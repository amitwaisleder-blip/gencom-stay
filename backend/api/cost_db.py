from __future__ import annotations

import csv
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy import select, or_
from sqlalchemy.orm import Session

from db import get_db
from models.entities import CostDatabaseItem, Property
from schemas.cost import CostItemCreate, CostItemRead, CostItemUpdate


def _attach_property_name(items: list[CostDatabaseItem], db: Session) -> list[CostItemRead]:
    """Hydrate CostItemRead rows with the name of the property each cost was
    last used on, so the UI can show "seen on: <hotel name>" for actual-project
    rows. Uses a single batch lookup rather than N+1 queries."""
    ids = {i.last_used_property_id for i in items if i.last_used_property_id}
    names: dict[str, str] = {}
    if ids:
        rows = db.execute(select(Property.id, Property.name).where(Property.id.in_(ids))).all()
        names = {pid: (name or "") for pid, name in rows}
    out: list[CostItemRead] = []
    for i in items:
        read = CostItemRead.model_validate(i)
        if i.last_used_property_id:
            read.last_used_property_name = names.get(i.last_used_property_id) or None
        out.append(read)
    return out


router = APIRouter(prefix="/api/cost-db", tags=["cost-db"])


@router.get("", response_model=list[CostItemRead])
def list_cost_items(
    q: Optional[str] = Query(None, description="Search text (matches name/notes)"),
    tier: Optional[str] = None,
    source: Optional[str] = None,
    include_archived: bool = False,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    stmt = select(CostDatabaseItem)
    if not include_archived:
        stmt = stmt.where(CostDatabaseItem.archived.is_(False))
    if tier:
        stmt = stmt.where(CostDatabaseItem.brand_tier == tier)
    if source:
        stmt = stmt.where(CostDatabaseItem.source == source)
    if q:
        pattern = f"%{q.lower()}%"
        stmt = stmt.where(or_(
            CostDatabaseItem.item_name.ilike(pattern),
            CostDatabaseItem.notes.ilike(pattern),
        ))
    stmt = stmt.order_by(CostDatabaseItem.item_name).limit(limit).offset(offset)
    items = list(db.execute(stmt).scalars().all())
    return _attach_property_name(items, db)


@router.post("", response_model=CostItemRead)
def create_cost_item(payload: CostItemCreate, db: Session = Depends(get_db)):
    item = CostDatabaseItem(**payload.model_dump(exclude_unset=True))
    db.add(item)
    db.commit()
    db.refresh(item)
    return _attach_property_name([item], db)[0]


@router.patch("/{item_id}", response_model=CostItemRead)
def update_cost_item(item_id: str, payload: CostItemUpdate, db: Session = Depends(get_db)):
    item = db.get(CostDatabaseItem, item_id)
    if not item:
        raise HTTPException(404, "Cost item not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return _attach_property_name([item], db)[0]


@router.delete("/{item_id}", status_code=204)
def delete_cost_item(item_id: str, db: Session = Depends(get_db)):
    item = db.get(CostDatabaseItem, item_id)
    if not item:
        raise HTTPException(404, "Cost item not found")
    db.delete(item)
    db.commit()


@router.post("/import-csv")
async def import_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """CSV columns: item_name, unit, brand_tier, suggested_cost, notes (optional)."""
    content = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    imported = 0
    errors: list[dict] = []
    required = {"item_name", "unit", "brand_tier", "suggested_cost"}
    if reader.fieldnames is None or not required.issubset({f.strip().lower() for f in reader.fieldnames}):
        raise HTTPException(400, f"CSV must include columns: {sorted(required)}")

    for row_idx, row in enumerate(reader, start=2):
        row = {k.strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
        try:
            item = CostDatabaseItem(
                item_name=row["item_name"],
                unit=row["unit"],
                brand_tier=row["brand_tier"],
                suggested_cost=float(row["suggested_cost"]),
                notes=row.get("notes"),
                source="user_seeded",
            )
            db.add(item)
            imported += 1
        except Exception as e:
            errors.append({"row": row_idx, "error": str(e)})
    db.commit()
    return {"imported": imported, "errors": errors}
