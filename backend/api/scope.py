from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

import json

from db import get_db
from models.entities import Document, Property, ScopeItem, Scenario
from schemas.scope import ScopeItemCreate, ScopeItemRead, ScopeItemUpdate
from schemas.cost import CostMatchResult
from services import claude_client
from services.claude_client import ClaudeError, load_prompt, text_block
from services.cost_engine import apply_match_to_scope_item, match_cost, top_matches, writeback_override
from services.extractor import _doc_content_blocks


router = APIRouter(prefix="/api/properties/{property_id}/scope", tags=["scope"])


def _read(item: ScopeItem) -> ScopeItemRead:
    d = {c.name: getattr(item, c.name) for c in ScopeItem.__table__.columns}
    effective = item.override_unit_cost if item.override_unit_cost is not None else (item.suggested_unit_cost or 0.0)
    eff_qty = item.effective_quantity()
    return ScopeItemRead(
        **d,
        effective_unit_cost=effective,
        effective_quantity=eff_qty,
        line_total=eff_qty * effective,
    )


def _auto_assign_scenarios(db: Session, property_id: str, item: ScopeItem):
    """Attach the item to scenarios whose auto_filter matches."""
    scenarios = db.execute(select(Scenario).where(Scenario.property_id == property_id)).scalars().all()
    for s in scenarios:
        f = s.auto_filter
        include = True
        if f and "priority_in" in f:
            include = item.priority in f["priority_in"]
        if f is None:
            include = item.included_in_budget
        if include and item not in s.scope_items:
            s.scope_items.append(item)


@router.get("", response_model=list[ScopeItemRead])
def list_scope(property_id: str, include_deleted: bool = False, db: Session = Depends(get_db)):
    q = select(ScopeItem).where(ScopeItem.property_id == property_id)
    if not include_deleted:
        q = q.where(ScopeItem.deleted.is_(False))
    items = db.execute(q.order_by(ScopeItem.division, ScopeItem.line_item)).scalars().all()
    return [_read(i) for i in items]


@router.post("", response_model=ScopeItemRead)
def create_scope_item(property_id: str, payload: ScopeItemCreate, db: Session = Depends(get_db)):
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    item = ScopeItem(property_id=property_id, **payload.model_dump(exclude_unset=True))
    # Auto-match a cost if none is provided.
    if item.suggested_unit_cost is None and item.override_unit_cost is None:
        apply_match_to_scope_item(db, item, prop.target_brand_tier)
    db.add(item)
    db.flush()
    _auto_assign_scenarios(db, property_id, item)
    db.commit()
    db.refresh(item)
    return _read(item)


@router.patch("/{item_id}", response_model=ScopeItemRead)
def update_scope_item(property_id: str, item_id: str, payload: ScopeItemUpdate, db: Session = Depends(get_db)):
    item = db.get(ScopeItem, item_id)
    if not item or item.property_id != property_id:
        raise HTTPException(404, "Scope item not found")
    data = payload.model_dump(exclude_unset=True)
    override_changed = "override_unit_cost" in data and data["override_unit_cost"] != item.override_unit_cost
    for k, v in data.items():
        setattr(item, k, v)

    # Override write-back (spec 6.2).
    if override_changed and item.override_unit_cost is not None:
        writeback_override(db, item, item.override_unit_cost, property_id)

    # Re-check scenario memberships if priority changed.
    if "priority" in data or "included_in_budget" in data:
        _auto_assign_scenarios(db, property_id, item)

    db.commit()
    db.refresh(item)
    return _read(item)


@router.delete("/all", status_code=204)
def delete_all_scope(property_id: str, db: Session = Depends(get_db)):
    """Hard-delete every scope item for a property so the user can start
    from scratch. Soft-delete isn't enough here — the user asked for a
    full reset, and leftover rows (even hidden) would show up in cost
    history and scenario joins."""
    items = db.execute(
        select(ScopeItem).where(ScopeItem.property_id == property_id)
    ).scalars().all()
    for item in items:
        db.delete(item)
    db.commit()


@router.delete("/{item_id}", status_code=204)
def delete_scope_item(property_id: str, item_id: str, db: Session = Depends(get_db)):
    item = db.get(ScopeItem, item_id)
    if not item or item.property_id != property_id:
        raise HTTPException(404, "Scope item not found")
    if item.source == "manual":
        db.delete(item)
    else:
        item.deleted = True  # soft-delete AI-extracted rows
    db.commit()


@router.post("/{item_id}/restore", response_model=ScopeItemRead)
def restore_scope_item(property_id: str, item_id: str, db: Session = Depends(get_db)):
    item = db.get(ScopeItem, item_id)
    if not item or item.property_id != property_id:
        raise HTTPException(404, "Scope item not found")
    item.deleted = False
    db.commit()
    db.refresh(item)
    return _read(item)


@router.post("/{item_id}/rematch", response_model=CostMatchResult)
def rematch_scope_item(property_id: str, item_id: str, db: Session = Depends(get_db)):
    item = db.get(ScopeItem, item_id)
    if not item or item.property_id != property_id:
        raise HTTPException(404, "Scope item not found")
    prop = db.get(Property, property_id)
    result = apply_match_to_scope_item(db, item, prop.target_brand_tier if prop else None)
    db.commit()
    return result


@router.post("/match-preview", response_model=CostMatchResult)
def match_preview(property_id: str, body: dict, db: Session = Depends(get_db)):
    """Preview a match without creating an item. Body: {item_name, unit?}."""
    prop = db.get(Property, property_id)
    tier = prop.target_brand_tier if prop else None
    return match_cost(db, body.get("item_name", ""), tier, body.get("unit"))


@router.get("/{item_id}/cost-matches")
def cost_matches(property_id: str, item_id: str, limit: int = 5, db: Session = Depends(get_db)):
    """Top N fuzzy matches for a scope item from the cost DB."""
    item = db.get(ScopeItem, item_id)
    if not item or item.property_id != property_id:
        raise HTTPException(404, "Scope item not found")
    prop = db.get(Property, property_id)
    tier = prop.target_brand_tier if prop else None
    return {"matches": top_matches(db, item.line_item, tier, limit=limit, unit=item.unit)}


@router.post("/{item_id}/ai-cost")
def ai_cost_estimate(property_id: str, item_id: str, db: Session = Depends(get_db)):
    """Ask Claude to suggest a unit cost for this item. Does not modify the DB."""
    item = db.get(ScopeItem, item_id)
    if not item or item.property_id != property_id:
        raise HTTPException(404, "Scope item not found")
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")

    tier = prop.target_brand_tier or "upper_upscale"
    # Pull a small sample of reference costs with compatible unit — mixing
    # units confuses the model (e.g. a per-key allowance presented alongside
    # an each-item scope row).
    samples = top_matches(db, item.line_item, tier, limit=5, unit=item.unit)
    ref_lines = [
        f"- {s['item_name']} ({s['brand_tier']}, {s['unit']}): ${s['suggested_cost']}"
        for s in samples
    ] or ["(no close matches with compatible unit in your cost database)"]

    prompt = load_prompt("ai_cost_estimate")
    try:
        out = claude_client.complete_json(
            system=prompt,
            user_content=[text_block(_cost_context(item, prop, ref_lines))],
            max_tokens=2000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))
    return out


def _cost_context(item: ScopeItem, prop: Property, ref_lines: list[str]) -> str:
    """Build the user-message context for an AI cost estimate.

    The model needs the unit and property scale to decide whether the cost
    is per-key, per-each, per-floor, etc. Without this context it used to
    collapse every estimate into "per unit" and the per-key scope items
    came out 100-1000× too low.
    """
    tier = prop.target_brand_tier or "upper_upscale"
    lines = [
        f"Scope item: {item.line_item}",
        f"Description: {item.description or '(none)'}",
        f"Division: {item.division}",
        f"Sub-area: {item.sub_area or '(none)'}",
        f"Unit: {item.unit or 'each'}    <-- cost must be per THIS unit",
        f"Quantity on the line: {item.quantity}",
    ]
    if item.multiplier_basis:
        lines.append(
            f"Multiplier basis: {item.multiplier_basis}  "
            f"(effective qty = {item.effective_quantity()} after scaling by property)"
        )
    lines += [
        "",
        "Property context (for scale reference only — do NOT pre-multiply):",
        f"- Brand tier: {tier}",
        f"- Property type: {prop.property_type or 'unknown'}",
        f"- Keys: {prop.keys or 'unknown'}",
        f"- Floors: {prop.floors or 'unknown'}",
        f"- Total GSF: {prop.total_gsf or 'unknown'}",
        "",
        "Reference costs from the user's DB (closest unit-compatible matches):",
        *ref_lines,
    ]
    return "\n".join(lines)


@router.post("/batch-cost")
def batch_cost_assign(property_id: str, body: dict, db: Session = Depends(get_db)):
    """Bulk-populate unit costs across a set of scope items.

    Body: {
      source: "ai" | "db" | "ai_or_db",   # "ai_or_db" tries DB first, falls back to AI
      divisions: list[str] | null,        # None = all divisions
      only_uncosted: bool = True,         # skip items that already have a cost
      confidence_threshold: "high"|"medium"|"low" = "medium"  # for DB matches
    }
    Returns: {updated: int, skipped: int, errors: list, items: [{id, line_item, suggested_unit_cost, source}]}
    """
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")

    source = (body.get("source") or "ai_or_db").lower()
    if source not in ("ai", "db", "ai_or_db"):
        raise HTTPException(400, "source must be 'ai', 'db', or 'ai_or_db'")
    divisions = body.get("divisions")
    only_uncosted = body.get("only_uncosted", True)
    confidence_threshold = body.get("confidence_threshold") or "medium"

    # Order thresholds so we know what's acceptable.
    threshold_rank = {"high": 3, "medium": 2, "low": 1}
    min_rank = threshold_rank.get(confidence_threshold, 2)
    tier = prop.target_brand_tier or "upper_upscale"

    candidates: list[ScopeItem] = []
    for it in prop.scope_items:
        if it.deleted or not it.included_in_budget:
            continue
        if divisions and it.division not in divisions:
            continue
        if only_uncosted and (it.override_unit_cost is not None or it.suggested_unit_cost is not None):
            continue
        candidates.append(it)

    if not candidates:
        return {"updated": 0, "skipped": 0, "errors": [], "items": []}

    updated = 0
    errors: list[str] = []
    result_items: list[dict] = []

    ai_prompt = None  # lazy-loaded only if we need it

    for item in candidates:
        cost: float | None = None
        cost_source: str | None = None

        # Try DB match first for "db" or "ai_or_db".
        if source in ("db", "ai_or_db"):
            result = match_cost(db, item.line_item, tier, item.unit)
            if (
                result.suggested_cost is not None
                and threshold_rank.get(result.confidence or "low", 1) >= min_rank
            ):
                item.suggested_unit_cost = result.suggested_cost
                item.cost_db_item_id = result.cost_db_item_id
                item.confidence = result.confidence
                cost = result.suggested_cost
                cost_source = f"db ({result.match_type}, {result.confidence})"

        # Fall back to AI if requested and we didn't already set a cost.
        if cost is None and source in ("ai", "ai_or_db"):
            try:
                if ai_prompt is None:
                    ai_prompt = load_prompt("ai_cost_estimate")
                samples = top_matches(db, item.line_item, tier, limit=5, unit=item.unit)
                ref_lines = [
                    f"- {s['item_name']} ({s['brand_tier']}, {s['unit']}): ${s['suggested_cost']}"
                    for s in samples
                ] or ["(no close matches with compatible unit in your cost database)"]
                out = claude_client.complete_json(
                    system=ai_prompt,
                    user_content=[text_block(_cost_context(item, prop, ref_lines))],
                    max_tokens=2000,
                )
                ai_cost = out.get("suggested_cost")
                if ai_cost is not None:
                    item.suggested_unit_cost = float(ai_cost)
                    item.confidence = out.get("confidence") or "medium"
                    cost = float(ai_cost)
                    cost_source = f"ai ({out.get('confidence') or 'medium'})"
            except ClaudeError as e:
                errors.append(f"{item.line_item}: {e}")
                continue
            except Exception as e:
                errors.append(f"{item.line_item}: {e}")
                continue

        if cost is not None:
            updated += 1
            result_items.append({
                "id": item.id,
                "line_item": item.line_item,
                "division": item.division,
                "suggested_unit_cost": cost,
                "source": cost_source,
            })

    db.commit()
    return {
        "updated": updated,
        "skipped": len(candidates) - updated,
        "total_candidates": len(candidates),
        "errors": errors,
        "items": result_items,
    }


@router.post("/breakdown-preview")
def breakdown_preview(property_id: str, body: dict, db: Session = Depends(get_db)):
    """Break down a PREVIEW (not-yet-committed) scope item. Body takes the raw
    item fields (label, description, division, etc.) instead of an item_id."""
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    label = (body.get("label") or body.get("line_item") or "").strip()
    if not label:
        raise HTTPException(400, "label (or line_item) is required")
    description = body.get("description") or ""
    division = body.get("division") or ""
    source = body.get("source") or "pip"

    prompt = load_prompt("breakdown_scope_item")
    context_lines = [
        f"Original line item: {label}",
        f"Description: {description or '(none)'}",
        f"Division: {division}",
        f"Source: {source}",
        f"Property type: {prop.property_type or 'unknown'}",
        f"Brand tier: {prop.target_brand_tier or 'unknown'}",
        f"Total keys: {prop.keys or 'unknown'}",
        f"Guestroom mix: {prop.guestroom_mix or '{}'}",
        f"Floors: {prop.floors or 'unknown'}",
    ]
    try:
        out = claude_client.complete_json(
            system=prompt,
            user_content=[text_block("\n".join(context_lines))],
            max_tokens=8000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))
    return out


@router.post("/{item_id}/breakdown")
def breakdown_item(property_id: str, item_id: str, db: Session = Depends(get_db)):
    """Ask Claude to suggest specific sub-items that break down a generic scope
    line. Does NOT modify the DB — returns suggestions for the user to review."""
    item = db.get(ScopeItem, item_id)
    if not item or item.property_id != property_id:
        raise HTTPException(404, "Scope item not found")
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")

    prompt = load_prompt("breakdown_scope_item")
    context_lines = [
        f"Original line item: {item.line_item}",
        f"Description: {item.description or '(none)'}",
        f"Division: {item.division}",
        f"Source: {item.source}",
        f"Property type: {prop.property_type or 'unknown'}",
        f"Brand tier: {prop.target_brand_tier or 'unknown'}",
        f"Total keys: {prop.keys or 'unknown'}",
        f"Guestroom mix: {prop.guestroom_mix or '{}'}",
        f"Floors: {prop.floors or 'unknown'}",
    ]
    try:
        out = claude_client.complete_json(
            system=prompt,
            user_content=[text_block("\n".join(context_lines))],
            max_tokens=8000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))
    return out


@router.post("/add-scope-from-description")
def add_scope_from_description(property_id: str, body: dict, db: Session = Depends(get_db)):
    """Given a PIP narrative description (the paragraph that sits just below
    a line-item label in the extraction preview), split it into the discrete
    scope items that description actually names.

    This endpoint intentionally uses a strict extraction prompt —
    `split_scope_from_description` — rather than the recommendation-style
    `breakdown_scope_item` used by "AI break down". Claude is instructed not
    to invent items beyond what the source text says, so output tracks the
    PIP's own wording line for line."""
    description = (body.get("description") or "").strip()
    if not description:
        raise HTTPException(400, "Description is required.")

    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")

    label = (body.get("label") or "").strip() or "(no label)"
    division = (body.get("division") or "").strip() or "Uncategorized"
    source = (body.get("source") or "").strip() or "pip"

    # Minimal context — just enough to assign division + per-key basis
    # correctly. The prompt itself enforces "extract only, don't invent".
    prompt = load_prompt("split_scope_from_description")
    user_text = (
        f"Line item label: {label}\n"
        f"Division: {division}\n"
        f"Source document type: {source}\n"
        f"Total keys (for basis math only): {prop.keys or 'unknown'}\n"
        "\n"
        "PIP narrative description — extract one scope line per distinct "
        "requirement it contains. Do not add anything the text does not say:\n"
        "\n"
        f"{description}"
    )
    try:
        out = claude_client.complete_json(
            system=prompt,
            user_content=[text_block(user_text)],
            max_tokens=6000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))
    return out


@router.post("/{item_id}/apply-breakdown")
def apply_breakdown(property_id: str, item_id: str, body: dict, db: Session = Depends(get_db)):
    """Soft-delete the original item and create the accepted breakdown suggestions.
    Body: {suggestions: [...accepted subset of the Claude response...]}"""
    item = db.get(ScopeItem, item_id)
    if not item or item.property_id != property_id:
        raise HTTPException(404, "Scope item not found")
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")

    suggestions = body.get("suggestions") or []
    if not isinstance(suggestions, list) or not suggestions:
        raise HTTPException(400, "No suggestions provided")

    created: list[ScopeItem] = []
    for s in suggestions:
        label = (s.get("label") or "").strip()
        if not label:
            continue
        new_item = ScopeItem(
            property_id=property_id,
            division=s.get("division") or item.division,
            line_item=label[:200],
            description=(s.get("description") or "")[:2000] or None,
            quantity=float(s.get("quantity") or 1),
            unit=(s.get("unit") or "each")[:20],
            multiplier_basis=s.get("multiplier_basis") if s.get("multiplier_basis") in ("keys", "floors", "keys_pct", "doubles", "suites") else None,
            priority=s.get("priority") if s.get("priority") in ("required", "recommended", "optional", "na") else "required",
            confidence="medium",
            source="manual",
            included_in_budget=True,
        )
        apply_match_to_scope_item(db, new_item, prop.target_brand_tier)
        db.add(new_item)
        db.flush()
        _auto_assign_scenarios(db, property_id, new_item)
        created.append(new_item)

    # Soft-delete the original (user can restore from the UI if they regret it).
    item.deleted = True

    db.commit()
    return {"created": [_read(c) for c in created], "soft_deleted_id": item.id}


@router.post("/suggestions")
def scope_suggestions(property_id: str, db: Session = Depends(get_db)):
    """Run an AI review over the current scope + property profile and return
    a list of potential issues (missing items, wrong quantities, things that
    don't make sense for the age/tier/market). Does NOT modify anything."""
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    items = db.execute(
        select(ScopeItem)
        .where(ScopeItem.property_id == property_id, ScopeItem.deleted.is_(False))
        .order_by(ScopeItem.division, ScopeItem.line_item)
    ).scalars().all()

    # Compact property profile (only fields relevant for the review).
    property_profile = {
        "name": prop.name,
        "city": prop.city,
        "state": prop.state,
        "current_brand": prop.current_brand,
        "target_brand": prop.target_brand,
        "target_brand_tier": prop.target_brand_tier,
        "property_type": prop.property_type,
        "year_built": prop.year_built,
        "year_last_renovated": prop.year_last_renovated,
        "keys": prop.keys,
        "floors": prop.floors,
        "towers": prop.towers,
        "total_gsf": prop.total_gsf,
        "guestroom_mix": prop.guestroom_mix,
        "roof_type": prop.roof_type,
        "roof_age": prop.roof_age,
        "passenger_elevators": prop.passenger_elevators,
        "service_elevators": prop.service_elevators,
        "elevator_modernization_status": prop.elevator_modernization_status,
        "fb_outlets": prop.fb_outlets,
        "meeting_space": prop.meeting_space_json,
        "pools": prop.pools_json,
        "spa_treatment_rooms": prop.spa_treatment_rooms,
        "fitness_sqft": prop.fitness_sqft,
        "parking_type": prop.parking_type,
        "parking_spaces": prop.parking_spaces,
        "mep": prop.mep_json,
        "sprinklered": prop.sprinklered,
        "fire_alarm_age": prop.fire_alarm_age,
    }
    scope_rows = [
        {
            "id": it.id,
            "division": it.division,
            "sub_area": it.sub_area,
            "line_item": it.line_item,
            "description": (it.description or "")[:300],
            "quantity": it.quantity,
            "unit": it.unit,
            "multiplier_basis": it.multiplier_basis,
            "effective_quantity": it.effective_quantity(),
            "priority": it.priority,
        }
        for it in items
    ]

    prompt = load_prompt(
        "scope_suggestions",
        substitutions={
            "property_json": json.dumps(property_profile, indent=2, default=str),
            "scope_json": json.dumps(scope_rows, indent=2, default=str),
        },
    )
    try:
        out = claude_client.complete_json(
            system=prompt,
            user_content=[text_block("Please produce the suggestions JSON.")],
            max_tokens=6000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))
    return out
