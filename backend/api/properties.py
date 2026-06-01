from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import UPLOADS_DIR
from db import get_db
from models.entities import Property, Scenario, ScopeItem
from schemas.property import PropertyCardRead, PropertyCreate, PropertyRead, PropertyUpdate
from api.scenarios import compute_scenario_totals


router = APIRouter(prefix="/api/properties", tags=["properties"])


REQUIRED_SETUP_FIELDS = ("name", "keys", "target_brand", "property_type")


def _setup_complete(p: Property) -> bool:
    return all(getattr(p, f) not in (None, "") for f in REQUIRED_SETUP_FIELDS)


def _scenario_grand_totals(db: Session, prop: Property) -> dict[str, float]:
    """Grand total for each scenario on this property, keyed by scenario name.
    Uses the same computation as the Summary page so dashboard numbers match."""
    scenarios = db.execute(
        select(Scenario).where(Scenario.property_id == prop.id).order_by(Scenario.created_at)
    ).scalars().all()
    out: dict[str, float] = {}
    for s in scenarios:
        t = compute_scenario_totals(s, prop)
        out[s.name] = round(t.grand_total, 2)
    return out


def _default_scenario_breakdown(db: Session, prop: Property) -> tuple[float, float, float]:
    """Return (hard, soft_plus, grand) for the default scenario — still used
    as the single headline number on the card."""
    scenario = db.execute(
        select(Scenario).where(
            Scenario.property_id == prop.id, Scenario.is_default.is_(True)
        )
    ).scalar_one_or_none()
    if not scenario:
        return 0.0, 0.0, 0.0
    t = compute_scenario_totals(scenario, prop)
    hard = t.base_total
    soft_plus = (
        t.soft_costs + t.contingency + t.dev_fee
        + t.escalation + t.ffe + t.ose + t.tech
    )
    return round(hard, 2), round(soft_plus, 2), round(t.grand_total, 2)


@router.get("", response_model=list[PropertyCardRead])
def list_properties(archived: bool = False, db: Session = Depends(get_db)):
    rows = db.execute(
        select(Property).where(Property.archived.is_(archived)).order_by(Property.updated_at.desc())
    ).scalars().all()
    cards: list[PropertyCardRead] = []
    for p in rows:
        hard, soft, grand = _default_scenario_breakdown(db, p)
        dpk = round(grand / p.keys, 2) if p.keys and p.keys > 0 else 0.0
        totals = _scenario_grand_totals(db, p)
        cards.append(
            PropertyCardRead(
                id=p.id,
                name=p.name,
                current_brand=p.current_brand,
                current_flag=p.current_flag,
                target_brand=p.target_brand,
                target_flag=p.target_flag,
                address=p.address,
                city=p.city,
                state=p.state,
                keys=p.keys,
                year_built=p.year_built,
                thumbnail_path=p.thumbnail_path,
                updated_at=p.updated_at,
                archived=p.archived,
                default_scenario_total=grand,
                dollars_per_key=dpk,
                hard_total=hard,
                soft_total=soft,
                grand_total=grand,
                required_total=totals.get("Required Only", 0.0),
                required_recommended_total=totals.get("Required + Recommended", 0.0),
                full_scope_total=totals.get("Full Scope", 0.0),
                setup_complete=_setup_complete(p),
            )
        )
    return cards


@router.post("", response_model=PropertyRead)
def create_property(payload: PropertyCreate, db: Session = Depends(get_db)):
    p = Property(**payload.model_dump(exclude_unset=True))
    db.add(p)
    db.flush()
    # Default soft-cost stack split into three groups:
    #   • soft         — applies to hard costs ex-DM
    #   • contingency  — applies to hard costs ex-DM + all soft lines
    #   • dev_fee      — applies to hard costs ex-DM + all soft + all contingency
    soft_names = [
        "GC General Conditions, Insurance & Fees",
        "Attic Stock, Freight, Warehouse & Install",
        "Permits",
        "Design Professionals (A/E/ID/PA)",
        "Project Management",
        "Purchasing Agent",
    ]
    default_soft_breakdown = [
        {"name": "GC General Conditions, Insurance & Fees", "pct": 0.08, "group": "soft"},
        {"name": "Attic Stock, Freight, Warehouse & Install", "pct": 0.42, "group": "soft"},
        {"name": "Permits", "fixed": 75000, "group": "soft"},
        {"name": "Design Professionals (A/E/ID/PA)", "pct": 0.08, "group": "soft"},
        {"name": "Project Management", "pct": 0.04, "group": "soft"},
        {"name": "Purchasing Agent", "pct": 0.05, "group": "soft"},
        {"name": "Contingency", "pct": 0.07, "group": "contingency", "basis_soft_lines": soft_names},
        {"name": "Developer's Fee", "pct": 0.03, "group": "dev_fee", "basis_soft_lines": [*soft_names, "Contingency"]},
    ]
    defaults = [
        ("Required Only", False, {"priority_in": ["required"]}),
        ("Required + Recommended", False, {"priority_in": ["required", "recommended"]}),
        ("Full Scope", True, None),
    ]
    for name, is_default, auto_filter in defaults:
        db.add(Scenario(
            property_id=p.id, name=name, is_default=is_default, auto_filter=auto_filter,
            soft_cost_breakdown=default_soft_breakdown,
            soft_cost_pct=sum((x.get("pct") or 0) for x in default_soft_breakdown),
            # We track the full soft stack in soft_cost_breakdown — turn off the
            # separate flat-pct buckets so we don't double-count.
            contingency_pct=0.0,
            escalation_pct=0.0,
        ))
    db.commit()
    db.refresh(p)
    return p


@router.get("/{property_id}", response_model=PropertyRead)
def get_property(property_id: str, db: Session = Depends(get_db)):
    p = db.get(Property, property_id)
    if not p:
        raise HTTPException(404, "Property not found")
    return p


@router.patch("/{property_id}", response_model=PropertyRead)
def update_property(property_id: str, payload: PropertyUpdate, db: Session = Depends(get_db)):
    p = db.get(Property, property_id)
    if not p:
        raise HTTPException(404, "Property not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@router.post("/{property_id}/archive", response_model=PropertyRead)
def archive_property(property_id: str, db: Session = Depends(get_db)):
    p = db.get(Property, property_id)
    if not p:
        raise HTTPException(404, "Property not found")
    p.archived = True
    db.commit()
    db.refresh(p)
    return p


@router.post("/{property_id}/restore", response_model=PropertyRead)
def restore_property(property_id: str, db: Session = Depends(get_db)):
    p = db.get(Property, property_id)
    if not p:
        raise HTTPException(404, "Property not found")
    p.archived = False
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{property_id}", status_code=204)
def delete_property(property_id: str, db: Session = Depends(get_db)):
    p = db.get(Property, property_id)
    if not p:
        raise HTTPException(404, "Property not found")
    db.delete(p)
    db.commit()


ALLOWED_THUMB_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


@router.post("/{property_id}/thumbnail", response_model=PropertyRead)
async def upload_thumbnail(property_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    p = db.get(Property, property_id)
    if not p:
        raise HTTPException(404, "Property not found")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_THUMB_EXTS:
        raise HTTPException(400, f"Thumbnail must be one of {sorted(ALLOWED_THUMB_EXTS)}")

    # Clean up old thumbnail file if it lives under uploads.
    if p.thumbnail_path:
        old = UPLOADS_DIR / p.thumbnail_path
        try:
            if old.is_file() and UPLOADS_DIR in old.resolve().parents:
                old.unlink()
        except Exception:
            pass

    prop_dir = UPLOADS_DIR / property_id
    prop_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"thumb_{uuid.uuid4().hex[:8]}{suffix}"
    dest = prop_dir / stored_name
    dest.write_bytes(await file.read())

    # Store relative-to-UPLOADS_DIR with POSIX separators so the /files/uploads
    # static mount can serve it on any OS.
    p.thumbnail_path = f"{property_id}/{stored_name}"
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{property_id}/thumbnail", response_model=PropertyRead)
def delete_thumbnail(property_id: str, db: Session = Depends(get_db)):
    p = db.get(Property, property_id)
    if not p:
        raise HTTPException(404, "Property not found")
    if p.thumbnail_path:
        old = UPLOADS_DIR / p.thumbnail_path
        try:
            if old.is_file() and UPLOADS_DIR in old.resolve().parents:
                old.unlink()
        except Exception:
            pass
    p.thumbnail_path = None
    db.commit()
    db.refresh(p)
    return p


@router.post("/{property_id}/duplicate", response_model=PropertyRead)
def duplicate_property(property_id: str, db: Session = Depends(get_db)):
    src = db.get(Property, property_id)
    if not src:
        raise HTTPException(404, "Property not found")
    clone_fields = {c.name for c in Property.__table__.columns} - {"id", "created_at", "updated_at", "archived"}
    clone = Property(**{f: getattr(src, f) for f in clone_fields})
    if clone.name:
        clone.name = f"{clone.name} (copy)"
    db.add(clone)
    db.flush()
    # Clone scenarios (without scope items for now — scope will be empty on clone per spec)
    for s in src.scenarios:
        db.add(Scenario(
            property_id=clone.id, name=s.name, is_default=s.is_default,
            soft_cost_pct=s.soft_cost_pct, contingency_pct=s.contingency_pct,
            escalation_pct=s.escalation_pct, ffe_pct=s.ffe_pct, ose_pct=s.ose_pct,
            tech_pct=s.tech_pct, auto_filter=s.auto_filter,
        ))
    # Clone scope items
    for item in src.scope_items:
        if item.deleted:
            continue
        db.add(ScopeItem(
            property_id=clone.id, division=item.division, line_item=item.line_item,
            description=item.description, quantity=item.quantity, unit=item.unit,
            suggested_unit_cost=item.suggested_unit_cost, override_unit_cost=item.override_unit_cost,
            source="manual", priority=item.priority, confidence=item.confidence,
            notes=item.notes, included_in_budget=item.included_in_budget,
        ))
    db.commit()
    db.refresh(clone)
    return clone
