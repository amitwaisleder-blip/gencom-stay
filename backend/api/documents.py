from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import UPLOADS_DIR
from db import get_db
from models.entities import Document, Property
from services import extractor as extractor_service


router = APIRouter(prefix="/api/properties/{property_id}", tags=["documents"])


ALLOWED_TYPES = {"pip", "om", "brochure", "walk_notes", "walk_photo", "other"}


def _doc_to_dict(d: Document) -> dict:
    return {
        "id": d.id,
        "property_id": d.property_id,
        "filename": d.filename,
        "file_path": d.file_path,
        "document_type": d.document_type,
        "uploaded_at": d.uploaded_at,
        "page_count": d.page_count,
        "extraction_status": d.extraction_status,
        "extraction_ran_at": d.extraction_ran_at,
        "extraction_error": d.extraction_error,
    }


def _count_pdf_pages(path: Path) -> Optional[int]:
    if path.suffix.lower() != ".pdf":
        return None
    try:
        from pypdf import PdfReader
        return len(PdfReader(str(path)).pages)
    except Exception:
        return None


@router.get("/documents")
def list_documents(property_id: str, db: Session = Depends(get_db)):
    rows = db.execute(
        select(Document).where(Document.property_id == property_id).order_by(Document.uploaded_at.desc())
    ).scalars().all()
    return [_doc_to_dict(d) for d in rows]


@router.post("/documents")
async def upload_documents(
    property_id: str,
    files: list[UploadFile] = File(...),
    types_json: str = Form("{}"),
    db: Session = Depends(get_db),
):
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    try:
        types_map: dict[str, str] = json.loads(types_json) if types_json else {}
    except json.JSONDecodeError:
        raise HTTPException(400, "types_json must be valid JSON")

    prop_uploads = UPLOADS_DIR / property_id
    prop_uploads.mkdir(parents=True, exist_ok=True)

    created: list[Document] = []
    for f in files:
        raw_type = (types_map.get(f.filename) or "other").lower()
        if raw_type not in ALLOWED_TYPES:
            raw_type = "other"
        suffix = Path(f.filename).suffix
        safe_stem = "".join(c for c in Path(f.filename).stem if c.isalnum() or c in "-_")[:60] or "doc"
        stored_name = f"{uuid.uuid4().hex[:8]}_{safe_stem}{suffix}"
        dest = prop_uploads / stored_name
        content = await f.read()
        dest.write_bytes(content)

        doc = Document(
            property_id=property_id,
            filename=f.filename,
            file_path=str(dest),
            document_type=raw_type,
            page_count=_count_pdf_pages(dest),
            extraction_status="pending",
        )
        db.add(doc)
        created.append(doc)

    db.commit()
    for d in created:
        db.refresh(d)
    return [_doc_to_dict(d) for d in created]


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(property_id: str, doc_id: str, db: Session = Depends(get_db)):
    d = db.get(Document, doc_id)
    if not d or d.property_id != property_id:
        raise HTTPException(404, "Document not found")
    try:
        Path(d.file_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(d)
    db.commit()


@router.post("/extract")
def run_extraction(property_id: str, db: Session = Depends(get_db)):
    try:
        result = extractor_service.run_extraction(db, property_id)
    except extractor_service.ClaudeError as e:
        raise HTTPException(502, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.post("/documents/{doc_id}/extract")
def run_extraction_for_document(property_id: str, doc_id: str, db: Session = Depends(get_db)):
    try:
        result = extractor_service.run_extraction_for_document(db, property_id, doc_id)
    except extractor_service.ClaudeError as e:
        raise HTTPException(502, str(e))
    except ValueError as e:
        raise HTTPException(404, str(e))
    return result


@router.post("/extract-preview")
def run_extraction_preview(
    property_id: str,
    body: Optional[dict] = Body(default=None),
    db: Session = Depends(get_db),
):
    """Run extraction but return scope suggestions for user review instead of
    committing them. Property fields are applied immediately.

    Optional body: {"granularity": "compact" | "standard" | "detailed"}.
    Defaults to "standard" for backward compatibility.
    """
    raw = (body or {}).get("granularity", "standard")
    granularity = raw if raw in ("compact", "standard", "detailed") else "standard"
    try:
        result = extractor_service.run_extraction_preview(db, property_id, granularity=granularity)
    except extractor_service.ClaudeError as e:
        raise HTTPException(502, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.post("/scope/import-batch")
def import_scope_batch(property_id: str, body: dict, db: Session = Depends(get_db)):
    """Create scope items from user-approved preview suggestions."""
    items = body.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "No items provided")
    try:
        result = extractor_service.import_scope_batch(db, property_id, items)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result
