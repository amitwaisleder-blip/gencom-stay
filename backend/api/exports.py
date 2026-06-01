from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Export, Property
from schemas.export import ExportRead, ExportRequest
from services.excel_writer import export_budget


router = APIRouter(prefix="/api/properties/{property_id}/exports", tags=["exports"])


def _normalize_path(p: str) -> str:
    """Normalize stored file_path for use as a URL. Handles legacy rows that
    included an "exports/" or "exports\\" prefix or used backslashes."""
    if not p:
        return p
    p = p.replace("\\", "/")
    for prefix in ("exports/", "/exports/"):
        if p.startswith(prefix):
            p = p[len(prefix):]
            break
    return p


def _download_url(file_path: str) -> str:
    return f"/files/exports/{_normalize_path(file_path)}"


@router.get("")
def list_exports(property_id: str, db: Session = Depends(get_db)):
    rows = db.execute(
        select(Export).where(Export.property_id == property_id).order_by(Export.exported_at.desc())
    ).scalars().all()
    return [
        {
            "id": r.id,
            "property_id": r.property_id,
            "exported_at": r.exported_at,
            "filename": r.filename,
            "file_path": r.file_path,
            "download_url": _download_url(r.file_path),
            "scenarios_included": r.scenarios_included,
            "note": r.note,
        }
        for r in rows
    ]


@router.post("")
def create_export(property_id: str, payload: ExportRequest, db: Session = Depends(get_db)):
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    try:
        result = export_budget(
            db, property_id, payload.scenarios,
            filename=payload.filename, note=payload.note,
        )
    except FileNotFoundError as e:
        raise HTTPException(400, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))

    export = Export(
        property_id=property_id,
        filename=result["filename"],
        file_path=result["file_path"],
        scenarios_included=result["scenarios_included"],
        note=result["note"],
    )
    db.add(export)
    db.commit()
    db.refresh(export)
    return {
        "id": export.id,
        "filename": export.filename,
        "file_path": export.file_path,
        "download_url": _download_url(export.file_path),
        "divisions_log": result["divisions_log"],
        "scenarios_included": export.scenarios_included,
        "exported_at": export.exported_at,
    }


@router.get("/{export_id}/download-url")
def export_download_url(property_id: str, export_id: str, db: Session = Depends(get_db)):
    e = db.get(Export, export_id)
    if not e or e.property_id != property_id:
        raise HTTPException(404, "Export not found")
    return {"url": _download_url(e.file_path)}
