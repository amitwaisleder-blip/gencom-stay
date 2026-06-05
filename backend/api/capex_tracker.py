"""Capex Tracker — combined budget + invoice tracking for hotel renovation
capex. Three project kinds share one data model:

  • single    — one CapexProject + one CapexHotel
  • portfolio — one CapexProject + N CapexHotels
  • project   — one CapexProject + one CapexHotel (with parent_hotel_name set)

Budget lines belong to a hotel. Invoices and contracts belong to the project
and reference a specific line.
"""
from __future__ import annotations

import io
import json
import shutil
import sys
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from config import DATA_DIR, UPLOADS_DIR, settings
from db import get_db
from models.entities import (
    CapexDocument,
    CapexFilenamePattern,
    CapexHotel,
    CapexInvoice,
    CapexLine,
    CapexProject,
)
from schemas.capex import (
    BudgetExtractLine,
    BudgetExtractResult,
    CapexDocumentRead,
    CapexHotelCreate,
    CapexHotelRead,
    CapexHotelUpdate,
    CapexInvoiceRead,
    CapexInvoiceUpdate,
    CapexLineCreate,
    CapexLineRead,
    CapexLineUpdate,
    CapexProjectCard,
    CapexProjectCreate,
    CapexProjectRead,
    CapexProjectUpdate,
    DocumentApplyRequest,
    DocumentParseResult,
    HotelLookupRequest,
    HotelLookupResponse,
    InvoiceApplyRequest,
    InvoiceMarkPaidRequest,
    InvoiceParseLineMatch,
    InvoiceParseResult,
    SuggestedSplit,
)
from services.claude_client import (
    client as claude_client,
    ClaudeError,
    _extract_json,
    complete_json,
    pdf_block,
    text_block,
)


router = APIRouter(prefix="/api/capex-tracker", tags=["capex-tracker"])


def _capex_uploads(project_id: str, subdir: str) -> Path:
    """Resolve and create the on-disk folder for a project's uploaded files."""
    p = UPLOADS_DIR / "capex-tracker" / project_id / subdir
    p.mkdir(parents=True, exist_ok=True)
    return p


def _line_spend_to_date(line: CapexLine) -> float:
    """Spend across every year on a single line. Cashflow (monthly) is the
    source of truth when present; year_data.spend is the fallback."""
    cf = line.cashflow or {}
    if cf:
        total = 0.0
        for _ystr, months in cf.items():
            if isinstance(months, dict):
                for _m, v in months.items():
                    total += float(v or 0)
        return total
    yd = line.year_data or {}
    total = 0.0
    for _yr, info in yd.items():
        if isinstance(info, dict):
            total += float(info.get("spend") or 0.0)
    return total


def _line_spend_for_year(line: CapexLine, year: int) -> float:
    """Spend booked to a specific year. Cashflow takes precedence."""
    cf = line.cashflow or {}
    if cf:
        months = cf.get(str(year)) or {}
        if isinstance(months, dict):
            return float(sum((v or 0) for v in months.values()))
    yd = (line.year_data or {}).get(str(year)) or {}
    return float(yd.get("spend") or 0.0)


def _hotel_totals(hotel: CapexHotel) -> tuple[float, float, int]:
    """(forecast_total, spend_to_date, line_count) summed across the hotel's
    lines. spend_to_date prefers cashflow rollup; falls back to year_data.spend."""
    forecast = 0.0
    spend = 0.0
    for line in hotel.lines:
        forecast += line.forecast_total_budget or 0.0
        spend += _line_spend_to_date(line)
    return round(forecast, 2), round(spend, 2), len(hotel.lines)


def _project_totals(project: CapexProject) -> tuple[float, float, float]:
    """(forecast_total, spend_to_date, remaining_current_year) summed across
    every hotel in the project. spend prefers cashflow rollup."""
    current_year = datetime.now().year
    forecast = 0.0
    spend = 0.0
    current_year_remaining = 0.0
    for hotel in project.hotels:
        for line in hotel.lines:
            forecast += line.forecast_total_budget or 0.0
            spend += _line_spend_to_date(line)
            cy_info = (line.year_data or {}).get(str(current_year)) or {}
            cy_forecast = float(cy_info.get("forecast") or 0.0)
            cy_spend = _line_spend_for_year(line, current_year)
            current_year_remaining += max(cy_forecast - cy_spend, 0.0)
    return round(forecast, 2), round(spend, 2), round(current_year_remaining, 2)


def _hotel_to_read(hotel: CapexHotel) -> CapexHotelRead:
    forecast, spend, count = _hotel_totals(hotel)
    return CapexHotelRead(
        id=hotel.id,
        project_id=hotel.project_id,
        name=hotel.name,
        image_path=hotel.image_path,
        logo_path=hotel.logo_path,
        sort_order=hotel.sort_order,
        address=hotel.address,
        city=hotel.city,
        state=hotel.state,
        country=hotel.country,
        keys=hotel.keys,
        year_built=hotel.year_built,
        last_renovation=hotel.last_renovation,
        current_brand=hotel.current_brand,
        current_flag=hotel.current_flag,
        property_type=hotel.property_type,
        floors=hotel.floors,
        notes=hotel.notes,
        enrichment_confidence=hotel.enrichment_confidence,
        line_count=count,
        forecast_total=forecast,
        spend_to_date=spend,
        created_at=hotel.created_at,
        updated_at=hotel.updated_at,
    )


def _project_to_read(project: CapexProject) -> CapexProjectRead:
    return CapexProjectRead(
        id=project.id,
        kind=project.kind,
        name=project.name,
        image_path=project.image_path,
        parent_hotel_name=project.parent_hotel_name,
        year_start=project.year_start,
        year_end=project.year_end,
        month_start=getattr(project, "month_start", None),
        month_end=getattr(project, "month_end", None),
        archived=project.archived,
        created_at=project.created_at,
        updated_at=project.updated_at,
        hotels=[_hotel_to_read(h) for h in sorted(project.hotels, key=lambda h: (h.sort_order, h.created_at))],
    )


# ─── Hotel lookup (AI-fill) ───────────────────────────────────────────────

HOTEL_LOOKUP_SYSTEM = """You are a hospitality data lookup assistant. Given a hotel name (and optional city hint), return a structured JSON object with known facts about the property. Only use information you are confident about from your training data. For any field you are uncertain about, return null rather than guess.

Return ONLY a JSON object — no preamble, no markdown fences — with these keys:
{
  "name": string (the hotel's canonical name),
  "address": string or null,            // street address if known, e.g. "1 Main St"
  "city": string or null,
  "state": string or null,              // US state abbreviation, e.g. "FL"
  "country": string or null,            // ISO-style or full name; "USA" for US
  "keys": integer or null,              // total guestroom count
  "year_built": integer or null,
  "last_renovation": integer or null,
  "current_brand": string or null,      // e.g. "Ritz-Carlton", "Rosewood", "Independent/Boutique"
  "current_flag": string or null,       // operator/management company if known and distinct from brand
  "property_type": string or null,      // one of: "Urban", "Resort", "Airport", "Suburban", "Conversion"
  "floors": integer or null,
  "notes": short string noting any assumptions, ambiguity, or interesting facts (closed, recent sale, etc.) or null,
  "confidence": "high" | "medium" | "low"
}

Rules:
- If two hotels share the name, use the city_hint to disambiguate. If still ambiguous, pick the most prominent and mention the ambiguity in notes.
- Be conservative. A null is better than a guess that could be wrong by >20%.
- For independent hotels, current_brand can be "Independent/Boutique".
- Set confidence to "high" only for well-known flagships where most fields are certain."""


@router.post("/lookup-hotel", response_model=HotelLookupResponse)
def lookup_hotel(req: HotelLookupRequest) -> HotelLookupResponse:
    if not req.name.strip():
        raise HTTPException(400, "Hotel name is required.")
    if not settings.anthropic_api_key:
        raise HTTPException(
            503,
            "Claude API key not configured. Add ANTHROPIC_API_KEY in backend/.env to use AI-fill.",
        )

    user_text = f"Hotel name: {req.name.strip()}"
    if req.city_hint and req.city_hint.strip():
        user_text += f"\nCity hint: {req.city_hint.strip()}"

    try:
        c = claude_client()
        with c.messages.stream(
            model=settings.extraction_model,
            max_tokens=1500,
            system=HOTEL_LOOKUP_SYSTEM,
            messages=[{"role": "user", "content": user_text}],
        ) as stream:
            final = stream.get_final_message()
        text_blocks = "".join(
            b.text for b in final.content if getattr(b, "type", None) == "text"
        )
        data = _extract_json(text_blocks)
    except ClaudeError as e:
        raise HTTPException(502, f"Claude error: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e))

    # Coerce common int fields if Claude returned strings.
    for k in ("keys", "year_built", "last_renovation", "floors"):
        v = data.get(k)
        if isinstance(v, str):
            try:
                data[k] = int(v.replace(",", "").strip())
            except ValueError:
                data[k] = None

    return HotelLookupResponse(**data)


# ─── Budget extraction (PDF / Excel / DOCX → structured lines) ────────────

BUDGET_EXTRACT_SYSTEM = """You are a hospitality capex budget parser. The user uploads either:

  (A) a "proposal" — ONE contractor's quote for ONE or a few specific scopes (e.g. "Elevator Modernization Proposal" from Otis with sub-items for machine room, controllers, cab refurb, electrical). The internal sub-items roll up to one budget line.

  (B) an "aggregated_budget" — an owner-side capex schedule covering many distinct projects from many vendors (e.g. a hotel's full-year capex cashflow with rows for sprinklers, HVAC, IT, elevators, kitchen equipment, etc.). Each row is its own budget line.

Your first job is to classify the document, then emit budget lines accordingly.

For a PROPOSAL: emit ONE line per distinct scope. The contractor's internal cost breakdown (line items, allowances, components, per-unit pricing) goes in the line's `breakdown` array — DO NOT emit those as separate top-level lines. The line's original_total_budget should equal the proposal's grand total for that scope.

For an AGGREGATED_BUDGET: emit one line per project row in the source. Each row's breakdown stays empty unless the source itself has a sub-itemization within a single project row.

Line fields:
  • code              — line/sub code from the source if any. Null if absent.
  • group             — top-level grouping. e.g. "Hard Costs", "Soft Costs", "FF&E", "OS&E".
  • category          — sub-grouping within the group. e.g. "Guestrooms", "Elevator", "MEP", "IT".
  • project_name      — short human label (e.g. "Elevator Modernization", "Soft Goods Refresh").
  • description       — longer explanatory text. Null if redundant with project_name.
  • vendor            — contractor / supplier / firm. Null if owner-side line with no vendor.
  • original_total_budget   — headline dollar amount (number).
  • forecast_total_budget   — equal to original unless source distinguishes them.
  • year_data         — Per-year forecast AND spend from the source. Look for columns / rows like:
                          "2025 YTD SPEND", "2025 ACTUAL", "Prior Year Spend"  → year_data["2025"].spend
                          "2025 FCAST SPEND", "2025 BUDGET", "2025 PROJECTION"  → year_data["2025"].forecast
                          "2026 YTD SPEND" → year_data["2026"].spend, "2026 FCAST" → year_data["2026"].forecast, etc.
                        Shape: { "2025": {"forecast": 50000, "spend": 26000}, "2026": {"forecast": 75000, "spend": 0}, ... }
                        CRITICAL: when the source has BOTH spend and forecast columns for the same year, populate BOTH
                        fields. Don't collapse them or pick one — both are needed. Null if source has no per-year breakdown at all.
  • cashflow          — MONTHLY cashflow / spend if the source has month-by-month columns or rows.
                        Shape: { "2025": { "1": 0, "2": 5000, "3": 8000, ..., "12": 0 }, "2026": { ... } }
                        Use this ONLY for true monthly data (e.g. "Mar 25", "April 2026", "Q1 2025" — split quarters
                        across their months). If the source only has yearly YTD/forecast totals, leave cashflow null
                        and put the year totals in year_data.
  • notes             — caveats, assumptions, exclusions, page references.
  • breakdown         — array of sub-items. Use this for proposal sub-items. Each item:
      { "label": str, "description": str|null, "vendor": str|null,
        "qty": number|null, "unit": str|null, "unit_cost": number|null,
        "total": number, "notes": str|null }
    Null or [] if there's no sub-itemization.

CRITICAL — DO NOT MISS SPEND COLUMNS:
- Sheets often have side-by-side YTD spend and forecast columns for the same year.
  E.g. row has columns: "2025 YTD SPEND", "2026 YTD SPEND", "2026 FCAST SPEND", "2027 FCAST SPEND".
  In year_data: {"2025":{"spend": <2025 YTD>, "forecast": 0}, "2026":{"spend": <2026 YTD>, "forecast": <2026 FCAST>}, "2027":{"spend": 0, "forecast": <2027 FCAST>}}
- "Prior Year Bal" or "Prior Year Spend" goes into the most recent year_data BEFORE the current year.
- If the source has true MONTHLY columns (e.g. one column per month), use cashflow instead — and the
  cashflow rollup will overwrite year_data.spend automatically downstream.

Top-level fields:
  • doc_kind          — "proposal" or "aggregated_budget" (your classification).
  • document_title    — title printed on the document.
  • primary_vendor    — if the whole document is from one contractor, name them. Null otherwise.
  • notes             — overall caveats or context.
  • confidence        — "high" | "medium" | "low".

Rules:
- Skip subtotal / "GRAND TOTAL" rows from the source — those are derived, not leaf items.
- For proposals: the breakdown subtotal must equal the line's original_total_budget. If the source has tax/fees/contingency at the bottom, include those as breakdown items too.
- For aggregated budgets: classify each row's group correctly (Hard vs Soft etc.) using context.
- Never invent line items.
- Numbers must be JSON numbers (no $, no commas, parens treated as positive).
- Return ONLY a JSON object, no preamble, no markdown fences:

{
  "doc_kind": "proposal" | "aggregated_budget",
  "document_title": string or null,
  "primary_vendor": string or null,
  "notes": string or null,
  "confidence": "high" | "medium" | "low",
  "lines": [
    { "code": ..., "group": ..., "category": ..., "project_name": ..., "description": ...,
      "vendor": ..., "original_total_budget": ..., "forecast_total_budget": ...,
      "year_data": ..., "notes": ...,
      "breakdown": [ { "label": ..., "description": ..., "vendor": ..., "qty": ..., "unit": ..., "unit_cost": ..., "total": ..., "notes": ... }, ... ] | null }
  ]
}"""


def _excel_to_text(raw: bytes, filename: str) -> str:
    """Render every sheet/cell as TSV with a sheet-name header."""
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    parts: list[str] = []
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        parts.append(f"=== Sheet: {sheet_name} ===")
        for row in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v) for v in row]
            if any(c.strip() for c in cells):
                parts.append("\t".join(cells))
        parts.append("")
    return "\n".join(parts)


def _docx_to_text(raw: bytes, filename: str) -> str:
    from docx import Document as DocxDocument
    doc = DocxDocument(io.BytesIO(raw))
    parts: list[str] = []
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            parts.append(t)
    for tbl in doc.tables:
        for row in tbl.rows:
            row_text = "\t".join((c.text or "").strip() for c in row.cells)
            if row_text.strip():
                parts.append(row_text)
    return "\n".join(parts)


SUPPORTED_BUDGET_EXTS = {".pdf", ".xlsx", ".xls", ".docx", ".csv"}


@router.post("/extract-budget", response_model=BudgetExtractResult)
async def extract_budget(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "No file uploaded.")
    ext = Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_BUDGET_EXTS:
        raise HTTPException(
            400,
            f"Unsupported file type {ext!r}. Accepted: PDF, XLSX, DOCX, CSV.",
        )
    if not settings.anthropic_api_key:
        raise HTTPException(
            503,
            "Claude API key not configured. Add ANTHROPIC_API_KEY in backend/.env.",
        )

    # Persist for audit / debugging.
    folder = UPLOADS_DIR / "capex-tracker" / "_budget_uploads"
    folder.mkdir(parents=True, exist_ok=True)
    safe = "".join(c for c in Path(file.filename).stem if c.isalnum() or c in " -_")[:80] or "budget"
    saved = folder / f"{safe}-{uuid.uuid4().hex[:8]}{ext}"
    raw = await file.read()
    saved.write_bytes(raw)

    if ext == ".pdf":
        user_content: list[dict] = [pdf_block(saved)]
    elif ext == ".xlsx":
        text = _excel_to_text(raw, file.filename)
        if not text.strip():
            raise HTTPException(400, "Could not read the Excel file.")
        user_content = [text_block(text)]
    elif ext == ".docx":
        text = _docx_to_text(raw, file.filename)
        if not text.strip():
            raise HTTPException(400, "Could not read the Word document.")
        user_content = [text_block(text)]
    elif ext == ".csv":
        try:
            csv_text = raw.decode("utf-8", errors="replace")
        except Exception:
            csv_text = raw.decode("latin-1", errors="replace")
        user_content = [text_block(f"=== CSV file: {file.filename} ===\n{csv_text}")]
    else:
        # .xls — openpyxl can't read legacy. Surface a clean error.
        raise HTTPException(
            400,
            "Legacy .xls files aren't supported. Re-save as .xlsx or export to PDF.",
        )

    try:
        c = claude_client()
        with c.messages.stream(
            model=settings.extraction_model,
            # 32k is generous for any single-document capex schedule — Claude
            # rarely needs more than a few thousand tokens per ~30 lines.
            max_tokens=32000,
            system=BUDGET_EXTRACT_SYSTEM,
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            final = stream.get_final_message()
        text_blocks = "".join(
            b.text for b in final.content if getattr(b, "type", None) == "text"
        )
        stop_reason = getattr(final, "stop_reason", None)
        try:
            data = _extract_json(text_blocks)
        except (ValueError, ClaudeError) as je:
            # Most likely cause: Claude truncated mid-JSON because the document
            # was longer than expected. Tell the user something actionable.
            if stop_reason == "max_tokens":
                raise HTTPException(
                    413,
                    "The document is too long for a single extraction pass — "
                    "Claude's response was cut off. Try splitting the workbook "
                    "into one sheet per file, or upload the section you actually "
                    "want to track.",
                )
            raise HTTPException(
                502,
                f"Claude returned malformed JSON ({je}). Try uploading the "
                "file again, or split it into smaller sections if it's very large.",
            )
    except HTTPException:
        raise
    except ClaudeError as e:
        raise HTTPException(502, f"Claude error: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e))

    raw_lines = data.get("lines") or []
    if not isinstance(raw_lines, list):
        raise HTTPException(502, "Claude returned a malformed budget payload.")

    cleaned: list[BudgetExtractLine] = []
    for r in raw_lines:
        if not isinstance(r, dict):
            continue
        for k in ("original_total_budget", "forecast_total_budget"):
            v = r.get(k)
            if isinstance(v, str):
                try:
                    r[k] = float(v.replace("$", "").replace(",", "").strip())
                except ValueError:
                    r[k] = 0.0
            elif v is None:
                r[k] = 0.0
        if not r.get("forecast_total_budget"):
            r["forecast_total_budget"] = r.get("original_total_budget") or 0.0
        # Coerce cashflow values that Claude sometimes hands back as strings.
        cf = r.get("cashflow")
        if isinstance(cf, dict):
            cleaned_cf: dict[str, dict[str, float]] = {}
            for year_key, months in cf.items():
                if not isinstance(months, dict):
                    continue
                year_str = str(year_key)
                cleaned_cf[year_str] = {}
                for month_key, value in months.items():
                    try:
                        m = int(str(month_key).strip())
                    except (ValueError, TypeError):
                        continue
                    if m < 1 or m > 12:
                        continue
                    if isinstance(value, str):
                        try:
                            v = float(value.replace("$", "").replace(",", "").replace("(", "-").replace(")", "").strip() or "0")
                        except ValueError:
                            v = 0.0
                    else:
                        v = float(value or 0)
                    cleaned_cf[year_str][str(m)] = v
            r["cashflow"] = cleaned_cf or None
        else:
            r["cashflow"] = None
        # If we extracted cashflow, sync the year_data.spend totals so the
        # budget table immediately reflects per-year spend rollups.
        if r.get("cashflow"):
            yd = dict(r.get("year_data") or {})
            for ystr, months in r["cashflow"].items():
                cur = dict(yd.get(ystr) or {})
                cur["spend"] = float(sum((v or 0) for v in months.values()))
                if "forecast" not in cur:
                    cur["forecast"] = 0.0
                yd[ystr] = cur
            r["year_data"] = yd
        # Coerce breakdown numerics that Claude sometimes hands back as strings.
        bd = r.get("breakdown")
        if isinstance(bd, list):
            for item in bd:
                if not isinstance(item, dict):
                    continue
                for k in ("qty", "unit_cost", "total"):
                    v = item.get(k)
                    if isinstance(v, str):
                        try:
                            item[k] = float(v.replace("$", "").replace(",", "").strip())
                        except ValueError:
                            item[k] = None
            r["breakdown"] = [b for b in bd if isinstance(b, dict) and b.get("label")]
        else:
            r["breakdown"] = None
        try:
            cleaned.append(BudgetExtractLine(**r))
        except Exception:
            continue

    return BudgetExtractResult(
        lines=cleaned,
        document_title=data.get("document_title"),
        primary_vendor=data.get("primary_vendor"),
        notes=data.get("notes"),
        confidence=data.get("confidence"),
        source_filename=file.filename,
        line_count=len(cleaned),
        doc_kind=data.get("doc_kind"),
    )


# ─── Project routes ───────────────────────────────────────────────────────

@router.get("/projects", response_model=list[CapexProjectCard])
def list_projects(archived: bool = False, db: Session = Depends(get_db)):
    rows = (
        db.execute(
            select(CapexProject)
            .where(CapexProject.archived.is_(archived))
            .order_by(CapexProject.updated_at.desc())
            .options(joinedload(CapexProject.hotels).joinedload(CapexHotel.lines))
        )
        .unique()
        .scalars()
        .all()
    )
    cards: list[CapexProjectCard] = []
    for p in rows:
        forecast, spend, current_remaining = _project_totals(p)
        cards.append(
            CapexProjectCard(
                id=p.id,
                kind=p.kind,
                name=p.name,
                image_path=p.image_path,
                parent_hotel_name=p.parent_hotel_name,
                year_start=p.year_start,
                year_end=p.year_end,
                month_start=getattr(p, "month_start", None),
                month_end=getattr(p, "month_end", None),
                updated_at=p.updated_at,
                forecast_total=forecast,
                spend_to_date=spend,
                remaining_current_year=current_remaining,
            )
        )
    return cards


@router.post("/projects", response_model=CapexProjectRead)
def create_project(payload: CapexProjectCreate, db: Session = Depends(get_db)):
    if payload.kind not in ("single", "portfolio", "project"):
        raise HTTPException(400, f"Invalid kind {payload.kind!r}")
    if payload.year_end < payload.year_start:
        raise HTTPException(400, "year_end must be >= year_start")

    project = CapexProject(
        kind=payload.kind,
        name=payload.name.strip(),
        image_path=payload.image_path,
        parent_hotel_name=(payload.parent_hotel_name or None),
        year_start=payload.year_start,
        year_end=payload.year_end,
    )
    db.add(project)
    db.flush()

    # Create hotels: Single + Project always have exactly one. Portfolio can
    # have any number (including zero — they get added later via the wizard).
    hotels_payload = list(payload.hotels)
    if payload.kind in ("single", "project") and not hotels_payload:
        # Auto-create the implicit hotel using the project's name.
        hotels_payload = [CapexHotelCreate(name=project.name, image_path=project.image_path)]
    if payload.kind in ("single", "project") and len(hotels_payload) > 1:
        raise HTTPException(400, f"kind={payload.kind} supports exactly one hotel")

    for idx, h in enumerate(hotels_payload):
        hotel_kwargs = h.model_dump(exclude_unset=True)
        hotel_kwargs["name"] = hotel_kwargs.get("name", "").strip() or h.name
        hotel_kwargs.setdefault("sort_order", idx)
        db.add(CapexHotel(project_id=project.id, **hotel_kwargs))
    db.commit()
    db.refresh(project)
    return _project_to_read(project)


@router.get("/projects/{project_id}", response_model=CapexProjectRead)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return _project_to_read(project)


@router.patch("/projects/{project_id}", response_model=CapexProjectRead)
def update_project(project_id: str, payload: CapexProjectUpdate, db: Session = Depends(get_db)):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(project, k, v)
    db.commit()
    db.refresh(project)
    return _project_to_read(project)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    db.delete(project)
    db.commit()
    # Also wipe the project's upload folder (if any) so we don't leave orphans.
    folder = UPLOADS_DIR / "capex-tracker" / project_id
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
    return {"ok": True}


# ─── Image upload (project / hotel cover) ─────────────────────────────────

ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


@router.post("/projects/{project_id}/image")
async def upload_project_image(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return _store_image(project_id, file, target="project", entity=project, db=db)


@router.post("/hotels/{hotel_id}/image")
async def upload_hotel_image(hotel_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    return _store_image(hotel.project_id, file, target="hotel", entity=hotel, db=db)


def _store_image(project_id: str, file: UploadFile, *, target: str, entity, db: Session):
    if not file.filename:
        raise HTTPException(400, "No file uploaded.")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(400, f"Unsupported image type {ext!r}.")
    folder = _capex_uploads(project_id, "images")
    saved = folder / f"{target}-{uuid.uuid4().hex[:10]}{ext}"
    with saved.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    rel = saved.relative_to(UPLOADS_DIR).as_posix()
    public_path = f"/files/uploads/{rel}"
    entity.image_path = public_path
    db.commit()
    return {"ok": True, "image_path": public_path}


# ─── Hotel logo (upload + AI auto-detect) ─────────────────────────────────

@router.post("/hotels/{hotel_id}/logo")
async def upload_hotel_logo(hotel_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    if not file.filename:
        raise HTTPException(400, "No file uploaded.")
    ext = Path(file.filename).suffix.lower()
    # Allow SVG for vector logos in addition to the standard image types.
    allowed = ALLOWED_IMAGE_EXTS | {".svg"}
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported image type {ext!r}.")
    folder = _capex_uploads(hotel.project_id, "logos")
    saved = folder / f"logo-{uuid.uuid4().hex[:10]}{ext}"
    with saved.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    rel = saved.relative_to(UPLOADS_DIR).as_posix()
    public_path = f"/files/uploads/{rel}"
    hotel.logo_path = public_path
    db.commit()
    return {"ok": True, "logo_path": public_path}


LOGO_LOOKUP_SYSTEM = """You map a hotel brand or chain name to (a) its English Wikipedia article title and (b) its corporate domain, so a downstream service can fetch the official logo. Return ONLY a JSON object — no preamble, no markdown:

{
  "wikipedia_titles": [string, ...],   // 1-3 likely English Wikipedia article titles in order of preference. Use exact case + underscores. Examples: "The_Ritz-Carlton_Hotel_Company", "Ritz-Carlton_Hotel_Company", "Marriott_International". Null/[] if it's an independent hotel unlikely to have an article.
  "domain": string,                     // primary corporate domain, e.g. "ritzcarlton.com"
  "fallback_domain": string|null,       // parent-company domain (e.g. "marriott.com" for Ritz-Carlton)
  "canonical_brand": string,            // brand name as the company writes it
  "confidence": "high"|"medium"|"low"
}

Rules:
- Wikipedia titles are case-sensitive and use underscores in place of spaces.
- For chains, the article is typically named after the company ("The_Ritz-Carlton_Hotel_Company", "Hilton_Hotels_%26_Resorts", "Hyatt") — give a few variants if the canonical title is ambiguous.
- For independent / boutique hotels, leave wikipedia_titles empty.
- For domain, prefer the customer-facing brand site, not the corporate parent unless the brand IS the parent.
- Never invent. If you're unsure, set confidence="low" and give your best guesses."""


@router.post("/hotels/{hotel_id}/logo/auto")
async def auto_detect_hotel_logo(hotel_id: str, db: Session = Depends(get_db)):
    """Use Claude to identify the brand's official domain, then fetch a logo
    from Clearbit's public logo endpoint. No third-party API key required."""
    import urllib.request
    import urllib.error

    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    if not settings.anthropic_api_key:
        raise HTTPException(503, "Claude API key not configured. Add ANTHROPIC_API_KEY in backend/.env.")

    brand_for_lookup = (hotel.current_brand or "").strip() or (hotel.name or "").strip()
    if not brand_for_lookup:
        raise HTTPException(400, "Hotel has no brand or name to look up.")

    user_text = f"Brand or hotel name: {brand_for_lookup}"
    if hotel.current_flag:
        user_text += f"\nManagement company: {hotel.current_flag}"
    if hotel.city or hotel.state:
        user_text += f"\nLocation: {', '.join(filter(None, [hotel.city, hotel.state, hotel.country]))}"

    try:
        c = claude_client()
        with c.messages.stream(
            model=settings.extraction_model,
            max_tokens=500,
            system=LOGO_LOOKUP_SYSTEM,
            messages=[{"role": "user", "content": user_text}],
        ) as stream:
            final = stream.get_final_message()
        text_blocks = "".join(
            b.text for b in final.content if getattr(b, "type", None) == "text"
        )
        data = _extract_json(text_blocks)
    except ClaudeError as e:
        raise HTTPException(502, f"Claude error: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e))

    candidates = [data.get("domain"), data.get("fallback_domain")]
    candidates = [c.strip().lstrip("www.").lower() for c in candidates if c and isinstance(c, str)]
    if not candidates:
        raise HTTPException(404, "Couldn't identify a brand domain to fetch a logo from. Upload one manually instead.")

    wiki_titles = data.get("wikipedia_titles") or []
    if not isinstance(wiki_titles, list):
        wiki_titles = []
    wiki_titles = [t.strip() for t in wiki_titles if isinstance(t, str) and t.strip()]

    last_err: Optional[str] = None
    folder = _capex_uploads(hotel.project_id, "logos")
    folder.mkdir(parents=True, exist_ok=True)

    def _fetch_image(url: str) -> tuple[Optional[bytes], Optional[str], Optional[str]]:
        """Fetch a URL; return (bytes, content_type, err) where bytes is None on
        any non-image response."""
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 GencomCapexTracker/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                ctype = resp.headers.get("Content-Type", "") or ""
                raw = resp.read()
            if not raw or "image" not in ctype.lower():
                return None, ctype, f"non-image response ({ctype or 'no content-type'})"
            if len(raw) < 300:
                return None, ctype, f"too small ({len(raw)} bytes — likely placeholder)"
            return raw, ctype, None
        except urllib.error.HTTPError as e:
            return None, None, f"HTTP {e.code}"
        except Exception as e:  # noqa: BLE001
            return None, None, str(e)

    def _scrape_homepage_icons(domain: str) -> list[str]:
        """Pull <link rel="apple-touch-icon"> + <meta property="og:image"> URLs
        from the brand's homepage. These are typically 180×180 to 1200×630."""
        import re as _re
        from urllib.parse import urljoin
        for base in (f"https://www.{domain}/", f"https://{domain}/"):
            try:
                req = urllib.request.Request(base, headers={"User-Agent": "Mozilla/5.0 GencomCapexTracker/1.0"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    ctype = resp.headers.get("Content-Type", "") or ""
                    if "html" not in ctype.lower():
                        continue
                    # Just the <head> is plenty for the meta/link tags.
                    html = resp.read(80_000).decode(errors="replace")
            except Exception:
                continue
            urls: list[tuple[int, str]] = []  # (priority, url) — lower = better
            # Apple touch icons — usually 180×180.
            for m in _re.finditer(
                r'<link[^>]+rel=["\'](?:apple-touch-icon(?:-precomposed)?)["\'][^>]*href=["\']([^"\']+)["\']',
                html,
                _re.IGNORECASE,
            ):
                urls.append((1, urljoin(base, m.group(1))))
            # Reverse direction: href before rel.
            for m in _re.finditer(
                r'<link[^>]+href=["\']([^"\']+)["\'][^>]*rel=["\'](?:apple-touch-icon(?:-precomposed)?)["\']',
                html,
                _re.IGNORECASE,
            ):
                urls.append((1, urljoin(base, m.group(1))))
            # Generic icon links (with size attribute, prefer 192/180/144).
            for m in _re.finditer(
                r'<link[^>]+rel=["\']icon["\'][^>]*sizes=["\'](\d+)x\d+["\'][^>]*href=["\']([^"\']+)["\']',
                html,
                _re.IGNORECASE,
            ):
                size = int(m.group(1))
                if size >= 64:
                    urls.append((2, urljoin(base, m.group(2))))
            for m in _re.finditer(
                r'<link[^>]+href=["\']([^"\']+)["\'][^>]*sizes=["\'](\d+)x\d+["\']',
                html,
                _re.IGNORECASE,
            ):
                size = int(m.group(2))
                if size >= 64 and "icon" in html[max(0, m.start() - 80) : m.end() + 80].lower():
                    urls.append((2, urljoin(base, m.group(1))))
            # og:image — last resort because it's often a hero photo, not a logo,
            # but for some brands this is the only large branded image.
            for m in _re.finditer(
                r'<meta[^>]+property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']',
                html,
                _re.IGNORECASE,
            ):
                urls.append((3, urljoin(base, m.group(1))))
            urls.sort(key=lambda x: x[0])
            seen: set[str] = set()
            out: list[str] = []
            for _, u in urls:
                if u not in seen:
                    seen.add(u)
                    out.append(u)
            if out:
                return out
        return []

    def _wikipedia_logo_urls(title: str) -> list[str]:
        """Use Wikipedia's REST summary API to get the page's main image
        (typically the infobox logo for a brand article)."""
        from urllib.parse import quote
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title, safe='_')}"
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "GencomCapexTracker/1.0 (logo lookup; contact via app)",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                payload = json.loads(resp.read().decode("utf-8", errors="replace"))
        except Exception:
            return []
        out: list[str] = []
        # originalimage is the largest available; thumbnail is a sized variant.
        for key in ("originalimage", "thumbnail"):
            v = payload.get(key) or {}
            src = v.get("source")
            if isinstance(src, str) and src.startswith("http"):
                out.append(src)
        return out

    # Strategy: try Wikipedia infobox logo first (high-res, transparent
    # background, real brand mark), then scrape brand homepages, then favicon
    # services as a final low-res-but-reliable fallback.
    def fallback_sources_for(domain: str) -> list[str]:
        return [
            # logo.clearbit.com is dead (DNS pulled mid-2024) but we keep it
            # at the top in case it's ever resurrected — failure is fast.
            f"https://logo.clearbit.com/{domain}",
            f"https://icons.duckduckgo.com/ip3/{domain}.ico",
            f"https://www.google.com/s2/favicons?domain={domain}&sz=256",
        ]

    all_urls: list[tuple[str, str]] = []  # (source_label, url) preserving order
    for title in wiki_titles:
        for u in _wikipedia_logo_urls(title):
            all_urls.append((f"wikipedia:{title}", u))
    for domain in candidates:
        for u in _scrape_homepage_icons(domain):
            all_urls.append((domain, u))
        for u in fallback_sources_for(domain):
            all_urls.append((domain, u))

    for source, url in all_urls:
        raw, ctype, err = _fetch_image(url)
        if raw is None:
            last_err = f"{source} ({url.split('/')[2]}): {err}"
            continue
        if "png" in (ctype or ""):
            ext = ".png"
        elif "jpeg" in (ctype or "") or "jpg" in (ctype or ""):
            ext = ".jpg"
        elif "svg" in (ctype or ""):
            ext = ".svg"
        elif "ico" in (ctype or "") or "icon" in (ctype or ""):
            ext = ".ico"
        else:
            ext = ".png"
        saved = folder / f"logo-{uuid.uuid4().hex[:10]}{ext}"
        saved.write_bytes(raw)
        rel = saved.relative_to(UPLOADS_DIR).as_posix()
        public_path = f"/files/uploads/{rel}"
        hotel.logo_path = public_path
        db.commit()
        return {
            "ok": True,
            "logo_path": public_path,
            "source_domain": source,
            "source_url": url,
            "canonical_brand": data.get("canonical_brand"),
            "confidence": data.get("confidence"),
        }

    raise HTTPException(
        404,
        "Couldn't fetch a brand logo automatically. Upload one manually instead. "
        f"(Tried: {', '.join(candidates)}. Last error: {last_err or 'none'}.)",
    )


@router.delete("/hotels/{hotel_id}/logo")
def clear_hotel_logo(hotel_id: str, db: Session = Depends(get_db)):
    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    hotel.logo_path = None
    db.commit()
    return {"ok": True}


# ─── Hotel routes ─────────────────────────────────────────────────────────

@router.post("/projects/{project_id}/hotels", response_model=CapexHotelRead)
def add_hotel(project_id: str, payload: CapexHotelCreate, db: Session = Depends(get_db)):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if project.kind in ("single", "project") and len(project.hotels) >= 1:
        raise HTTPException(400, f"kind={project.kind} supports exactly one hotel")
    hotel_kwargs = payload.model_dump(exclude_unset=True)
    hotel_kwargs["name"] = hotel_kwargs.get("name", "").strip() or payload.name
    hotel_kwargs.setdefault("sort_order", len(project.hotels))
    hotel = CapexHotel(project_id=project_id, **hotel_kwargs)
    db.add(hotel)
    db.commit()
    db.refresh(hotel)
    return _hotel_to_read(hotel)


@router.get("/hotels/{hotel_id}", response_model=CapexHotelRead)
def get_hotel(hotel_id: str, db: Session = Depends(get_db)):
    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    return _hotel_to_read(hotel)


@router.patch("/hotels/{hotel_id}", response_model=CapexHotelRead)
def update_hotel(hotel_id: str, payload: CapexHotelUpdate, db: Session = Depends(get_db)):
    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(hotel, k, v)
    db.commit()
    db.refresh(hotel)
    return _hotel_to_read(hotel)


@router.delete("/hotels/{hotel_id}")
def delete_hotel(hotel_id: str, db: Session = Depends(get_db)):
    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    db.delete(hotel)
    db.commit()
    return {"ok": True}


# ─── Line routes ──────────────────────────────────────────────────────────

@router.get("/hotels/{hotel_id}/lines", response_model=list[CapexLineRead])
def list_lines(hotel_id: str, db: Session = Depends(get_db)):
    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    rows = (
        db.execute(
            select(CapexLine).where(CapexLine.hotel_id == hotel_id).order_by(CapexLine.sort_order, CapexLine.created_at)
        )
        .scalars()
        .all()
    )
    return rows


@router.post("/hotels/{hotel_id}/lines", response_model=CapexLineRead)
def create_line(hotel_id: str, payload: CapexLineCreate, db: Session = Depends(get_db)):
    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    line = CapexLine(hotel_id=hotel_id, **payload.model_dump(exclude_unset=True))
    db.add(line)
    db.commit()
    db.refresh(line)
    return line


@router.post("/hotels/{hotel_id}/lines/bulk", response_model=list[CapexLineRead])
def bulk_create_lines(hotel_id: str, payload: list[CapexLineCreate], db: Session = Depends(get_db)):
    hotel = db.get(CapexHotel, hotel_id)
    if not hotel:
        raise HTTPException(404, "Hotel not found")
    created: list[CapexLine] = []
    for item in payload:
        line = CapexLine(hotel_id=hotel_id, **item.model_dump(exclude_unset=True))
        db.add(line)
        created.append(line)
    db.commit()
    for line in created:
        db.refresh(line)
    return created


@router.patch("/lines/{line_id}", response_model=CapexLineRead)
def update_line(line_id: str, payload: CapexLineUpdate, db: Session = Depends(get_db)):
    line = db.get(CapexLine, line_id)
    if not line:
        raise HTTPException(404, "Line not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(line, k, v)
    db.commit()
    db.refresh(line)
    return line


@router.delete("/lines/{line_id}")
def delete_line(line_id: str, db: Session = Depends(get_db)):
    line = db.get(CapexLine, line_id)
    if not line:
        raise HTTPException(404, "Line not found")
    db.delete(line)
    db.commit()
    return {"ok": True}


# ─── Invoice upload + AI auto-match ───────────────────────────────────────

INVOICE_MATCH_DEFAULT_THRESHOLD = 0.75
SUPPORTED_INVOICE_EXTS = {".pdf", ".xlsx", ".xls", ".docx", ".csv", ".png", ".jpg", ".jpeg", ".webp"}


INVOICE_PARSE_SYSTEM = """You are an invoice intake + matching assistant for a hotel capex budget tracker. The user has uploaded a vendor invoice. You are given:

  1. The invoice file (PDF/image/spreadsheet/text).
  2. A JSON list of every budget line in the project — each with id, code, group, category, project_name, vendor, original_total_budget, forecast_total_budget, description.
  3. Optional context about the host hotel (name, city, brand) for vendor disambiguation.

Your job:

(A) Extract invoice metadata:
    • vendor              — supplier / contractor name
    • invoice_number      — invoice / proposal number (string)
    • invoice_date        — ISO date (YYYY-MM-DD) if you can determine it; null otherwise
    • total_amount        — grand total billed on this invoice (number, no $ or commas)
    • description         — one-line summary of what the invoice covers
    • suggested_year      — int year derived from invoice_date (or invoice context)
    • suggested_month     — int 1-12 derived from invoice_date

(B) Score every budget line against the invoice. For each line, compute a confidence in [0, 1] and a one-sentence reason. Use these signals (weighted):
    1. Exact match on Code that appears anywhere in the invoice (highest weight).
    2. Vendor name on the budget line matches the invoice vendor (high weight).
    3. project_name + description keywords match the invoice scope (medium).
    4. Invoice total is plausibly a draw on the line's forecast_total_budget (medium — not exceeding it; reasonable fraction).
    5. Hotel/property mentioned on invoice matches the host hotel.

Only return lines with confidence >= 0.05 — drop the rest. Sort matches by confidence desc, top 5.

(C) Identify INVOICE SPLITS — separate sections of this invoice that should
    each be applied to a DIFFERENT budget line. Many vendor invoices (especially
    consulting / engineering firms) bill multiple scopes on one invoice — e.g.
    "Structural Engineering — Phase 1: $10,000" plus "MEP Engineering — Phase 1:
    $5,000". Each line item or section that maps to a different code/scope
    becomes its own split.

    Rules:
    - Sum of split amounts SHOULD equal total_amount (within $1 rounding).
    - If the invoice covers ONLY ONE scope (single line item, single phase,
      one project code), return suggested_splits as an empty array — the
      legacy single-line apply path will be used.
    - Each split's `suggested_line_id` is the budget line you'd attribute that
      portion to. Confidence is 0..1 (same scoring rules as matches).
    - The `code` field on each split is any project / phase / line code that
      appears in the source for that split (e.g. "ASR-003").

(D) OUTPUT FORMAT — read carefully:

Your response MUST be ONLY a single JSON object. No preamble. No analysis
narrative. No "Let me analyze..." or bullet-point breakdowns. No markdown
fences. No commentary after the JSON. The very first character of your
response must be `{` and the very last character must be `}`.

Schema:
{
  "vendor": str|null,
  "invoice_number": str|null,
  "invoice_date": str|null,    // YYYY-MM-DD
  "total_amount": number,
  "description": str|null,
  "suggested_year": int|null,
  "suggested_month": int|null,
  "notes": str|null,
  "matches": [
    { "line_id": str, "confidence": number, "reason": str }
  ],
  "suggested_splits": [
    { "amount": number, "label": str, "description": str|null, "code": str|null,
      "suggested_line_id": str|null, "confidence": number, "reason": str }
  ]
}"""


def _hotel_for_project(project: CapexProject) -> Optional[CapexHotel]:
    """Return the project's primary hotel for host context. For Single + Project
    kinds there is exactly one. For Portfolio we return the first."""
    if not project.hotels:
        return None
    return sorted(project.hotels, key=lambda h: (h.sort_order, h.created_at))[0]


def _build_invoice_match_payload(project: CapexProject, db: Session) -> tuple[list[dict], dict]:
    """Compose the (lines, host) JSON payload Claude needs to score matches."""
    lines_payload: list[dict] = []
    for hotel in project.hotels:
        for line in hotel.lines:
            lines_payload.append(
                {
                    "id": line.id,
                    "hotel_id": hotel.id,
                    "code": line.code,
                    "group": line.group,
                    "category": line.category,
                    "project_name": line.project_name,
                    "description": line.description,
                    "vendor": line.vendor,
                    "original_total_budget": line.original_total_budget,
                    "forecast_total_budget": line.forecast_total_budget,
                }
            )
    primary = _hotel_for_project(project)
    host = {
        "project_kind": project.kind,
        "project_name": project.name,
        "parent_hotel_name": project.parent_hotel_name,
        "primary_hotel_name": primary.name if primary else None,
        "primary_hotel_city": primary.city if primary else None,
        "primary_hotel_state": primary.state if primary else None,
        "primary_hotel_brand": primary.current_brand if primary else None,
        "primary_hotel_keys": primary.keys if primary else None,
    }
    return lines_payload, host


@router.post("/projects/{project_id}/invoices/upload", response_model=InvoiceParseResult)
async def upload_invoice(
    project_id: str,
    file: UploadFile = File(...),
    threshold: float = Form(INVOICE_MATCH_DEFAULT_THRESHOLD),
    db: Session = Depends(get_db),
):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if not file.filename:
        raise HTTPException(400, "No file uploaded.")
    ext = Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_INVOICE_EXTS:
        raise HTTPException(
            400,
            f"Unsupported file type {ext!r}. Accepted: PDF, XLSX, DOCX, CSV, PNG, JPG, WEBP.",
        )
    if not settings.anthropic_api_key:
        raise HTTPException(
            503,
            "Claude API key not configured. Add ANTHROPIC_API_KEY in backend/.env.",
        )

    folder = _capex_uploads(project_id, "invoices")
    safe = "".join(c for c in Path(file.filename).stem if c.isalnum() or c in " -_")[:80] or "invoice"
    saved = folder / f"{safe}-{uuid.uuid4().hex[:8]}{ext}"
    raw = await file.read()
    saved.write_bytes(raw)
    public_path = f"/files/uploads/{saved.relative_to(UPLOADS_DIR).as_posix()}"

    # Build the user content for Claude — the file plus the lines/host JSON.
    lines_payload, host = _build_invoice_match_payload(project, db)
    instr_text = (
        "Match this invoice against the project's budget lines.\n\n"
        f"Host context:\n{json.dumps(host, indent=2)}\n\n"
        f"Budget lines ({len(lines_payload)}):\n{json.dumps(lines_payload, indent=2)}"
    )

    if ext == ".pdf":
        user_content: list[dict] = [pdf_block(saved), text_block(instr_text)]
    elif ext == ".xlsx":
        text = _excel_to_text(raw, file.filename)
        user_content = [text_block(text), text_block(instr_text)]
    elif ext == ".docx":
        text = _docx_to_text(raw, file.filename)
        user_content = [text_block(text), text_block(instr_text)]
    elif ext == ".csv":
        try:
            csv_text = raw.decode("utf-8", errors="replace")
        except Exception:
            csv_text = raw.decode("latin-1", errors="replace")
        user_content = [text_block(csv_text), text_block(instr_text)]
    elif ext in (".png", ".jpg", ".jpeg", ".webp"):
        # Image invoices — pass as a vision content block.
        import base64
        media_type = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
        }[ext]
        user_content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.standard_b64encode(raw).decode("ascii"),
                },
            },
            text_block(instr_text),
        ]
    else:
        raise HTTPException(400, f"Unsupported invoice type {ext!r}.")

    try:
        c = claude_client()
        with c.messages.stream(
            model=settings.extraction_model,
            max_tokens=12000,
            system=INVOICE_PARSE_SYSTEM,
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            final = stream.get_final_message()
        text_blocks = "".join(
            b.text for b in final.content if getattr(b, "type", None) == "text"
        )
        stop_reason = getattr(final, "stop_reason", None)
        if stop_reason == "max_tokens":
            raise HTTPException(
                502,
                "Claude response was truncated at max_tokens. The invoice plus the "
                "budget-line context is too large for one response. Try uploading a "
                "shorter invoice or contact the developer to raise the cap.",
            )
        if not text_blocks.strip():
            block_types = [getattr(b, "type", "?") for b in final.content]
            raise HTTPException(
                502,
                f"Claude returned no text (stop_reason={stop_reason}, blocks={block_types}). "
                "This usually means the file couldn't be read (corrupted/encrypted PDF). "
                "Try a different file.",
            )
        try:
            data = _extract_json(text_blocks)
        except json.JSONDecodeError as je:
            preview = text_blocks[:500].replace("\n", " ")
            raise HTTPException(
                502,
                f"Claude returned non-JSON output: {je}. First 500 chars: {preview!r}",
            )
    except HTTPException:
        raise
    except ClaudeError as e:
        raise HTTPException(502, f"Claude error: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"{type(e).__name__}: {e}")

    # Coerce numerics.
    for k in ("total_amount",):
        v = data.get(k)
        if isinstance(v, str):
            try:
                data[k] = float(v.replace("$", "").replace(",", "").strip())
            except ValueError:
                data[k] = 0.0
    for k in ("suggested_year", "suggested_month"):
        v = data.get(k)
        if isinstance(v, str):
            try:
                data[k] = int(v.strip())
            except ValueError:
                data[k] = None

    raw_matches = data.get("matches") or []
    valid_line_ids = {l["id"] for l in lines_payload}
    matches: list[InvoiceParseLineMatch] = []
    for m in raw_matches:
        if not isinstance(m, dict):
            continue
        lid = m.get("line_id")
        if lid not in valid_line_ids:
            continue
        try:
            conf = float(m.get("confidence") or 0)
        except (TypeError, ValueError):
            conf = 0.0
        matches.append(InvoiceParseLineMatch(line_id=lid, confidence=conf, reason=m.get("reason")))
    matches.sort(key=lambda m: m.confidence, reverse=True)
    best = matches[0] if matches else None
    above = bool(best and best.confidence >= threshold)

    # Coerce suggested splits — Claude may return amounts as strings.
    raw_splits = data.get("suggested_splits") or []
    suggested_splits: list[SuggestedSplit] = []
    if isinstance(raw_splits, list):
        for s in raw_splits:
            if not isinstance(s, dict):
                continue
            amt = s.get("amount")
            if isinstance(amt, str):
                try:
                    amt = float(amt.replace("$", "").replace(",", "").strip())
                except ValueError:
                    amt = 0.0
            elif amt is None:
                amt = 0.0
            sline = s.get("suggested_line_id")
            if sline not in valid_line_ids:
                sline = None
            try:
                conf = float(s.get("confidence") or 0)
            except (TypeError, ValueError):
                conf = 0.0
            suggested_splits.append(
                SuggestedSplit(
                    amount=float(amt),
                    label=s.get("label"),
                    description=s.get("description"),
                    code=s.get("code"),
                    suggested_line_id=sline,
                    confidence=conf,
                    reason=s.get("reason"),
                )
            )

    # Persist a pending invoice record so the user can come back to confirm.
    invoice = CapexInvoice(
        project_id=project_id,
        line_id=best.line_id if above else None,
        vendor=data.get("vendor"),
        invoice_number=data.get("invoice_number"),
        invoice_date=data.get("invoice_date"),
        total_amount=float(data.get("total_amount") or 0),
        description=data.get("description"),
        applied_year=data.get("suggested_year") if above else None,
        applied_month=data.get("suggested_month") if above else None,
        confidence=best.confidence if best else None,
        match_status="pending",
        file_path=public_path,
        original_filename=file.filename,
        parsed_json={
            "matches": [m.model_dump() for m in matches],
            "suggested_splits": [s.model_dump() for s in suggested_splits],
            "ai_notes": data.get("notes"),
        },
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    return InvoiceParseResult(
        invoice_id=invoice.id,
        vendor=data.get("vendor"),
        invoice_number=data.get("invoice_number"),
        invoice_date=data.get("invoice_date"),
        total_amount=float(data.get("total_amount") or 0),
        description=data.get("description"),
        suggested_year=data.get("suggested_year"),
        suggested_month=data.get("suggested_month"),
        matches=matches[:5],
        best_match=best,
        suggested_splits=suggested_splits,
        threshold=threshold,
        above_threshold=above,
        source_filename=file.filename,
        notes=data.get("notes"),
    )


def _apply_invoice_to_year_data(line: CapexLine, year: int, delta: float, month: Optional[int] = None) -> None:
    """Increment the line's year_data[year].spend by `delta`. Initializes structure
    if missing. Forecast is left alone. When `month` is provided, the cashflow
    matrix is also updated so monthly views stay in sync."""
    yd = dict(line.year_data or {})
    cur = dict(yd.get(str(year)) or {})
    cur["spend"] = float(cur.get("spend") or 0) + delta
    if "forecast" not in cur:
        cur["forecast"] = float(cur.get("forecast") or 0)
    yd[str(year)] = cur
    line.year_data = yd
    if month is not None and 1 <= month <= 12:
        cf = dict(line.cashflow or {})
        ymonths = dict(cf.get(str(year)) or {})
        ymonths[str(month)] = float(ymonths.get(str(month)) or 0) + delta
        cf[str(year)] = ymonths
        line.cashflow = cf


def _book_invoice_spend(invoice: CapexInvoice, db: Session, sign: int) -> None:
    """Apply or reverse the invoice's spend rollup. `sign` is +1 to book,
    -1 to undo. Honors splits when present; falls back to the single-line
    legacy path when there are no splits.

    No-op when the invoice isn't in a "matched"/"manual" state, since
    pending/unmatched invoices haven't been booked anywhere."""
    if invoice.match_status not in ("matched", "manual"):
        return

    splits = invoice.splits or []
    valid_splits = [
        s for s in splits
        if isinstance(s, dict)
        and s.get("line_id")
        and s.get("applied_year") is not None
    ]
    if valid_splits:
        for s in valid_splits:
            line = db.get(CapexLine, s["line_id"])
            if not line:
                continue
            _apply_invoice_to_year_data(
                line,
                int(s["applied_year"]),
                sign * float(s.get("amount") or 0),
                s.get("applied_month"),
            )
        return

    # Legacy single-line rollup
    if not (invoice.line_id and invoice.applied_year):
        return
    line = db.get(CapexLine, invoice.line_id)
    if not line:
        return
    _apply_invoice_to_year_data(
        line,
        invoice.applied_year,
        sign * float(invoice.total_amount or 0),
        invoice.applied_month,
    )


def _normalize_splits(raw: object) -> Optional[list[dict]]:
    """Turn whatever the client sent into a clean list of split dicts. Returns
    None if there are no valid splits, otherwise a list with stable per-row IDs
    and coerced numerics."""
    if not isinstance(raw, list):
        return None
    out: list[dict] = []
    for item in raw:
        if isinstance(item, dict):
            d = dict(item)
        else:
            try:
                d = item.model_dump()  # pydantic InvoiceSplit
            except Exception:  # noqa: BLE001
                continue
        if not d.get("id"):
            d["id"] = str(uuid.uuid4())
        try:
            d["amount"] = float(d.get("amount") or 0)
        except (TypeError, ValueError):
            d["amount"] = 0.0
        if d.get("applied_year") is not None:
            try:
                d["applied_year"] = int(d["applied_year"])
            except (TypeError, ValueError):
                d["applied_year"] = None
        if d.get("applied_month") is not None:
            try:
                m = int(d["applied_month"])
                d["applied_month"] = m if 1 <= m <= 12 else None
            except (TypeError, ValueError):
                d["applied_month"] = None
        out.append(d)
    return out or None


@router.post("/projects/{project_id}/invoices/{invoice_id}/apply", response_model=CapexInvoiceRead)
def apply_invoice(
    project_id: str,
    invoice_id: str,
    payload: InvoiceApplyRequest,
    db: Session = Depends(get_db),
):
    invoice = db.get(CapexInvoice, invoice_id)
    if not invoice or invoice.project_id != project_id:
        raise HTTPException(404, "Invoice not found")

    # Reverse any prior booking before re-applying.
    _book_invoice_spend(invoice, db, sign=-1)

    # Apply user overrides on the metadata.
    if payload.vendor is not None:
        invoice.vendor = payload.vendor or None
    if payload.invoice_number is not None:
        invoice.invoice_number = payload.invoice_number or None
    if payload.invoice_date is not None:
        invoice.invoice_date = payload.invoice_date or None
    if payload.total_amount is not None:
        invoice.total_amount = payload.total_amount
    if payload.description is not None:
        invoice.description = payload.description or None

    splits_payload = payload.splits
    has_splits = splits_payload is not None and len(splits_payload) > 0
    if has_splits:
        invoice.splits = _normalize_splits(splits_payload)
        # Aggregate the parent fields from splits for display + legacy clients.
        # Use the first split's line/year/month as the "primary" pointer.
        primary = invoice.splits[0]
        invoice.line_id = primary.get("line_id")
        invoice.applied_year = primary.get("applied_year")
        invoice.applied_month = primary.get("applied_month")
        if payload.total_amount is None:
            invoice.total_amount = float(sum((s.get("amount") or 0) for s in invoice.splits))
    else:
        # Legacy single-line apply path.
        if not payload.line_id:
            raise HTTPException(400, "Either line_id or splits must be provided.")
        line = db.get(CapexLine, payload.line_id)
        if not line:
            raise HTTPException(404, "Line not found")
        if payload.applied_month is None or not (1 <= payload.applied_month <= 12):
            raise HTTPException(400, "applied_month must be 1..12")
        if payload.applied_year is None:
            raise HTTPException(400, "applied_year is required for single-line apply")
        invoice.line_id = payload.line_id
        invoice.applied_year = payload.applied_year
        invoice.applied_month = payload.applied_month
        invoice.splits = None

    invoice.match_status = payload.match_status or "matched"

    _book_invoice_spend(invoice, db, sign=+1)

    db.commit()
    db.refresh(invoice)
    return invoice


@router.patch("/invoices/{invoice_id}", response_model=CapexInvoiceRead)
def update_invoice(invoice_id: str, payload: CapexInvoiceUpdate, db: Session = Depends(get_db)):
    """Generic invoice update with spend reconciliation. If the user changes
    line_id, applied_year, applied_month, or total_amount, we decrement the
    previously-booked spend and re-book it under the new (line, year, month)
    so the budget table's spend column stays accurate."""
    invoice = db.get(CapexInvoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")

    set_data = payload.model_dump(exclude_unset=True)

    # Always reverse the prior booking before mutating, then re-book once the
    # update is applied. Cheap and avoids subtle reconciliation bugs when
    # multiple fields change at once (splits + status + amount).
    _book_invoice_spend(invoice, db, sign=-1)

    if "splits" in set_data:
        set_data["splits"] = _normalize_splits(set_data["splits"])

    for k, v in set_data.items():
        setattr(invoice, k, v)

    _book_invoice_spend(invoice, db, sign=+1)

    db.commit()
    db.refresh(invoice)
    return invoice


@router.get("/projects/{project_id}/invoices", response_model=list[CapexInvoiceRead])
def list_invoices(project_id: str, db: Session = Depends(get_db)):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    rows = (
        db.execute(
            select(CapexInvoice)
            .where(CapexInvoice.project_id == project_id)
            .order_by(CapexInvoice.created_at.desc())
        )
        .scalars()
        .all()
    )
    return rows


@router.delete("/invoices/{invoice_id}")
def delete_invoice(invoice_id: str, db: Session = Depends(get_db)):
    invoice = db.get(CapexInvoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    # Reverse all bookings (splits or legacy single-line) before deleting.
    _book_invoice_spend(invoice, db, sign=-1)
    db.delete(invoice)
    db.commit()
    return {"ok": True}


# ─── Contract / Agreement / Executed Proposal upload ──────────────────────

SUPPORTED_DOC_EXTS = {".pdf", ".xlsx", ".docx", ".csv", ".png", ".jpg", ".jpeg", ".webp"}

DOCUMENT_PARSE_SYSTEM = """You are an intake assistant for a hotel capex budget tracker. The user just uploaded a CONTRACT, AGREEMENT, or EXECUTED PROPOSAL related to a renovation line item. Read the document and extract:

  • suggested_doc_type — one of: "contract" | "agreement" | "proposal"
        - "contract"  : a legally binding executed contract or change order (typically updates the budget forecast).
        - "agreement" : a side letter, MOU, NDA, or other agreement that doesn't itself commit dollars (typically does NOT update forecast).
        - "proposal"  : a vendor proposal / quote / bid. If it's clearly stamped or signed as EXECUTED / ACCEPTED, treat it like a contract; otherwise leave forecast alone unless the user opts in.
  • vendor          — the contractor / supplier on the doc.
  • amount          — total contract value in USD (number, no $ or commas). For change orders, use the new total or change-order amount as labeled. Null if not determinable.
  • document_date   — ISO YYYY-MM-DD if a primary date is on the document (execution / signing / proposal date). Null otherwise.
  • scope_summary   — one-sentence description of what this document covers.
  • confidence      — "high" | "medium" | "low" based on legibility / clarity of the source.
  • notes           — any caveats: change-order vs original, scope exclusions, expiration, signatures missing, etc. Null if nothing relevant.

Return ONLY a JSON object — no preamble, no markdown fences:
{
  "suggested_doc_type": "contract" | "agreement" | "proposal",
  "vendor": str | null,
  "amount": number | null,
  "document_date": str | null,
  "scope_summary": str | null,
  "confidence": "high" | "medium" | "low",
  "notes": str | null
}"""


def _doc_to_read(doc: CapexDocument) -> CapexDocumentRead:
    return CapexDocumentRead(
        id=doc.id,
        project_id=doc.project_id,
        line_id=doc.line_id,
        doc_type=doc.doc_type,
        vendor=doc.vendor,
        amount=doc.amount,
        updates_forecast=doc.updates_forecast,
        file_path=doc.file_path,
        original_filename=doc.original_filename,
        notes=doc.notes,
        created_at=doc.created_at,
    )


@router.post("/projects/{project_id}/documents/upload", response_model=DocumentParseResult)
async def upload_document(
    project_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    if not file.filename:
        raise HTTPException(400, "No file uploaded.")
    ext = Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_DOC_EXTS:
        raise HTTPException(
            400,
            f"Unsupported file type {ext!r}. Accepted: PDF, XLSX, DOCX, CSV, PNG, JPG, WEBP.",
        )
    if not settings.anthropic_api_key:
        raise HTTPException(
            503,
            "Claude API key not configured. Add ANTHROPIC_API_KEY in backend/.env.",
        )

    folder = _capex_uploads(project_id, "documents")
    safe = "".join(c for c in Path(file.filename).stem if c.isalnum() or c in " -_")[:80] or "document"
    saved = folder / f"{safe}-{uuid.uuid4().hex[:8]}{ext}"
    raw = await file.read()
    saved.write_bytes(raw)
    public_path = f"/files/uploads/{saved.relative_to(UPLOADS_DIR).as_posix()}"

    if ext == ".pdf":
        user_content: list[dict] = [pdf_block(saved)]
    elif ext == ".xlsx":
        text = _excel_to_text(raw, file.filename)
        user_content = [text_block(text or "(Excel file empty)")]
    elif ext == ".docx":
        text = _docx_to_text(raw, file.filename)
        user_content = [text_block(text or "(Word file empty)")]
    elif ext == ".csv":
        try:
            csv_text = raw.decode("utf-8", errors="replace")
        except Exception:
            csv_text = raw.decode("latin-1", errors="replace")
        user_content = [text_block(csv_text)]
    elif ext in (".png", ".jpg", ".jpeg", ".webp"):
        import base64
        media_type = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
        }[ext]
        user_content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.standard_b64encode(raw).decode("ascii"),
                },
            }
        ]
    else:
        raise HTTPException(400, f"Unsupported document type {ext!r}.")

    try:
        c = claude_client()
        with c.messages.stream(
            model=settings.extraction_model,
            max_tokens=2500,
            system=DOCUMENT_PARSE_SYSTEM,
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            final = stream.get_final_message()
        text_blocks = "".join(
            b.text for b in final.content if getattr(b, "type", None) == "text"
        )
        data = _extract_json(text_blocks)
    except ClaudeError as e:
        raise HTTPException(502, f"Claude error: {e}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, str(e))

    # Coerce amount.
    amt = data.get("amount")
    if isinstance(amt, str):
        try:
            amt = float(amt.replace("$", "").replace(",", "").strip())
        except ValueError:
            amt = None
    elif amt is None:
        amt = None

    suggested_type = data.get("suggested_doc_type") or "proposal"
    if suggested_type not in ("contract", "agreement", "proposal"):
        suggested_type = "proposal"

    # Persist a draft document with line_id=null and updates_forecast=False.
    # The /apply call lets the user pick the line and decide forecast handling.
    doc = CapexDocument(
        project_id=project_id,
        line_id=None,
        doc_type=suggested_type,
        vendor=data.get("vendor"),
        amount=amt,
        updates_forecast=False,
        file_path=public_path,
        original_filename=file.filename,
        notes=data.get("notes"),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    return DocumentParseResult(
        document_id=doc.id,
        suggested_doc_type=suggested_type,
        vendor=data.get("vendor"),
        amount=amt,
        document_date=data.get("document_date"),
        scope_summary=data.get("scope_summary"),
        confidence=data.get("confidence"),
        notes=data.get("notes"),
        source_filename=file.filename,
    )


@router.post("/documents/{document_id}/apply", response_model=CapexDocumentRead)
def apply_document(document_id: str, payload: DocumentApplyRequest, db: Session = Depends(get_db)):
    doc = db.get(CapexDocument, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    line = db.get(CapexLine, payload.line_id)
    if not line:
        raise HTTPException(404, "Line not found")

    if payload.forecast_action == "custom" and (payload.custom_amount is None or payload.custom_amount < 0):
        raise HTTPException(400, "custom_amount required (and non-negative) when forecast_action='custom'.")

    # Apply user overrides on the doc.
    if payload.vendor is not None:
        doc.vendor = payload.vendor or None
    if payload.amount is not None:
        doc.amount = payload.amount
    if payload.notes is not None:
        doc.notes = payload.notes or None
    doc.line_id = payload.line_id
    doc.doc_type = payload.doc_type

    # Forecast handling.
    if payload.forecast_action == "update":
        # Use the document's amount (post-override).
        if doc.amount is None:
            raise HTTPException(400, "Document has no amount — can't update forecast.")
        line.forecast_total_budget = float(doc.amount)
        doc.updates_forecast = True
    elif payload.forecast_action == "custom":
        line.forecast_total_budget = float(payload.custom_amount or 0)
        doc.updates_forecast = True
    else:  # "none"
        doc.updates_forecast = False

    db.commit()
    db.refresh(doc)
    return _doc_to_read(doc)


@router.get("/lines/{line_id}/documents", response_model=list[CapexDocumentRead])
def list_line_documents(line_id: str, db: Session = Depends(get_db)):
    rows = (
        db.execute(
            select(CapexDocument)
            .where(CapexDocument.line_id == line_id)
            .order_by(CapexDocument.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [_doc_to_read(d) for d in rows]


@router.get("/projects/{project_id}/documents", response_model=list[CapexDocumentRead])
def list_project_documents(project_id: str, db: Session = Depends(get_db)):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    rows = (
        db.execute(
            select(CapexDocument)
            .where(CapexDocument.project_id == project_id)
            .order_by(CapexDocument.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [_doc_to_read(d) for d in rows]


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, db: Session = Depends(get_db)):
    doc = db.get(CapexDocument, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    db.delete(doc)
    db.commit()
    return {"ok": True}


# ─── Invoice payment status + Excel exports ───────────────────────────────

CAPEX_TEMPLATES_DIR = DATA_DIR / "capex-templates"
INVOICE_TRACKING_TEMPLATE = CAPEX_TEMPLATES_DIR / "invoice-tracking.xlsx"
FUNDING_REQUEST_TEMPLATE = CAPEX_TEMPLATES_DIR / "funding-request.xlsx"

MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


@router.post("/invoices/{invoice_id}/mark-paid", response_model=CapexInvoiceRead)
def mark_invoice_paid(invoice_id: str, payload: InvoiceMarkPaidRequest, db: Session = Depends(get_db)):
    invoice = db.get(CapexInvoice, invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    invoice.date_paid = (payload.date_paid or "").strip() or None
    if payload.payment_notes is not None:
        invoice.payment_notes = payload.payment_notes or None
    db.commit()
    db.refresh(invoice)
    return invoice


def _filter_invoices_for_month(
    project_id: str,
    hotel_id: Optional[str],
    year: int,
    month: int,
    db: Session,
) -> tuple[list[CapexInvoice], CapexHotel | None]:
    """Return invoices on this project (and optionally scoped to a hotel) whose
    date_received falls in the target month. We use the invoice_date field as
    the "date received" proxy — it's what Claude extracted and what the user
    sees as the invoice's primary date."""
    rows = (
        db.execute(
            select(CapexInvoice)
            .where(CapexInvoice.project_id == project_id)
            .order_by(CapexInvoice.invoice_date.asc(), CapexInvoice.created_at.asc())
        )
        .scalars()
        .all()
    )
    target_prefix = f"{year:04d}-{month:02d}"
    filtered: list[CapexInvoice] = []
    line_ids_for_hotel: set[str] = set()
    primary_hotel: Optional[CapexHotel] = None
    if hotel_id:
        primary_hotel = db.get(CapexHotel, hotel_id)
        if primary_hotel:
            line_ids_for_hotel = {l.id for l in primary_hotel.lines}
    for inv in rows:
        if hotel_id and inv.line_id not in line_ids_for_hotel:
            continue
        if not (inv.invoice_date or "").startswith(target_prefix):
            continue
        filtered.append(inv)
    if not primary_hotel:
        project = db.get(CapexProject, project_id)
        if project:
            primary_hotel = _hotel_for_project(project)
    return filtered, primary_hotel


def _substitute_header(value: object, hotel: Optional[CapexHotel], year: int, month: int) -> object:
    """Replace {PROJECT_NAME}, {MONTH}, {YEAR}, {CITY}, {STATE} placeholders in
    a cell's string value. Pass non-strings through untouched."""
    if not isinstance(value, str):
        return value
    project_name = hotel.name if hotel else ""
    city = (hotel.city if hotel else "") or ""
    state = (hotel.state if hotel else "") or ""
    return (
        value.replace("{PROJECT_NAME}", project_name)
        .replace("{MONTH}", MONTH_NAMES[month - 1])
        .replace("{YEAR}", str(year))
        .replace("{CITY}", city)
        .replace("{STATE}", state)
    )


def _line_for_invoice(invoice: CapexInvoice, db: Session) -> Optional[CapexLine]:
    if not invoice.line_id:
        return None
    return db.get(CapexLine, invoice.line_id)


@router.get("/projects/{project_id}/invoices/export-tracking")
def export_invoice_tracking(
    project_id: str,
    year: int,
    month: int,
    hotel_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Fill the Invoice Tracking template with all invoices in the chosen
    month and stream the resulting xlsx back."""
    if not (1 <= month <= 12):
        raise HTTPException(400, "month must be 1..12")
    if not INVOICE_TRACKING_TEMPLATE.exists():
        raise HTTPException(500, "Invoice tracking template missing on server.")

    invoices, hotel = _filter_invoices_for_month(project_id, hotel_id, year, month, db)
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    from openpyxl import load_workbook
    wb = load_workbook(INVOICE_TRACKING_TEMPLATE)
    ws = wb.active

    # Template layout:
    #   row 1, 2 = banner header (with {PROJECT_NAME} / {MONTH} / {YEAR} / etc.)
    #   row 4    = column headers
    #   rows 5-6 = blank data rows (status formula in col G)
    #   row 7    = total row, with {PROJECT_NAME} – TOTAL placeholder + SUM(D5:D6)
    #
    # Strategy: substitute placeholders in banner + total rows, insert extra
    # data rows if needed, write invoice data, then rewrite the SUM range.
    template_data_row = 5
    template_total_row = 7
    existing_data_rows = template_total_row - template_data_row  # 2

    # Substitute placeholders in banner + total rows.
    for row_idx in (1, 2, template_total_row):
        for col_idx in range(1, ws.max_column + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.value = _substitute_header(cell.value, hotel, year, month)

    # Data layout (cols 1-indexed):
    #   B vendor, C invoice#, D amount, E date_received, F date_paid, G status (formula), H notes
    def write_invoice_row(row_idx: int, inv: CapexInvoice) -> None:
        ws.cell(row=row_idx, column=2, value=inv.vendor or "")
        ws.cell(row=row_idx, column=3, value=inv.invoice_number or "")
        ws.cell(row=row_idx, column=4, value=float(inv.total_amount or 0))
        ws.cell(row=row_idx, column=5, value=inv.invoice_date or "")
        ws.cell(row=row_idx, column=6, value=inv.date_paid or "")
        ws.cell(row=row_idx, column=7, value=f'=IF(F{row_idx}="","Unpaid","Paid")')
        ws.cell(row=row_idx, column=8, value=inv.payment_notes or "")

    if len(invoices) > existing_data_rows:
        # Insert rows just BEFORE the total row so the total stays at the bottom.
        ws.insert_rows(template_total_row, amount=len(invoices) - existing_data_rows)

    last_data_row = max(template_data_row + len(invoices) - 1, template_data_row)
    new_total_row = last_data_row + 1
    if len(invoices) < existing_data_rows:
        # Total row didn't shift; preserve template's two-row buffer.
        new_total_row = template_total_row

    for offset, inv in enumerate(invoices):
        write_invoice_row(template_data_row + offset, inv)

    # Rewrite the SUM range on the totals row to span actual data.
    end_for_sum = max(template_data_row, last_data_row)
    ws.cell(row=new_total_row, column=4, value=f"=SUM(D{template_data_row}:D{end_for_sum})")

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)

    safe_project = "".join(c for c in (hotel.name if hotel else project.name) if c.isalnum() or c in " -_") or "project"
    fname = f"{safe_project} {MONTH_NAMES[month-1]} {year} - Invoice Tracking.xlsx"
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/projects/{project_id}/invoices/export-funding-request")
def export_funding_request(
    project_id: str,
    year: int,
    month: int,
    hotel_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Fill the Funding Request template with invoices received in the chosen
    month so the user can submit a draw request to the lender."""
    if not (1 <= month <= 12):
        raise HTTPException(400, "month must be 1..12")
    if not FUNDING_REQUEST_TEMPLATE.exists():
        raise HTTPException(500, "Funding request template missing on server.")

    invoices, hotel = _filter_invoices_for_month(project_id, hotel_id, year, month, db)
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    from openpyxl import load_workbook
    wb = load_workbook(FUNDING_REQUEST_TEMPLATE)
    ws = wb.active

    # Template: rows 1-2 banner, row 4 column headers, rows 5-7 data, row 8 total.
    template_data_row = 5
    template_total_row = 8
    existing_data_rows = template_total_row - template_data_row  # 3

    for row_idx in (1, 2, template_total_row):
        for col_idx in range(1, ws.max_column + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.value = _substitute_header(cell.value, hotel, year, month)

    if len(invoices) > existing_data_rows:
        ws.insert_rows(template_total_row, amount=len(invoices) - existing_data_rows)

    last_data_row = max(template_data_row + len(invoices) - 1, template_data_row)
    new_total_row = last_data_row + 1
    if len(invoices) < existing_data_rows:
        new_total_row = template_total_row

    for offset, inv in enumerate(invoices):
        line = _line_for_invoice(inv, db)
        r = template_data_row + offset
        ws.cell(row=r, column=2, value=(line.code if line else "") or "")
        ws.cell(row=r, column=3, value=inv.vendor or "")
        ws.cell(row=r, column=4, value=inv.invoice_number or "")
        ws.cell(row=r, column=5, value=float(inv.total_amount or 0))
        ws.cell(row=r, column=6, value=inv.invoice_date or "")
        ws.cell(
            row=r,
            column=7,
            value=inv.description or (line.project_name if line else "") or "",
        )
        ws.cell(row=r, column=8, value=inv.payment_notes or "")

    end_for_sum = max(template_data_row, last_data_row)
    ws.cell(row=new_total_row, column=5, value=f"=SUM(E{template_data_row}:E{end_for_sum})")

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)

    safe_project = "".join(c for c in (hotel.name if hotel else project.name) if c.isalnum() or c in " -_") or "project"
    fname = f"{safe_project} {MONTH_NAMES[month-1]} {year} - Funding Request.xlsx"
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/projects/{project_id}/cashflow/import")
async def import_cashflow(
    project_id: str,
    file: UploadFile = File(...),
    hotel_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Read an xlsx in the same shape produced by export_cashflow and merge
    the per-line monthly values into each line's cashflow JSON. Matches by
    line code (column A); rows whose code doesn't resolve are returned in
    `unmatched` so the user knows what was skipped."""
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    if hotel_id:
        hotel = db.get(CapexHotel, hotel_id)
        if not hotel or hotel.project_id != project_id:
            raise HTTPException(404, "Hotel not found")
        scope_hotels = [hotel]
    else:
        scope_hotels = list(project.hotels)

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")

    from datetime import date as _date, datetime as _datetime
    import re as _re

    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(raw), data_only=True)
    except Exception as e:
        raise HTTPException(400, f"Could not open xlsx: {e}")
    ws = wb.active

    # Recognize a wide range of month-header conventions in real-world
    # cashflow workbooks. A cell counts as a month-header if any of these
    # produces a 1..12 month number (and optionally a year):
    #
    #   • Datetime/date cell (Excel date-formatted)        → .month, .year
    #   • Bare "Jan", "January", "JAN." (any case/dot)    → month only
    #   • "Jan-24", "Jan 2024", "January 2024", "1/24"    → month + year
    #   • Numeric 1..12 in a row that already looks       → month only
    #     mostly month-y (rarely needed, but safe)
    months_long = ["january", "february", "march", "april", "may", "june",
                   "july", "august", "september", "october", "november", "december"]
    month_to_num = {m: i + 1 for i, m in enumerate(months_long)}
    for m in months_long:
        month_to_num[m[:3]] = months_long.index(m) + 1
    # Patterns like "Jan-24", "Jan 2024", "Jan/24"
    _month_year_re = _re.compile(
        r"^\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
        r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
        r"[\s\-_/.,]+(\d{2,4})\s*$",
        _re.IGNORECASE,
    )
    # Patterns like "1/24", "01/2024", "2024-01"
    _numeric_my_re = _re.compile(r"^\s*(\d{1,2})[/\-_.](\d{2,4})\s*$|^\s*(\d{4})[/\-_.](\d{1,2})\s*$")
    _MONTH_PREFIXES = {"jan", "feb", "mar", "apr", "may", "jun",
                       "jul", "aug", "sep", "sept", "oct", "nov", "dec"}

    def _parse_month_header(v) -> Optional[tuple[int, Optional[int]]]:
        """Return (month, year_or_None) if `v` looks like a month header."""
        if v is None:
            return None
        if isinstance(v, _datetime) or isinstance(v, _date):
            return v.month, v.year
        s = str(v).strip()
        if not s:
            return None
        low = s.lower().rstrip(".")
        # Bare month name (Jan, January, Sept, etc.)
        if low in month_to_num:
            return month_to_num[low], None
        if low.replace(".", "") in month_to_num:
            return month_to_num[low.replace(".", "")], None
        # Month + year as text
        m = _month_year_re.match(s)
        if m:
            name = m.group(1).lower().rstrip(".")
            num = month_to_num.get(name) or month_to_num.get(name[:3])
            yr_raw = int(m.group(2))
            yr = yr_raw + 2000 if yr_raw < 100 else yr_raw
            if num and 1900 <= yr <= 2200:
                return num, yr
        # Numeric month/year (1/24, 2024-01)
        m2 = _numeric_my_re.match(s)
        if m2:
            if m2.group(1) and m2.group(2):
                a, b = int(m2.group(1)), int(m2.group(2))
                # disambiguate: "01/2024" → mm/yyyy; "2024/01" → yyyy/mm
                if a > 12 and b <= 12:
                    return b, a
                if 1 <= a <= 12:
                    yr = b + 2000 if b < 100 else b
                    if 1900 <= yr <= 2200:
                        return a, yr
            elif m2.group(3) and m2.group(4):
                yr, mn = int(m2.group(3)), int(m2.group(4))
                if 1 <= mn <= 12 and 1900 <= yr <= 2200:
                    return mn, yr
        return None

    # Scan up to 50 rows for a month-like header. Threshold of 3 month-cells
    # avoids false positives but tolerates partial-year sheets (only Q1,
    # only one month, etc.).
    header_row = None
    scan_limit = min(ws.max_row, 50)
    for r in range(1, scan_limit + 1):
        hits = 0
        for c in range(1, ws.max_column + 1):
            if _parse_month_header(ws.cell(row=r, column=c).value) is not None:
                hits += 1
                if hits >= 3:
                    header_row = r
                    break
        if header_row is not None:
            break
    if header_row is None:
        raise HTTPException(
            400,
            "Couldn't find a month header row. Expected month names (Jan, January, "
            "Jan-24, 1/2024, …) or date cells in the first 50 rows.",
        )

    # Map (year, month) -> column. Year may come from the header cell itself
    # (e.g. "Jan-24") or from a banner above (the export's layout).
    def _resolve_year_for_col(col_idx: int) -> Optional[int]:
        for rr in range(header_row, 0, -1):
            v = ws.cell(row=rr, column=col_idx).value
            if isinstance(v, (int, float)) and 1900 <= int(v) <= 2200:
                return int(v)
            if isinstance(v, (_datetime, _date)):
                return v.year
            for mr in ws.merged_cells.ranges:
                if mr.min_row <= rr <= mr.max_row and mr.min_col <= col_idx <= mr.max_col:
                    top = ws.cell(row=mr.min_row, column=mr.min_col).value
                    if isinstance(top, (int, float)) and 1900 <= int(top) <= 2200:
                        return int(top)
                    if isinstance(top, (_datetime, _date)):
                        return top.year
        return None

    col_to_ym: dict[int, tuple[int, int]] = {}
    code_col: Optional[int] = None
    for c in range(1, ws.max_column + 1):
        cell_val = ws.cell(row=header_row, column=c).value
        lbl = str(cell_val or "").strip().lower()
        if lbl in ("code", "line code", "line #", "line", "ref", "id"):
            code_col = c
        parsed = _parse_month_header(cell_val)
        if parsed is not None:
            month, yr = parsed
            if yr is None:
                yr = _resolve_year_for_col(c)
            if yr is not None:
                col_to_ym[c] = (yr, month)

    if not col_to_ym:
        raise HTTPException(
            400,
            "Found month headers but couldn't determine their year. Add a year "
            "in the header (e.g. 'Jan-24') or as a banner row above.",
        )

    # Build lookups across in-scope hotels for matching xlsx rows to lines.
    # Matching strategy (in order): exact code, exact name, exact description,
    # name+description composite, and finally substring-name with description
    # disambiguation. The substring step handles the common case where the
    # original budget upload renamed lines for clarity ("Building Signage" →
    # "Building Signage (Garage)") while the cashflow xlsx still uses the
    # original short name.
    def _norm(s: Optional[str]) -> str:
        return " ".join((s or "").split()).strip().lower()

    code_to_line: dict[str, CapexLine] = {}
    name_to_lines: dict[str, list[CapexLine]] = {}
    desc_to_lines: dict[str, list[CapexLine]] = {}
    all_lines: list[CapexLine] = []
    for h in scope_hotels:
        for line in h.lines:
            all_lines.append(line)
            if line.code:
                code_to_line.setdefault(_norm(line.code), line)
            nm = _norm(line.project_name)
            if nm:
                name_to_lines.setdefault(nm, []).append(line)
            ds = _norm(line.description)
            if ds:
                desc_to_lines.setdefault(ds, []).append(line)

    def _match_row(text_cells: list[str]) -> Optional[CapexLine]:
        """Find the single best line for an xlsx row given its non-month
        text values. Returns None if no confident match exists."""
        cells = [c for c in text_cells if c]
        if not cells:
            return None
        # 1) Exact code in any cell.
        for tc in cells:
            if tc in code_to_line:
                return code_to_line[tc]
        # 2) Exact project_name (unique).
        for tc in cells:
            cands = name_to_lines.get(tc)
            if cands and len(cands) == 1:
                return cands[0]
        # 3) Composite name+description: name matches multiple lines, but
        #    one of those lines' descriptions appears in another cell.
        for tc in cells:
            cands = name_to_lines.get(tc)
            if not cands or len(cands) <= 1:
                continue
            for dc in cells:
                if dc == tc:
                    continue
                for cand in cands:
                    if _norm(cand.description) == dc:
                        return cand
        # 4) Exact description (unique).
        for tc in cells:
            cands = desc_to_lines.get(tc)
            if cands and len(cands) == 1:
                return cands[0]
        # 5) Substring on project_name (row text ⊆ DB name, or DB name ⊆
        #    row text). When multiple lines match, score by how many other
        #    cells overlap that line's description.
        for tc in cells:
            cands = [
                line for line in all_lines
                if (nm := _norm(line.project_name))
                and (tc in nm or nm in tc)
            ]
            if not cands:
                continue
            if len(cands) == 1:
                return cands[0]
            other = [c for c in cells if c != tc]
            # Token helper that strips punctuation so "(2025" tokenizes to
            # "2025" — otherwise parenthesized suffixes never overlap with
            # row text.
            def _toks(s: str) -> set[str]:
                import re as _r
                return {t for t in _r.findall(r"[a-z0-9]+", s) if len(t) > 2}

            scored: list[tuple[int, int, CapexLine]] = []
            for cand in cands:
                cd = _norm(cand.description)
                cn = _norm(cand.project_name)
                ccat = _norm(cand.category)
                cgrp = _norm(cand.group)
                # Tokens from name, description, category, group form the
                # candidate's full searchable text. Token-level overlap lets
                # us disambiguate "TVs" rows by category words like
                # "Carryover" → "TVs - Attic Stock (2025 Carryover)".
                cand_tokens = _toks(" ".join((cn, cd, ccat, cgrp)))
                score = 0
                for oc in other:
                    if not oc:
                        continue
                    if cd and (oc in cd or cd in oc):
                        score += 2
                    if cn and oc in cn:
                        score += 1
                    if ccat and (oc in ccat or ccat in oc):
                        score += 1
                    score += len(_toks(oc) & cand_tokens)
                # Tiebreaker: shorter names are more "default". When two
                # candidates tie (e.g. "TVs - Attic Stock" vs the same with
                # "(2025 Carryover)"), the row with no carryover signal
                # should land on the shorter, base-named line.
                scored.append((score, -len(cn), cand))
            scored.sort(key=lambda x: (-x[0], -x[1]))
            top = scored[0]
            if top[0] > 0 and (
                len(scored) < 2
                or top[0] > scored[1][0]
                or top[1] != scored[1][1]
            ):
                return top[2]
        return None

    # Auto-detect the identifier column if no explicit "Code" header was found.
    # Score each leading column by how many of its values match a known code,
    # name, or description. This lets us correctly pick column B when it
    # holds project names instead of codes.
    if code_col is None:
        candidate_cols = [c for c in range(1, ws.max_column + 1) if c not in col_to_ym]
        candidate_cols.sort()
        best_col = None
        best_hits = 0
        for c in candidate_cols[:6]:
            hits = 0
            for r in range(header_row + 1, min(header_row + 30, ws.max_row + 1)):
                v = ws.cell(row=r, column=c).value
                if v is None:
                    continue
                key = _norm(str(v))
                if key and (key in code_to_line or key in name_to_lines or key in desc_to_lines):
                    hits += 1
            if hits > best_hits:
                best_hits = hits
                best_col = c
        code_col = best_col or 1

    # Pre-compute the list of non-month columns so each row can pull its
    # full set of text cells for multi-strategy matching.
    text_cols = [c for c in range(1, ws.max_column + 1) if c not in col_to_ym]

    matched: list[dict] = []
    unmatched: list[dict] = []
    data_start = header_row + 1
    for r in range(data_start, ws.max_row + 1):
        code_val = ws.cell(row=r, column=code_col).value
        code = str(code_val).strip() if code_val is not None else ""
        if not code:
            continue
        # Skip an obvious "Total" footer row.
        if code.lower() in ("total", "totals", "grand total"):
            continue

        # Collect identifier-like text cells. Skip purely numeric values
        # (cost/forecast columns) — they cause spurious substring matches
        # like '0' silently matching any line whose name contains a digit.
        row_cells: list[str] = []
        for c in text_cols:
            v = ws.cell(row=r, column=c).value
            if v is None or isinstance(v, (int, float)):
                continue
            key = _norm(str(v))
            if not key:
                continue
            # Require length ≥ 3 with at least one letter — filters out "0",
            # "1.5", short numeric stamps, etc., while still allowing short
            # codes like "LL11" or "FF&E".
            if len(key) < 3 or not _re.search(r"[A-Za-z]", key):
                continue
            row_cells.append(key)

        line = _match_row(row_cells)
        if not line:
            unmatched.append({"code": code, "row": r})
            continue

        # Build the new monthly map for the years this row touches; preserve
        # any years that aren't mentioned in the import (so a partial import
        # doesn't blow away other-year data).
        cf: dict[str, dict[str, float]] = dict(line.cashflow or {})
        affected_years: set[int] = set()
        for col, (year, month) in col_to_ym.items():
            v = ws.cell(row=r, column=col).value
            try:
                fv = float(v) if v not in (None, "") else 0.0
            except (TypeError, ValueError):
                fv = 0.0
            affected_years.add(year)
            ymap = dict(cf.get(str(year)) or {})
            if fv:
                ymap[str(month)] = fv
            else:
                ymap.pop(str(month), None)
            cf[str(year)] = ymap

        # Drop years that ended up with no entries to keep the JSON tidy.
        for y in list(cf.keys()):
            if not cf[y]:
                cf.pop(y)

        line.cashflow = cf or None
        matched.append({
            "line_id": line.id,
            "code": code,
            "years": sorted(affected_years),
        })

    db.commit()

    return {
        "matched": matched,
        "unmatched": unmatched,
        "matched_count": len(matched),
        "unmatched_count": len(unmatched),
    }


@router.get("/projects/{project_id}/cashflow/export")
def export_cashflow(
    project_id: str,
    hotel_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Plain xlsx of monthly cashflow by line. Placeholder layout — will be
    swapped to a templated workbook once the user provides the template."""
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    if hotel_id:
        hotel = db.get(CapexHotel, hotel_id)
        if not hotel or hotel.project_id != project_id:
            raise HTTPException(404, "Hotel not found")
        lines = list(hotel.lines)
        scope_name = hotel.name
    else:
        lines = []
        for h in project.hotels:
            lines.extend(h.lines)
        scope_name = project.name

    years = list(range(project.year_start, project.year_end + 1))
    months_short = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Cashflow"

    meta_cols = ["Code", "Group", "Category", "Project", "Vendor", "Forecast"]
    bold = Font(bold=True)
    header_fill = PatternFill("solid", fgColor="EEEEEE")
    centered = Alignment(horizontal="center")

    # Row 2: meta + month headers; row 1: year banner merged across 12 months.
    for i, label in enumerate(meta_cols, start=1):
        c = ws.cell(row=2, column=i, value=label)
        c.font = bold
        c.fill = header_fill

    col = len(meta_cols) + 1
    for y in years:
        start_col = col
        for m_label in months_short:
            mc = ws.cell(row=2, column=col, value=m_label)
            mc.font = bold
            mc.fill = header_fill
            mc.alignment = centered
            col += 1
        yc = ws.cell(row=1, column=start_col, value=y)
        yc.font = bold
        yc.alignment = centered
        ws.merge_cells(start_row=1, start_column=start_col, end_row=1, end_column=start_col + 11)

    total_col = col
    tc = ws.cell(row=2, column=total_col, value="Total")
    tc.font = bold
    tc.fill = header_fill
    tc.alignment = centered

    money_fmt = '"$"#,##0;[Red]("$"#,##0)'

    row = 3
    for line in lines:
        ws.cell(row=row, column=1, value=line.code or "")
        ws.cell(row=row, column=2, value=line.group or "")
        ws.cell(row=row, column=3, value=line.category or "")
        ws.cell(row=row, column=4, value=line.project_name or "")
        ws.cell(row=row, column=5, value=line.vendor or "")
        fc = ws.cell(row=row, column=6, value=float(line.forecast_total_budget or 0))
        fc.number_format = money_fmt

        c = len(meta_cols) + 1
        cf = line.cashflow or {}
        for y in years:
            ymonths = cf.get(str(y)) or {}
            for m in range(1, 13):
                v = float(ymonths.get(str(m)) or 0)
                if v:
                    cell = ws.cell(row=row, column=c, value=v)
                    cell.number_format = money_fmt
                c += 1

        first_month_letter = get_column_letter(len(meta_cols) + 1)
        last_month_letter = get_column_letter(total_col - 1)
        sum_cell = ws.cell(
            row=row,
            column=total_col,
            value=f"=SUM({first_month_letter}{row}:{last_month_letter}{row})",
        )
        sum_cell.number_format = money_fmt
        row += 1

    # Totals row at the bottom — SUM down each numeric column.
    if row > 3:
        total_row = row
        ws.cell(row=total_row, column=1, value="Total").font = bold
        for c_idx in range(6, total_col + 1):
            letter = get_column_letter(c_idx)
            cell = ws.cell(row=total_row, column=c_idx, value=f"=SUM({letter}3:{letter}{row - 1})")
            cell.number_format = money_fmt
            cell.font = bold

    # Reasonable widths so the sheet is readable on open.
    ws.column_dimensions["A"].width = 10
    for letter in ("B", "C", "D", "E"):
        ws.column_dimensions[letter].width = 18
    ws.column_dimensions["F"].width = 14
    for c_idx in range(len(meta_cols) + 1, total_col + 1):
        ws.column_dimensions[get_column_letter(c_idx)].width = 12
    ws.freeze_panes = "G3"

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)

    safe = "".join(ch for ch in scope_name if ch.isalnum() or ch in " -_") or "cashflow"
    fname = f"{safe} - Cashflow.xlsx"
    return StreamingResponse(
        bio,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── Filename suggestion / history ──────────────────────────────────────────
# Powers the post-parse "Save a copy" flow. The frontend calls suggest with
# the parsed metadata (vendor, invoice number, dates, project code, etc.)
# and gets back a filename that follows the user's evolving convention,
# learned from filenames they actually saved before.

from pydantic import BaseModel  # noqa: E402  (kept inline near use)


class FilenameSuggestRequest(BaseModel):
    kind: str  # invoice | contract | budget
    metadata: dict
    extension: Optional[str] = None  # ".pdf", ".xlsx", etc — preserved on output


class FilenameSuggestResponse(BaseModel):
    filename: str
    pattern_examples: int  # how many prior saves informed this suggestion


class FilenameHistoryRecord(BaseModel):
    kind: str
    chosen_filename: str
    metadata: Optional[dict] = None


@router.post("/filename-suggest", response_model=FilenameSuggestResponse)
def filename_suggest(payload: FilenameSuggestRequest, db: Session = Depends(get_db)) -> FilenameSuggestResponse:
    """Ask Claude to follow the user's apparent naming convention based on
    the most recent filenames they Save-As'd for the same kind of document."""

    examples = (
        db.query(CapexFilenamePattern)
        .filter(CapexFilenamePattern.kind == payload.kind)
        .order_by(CapexFilenamePattern.created_at.desc())
        .limit(10)
        .all()
    )
    ext = (payload.extension or "").strip()
    if ext and not ext.startswith("."):
        ext = "." + ext

    if not examples:
        # Cold start: no learned pattern yet. Return a sensible default
        # built from common metadata keys, or fall back to "<kind>".
        fallback = _fallback_filename(payload.kind, payload.metadata)
        return FilenameSuggestResponse(
            filename=fallback + (ext if not fallback.endswith(ext) else ""),
            pattern_examples=0,
        )

    examples_block = "\n".join(
        f"- chosen: {e.chosen_filename}\n  metadata: {json.dumps(e.parsed_metadata or {}, default=str)}"
        for e in examples
    )
    system = (
        "You are an executive assistant suggesting a filename for a freshly-"
        f"parsed {payload.kind}. The user has filed similar documents before "
        "with their own naming convention; infer that convention and apply "
        "it to the new document's metadata.\n\n"
        "Rules:\n"
        "- Match the user's apparent ordering (project code first, property "
        "first, vendor first, etc.) — do NOT impose a different order.\n"
        "- Match their separators ( -, _, en-dash, etc.).\n"
        "- Match their date format (YYYY-MM-DD, MM-DD-YYYY, etc.).\n"
        "- Match their casing (Title Case, lowercase, etc.).\n"
        "- Strip any extension; the caller will re-append it.\n"
        "- Keep it filesystem-safe (no /, \, :, *, ?, \", <, >, |).\n"
        "- Return strict JSON only: {\"filename\": \"...\"}"
    )
    user_text = (
        "Prior chosen filenames + their parse metadata (most recent first):\n"
        f"{examples_block}\n\n"
        "New document metadata:\n"
        f"{json.dumps(payload.metadata, default=str)}\n\n"
        "Return the filename only, no extension."
    )

    try:
        resp = complete_json(
            system=system,
            user_content=[text_block(user_text)],
            max_tokens=400,
        )
    except ClaudeError:
        return FilenameSuggestResponse(
            filename=_fallback_filename(payload.kind, payload.metadata) + ext,
            pattern_examples=len(examples),
        )

    name = str(resp.get("filename") or "").strip()
    name = _sanitize_filename(name) or _fallback_filename(payload.kind, payload.metadata)
    if ext and not name.lower().endswith(ext.lower()):
        name = name + ext
    return FilenameSuggestResponse(filename=name, pattern_examples=len(examples))


@router.post("/filename-history")
def filename_history(payload: FilenameHistoryRecord, db: Session = Depends(get_db)) -> dict:
    """Log the filename the user actually committed to, so the next suggest
    call learns from it."""

    cleaned = _sanitize_filename(payload.chosen_filename)
    if not cleaned:
        raise HTTPException(status_code=400, detail="chosen_filename is empty after sanitization.")
    row = CapexFilenamePattern(
        kind=payload.kind,
        chosen_filename=cleaned,
        parsed_metadata=payload.metadata or None,
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


def _sanitize_filename(name: str) -> str:
    """Strip path-unsafe characters; keep dots, dashes, spaces, parens."""
    if not name:
        return ""
    bad = '/\:*?"<>|'
    return "".join(ch for ch in name if ch not in bad).strip().strip(".")


def _fallback_filename(kind: str, metadata: dict) -> str:
    """Used when there's no learned pattern AND Claude can't run."""
    parts: list[str] = []
    md = metadata or {}
    code = md.get("project_code") or md.get("code")
    if code:
        parts.append(str(code))
    vendor = md.get("vendor") or md.get("sender")
    if vendor:
        parts.append(str(vendor))
    invoice_num = md.get("invoice_number") or md.get("number")
    if invoice_num:
        parts.append(str(invoice_num))
    received = md.get("invoice_date") or md.get("date") or md.get("received_at")
    if received:
        parts.append(str(received)[:10])
    if not parts:
        parts.append(kind)
    return _sanitize_filename(" — ".join(parts))


# ── Cashflow HTML export ───────────────────────────────────────────────────
# Same data shape as the xlsx export but rendered as a self-contained
# HTML page — easier to email, paste into a Google Doc, or share with
# anyone who doesn't have Excel handy. Negative values render red,
# zero cells stay blank, year headers span their 12 month columns.

from html import escape as _h  # noqa: E402  (kept inline near use)


@router.get("/projects/{project_id}/cashflow/export-html")
def export_cashflow_html(
    project_id: str,
    hotel_id: Optional[str] = None,
    download: bool = False,
    db: Session = Depends(get_db),
):
    project = db.get(CapexProject, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    if hotel_id:
        hotel = db.get(CapexHotel, hotel_id)
        if not hotel or hotel.project_id != project_id:
            raise HTTPException(404, "Hotel not found")
        lines = list(hotel.lines)
        scope_name = hotel.name
    else:
        lines = []
        for h in project.hotels:
            lines.extend(h.lines)
        scope_name = project.name

    years = list(range(project.year_start, project.year_end + 1))
    months_short = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    def _money(v: float) -> str:
        if not v:
            return ""
        sign = "-" if v < 0 else ""
        cls = ' class="neg"' if v < 0 else ""
        return f'<span{cls}>{sign}${abs(v):,.0f}</span>'

    head = (
        '<thead>'
        '<tr class="year-banner">'
        '<th colspan="6" class="meta-banner"></th>'
    )
    for y in years:
        head += f'<th colspan="12" class="year">{y}</th>'
    head += '<th class="total-banner"></th></tr>'
    head += (
        '<tr class="col-headers">'
        '<th>Code</th><th>Group</th><th>Category</th><th>Project</th>'
        '<th>Vendor</th><th class="num">Forecast</th>'
    )
    for _ in years:
        for m in months_short:
            head += f'<th class="num month">{m}</th>'
    head += '<th class="num total">Total</th></tr></thead>'

    body_rows: list[str] = []
    col_totals: dict[int, float] = {}
    forecast_total = 0.0
    grand_total = 0.0

    for line in lines:
        cells: list[str] = [
            f'<td>{_h(line.code or "")}</td>',
            f'<td>{_h(line.group or "")}</td>',
            f'<td>{_h(line.category or "")}</td>',
            f'<td>{_h(line.project_name or "")}</td>',
            f'<td>{_h(line.vendor or "")}</td>',
        ]
        forecast = float(line.forecast_total_budget or 0)
        forecast_total += forecast
        cells.append(f'<td class="num">{_money(forecast)}</td>')

        cf = line.cashflow or {}
        row_total = 0.0
        col_idx = 0  # 0..(years*12-1)
        for y in years:
            ymonths = cf.get(str(y)) or {}
            for m in range(1, 13):
                v = float(ymonths.get(str(m)) or 0)
                row_total += v
                col_totals[col_idx] = col_totals.get(col_idx, 0.0) + v
                cells.append(f'<td class="num">{_money(v)}</td>')
                col_idx += 1
        grand_total += row_total
        cells.append(f'<td class="num total">{_money(row_total)}</td>')
        body_rows.append("<tr>" + "".join(cells) + "</tr>")

    # Footer totals row.
    foot_cells = [
        '<td colspan="5" class="totals-label">Total</td>',
        f'<td class="num">{_money(forecast_total)}</td>',
    ]
    for i in range(len(years) * 12):
        foot_cells.append(f'<td class="num">{_money(col_totals.get(i, 0.0))}</td>')
    foot_cells.append(f'<td class="num total">{_money(grand_total)}</td>')

    title = f"{scope_name} — Cashflow"
    # Windows strftime uses %#d / %#I for non-padded; POSIX uses %-d / %-I.
    # Try platform-appropriate first, fall back to ISO if it raises.
    now = datetime.now()
    try:
        fmt = "%B %#d, %Y %#I:%M %p" if sys.platform == "win32" else "%B %-d, %Y %-I:%M %p"
        generated_at = now.strftime(fmt)
    except Exception:
        generated_at = now.isoformat(timespec="minutes")

    html_doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>{_h(title)}</title>
<style>
  :root {{
    --ink: #1a1d24;
    --stone: #6b6f78;
    --sand: #d9d4c8;
    --gold: #b89555;
    --mist: #f5f3ee;
    --red: #b91c1c;
  }}
  html, body {{ margin: 0; padding: 0; background: var(--mist); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif; }}
  .page {{ max-width: 1600px; margin: 0 auto; padding: 24px 28px 60px; }}
  header {{ display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding-bottom: 14px; border-bottom: 1px solid var(--sand); }}
  .eyebrow {{ font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--gold); font-weight: 600; }}
  h1 {{ margin: 4px 0 0; font-size: 22px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }}
  .meta {{ font-size: 12px; color: var(--stone); }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 11.5px; background: #fff; box-shadow: 0 1px 0 rgba(26,29,36,0.04); }}
  th, td {{ padding: 6px 10px; border-bottom: 1px solid var(--sand); text-align: left; vertical-align: top; }}
  th {{ background: var(--mist); font-weight: 600; color: var(--stone); text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; }}
  td.num, th.num {{ text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }}
  th.year {{ text-align: center; background: #fff; color: var(--ink); font-weight: 700; font-size: 11px; letter-spacing: 0.04em; border-bottom: 1px solid var(--sand); }}
  th.month {{ font-size: 9.5px; }}
  th.total, td.total {{ background: var(--mist); font-weight: 600; }}
  tr:hover td {{ background: rgba(184,149,85,0.06); }}
  tfoot td {{ font-weight: 700; background: var(--ink); color: #fff; border-bottom: 0; }}
  tfoot td.totals-label {{ text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }}
  .neg {{ color: var(--red); }}
  @media print {{
    .page {{ max-width: none; padding: 0; }}
    body, html {{ background: #fff; }}
    table {{ font-size: 9.5px; box-shadow: none; }}
    tr:hover td {{ background: transparent; }}
    th {{ background: #f3f3f3 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    tfoot td {{ background: #1a1d24 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  }}
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <div class="eyebrow">Capex Tracker · Cashflow</div>
      <h1>{_h(scope_name)}</h1>
    </div>
    <div class="meta">
      {_h(str(years[0]))}–{_h(str(years[-1]))} · {len(lines)} line{'s' if len(lines) != 1 else ''} · Generated {_h(generated_at)}
    </div>
  </header>
  <table>
    {head}
    <tbody>{''.join(body_rows) if body_rows else '<tr><td colspan="' + str(7 + len(years) * 12) + '" style="text-align:center;color:var(--stone);padding:24px">No lines yet.</td></tr>'}</tbody>
    <tfoot><tr>{''.join(foot_cells)}</tr></tfoot>
  </table>
</div>
</body>
</html>
"""

    safe = "".join(ch for ch in scope_name if ch.isalnum() or ch in " -_") or "cashflow"
    fname = f"{safe} - Cashflow.html"
    headers: dict[str, str] = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{fname}"'
    return StreamingResponse(
        io.BytesIO(html_doc.encode("utf-8")),
        media_type="text/html; charset=utf-8",
        headers=headers,
    )
