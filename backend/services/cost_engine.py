"""Cost matching engine per spec Section 6.

Algorithm:
  1. Exact match: case-insensitive item_name equal + tier equal → High confidence
  2. Fuzzy match: rapidfuzz ratio > 85 on same tier → Medium confidence
  3. Cross-tier match: match in adjacent tier, apply multiplier → Low confidence
  4. AI fallback: call Claude with scope item + property context → Low

Override write-back (step 6.2) is a separate function invoked when the user
sets override_unit_cost on a scope item.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from rapidfuzz import fuzz, process
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.entities import CostDatabaseItem, CostHistory, Property, ScopeItem
from schemas.cost import CostMatchResult


TIER_ORDER = ["upscale", "upper_upscale", "luxury"]

# Cross-tier multipliers (configurable in the future).
# To convert FROM upscale TO the target tier.
TIER_MULTIPLIER_FROM_UPSCALE = {
    "upscale": 1.0,
    "upper_upscale": 1.25,
    "luxury": 1.6,
}


def _tier_multiplier(from_tier: str, to_tier: str) -> float:
    """Return multiplier to convert a cost from from_tier to to_tier."""
    from_m = TIER_MULTIPLIER_FROM_UPSCALE.get(from_tier, 1.0)
    to_m = TIER_MULTIPLIER_FROM_UPSCALE.get(to_tier, 1.0)
    if from_m == 0:
        return 1.0
    return to_m / from_m


# Unit compatibility groups. Matching a per-key benchmark to an "each" scope
# item is the #1 source of bad estimates (Nehmer/HVS per-key allowances are
# aggregate numbers, not per-unit prices), so we gate matches by these groups.
_UNIT_GROUPS: dict[str, str] = {
    # Per-unit (physical thing you can count)
    "each": "each", "ea": "each", "unit": "each", "lot": "each",
    # Per-key (one guestroom)
    "per key": "per_key", "per room": "per_key", "per_key": "per_key", "key": "per_key", "keys": "per_key",
    # Per-floor
    "per floor": "per_floor", "floors": "per_floor",
    # Area
    "sf": "area", "sqft": "area", "sq ft": "area", "sqm": "area",
    "sy": "area_sy", "sq yd": "area_sy", "sqyd": "area_sy",
    # Linear
    "lf": "linear", "lin ft": "linear",
    # Lump sum / allowance — treat as compatible with each other and with "each"
    "ls": "allowance", "allowance": "allowance", "lump sum": "allowance",
    # Percentage of keys
    "% of keys": "pct_keys", "pct keys": "pct_keys",
}


def _unit_group(unit: Optional[str]) -> str:
    """Normalize a free-form unit string to one of a small set of groups."""
    if not unit:
        return "unknown"
    u = unit.strip().lower()
    if u in _UNIT_GROUPS:
        return _UNIT_GROUPS[u]
    # Heuristics for long-form strings the user might enter.
    if "key" in u or "room" in u:
        return "per_key"
    if "floor" in u:
        return "per_floor"
    if "sqft" in u or "sf" in u.split() or "square" in u:
        return "area"
    return "unknown"


def _unit_compat(a: Optional[str], b: Optional[str]) -> float:
    """Return a 0.0–1.0 compatibility score between two unit strings.

    1.0  — same group (e.g. both "each" or both "per key")
    0.7  — one side unknown (give benefit of the doubt, but downrank)
    0.3  — allowance ↔ each (fuzzy: an allowance could stand in for a per-unit cost)
    0.0  — different concrete groups (e.g. per-key vs each)
    """
    ga, gb = _unit_group(a), _unit_group(b)
    if ga == gb:
        return 1.0
    if ga == "unknown" or gb == "unknown":
        return 0.7
    if {ga, gb} == {"allowance", "each"}:
        return 0.3
    return 0.0


def _candidates(db: Session, tier: Optional[str] = None) -> list[CostDatabaseItem]:
    q = select(CostDatabaseItem).where(CostDatabaseItem.archived.is_(False))
    if tier:
        q = q.where(CostDatabaseItem.brand_tier == tier)
    return list(db.execute(q).scalars().all())


def top_matches(
    db: Session,
    item_name: str,
    brand_tier: Optional[str],
    limit: int = 5,
    unit: Optional[str] = None,
) -> list[dict]:
    """Return the top fuzzy cost-DB matches for an item_name, ranked.
    Includes items from all tiers with tier-adjusted costs for non-target tiers.

    When `unit` is supplied, results are ranked by (name_score × unit_compat)
    and candidates with zero unit-compatibility are dropped. This prevents a
    per-key benchmark row from being offered as a reference for a per-each
    scope item (which happens constantly with fuzzy name scoring alone)."""
    if not item_name.strip():
        return []
    target_tier = brand_tier or "upper_upscale"

    # Pull a wider candidate pool from rapidfuzz than `limit`, then re-rank by
    # (name × unit). This matters because the best name match might have an
    # incompatible unit, and we need runner-ups with compatible units.
    pool_size = max(limit * 4, 20)
    ranked: list[tuple[float, float, int, "CostDatabaseItem", bool]] = []
    # (combined_score, name_score, tier_adjust_flag_as_int, candidate_obj, is_tier_adj)

    def _score_pool(pool: list[CostDatabaseItem], is_cross_tier: bool):
        if not pool:
            return
        scored = process.extract(
            item_name, [c.item_name for c in pool],
            scorer=fuzz.WRatio, limit=pool_size,
        )
        for _matched_name, score, idx in scored:
            if score < 40:
                continue
            c = pool[idx]
            compat = _unit_compat(unit, c.unit) if unit else 1.0
            if compat <= 0.0:
                continue  # hard-drop unit mismatches
            combined = float(score) * compat
            ranked.append((combined, float(score), 1 if is_cross_tier else 0, c, is_cross_tier))

    _score_pool(_candidates(db, target_tier), is_cross_tier=False)
    for tier in TIER_ORDER:
        if tier == target_tier:
            continue
        _score_pool(_candidates(db, tier), is_cross_tier=True)

    # Prefer same-tier (tier_adjust=0) over cross-tier when combined scores tie.
    ranked.sort(key=lambda r: (-r[0], r[2], -r[1]))

    results: list[dict] = []
    for combined, name_score, _tier_flag, c, is_cross in ranked[:limit]:
        if is_cross:
            adj = round(c.suggested_cost * _tier_multiplier(c.brand_tier, target_tier), 2)
            results.append({
                "cost_db_item_id": c.id,
                "item_name": c.item_name,
                "unit": c.unit,
                "brand_tier": c.brand_tier,
                "suggested_cost": adj,
                "original_cost": c.suggested_cost,
                "score": int(name_score),
                "tier_adjusted": True,
                "source": c.source,
            })
        else:
            results.append({
                "cost_db_item_id": c.id,
                "item_name": c.item_name,
                "unit": c.unit,
                "brand_tier": c.brand_tier,
                "suggested_cost": c.suggested_cost,
                "score": int(name_score),
                "tier_adjusted": False,
                "source": c.source,
            })
    return results


def match_cost(
    db: Session,
    item_name: str,
    brand_tier: Optional[str],
    unit: Optional[str] = None,
) -> CostMatchResult:
    """Find the best CostDatabaseItem for a given scope item description + tier.

    Unit compatibility gates the match. A per-key benchmark row will not be
    returned as the match for an "each" scope item, and vice versa — these
    mismatches used to be the #1 source of wildly wrong estimates."""
    if not item_name:
        return CostMatchResult(match_type="none", confidence="low", explanation="empty item name")

    target_tier = brand_tier or "upper_upscale"
    needle = item_name.strip().lower()

    def _compat_ok(c: CostDatabaseItem, *, exact_name: bool) -> bool:
        # Exact name matches are allowed through at compat ≥ 0.3 (the user
        # wrote the same name, trust them even if units differ slightly).
        # Fuzzy matches require a stronger unit match.
        compat = _unit_compat(unit, c.unit) if unit else 1.0
        return compat >= (0.3 if exact_name else 0.7)

    # Step 1: exact match on target tier — gated by unit compat.
    same_tier = _candidates(db, target_tier)
    for c in same_tier:
        if c.item_name.strip().lower() == needle and _compat_ok(c, exact_name=True):
            return CostMatchResult(
                cost_db_item_id=c.id,
                suggested_cost=c.suggested_cost,
                match_type="exact",
                confidence="high",
                matched_item_name=c.item_name,
                explanation=f"Exact name match in {c.brand_tier} tier ({c.unit})",
            )

    # Step 2: fuzzy match on target tier — walk ranked candidates and keep the
    # first one whose unit is compatible. (rapidfuzz's best-only would hand us
    # a unit-mismatched winner; we want the best *compatible* one.)
    if same_tier:
        names = [c.item_name for c in same_tier]
        scored = process.extract(item_name, names, scorer=fuzz.WRatio, limit=10)
        for _matched_name, score, idx in scored:
            if score < 88:
                break
            c = same_tier[idx]
            if _compat_ok(c, exact_name=False):
                return CostMatchResult(
                    cost_db_item_id=c.id,
                    suggested_cost=c.suggested_cost,
                    match_type="fuzzy",
                    confidence="medium" if score >= 92 else "low",
                    matched_item_name=c.item_name,
                    explanation=f"Fuzzy match ({int(score)}%, {c.unit}) in {c.brand_tier} tier",
                )

    # Step 3: cross-tier match — same ranked-walk pattern.
    for tier in TIER_ORDER:
        if tier == target_tier:
            continue
        others = _candidates(db, tier)
        if not others:
            continue
        names = [c.item_name for c in others]
        scored = process.extract(item_name, names, scorer=fuzz.WRatio, limit=10)
        for _matched_name, score, idx in scored:
            if score < 88:
                break
            c = others[idx]
            if _compat_ok(c, exact_name=False):
                adj_cost = round(c.suggested_cost * _tier_multiplier(c.brand_tier, target_tier), 2)
                return CostMatchResult(
                    cost_db_item_id=c.id,
                    suggested_cost=adj_cost,
                    match_type="cross_tier",
                    confidence="low",
                    matched_item_name=c.item_name,
                    explanation=f"Cross-tier match from {c.brand_tier} (x{_tier_multiplier(c.brand_tier, target_tier):.2f})",
                )

    return CostMatchResult(
        match_type="none",
        confidence="low",
        explanation="No matching item with compatible unit found. AI estimate or manual entry recommended.",
    )


def apply_match_to_scope_item(db: Session, scope_item: ScopeItem, brand_tier: Optional[str]) -> CostMatchResult:
    """Run matching and populate scope item's suggested_unit_cost + cost_db_item_id.
    Does NOT commit — caller commits.
    """
    result = match_cost(db, scope_item.line_item, brand_tier, scope_item.unit)
    if result.suggested_cost is not None:
        scope_item.suggested_unit_cost = result.suggested_cost
        scope_item.cost_db_item_id = result.cost_db_item_id
        scope_item.confidence = result.confidence
    return result


def writeback_override(
    db: Session,
    scope_item: ScopeItem,
    new_value: float,
    property_id: str,
) -> CostDatabaseItem:
    """When a user sets override_unit_cost on a scope item, upsert a CostDatabaseItem
    and record the override in cost_history. Most-recent wins.

    Returns the updated or newly-created CostDatabaseItem.
    """
    # Find the property's brand tier.
    prop = db.get(Property, property_id)
    tier = prop.target_brand_tier if prop and prop.target_brand_tier else "upper_upscale"

    item = None
    if scope_item.cost_db_item_id:
        item = db.get(CostDatabaseItem, scope_item.cost_db_item_id)

    if item is None:
        # Try to find by (name, tier).
        needle = scope_item.line_item.strip().lower()
        candidates = _candidates(db, tier)
        for c in candidates:
            if c.item_name.strip().lower() == needle:
                item = c
                break

    if item is None:
        item = CostDatabaseItem(
            item_name=scope_item.line_item.strip(),
            unit=scope_item.unit or "each",
            brand_tier=tier,
            suggested_cost=new_value,
            source="actual_project",
            last_used_at=datetime.now(timezone.utc),
            last_used_property_id=property_id,
        )
        db.add(item)
        db.flush()
        scope_item.cost_db_item_id = item.id
    else:
        item.suggested_cost = new_value
        item.source = "actual_project"
        item.last_used_at = datetime.now(timezone.utc)
        item.last_used_property_id = property_id

    # Record history.
    db.add(CostHistory(
        cost_db_item_id=item.id,
        value=new_value,
        property_id=property_id,
    ))

    # Recompute low/high range from all history for this item.
    history = db.execute(
        select(CostHistory).where(CostHistory.cost_db_item_id == item.id)
    ).scalars().all()
    if history:
        values = [h.value for h in history]
        item.historical_range_low = min(values)
        item.historical_range_high = max(values)

    return item
