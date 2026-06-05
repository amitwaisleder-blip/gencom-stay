"""Deferred-maintenance cost database.

Independent of the main cost DB — this table stores real past project line
items harvested from proposals, estimates, and budgets. The user drops in a
document, Claude extracts the line items, and they end up in dm_cost_items
tagged with category/subcategory, contractor, date, city, and hotel.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from config import UPLOADS_DIR
from db import get_db
from models.entities import DmCostItem
from services import claude_client
from services.claude_client import ClaudeError, load_prompt, pdf_block, image_block, text_block


router = APIRouter(prefix="/api/dm-costs", tags=["dm_costs"])


# ─── Category taxonomy ─────────────────────────────────────────────────────
# Kept server-side so it's the single source of truth — the prompt, the
# frontend dropdown, and any validation all reference the same list.
CATEGORIES: dict[str, list[str]] = {
    "Building Envelope and Structure": [
        "Roof systems",
        "Façade and cladding",
        "Waterproofing",
        "Balcony repairs",
        "Window and door seals",
        "Expansion joints",
        "Structural elements",
    ],
    "MEP Systems": [
        "HVAC",
        "Plumbing",
        "Electrical",
        "Fire/life safety",
    ],
    "Vertical Transportation": [
        "Elevator cabs",
        "Hoist machines",
        "Ada Lift",
        "Door operators",
        "Escalators",
    ],
    "Exterior and Site": [
        "Pool and pool deck",
        "Parking structures",
        "Landscaping",
        "Hardscape",
        "Porte-cochère",
    ],
    # Broad categories with no fixed subcategory list — the AI and user can
    # leave subcategory null or add a freeform note.
    "Guestroom": [],
    "Guest Bathroom": [],
}


# ─── Schemas ───────────────────────────────────────────────────────────────
class DmCostItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    category: Optional[str]
    subcategory: Optional[str]
    scope: str
    unit: Optional[str] = None
    quantity: Optional[float] = None
    cost: Optional[float] = None
    unit_cost: Optional[float] = None
    contractor: Optional[str] = None
    estimate_date: Optional[str] = None
    year: Optional[int] = None
    city: Optional[str] = None
    state: Optional[str] = None
    hotel_name: Optional[str] = None
    notes: Optional[str] = None
    source_filename: Optional[str] = None
    source_page: Optional[int] = None
    source_excerpt: Optional[str] = None
    ai_extracted: bool = False


class DmCostItemCreate(BaseModel):
    category: Optional[str] = None
    subcategory: Optional[str] = None
    scope: str
    unit: Optional[str] = None
    quantity: Optional[float] = None
    cost: Optional[float] = None
    unit_cost: Optional[float] = None
    contractor: Optional[str] = None
    estimate_date: Optional[str] = None
    year: Optional[int] = None
    city: Optional[str] = None
    state: Optional[str] = None
    hotel_name: Optional[str] = None
    notes: Optional[str] = None


class DmCostItemUpdate(BaseModel):
    category: Optional[str] = None
    subcategory: Optional[str] = None
    scope: Optional[str] = None
    unit: Optional[str] = None
    quantity: Optional[float] = None
    cost: Optional[float] = None
    unit_cost: Optional[float] = None
    contractor: Optional[str] = None
    estimate_date: Optional[str] = None
    year: Optional[int] = None
    city: Optional[str] = None
    state: Optional[str] = None
    hotel_name: Optional[str] = None
    notes: Optional[str] = None


class DmUploadResult(BaseModel):
    created: int
    items: list[DmCostItemRead]
    document_context: dict
    warnings: list[str] = []


# ─── Taxonomy endpoint ─────────────────────────────────────────────────────
@router.get("/categories")
def list_categories():
    return {"categories": CATEGORIES}


# ─── CRUD ──────────────────────────────────────────────────────────────────
@router.get("", response_model=list[DmCostItemRead])
def list_items(
    q: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    subcategory: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    stmt = select(DmCostItem)
    if category:
        stmt = stmt.where(DmCostItem.category == category)
    if subcategory:
        stmt = stmt.where(DmCostItem.subcategory == subcategory)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                DmCostItem.scope.ilike(like),
                DmCostItem.contractor.ilike(like),
                DmCostItem.hotel_name.ilike(like),
                DmCostItem.city.ilike(like),
                DmCostItem.notes.ilike(like),
            )
        )
    stmt = stmt.order_by(DmCostItem.created_at.desc())
    return list(db.execute(stmt).scalars().all())


@router.post("", response_model=DmCostItemRead)
def create_item(payload: DmCostItemCreate, db: Session = Depends(get_db)):
    item = DmCostItem(**payload.model_dump(exclude_unset=True))
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=DmCostItemRead)
def update_item(item_id: str, payload: DmCostItemUpdate, db: Session = Depends(get_db)):
    item = db.get(DmCostItem, item_id)
    if not item:
        raise HTTPException(404, "DM cost item not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: str, db: Session = Depends(get_db)):
    item = db.get(DmCostItem, item_id)
    if not item:
        raise HTTPException(404, "DM cost item not found")
    db.delete(item)
    db.commit()


# ─── Upload + AI extraction ────────────────────────────────────────────────
DM_UPLOADS_DIR = UPLOADS_DIR / "dm_costs"


@router.post("/extract", response_model=DmUploadResult)
async def extract_dm_costs(
    file: UploadFile = File(...),
    # User-provided hints override what Claude finds — useful when the
    # document is light on context.
    override_contractor: Optional[str] = Form(None),
    override_hotel_name: Optional[str] = Form(None),
    override_city: Optional[str] = Form(None),
    override_state: Optional[str] = Form(None),
    override_year: Optional[int] = Form(None),
    db: Session = Depends(get_db),
):
    """Run Claude over an uploaded proposal/estimate/budget file, extract
    line items, and persist them to the DM cost DB. Accepts PDF and image."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        raise HTTPException(400, f"Unsupported file type {suffix}. Use PDF or image.")

    DM_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    safe_stem = "".join(c for c in Path(file.filename or "doc").stem if c.isalnum() or c in "-_")[:60] or "doc"
    stored = DM_UPLOADS_DIR / f"{uuid.uuid4().hex[:8]}_{safe_stem}{suffix}"
    content = await file.read()
    stored.write_bytes(content)

    try:
        block = pdf_block(stored) if suffix == ".pdf" else image_block(stored)
    except Exception as e:
        raise HTTPException(400, f"Failed to read file: {e}")

    system = load_prompt("extract_dm_costs")
    try:
        raw = claude_client.complete_json(
            system=system,
            user_content=[block, text_block("Extract deferred-maintenance line items from this document.")],
            max_tokens=8000,
        )
    except ClaudeError as e:
        raise HTTPException(502, f"AI extraction failed: {e}")

    ctx = raw.get("document_context") or {}
    raw_items = raw.get("items") or []
    warnings: list[str] = []
    if not isinstance(raw_items, list):
        raise HTTPException(502, "Claude returned unexpected shape (items must be a list).")

    # Apply user overrides — they win over whatever Claude thought it saw.
    contractor = override_contractor or ctx.get("contractor")
    hotel_name = override_hotel_name or ctx.get("hotel_name")
    city = override_city or ctx.get("city")
    state = override_state or ctx.get("state")
    year = override_year or ctx.get("year")
    estimate_date = ctx.get("estimate_date")

    created: list[DmCostItem] = []
    for r in raw_items:
        if not isinstance(r, dict):
            warnings.append(f"Skipped non-object item: {r!r}")
            continue
        scope = (r.get("scope") or "").strip()
        if not scope:
            continue
        # Validate category/subcategory against taxonomy; don't hard-fail —
        # just strip invalid ones so the row still gets saved (easier to
        # re-categorize in the UI than to lose data).
        cat = r.get("category")
        sub = r.get("subcategory")
        if cat and cat not in CATEGORIES:
            warnings.append(f"Unknown category '{cat}' for '{scope[:60]}' — stored as-is.")
        if sub and cat in CATEGORIES and sub not in CATEGORIES[cat]:
            warnings.append(f"Unknown subcategory '{sub}' under '{cat}' — cleared.")
            sub = None

        item = DmCostItem(
            category=cat,
            subcategory=sub,
            scope=scope[:2000],
            unit=(r.get("unit") or None),
            quantity=_coerce_float(r.get("quantity")),
            unit_cost=_coerce_float(r.get("unit_cost")),
            cost=_coerce_float(r.get("cost")),
            contractor=contractor,
            estimate_date=estimate_date,
            year=int(year) if year else None,
            city=city,
            state=state,
            hotel_name=hotel_name,
            source_filename=file.filename,
            source_file_path=str(stored),
            source_page=_coerce_int(r.get("source_page")),
            source_excerpt=(r.get("source_excerpt") or "")[:500] or None,
            ai_extracted=True,
        )
        db.add(item)
        created.append(item)

    db.commit()
    for it in created:
        db.refresh(it)

    return DmUploadResult(
        created=len(created),
        items=created,
        document_context={
            "contractor": contractor,
            "hotel_name": hotel_name,
            "city": city,
            "state": state,
            "year": year,
            "estimate_date": estimate_date,
        },
        warnings=warnings,
    )


def _coerce_float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _coerce_int(v) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
