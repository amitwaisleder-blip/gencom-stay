"""Gencom Stay — portfolio persistence + hero-image upload. Properties
live as JSON blobs on the server (same shape as the frontend Property
type); images go to disk under data/uploads/gencom-stay/<property_id>/
and are served back through /api/gencom-stay/images/<image_id>."""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import UPLOADS_DIR
from db import get_db
from models.entities import GencomStayImage, GencomStayProperty


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/gencom-stay", tags=["gencom-stay"])


GS_UPLOADS_ROOT = UPLOADS_DIR / "gencom-stay"
ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ALLOWED_IMAGE_MIME = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif",
}


def _prop_to_dict(p: GencomStayProperty) -> dict:
    data = dict(p.data or {})
    data["id"] = p.id
    data["_updatedAt"] = p.updated_at.isoformat() if p.updated_at else None
    return data


# ------------------------------------------------------------------
# Property CRUD
# ------------------------------------------------------------------
@router.get("/properties")
def list_properties(db: Session = Depends(get_db)):
    rows = db.execute(
        select(GencomStayProperty).order_by(GencomStayProperty.created_at.desc())
    ).scalars().all()
    return [_prop_to_dict(r) for r in rows]


@router.put("/properties/{property_id}")
def upsert_property(property_id: str, payload: dict, db: Session = Depends(get_db)) -> dict:
    # Strip the id from the body so we can't end-run the URL.
    body = {k: v for k, v in (payload or {}).items() if k != "id"}
    existing = db.get(GencomStayProperty, property_id)
    if existing:
        existing.data = body
    else:
        db.add(GencomStayProperty(id=property_id, data=body))
    db.commit()
    row = db.get(GencomStayProperty, property_id)
    return _prop_to_dict(row)  # type: ignore[arg-type]


@router.delete("/properties/{property_id}", status_code=204)
def delete_property(property_id: str, db: Session = Depends(get_db)):
    row = db.get(GencomStayProperty, property_id)
    if row:
        db.delete(row)
        # Best-effort: drop any image files for this property.
        images = db.execute(
            select(GencomStayImage).where(GencomStayImage.property_id == property_id)
        ).scalars().all()
        for img in images:
            try:
                Path(img.file_path).unlink(missing_ok=True)
            except Exception:
                pass
            db.delete(img)
        db.commit()
    return Response(status_code=204)


class BulkCreateRequest(BaseModel):
    properties: list[dict]


@router.post("/properties/bulk")
def bulk_upsert(body: BulkCreateRequest, db: Session = Depends(get_db)):
    """Used by the Excel import flow after the user reviews the parsed rows."""
    created: list[dict] = []
    for p in body.properties:
        pid = (p.get("id") or "").strip()
        if not pid:
            pid = _slug(p.get("name") or "property") + "-" + uuid.uuid4().hex[:6]
        data = {k: v for k, v in p.items() if k != "id"}
        existing = db.get(GencomStayProperty, pid)
        if existing:
            existing.data = data
        else:
            db.add(GencomStayProperty(id=pid, data=data))
        created.append({"id": pid, **data})
    db.commit()
    return {"count": len(created), "properties": created}


def _slug(s: str) -> str:
    out = []
    for ch in s.lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in " -_":
            out.append("-")
    return "".join(out).strip("-") or "property"


# ------------------------------------------------------------------
# Hero image upload
# ------------------------------------------------------------------
@router.post("/properties/{property_id}/image")
async def upload_image(
    property_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Save an uploaded image and stamp the property's heroImage URL.
    Only one image per property — a new upload replaces the old one."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(415, f"Unsupported image type: {suffix or '(none)'}")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image too large (10 MB max)")

    GS_UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)
    prop_dir = GS_UPLOADS_ROOT / property_id
    prop_dir.mkdir(parents=True, exist_ok=True)

    # Replace any previous image for this property so we don't accumulate
    # orphaned files on disk.
    old = db.execute(
        select(GencomStayImage).where(GencomStayImage.property_id == property_id)
    ).scalars().all()
    for o in old:
        try:
            Path(o.file_path).unlink(missing_ok=True)
        except Exception:
            pass
        db.delete(o)

    stored_name = f"{uuid.uuid4().hex[:8]}{suffix}"
    dest = prop_dir / stored_name
    dest.write_bytes(content)

    img = GencomStayImage(
        property_id=property_id,
        filename=file.filename or stored_name,
        file_path=str(dest),
        content_type=ALLOWED_IMAGE_MIME.get(suffix) or file.content_type,
    )
    db.add(img)

    # Update the property's heroImage so every list response reflects it.
    image_url = f"/api/gencom-stay/images/{img.id}"
    prop = db.get(GencomStayProperty, property_id)
    if prop:
        data = dict(prop.data or {})
        data["heroImage"] = image_url
        prop.data = data
    db.commit()
    db.refresh(img)

    return {"id": img.id, "url": image_url}


@router.get("/images/{image_id}")
def get_image(image_id: str, db: Session = Depends(get_db)):
    img = db.get(GencomStayImage, image_id)
    if not img:
        raise HTTPException(404, "Image not found")
    p = Path(img.file_path)
    if not p.exists():
        raise HTTPException(410, "Image is gone from disk")
    return FileResponse(
        str(p),
        media_type=img.content_type or "application/octet-stream",
        filename=img.filename,
    )
