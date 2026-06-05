"""Cash Flow Returns — deal extraction from IC packages.

POST /api/cash-flow-returns/extract-deal
    multipart form: file=<PDF | XLSX | XLS | DOCX | DOC>
    → { "deal": {...}, "assumptions": {...} }

The endpoint saves the upload under UPLOADS_DIR, then calls Claude with
the cfr_extract_deal prompt to return a typed Assumptions bundle. PDFs
go through the native Anthropic document block; spreadsheets and Word
docs are converted to plain text first via openpyxl / python-docx so
Claude reads the tabular content directly.
"""
from __future__ import annotations

import io
import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import UPLOADS_DIR
from services import claude_client
from services.claude_client import ClaudeError, load_prompt, pdf_block, text_block


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cash-flow-returns", tags=["cash-flow-returns"])

# Maps file extensions → { content-block builder, friendly-name } for
# the upload endpoint. Adding another type is one entry.
SUPPORTED_EXTS = {".pdf", ".xlsx", ".xls", ".docx", ".doc"}

# Per-block extraction config. Each entry tells the prompt template
# which subtree to focus on and what fields to look for. The descriptions
# read inline in the system prompt, so they're written for Claude.
BLOCK_CONFIG: dict[str, dict[str, str]] = {
    "costs": {
        "name": "Costs / Uses at Acquisition",
        "description": (
            "The `costs` subtree captures the dollar costs that make up the deal's "
            "uses-of-funds. Look for an acquisition-year sources & uses table. "
            "Fields:\n"
            "- `acquisitionPrice` (thousands)\n"
            "- `capexBudget` (thousands; the renovation / repositioning budget)\n"
            "- `dueDiligence` (thousands)\n"
            "- `acquisitionTransitionFees` (thousands)\n"
            "- `transferTax` (thousands)\n"
            "- `legalFees` (thousands)"
        ),
    },
    "financing": {
        "name": "Financing terms",
        "description": (
            "The `financing` subtree captures the debt structure. Look for a debt "
            "term sheet, financing summary, or sources-of-funds table. Fields:\n"
            "- `ltv` (decimal, e.g. 0.60 for 60% loan-to-value)\n"
            "- `ltc` (decimal, loan-to-cost; usually 1.00 for full coverage)\n"
            "- `financingCostsPct` (decimal — financing costs as % of total debt)\n"
            "- `baseRateLabel` (short string: \"3m EURIBOR\", \"SOFR\", \"3m SONIA\")\n"
            "- `baseRate` (decimal, e.g. 0.0209)\n"
            "- `spreadBps` (INTEGER basis points, e.g. 250)\n"
            "- `commitmentFeePct` (decimal)\n"
            "- `annualAmortAcqLoan` (decimal — annual amortisation of acquisition loan)\n"
            "- `annualAmortCapexFacility` (decimal)"
        ),
    },
    "exit": {
        "name": "Exit assumptions",
        "description": (
            "The `exit` subtree captures the disposition assumptions. Look for an "
            "exit-year valuation or returns summary. Fields:\n"
            "- `firstYear` (4-digit year — first year of the model, typically acquisitionYear+1)\n"
            "- `exitYear` (4-digit year — disposition year)\n"
            "- `holdPeriod` (integer — typically 5)\n"
            "- `exitCapRate` (decimal, e.g. 0.05 for 5.00%)\n"
            "- `transactionCosts` (decimal — sale transaction costs as % of gross sale)"
        ),
    },
    "pnl": {
        "name": "P&L projections",
        "description": (
            "The `pnl` subtree captures per-year operating projections. All arrays "
            "are length `holdPeriod`. Fields:\n"
            "- `keys` (integer per year — usually constant)\n"
            "- `occupancy` (decimals per year, e.g. 0.70 for 70%)\n"
            "- `adrY1` (whole currency units, e.g. 558.14 — NOT thousands)\n"
            "- `adrGrowth` (decimals per year; index 0 is null because Y1 is absolute)\n"
            "- `totalRevenueOverride` (thousands per year — optional override)\n"
            "- `gop.absoluteOverride` (thousands per year — optional)\n"
            "- `ebitda.absoluteOverride` (thousands per year — optional)\n"
            "- `noi.absoluteOverride` (thousands per year — optional)"
        ),
    },
    "cashflow": {
        "name": "Cash-flow assumptions",
        "description": (
            "The `cashflow` subtree captures non-P&L cash items. All arrays are "
            "length `holdPeriod`. Fields:\n"
            "- `capexDrawSchedule` (POSITIVE thousands per year; sums to capexBudget)\n"
            "- `imCosts` (thousands per year — incentive-management or asset-mgmt fees)\n"
            "- `taxPayableUnlevered` (thousands per year)\n"
            "- `taxPayableLevered` (thousands per year)\n"
            "- `promoteY5` (POSITIVE thousands — promote paid in the exit year)"
        ),
    },
}


@router.post("/extract-deal")
async def extract_deal(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No file uploaded.")
    user_content = await _content_for_extraction(file)
    prompt = load_prompt("cfr_extract_deal")
    try:
        out = claude_client.complete_json(
            system=prompt,
            user_content=user_content,
            max_tokens=8000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))

    if not isinstance(out, dict):
        raise HTTPException(502, "Extraction returned non-object JSON.")
    if "assumptions" not in out:
        raise HTTPException(502, "Extraction response missing 'assumptions' root.")
    out["_source_filename"] = file.filename
    return out


@router.post("/extract-block")
async def extract_block(
    file: UploadFile = File(...),
    block: str = Form(...),
):
    """Per-block extraction. Same file rules as /extract-deal but the
    prompt is scoped to a single subtree of the assumptions schema.

    The frontend uses this for in-block "Upload Doc" buttons — drop a
    debt term sheet on the Financing block, only financing fields land.
    """
    if block not in BLOCK_CONFIG:
        raise HTTPException(400, f"Unknown block {block!r}. Accepted: {sorted(BLOCK_CONFIG)}")
    if not file.filename:
        raise HTTPException(400, "No file uploaded.")

    content = await _content_for_extraction(file)
    cfg = BLOCK_CONFIG[block]
    prompt = load_prompt("cfr_extract_block", substitutions={
        "block_key":         block,
        "block_name":        cfg["name"],
        "block_description": cfg["description"],
    })

    try:
        out = claude_client.complete_json(
            system=prompt,
            user_content=content,
            max_tokens=4000,           # Single-block payloads are tiny
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))

    if not isinstance(out, dict) or "assumptions" not in out:
        raise HTTPException(502, "Extraction response missing 'assumptions' root.")
    sub = out["assumptions"].get(block)
    if not isinstance(sub, dict):
        raise HTTPException(
            502,
            f"Extraction did not return a {block!r} subtree. The source document may "
            f"not contain {cfg['name'].lower()} data.",
        )
    return {
        "block": block,
        "patch": sub,                  # { acquisitionPrice: ..., ... }
        "_source_filename": file.filename,
    }


async def _content_for_extraction(file: UploadFile) -> list[dict]:
    """Read `file`, persist it under UPLOADS_DIR, and return a Claude
    user-content list (one PDF block, or one text block for XLSX/DOCX).
    Shared by /extract-deal and /extract-block."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in SUPPORTED_EXTS:
        raise HTTPException(
            400,
            f"Unsupported file type {ext!r}. Accepted: PDF, XLSX, XLS, DOCX, DOC.",
        )
    cfr_uploads = UPLOADS_DIR / "cash-flow-returns"
    cfr_uploads.mkdir(parents=True, exist_ok=True)
    safe_stem = "".join(c for c in Path(file.filename or "deal").stem if c.isalnum() or c in " -_")[:80] or "deal"
    saved = cfr_uploads / f"{safe_stem}-{uuid.uuid4().hex[:8]}{ext}"
    raw = await file.read()
    saved.write_bytes(raw)

    if ext == ".pdf":
        return [pdf_block(saved)]
    if ext == ".xlsx":
        text = _excel_to_text(raw, file.filename or "")
        if not text:
            raise HTTPException(400, "Could not read the Excel file.")
        return [text_block(text)]
    if ext == ".docx":
        text = _docx_to_text(raw, file.filename or "")
        if not text:
            raise HTTPException(400, "Could not read the Word document.")
        return [text_block(text)]
    raise HTTPException(
        415,
        f"Legacy {ext} format not supported — re-save as .xlsx or .docx and re-upload.",
    )


# ------------------------------------------------------------------
# Document-to-text helpers. Inlined here (rather than imported from
# lunch_menu) to keep these two API modules independently shippable.
# ------------------------------------------------------------------
def _excel_to_text(data: bytes, filename: str) -> Optional[str]:
    """Dump every cell of every sheet in an .xlsx to tab-separated text so
    Claude reads structured data directly. Empty rows are skipped to
    keep the prompt size sane on big UW models."""
    try:
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    except Exception as e:
        logger.warning("openpyxl could not read %s: %s", filename, e)
        return None
    parts: list[str] = [f"=== Excel file: {filename} ==="]
    for sheet in wb.worksheets:
        parts.append(f"--- Sheet: {sheet.title} ---")
        for row in sheet.iter_rows(values_only=True):
            cells = ["" if c is None else str(c) for c in row]
            if any(c.strip() for c in cells):
                parts.append("\t".join(cells))
    return "\n".join(parts) if len(parts) > 1 else None


def _docx_to_text(data: bytes, filename: str) -> Optional[str]:
    """Pull every paragraph + table cell out of a .docx as plain text,
    preserving document order so an IC narrative reads naturally."""
    try:
        from docx import Document  # python-docx
    except ImportError:
        logger.warning("python-docx not installed — cannot parse %s", filename)
        return None
    try:
        doc = Document(io.BytesIO(data))
    except Exception as e:
        logger.warning("python-docx could not read %s: %s", filename, e)
        return None

    parts: list[str] = [f"=== Word document: {filename} ==="]
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            parts.append(t)
    for tbl in doc.tables:
        parts.append("--- table ---")
        for row in tbl.rows:
            cells = [(c.text or "").strip() for c in row.cells]
            if any(cells):
                parts.append("\t".join(cells))
    return "\n".join(parts) if len(parts) > 1 else None
