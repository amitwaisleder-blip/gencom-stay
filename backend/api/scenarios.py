from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Property, Scenario, ScopeItem
from schemas.scenario import (
    ScenarioCreate, ScenarioRead, ScenarioScopeUpdate, ScenarioTotals, ScenarioUpdate,
)


router = APIRouter(prefix="/api/properties/{property_id}/scenarios", tags=["scenarios"])


# Keyword patterns for soft-cost basis_categories. Matched against the scope
# item's line_item (case-insensitive). Accepts the canonical user-facing labels.
_CATEGORY_PATTERNS: dict[str, list[str]] = {
    "Casegoods": [
        "bed frame", "headboard", "nightstand", "dresser", "desk",
        "credenza", "armoire", "wardrobe", "bench", "console", "etagere", "étagère",
        "bookcase", "cabinet", "millwork", "table", "sideboard", "buffet",
        "media ", "vanity desk", "vanity/makeup",
    ],
    "Softgoods": [
        "drapery", "sheer", "pillow", "duvet", "bedspread", "bed scarf",
        "cushion", "upholster", "throw", "bed linen", "bath linen",
        "coverlet", "valance", "cornice",
    ],
    "Floor finishes": [
        "carpet", "area rug", "entry runner", "flooring", "hard surface flooring",
        "lvt", "porcelain floor", "stone floor", "wood floor", "tile floor",
        "transitions", "carpet pad",
    ],
    "Wallcover": [
        "wallcovering", "wallpaper", "vinyl wall", "wall base", "wall paint",
        "accent wall", "wall panel", "paneling", "chair rail", "crown molding",
    ],
    "Window Cover": [
        "drapery", "sheer", "shade", "curtain", "blackout", "motorized shade",
        "valance", "cornice", "window treatment", "drapery rod",
    ],
}

# Keywords for excluding IT + BOH items from a division-based basis.
_IT_BOH_EXCLUDE_PATTERNS: list[str] = [
    "wi-fi", "wifi", "ap (", "low voltage", "it / ", "network ", "cabling",
    "server", "switch ", "fiber ",
    "boh ", "back of house", "employee locker", "housekeeping closet",
    "loading dock", "dock seal", "compactor", "trash room", "recycling",
]


def _matches_any(item: ScopeItem, patterns: list[str]) -> bool:
    hay = (item.line_item or "").lower()
    return any(p in hay for p in patterns)


@router.get("", response_model=list[ScenarioRead])
def list_scenarios(property_id: str, db: Session = Depends(get_db)):
    return list(db.execute(
        select(Scenario).where(Scenario.property_id == property_id).order_by(Scenario.created_at)
    ).scalars().all())


@router.post("", response_model=ScenarioRead)
def create_scenario(property_id: str, payload: ScenarioCreate, db: Session = Depends(get_db)):
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    s = Scenario(property_id=property_id, **payload.model_dump(exclude_unset=True))
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@router.patch("/{scenario_id}", response_model=ScenarioRead)
def update_scenario(property_id: str, scenario_id: str, payload: ScenarioUpdate, db: Session = Depends(get_db)):
    s = db.get(Scenario, scenario_id)
    if not s or s.property_id != property_id:
        raise HTTPException(404, "Scenario not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    # If the breakdown changed and the caller didn't also set soft_cost_pct explicitly,
    # re-derive soft_cost_pct from the sum of the breakdown lines.
    if "soft_cost_breakdown" in data and "soft_cost_pct" not in data:
        if s.soft_cost_breakdown:
            s.soft_cost_pct = sum(float(line.get("pct", 0) or 0) for line in s.soft_cost_breakdown)

    # When the property is in "synced" mode, mirror soft_cost_breakdown edits
    # to every sibling scenario so the three views stay in lockstep.
    if "soft_cost_breakdown" in data:
        prop = db.get(Property, property_id)
        if prop and prop.soft_costs_synced:
            siblings = db.execute(
                select(Scenario).where(
                    Scenario.property_id == property_id,
                    Scenario.id != scenario_id,
                )
            ).scalars().all()
            for sib in siblings:
                sib.soft_cost_breakdown = s.soft_cost_breakdown
                sib.soft_cost_pct = s.soft_cost_pct

    db.commit()
    db.refresh(s)
    return s


@router.delete("/{scenario_id}", status_code=204)
def delete_scenario(property_id: str, scenario_id: str, db: Session = Depends(get_db)):
    s = db.get(Scenario, scenario_id)
    if not s or s.property_id != property_id:
        raise HTTPException(404, "Scenario not found")
    db.delete(s)
    db.commit()


@router.post("/{scenario_id}/scope", status_code=204)
def update_scenario_scope(
    property_id: str, scenario_id: str, payload: ScenarioScopeUpdate, db: Session = Depends(get_db)
):
    """Manual add/remove of scope items from a scenario."""
    s = db.get(Scenario, scenario_id)
    if not s or s.property_id != property_id:
        raise HTTPException(404, "Scenario not found")
    existing_ids = {i.id for i in s.scope_items}
    for add_id in payload.add_ids:
        if add_id in existing_ids:
            continue
        item = db.get(ScopeItem, add_id)
        if item and item.property_id == property_id:
            s.scope_items.append(item)
    if payload.remove_ids:
        s.scope_items = [i for i in s.scope_items if i.id not in set(payload.remove_ids)]
    db.commit()


def compute_scenario_totals(s: Scenario, prop: Property | None) -> ScenarioTotals:
    """Shared totals computation used by both the scenarios endpoint and the
    Dashboard card totals. Kept in one place so the two surfaces agree.
    """
    division_subtotals: dict[str, float] = {}
    priority_breakdown: dict[str, float] = {"required": 0, "recommended": 0, "optional": 0, "na": 0}
    base = 0.0
    # Keep per-item totals around so category-based basis filters can replay them.
    item_totals: list[tuple[ScopeItem, float]] = []
    for item in s.scope_items:
        if not item.included_in_budget or item.deleted:
            continue
        total = item.line_total()
        division_subtotals[item.division] = division_subtotals.get(item.division, 0) + total
        priority_breakdown[item.priority] = priority_breakdown.get(item.priority, 0) + total
        base += total
        item_totals.append((item, total))

    # Deferred maintenance excluded from the default basis for most soft costs.
    dm_keys = [k for k in division_subtotals if "DEFERRED" in k.upper()]
    dm_total = sum(division_subtotals[k] for k in dm_keys)
    non_dm_base = base - dm_total
    # IT + BOH exclusion total (computed lazily when requested).
    it_boh_total = sum(t for it, t in item_totals if _matches_any(it, _IT_BOH_EXCLUDE_PATTERNS))
    non_dm_ex_it_boh = non_dm_base - sum(
        t for it, t in item_totals
        if "DEFERRED" not in it.division.upper() and _matches_any(it, _IT_BOH_EXCLUDE_PATTERNS)
    )
    base_ex_it_boh = base - it_boh_total

    # ─── Soft costs with groups + per-line basis ─────────────────────
    # Group order: soft → contingency → dev_fee. Within each group a line
    # can reference names from EARLIER groups only (avoids cycles).
    line_amounts: dict[str, float] = {}
    group_totals: dict[str, float] = {"soft": 0.0, "contingency": 0.0, "dev_fee": 0.0}

    def _compute_base(line: dict) -> float:
        """Assemble the base dollar amount that this line's pct applies to."""
        basis_cats = line.get("basis_categories")
        basis_divs = line.get("basis_divisions")
        if basis_cats is not None:
            # Category-based — sum items matching any of the requested categories.
            patterns: list[str] = []
            for cat in basis_cats:
                patterns.extend(_CATEGORY_PATTERNS.get(cat, []))
            hard_portion = (
                0.0 if not patterns
                else sum(t for it, t in item_totals if _matches_any(it, patterns))
            )
        elif basis_divs is not None:
            hard_portion = sum(division_subtotals.get(d, 0) for d in basis_divs)
        else:
            # Full default.
            exclude_dm = line.get("basis_exclude_dm")
            if exclude_dm is None:
                exclude_dm = not bool(line.get("include_dm"))
            exclude_it_boh = bool(line.get("basis_exclude_it_boh"))
            if exclude_dm and exclude_it_boh:
                hard_portion = non_dm_ex_it_boh
            elif exclude_dm:
                hard_portion = non_dm_base
            elif exclude_it_boh:
                hard_portion = base_ex_it_boh
            else:
                hard_portion = base
        # Stacked soft / contingency lines that already computed.
        soft_lines = line.get("basis_soft_lines") or []
        stacked = sum(line_amounts.get(name, 0.0) for name in soft_lines)
        return hard_portion + stacked

    # Process in group order.
    breakdown = s.soft_cost_breakdown or []
    for group in ("soft", "contingency", "dev_fee"):
        for line in breakdown:
            g = line.get("group") or "soft"
            if g != group:
                continue
            line_base = _compute_base(line)
            amt = 0.0
            pct = line.get("pct")
            fixed = line.get("fixed")
            if pct is not None:
                amt += float(pct) * line_base
            if fixed is not None:
                amt += float(fixed)
            line_amounts[line.get("name", "")] = amt
            group_totals[group] += amt

    # Compatibility fallback for scenarios with NO breakdown at all.
    if not breakdown:
        group_totals["soft"] = non_dm_base * s.soft_cost_pct
        group_totals["contingency"] = non_dm_base * s.contingency_pct

    soft_costs = group_totals["soft"]
    contingency = group_totals["contingency"]
    escalation = non_dm_base * s.escalation_pct
    ffe = non_dm_base * s.ffe_pct
    ose = non_dm_base * s.ose_pct
    tech = non_dm_base * s.tech_pct
    dev_fee = group_totals["dev_fee"]

    grand = base + soft_costs + contingency + escalation + ffe + ose + tech + dev_fee

    dpk = (grand / prop.keys) if prop and prop.keys and prop.keys > 0 else 0
    dpg = (grand / prop.total_gsf) if prop and prop.total_gsf and prop.total_gsf > 0 else 0

    return ScenarioTotals(
        scenario_id=s.id,
        scenario_name=s.name,
        division_subtotals={k: round(v, 2) for k, v in division_subtotals.items()},
        base_total=round(base, 2),
        soft_costs=round(soft_costs, 2),
        contingency=round(contingency, 2),
        dev_fee=round(dev_fee, 2),
        escalation=round(escalation, 2),
        ffe=round(ffe, 2),
        ose=round(ose, 2),
        tech=round(tech, 2),
        grand_total=round(grand, 2),
        dollars_per_key=round(dpk, 2),
        dollars_per_gsf=round(dpg, 2),
        priority_breakdown={k: round(v, 2) for k, v in priority_breakdown.items()},
        soft_cost_line_amounts={k: round(v, 2) for k, v in line_amounts.items()},
    )


@router.get("/{scenario_id}/totals", response_model=ScenarioTotals)
def scenario_totals(property_id: str, scenario_id: str, db: Session = Depends(get_db)):
    s = db.get(Scenario, scenario_id)
    if not s or s.property_id != property_id:
        raise HTTPException(404, "Scenario not found")
    prop = db.get(Property, property_id)
    return compute_scenario_totals(s, prop)
