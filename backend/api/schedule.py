"""Schedule Generator API.

POST /api/schedule/preview         → schedule as JSON (tasks + milestones).
POST /api/schedule/export          → .xlsx download.
POST /api/schedule/ai-durations    → Claude-recommended per-phase design durations.
POST /api/schedule/extract-pip     → multipart upload; returns property + scope from PIP.

Preview / export accept the wizard's full state object and dispatch to the
deterministic engine in services/schedule_engine.py. Blackout-aware reflow
lands in the next pass.
"""
from __future__ import annotations

import logging
import re
import shutil
import tempfile
from datetime import date
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

from services.schedule_engine import build_schedule
from services.schedule_excel import write_schedule_xlsx
from services.schedule_html import write_schedule_html
from services.schedule_pdf import write_schedule_pdf
from services.schedule_pptx import write_schedule_pptx
from services.schedule_ai import recommend_durations
from services.schedule_pip_extract import extract_pip_for_schedule
from services.claude_client import ClaudeError


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class ScheduleRequest(BaseModel):
    # Permissive input — accept the wizard state shape verbatim. The engine
    # pulls only the keys it cares about; unknown keys pass through as
    # forwards-compat for new wizard fields.
    model_config = ConfigDict(extra="allow")
    state: dict[str, Any]


@router.post("/preview")
def preview(req: ScheduleRequest):
    try:
        sched = build_schedule(req.state)
    except Exception as e:
        logger.exception("schedule preview failed")
        raise HTTPException(status_code=500, detail=f"Schedule build failed: {e}")
    return sched.to_jsonable()


@router.post("/export")
def export(req: ScheduleRequest):
    try:
        sched = build_schedule(req.state)
        buf = write_schedule_xlsx(sched)
    except Exception as e:
        logger.exception("schedule export failed")
        raise HTTPException(status_code=500, detail=f"Schedule export failed: {e}")

    safe = re.sub(r"[^\w\-]+", "_", sched.project_name).strip("_") or "schedule"
    filename = f"{safe}_Schedule_{date.today().isoformat()}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export-html")
def export_html(req: ScheduleRequest):
    """Standalone HTML download — single file, inline CSS, shareable."""
    try:
        sched = build_schedule(req.state)
        html = write_schedule_html(sched)
    except Exception as e:
        logger.exception("schedule HTML export failed")
        raise HTTPException(status_code=500, detail=f"HTML export failed: {e}")

    safe = re.sub(r"[^\w\-]+", "_", sched.project_name).strip("_") or "schedule"
    filename = f"{safe}_Schedule_{date.today().isoformat()}.html"
    import io as _io
    buf = _io.BytesIO(html.encode("utf-8"))
    return StreamingResponse(
        buf,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export-pdf")
def export_pdf(req: ScheduleRequest):
    """PDF download — landscape Letter, multi-page, with Gantt + milestones."""
    try:
        sched = build_schedule(req.state)
        buf = write_schedule_pdf(sched)
    except Exception as e:
        logger.exception("schedule PDF export failed")
        raise HTTPException(status_code=500, detail=f"PDF export failed: {e}")

    safe = re.sub(r"[^\w\-]+", "_", sched.project_name).strip("_") or "schedule"
    filename = f"{safe}_Schedule_{date.today().isoformat()}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export-pptx")
def export_pptx(req: ScheduleRequest):
    """PowerPoint download — 3 slides (cover / Gantt / milestones)."""
    try:
        sched = build_schedule(req.state)
        buf = write_schedule_pptx(sched)
    except Exception as e:
        logger.exception("schedule PPTX export failed")
        raise HTTPException(status_code=500, detail=f"PPTX export failed: {e}")

    safe = re.sub(r"[^\w\-]+", "_", sched.project_name).strip("_") or "schedule"
    filename = f"{safe}_Schedule_{date.today().isoformat()}.pptx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/ai-durations")
def ai_durations(req: ScheduleRequest):
    """Claude-recommended per-phase design durations + rationale strings."""
    try:
        return recommend_durations(req.state)
    except ClaudeError as e:
        # ClaudeError is the user-facing failure path — preserve the message
        # so the UI can show a useful error banner.
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("ai-durations failed")
        raise HTTPException(status_code=500, detail=f"AI recommendation failed: {e}")


_ALLOWED_PIP_SUFFIXES = {".pdf", ".docx", ".xlsx", ".xls", ".txt", ".md"}


@router.post("/extract-pip")
async def extract_pip(file: UploadFile = File(...)):
    """Read an uploaded PIP file and return high-level property + scope JSON.

    The frontend uses this in PIP-driven mode to seed the Property Context and
    Scope Selection wizard pages without re-keying.
    """
    name = file.filename or "upload"
    suffix = Path(name).suffix.lower()
    if suffix not in _ALLOWED_PIP_SUFFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Use PDF, DOCX, XLSX, TXT, or MD.",
        )

    # Stage to a temp file because the extractor needs a Path (PDFs are
    # base64-encoded for the Claude API; openpyxl needs a real file handle).
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        try:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = Path(tmp.name)
        finally:
            file.file.close()

    try:
        return extract_pip_for_schedule(tmp_path)
    except ClaudeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("extract-pip failed")
        raise HTTPException(status_code=500, detail=f"Extraction failed: {e}")
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
