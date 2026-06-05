from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, File
from pathlib import Path

from config import TEMPLATE_PATH
from services import template_ingest


router = APIRouter(prefix="/api/template", tags=["template"])


@router.get("/scan")
def scan():
    return template_ingest.scan_template()


@router.get("/map")
def get_map():
    m = template_ingest.load_template_map()
    return {"map": m}


@router.post("/map")
def save_map(payload: dict):
    template_ingest.save_template_map(payload)
    return {"ok": True}


@router.get("/divisions")
def list_divisions():
    return {"divisions": template_ingest.list_divisions()}


@router.post("/upload")
async def upload_template(file: UploadFile = File(...)):
    if not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Template must be .xlsx or .xlsm")
    TEMPLATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    content = await file.read()
    TEMPLATE_PATH.write_bytes(content)
    return template_ingest.scan_template()
