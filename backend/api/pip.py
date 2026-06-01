"""PIP Generator — builds a PIP outline from questionnaire answers.

Two paths:
  • POST /api/pip/export-docx        → streams a .docx file back
  • POST /api/pip/import-to-property → creates a Property + scope hints,
                                         returns {property_id}

The user said they'll add a Word template later; for now the .docx is
generated with python-docx using a clean default layout. The structure is
easy to swap for a template-driven render once the template lands.
"""
from __future__ import annotations

import io
import json
from datetime import datetime
from typing import Any, Optional

from docx import Document as DocxDocument
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Property
from services import claude_client
from services.claude_client import ClaudeError, load_prompt, text_block


router = APIRouter(prefix="/api/pip", tags=["pip"])


# ─── Question metadata (kept in sync with frontend pipQuestions.ts) ───────
# Used to render the outline in a meaningful order with human-readable
# section titles. If the frontend tree drifts from this list, unknown keys
# still render with a fallback heading.
QUESTION_META: list[dict] = [
    {"id": "q1",  "title": "Property name and brand flag", "tier": 1},
    {"id": "q2",  "title": "Property address", "tier": 1},
    {"id": "q3",  "title": "Property type", "tier": 1},
    {"id": "q4",  "title": "Year built & last renovation", "tier": 1},
    {"id": "q5",  "title": "Guestroom key count and mix", "tier": 1},
    {"id": "q6",  "title": "Renovation trigger", "tier": 1},
    {"id": "q7",  "title": "Target repositioning outcome", "tier": 1},
    {"id": "q8",  "title": "Budget range", "tier": 1},
    {"id": "q9",  "title": "Operational status during renovation", "tier": 1},
    {"id": "q10", "title": "Level of renovation", "tier": 1},
    {"id": "q11", "title": "Brand PIP letter status", "tier": 2},
    {"id": "q12", "title": "Top 3 owner priorities", "tier": 2},
    {"id": "q13", "title": "Guestroom scope", "tier": 2},
    {"id": "q14", "title": "Guest bathroom scope", "tier": 2},
    {"id": "q15", "title": "In-room MEP upgrades", "tier": 2},
    {"id": "q16", "title": "Guestroom corridors scope", "tier": 2},
    {"id": "q17", "title": "Public areas in scope", "tier": 2},
    {"id": "q18", "title": "F&B outlet scope", "tier": 2},
    {"id": "q19", "title": "Meeting, ballroom, and ADA scope", "tier": 2},
    {"id": "q20", "title": "Amenities and recreation scope", "tier": 2},
    {"id": "q21", "title": "Vertical transportation scope", "tier": 3},
    {"id": "q22", "title": "Back-of-house improvements scope", "tier": 3},
    {"id": "q23", "title": "Building envelope scope", "tier": 3},
    {"id": "q24", "title": "MEP systems scope", "tier": 3},
    {"id": "q25", "title": "Known deferred maintenance and constraints", "tier": 3},
]
TIER_HEADERS = {
    1: "Tier 1 — Core Intake",
    2: "Tier 2 — Scope Definition",
    3: "Tier 3 — Infrastructure, BOH, and Risk",
}


class PipPayload(BaseModel):
    answers: dict[str, Any]


# ─── Formatting helpers ────────────────────────────────────────────────────
# Sub-keys whose content is big enough to deserve its own labeled sub-heading
# and a bulleted list in the export, rather than an inline "Label: a, b, c".
LONG_LIST_SUB_KEYS = {
    "full_scope_items",
    "soft_goods_detail", "case_goods_detail", "lighting_detail", "tech_detail",
    "bath_detail",
    "bath_casegoods_detail", "bath_softgoods_detail", "bath_plumbing_detail",
    "bath_finishes_detail", "bath_lighting_detail", "bath_fixtures_detail",
    "constraints",
}

# Pretty sub-labels — overrides plain snake_case titleization for known keys.
SUB_LABELS = {
    "property_name": "Property name",
    "brand_flag": "Brand flag",
    "year_built": "Year built",
    "year_last_reno": "Year of last renovation",
    "last_reno_scope": "Last renovation scope",
    "total": "Total keys",
    "standard": "Standard rooms",
    "suite": "Suites",
    "presidential": "Presidential / specialty",
    "ada": "ADA-accessible",
    "custom_budget": "Custom budget estimate",
    "max_ooo_keys": "Max out-of-order keys",
    "closure_months": "Target closure (months)",
    "pip_file": "PIP letter file",
    "fb_outlet_count": "Outlets in scope",
    "fb_operator": "Third-party operator / chef",
    "fb_kitchen": "Kitchen scope",
    "meeting_level": "Meeting space — level",
    "meeting_rooms": "Meeting space — areas",
    "ada": "ADA",
    "amenity_levels": "Amenity levels",
    "vt_passenger": "Passenger elevators in scope",
    "vt_service": "Service elevators in scope",
    "vt_escalators": "Escalators in scope",
    "boh_levels": "BOH levels",
    "constraints": "Constraints",
    "pcr_file": "PCR / PCA file",
    "known_dm": "Known deferred maintenance",
    "full_scope_items": "Expanded scope — typical items",
    "soft_goods_detail": "Soft Goods detail",
    "case_goods_detail": "Case Goods detail",
    "lighting_detail": "Lighting detail",
    "tech_detail": "In-Room Technology detail",
    "bath_detail": "Bathroom full-gut detail",
    "bath_level": "Overall level of work",
    "bath_casegoods_detail": "Casegoods detail",
    "bath_softgoods_detail": "Softgoods detail",
    "bath_plumbing_detail": "Plumbing Fixtures detail",
    "bath_finishes_detail": "Finishes detail",
    "bath_lighting_detail": "Bathroom lighting detail",
    "bath_fixtures_detail": "Fixtures detail",
}


def _sub_label(key: str) -> str:
    return SUB_LABELS.get(key, key.replace("_", " ").capitalize())


def _answer_primary_text(answer: Any) -> Optional[str]:
    """Single-line primary value — the headline answer for a question.
    For single-selects returns the picked option; for grouped answers returns
    the main value (property_name, year_built, total, etc.) where it exists."""
    if answer is None or answer == "":
        return None
    if isinstance(answer, (str, int, float)):
        return str(answer)
    if isinstance(answer, list):
        return ", ".join(str(x) for x in answer) if answer else None
    if isinstance(answer, dict):
        # Wrapped primary — used by multi-selects that also carry sub-answers.
        if "primary" in answer:
            prim = answer.get("primary")
            other = answer.get("other")
            if prim == "Other" and other:
                return f"Other — {other}"
            if isinstance(prim, list):
                return ", ".join(str(x) for x in prim) if prim else None
            return str(prim) if prim else None
        # Grouped answers — synthesize a headline from the most recognizable key.
        if "property_name" in answer:
            nm = answer.get("property_name")
            flag = answer.get("brand_flag")
            flag_str = _answer_primary_text(flag) if flag else None
            return " · ".join([s for s in [str(nm) if nm else None, flag_str] if s])
        if "year_built" in answer or "year_last_reno" in answer:
            parts = []
            if answer.get("year_built"):
                parts.append(f"Built {answer['year_built']}")
            if answer.get("year_last_reno"):
                parts.append(f"Last renovated {answer['year_last_reno']}")
            return " · ".join(parts) if parts else None
        if "total" in answer:
            return f"{int(answer['total'])} keys" if isinstance(answer["total"], (int, float)) else None
        return None
    return None


def _answer_sub_rows(answer: Any) -> list[tuple[str, Any]]:
    """Returns labeled sub-entries for grouped answers (below the primary).
    For grouped or dict answers, yields (label, value) pairs for every
    non-empty sub-key EXCEPT the ones already captured in the primary text.
    For single-select with "Other", returns []."""
    if not isinstance(answer, dict):
        return []
    # Skip keys that are already baked into the primary line.
    skip: set[str] = {"primary", "other"}
    if "property_name" in answer:
        skip.update({"property_name", "brand_flag"})
    if "total" in answer:
        skip.add("total")
    if "year_built" in answer:
        skip.update({"year_built", "year_last_reno"})
    rows: list[tuple[str, Any]] = []
    for k, v in answer.items():
        if k in skip:
            continue
        if v is None or v == "":
            continue
        rows.append((_sub_label(k), v))
    return rows


def _answer_lines(answer: Any) -> list[str]:
    """Legacy flattener — retained for the import-to-property deal_notes
    summary. The export path uses the richer primary/sub-row split above."""
    prim = _answer_primary_text(answer)
    out: list[str] = [prim] if prim else []
    for label, v in _answer_sub_rows(answer):
        if isinstance(v, list):
            out.append(f"{label}: {', '.join(str(x) for x in v)}")
        elif isinstance(v, dict):
            vp = _answer_primary_text(v)
            if vp:
                out.append(f"{label}: {vp}")
        else:
            out.append(f"{label}: {v}")
    return out


def _get_property_name(answers: dict) -> Optional[str]:
    q1 = answers.get("q1")
    if isinstance(q1, dict):
        name = q1.get("property_name")
        if name:
            return str(name)
        prim = q1.get("primary")
        return str(prim) if prim else None
    if isinstance(q1, str):
        return q1
    return None


def _get_address(answers: dict) -> Optional[str]:
    q2 = answers.get("q2")
    return str(q2) if q2 else None


def _get_keys(answers: dict) -> Optional[int]:
    q5 = answers.get("q5")
    if isinstance(q5, dict):
        total = q5.get("total")
        if isinstance(total, (int, float)):
            return int(total)
    return None


def _get_year_built(answers: dict) -> Optional[int]:
    q4 = answers.get("q4")
    if isinstance(q4, dict):
        yb = q4.get("year_built")
        if isinstance(yb, (int, float)):
            return int(yb)
    return None


def _get_year_last_reno(answers: dict) -> Optional[int]:
    q4 = answers.get("q4")
    if isinstance(q4, dict):
        yr = q4.get("year_last_reno")
        if isinstance(yr, (int, float)):
            return int(yr)
    return None


def _flag_from_q1(answers: dict) -> Optional[str]:
    q1 = answers.get("q1")
    if isinstance(q1, dict):
        prim = q1.get("primary")
        if prim == "Other":
            return str(q1.get("other") or "") or None
        return str(prim) if prim else None
    return None


# ─── Word export ───────────────────────────────────────────────────────────
# Color palette — muted, professional. Subject to override once the user
# supplies a branded template.
_GOLD = RGBColor(0xB8, 0x8E, 0x3F)
_INK = RGBColor(0x1A, 0x1A, 0x1A)
_STONE = RGBColor(0x6B, 0x6B, 0x6B)
_MIST = "F4F1EA"   # hex string for XML shading (cover band + table header)
_SAND = "E7E0D1"


def _cell_shade(cell, hex_fill: str) -> None:
    """Apply a background fill color to a table cell (python-docx has no
    built-in helper for this — we drop into the raw OXML)."""
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def _style_heading(run, *, size: int, color: RGBColor, bold: bool = True) -> None:
    run.font.name = "Calibri"
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color


def _rule(doc, color: RGBColor = _GOLD) -> None:
    """Thin horizontal rule — useful as a section separator."""
    p = doc.add_paragraph()
    p_pr = p._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "{:02X}{:02X}{:02X}".format(*color))
    pbdr.append(bottom)
    p_pr.append(pbdr)


def _add_kv_row(tbl, i: int, key: str, value: str) -> None:
    row = tbl.rows[i].cells
    row[0].text = ""
    row[1].text = ""
    for c in row:
        c.vertical_alignment = WD_ALIGN_VERTICAL.TOP
    # Key
    p_k = row[0].paragraphs[0]
    r_k = p_k.add_run(key)
    r_k.font.bold = True
    r_k.font.size = Pt(10)
    r_k.font.color.rgb = _STONE
    # Value
    p_v = row[1].paragraphs[0]
    r_v = p_v.add_run(str(value))
    r_v.font.size = Pt(10.5)
    r_v.font.color.rgb = _INK


def _set_style(style, *, name: str = "Calibri", size: int, color: RGBColor, bold: bool = False) -> None:
    style.font.name = name
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.color.rgb = color


def _configure_styles(doc) -> None:
    """Tighten up the stock Normal + Heading styles so defaults look consistent."""
    _set_style(doc.styles["Normal"], size=11, color=_INK)
    # Headings
    try:
        _set_style(doc.styles["Heading 1"], size=18, color=_GOLD, bold=True)
    except KeyError:
        pass
    try:
        _set_style(doc.styles["Heading 2"], size=13, color=_INK, bold=True)
    except KeyError:
        pass
    try:
        _set_style(doc.styles["Heading 3"], size=11, color=_STONE, bold=True)
    except KeyError:
        pass
    try:
        _set_style(doc.styles["List Bullet"], size=10.5, color=_INK)
    except KeyError:
        pass


def _add_bullet(doc, text: str, level: int = 0) -> None:
    p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
    r = p.add_run(text)
    r.font.size = Pt(10.5)


def _add_label_para(doc, label: str) -> None:
    """Small labeled sub-heading inside a question block (e.g. "Expanded
    scope — typical items")."""
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(label.upper())
    r.font.size = Pt(9)
    r.font.bold = True
    r.font.color.rgb = _STONE


def _render_answer_block(doc, q_title: str, q_number: int, tier: int, answer: Any) -> bool:
    """Render one question block. Returns True if anything was written."""
    primary = _answer_primary_text(answer)
    sub_rows = _answer_sub_rows(answer)
    if not primary and not sub_rows:
        return False

    # H2: numbered question title
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(2)
    r_num = p.add_run(f"{q_number:02d}.  ")
    _style_heading(r_num, size=13, color=_GOLD, bold=True)
    r_title = p.add_run(q_title)
    _style_heading(r_title, size=13, color=_INK, bold=True)

    # Primary line (if any)
    if primary:
        p2 = doc.add_paragraph()
        p2.paragraph_format.space_after = Pt(2)
        r = p2.add_run(primary)
        r.font.size = Pt(11)
        r.font.color.rgb = _INK

    # Sub-rows
    for (label, value) in sub_rows:
        # Long lists get their own labeled bulleted block.
        raw_key = _invert_sub_label(label)
        is_long = raw_key in LONG_LIST_SUB_KEYS or (
            isinstance(value, list) and len(value) >= 4
        )
        if isinstance(value, list):
            if is_long:
                _add_label_para(doc, label)
                for item in value:
                    _add_bullet(doc, str(item))
            else:
                p_row = doc.add_paragraph()
                p_row.paragraph_format.space_after = Pt(1)
                r_l = p_row.add_run(f"{label}: ")
                r_l.font.size = Pt(10.5)
                r_l.font.bold = True
                r_l.font.color.rgb = _STONE
                r_v = p_row.add_run(", ".join(str(x) for x in value))
                r_v.font.size = Pt(10.5)
                r_v.font.color.rgb = _INK
        elif isinstance(value, dict):
            # Nested dict — render as inline primary if we can, else skip.
            vp = _answer_primary_text(value)
            if vp:
                p_row = doc.add_paragraph()
                p_row.paragraph_format.space_after = Pt(1)
                r_l = p_row.add_run(f"{label}: ")
                r_l.font.size = Pt(10.5)
                r_l.font.bold = True
                r_l.font.color.rgb = _STONE
                r_v = p_row.add_run(vp)
                r_v.font.size = Pt(10.5)
                r_v.font.color.rgb = _INK
        else:
            p_row = doc.add_paragraph()
            p_row.paragraph_format.space_after = Pt(1)
            r_l = p_row.add_run(f"{label}: ")
            r_l.font.size = Pt(10.5)
            r_l.font.bold = True
            r_l.font.color.rgb = _STONE
            r_v = p_row.add_run(str(value))
            r_v.font.size = Pt(10.5)
            r_v.font.color.rgb = _INK

    _ = tier  # tier currently not used in per-question render (section header handles it)
    return True


def _invert_sub_label(label: str) -> str:
    """Best-effort reverse of SUB_LABELS so render can check LONG_LIST_SUB_KEYS."""
    for k, v in SUB_LABELS.items():
        if v == label:
            return k
    return label.lower().replace(" ", "_")


def _add_section_band(doc, text: str) -> None:
    """A full-width shaded band used for tier / major-section dividers."""
    tbl = doc.add_table(rows=1, cols=1)
    tbl.autofit = True
    _cell_shade(tbl.rows[0].cells[0], _SAND)
    cell = tbl.rows[0].cells[0]
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(text.upper())
    r.font.bold = True
    r.font.size = Pt(11)
    r.font.color.rgb = _INK
    # Pad with a small paragraph underneath.
    sp = doc.add_paragraph()
    sp.paragraph_format.space_after = Pt(0)


@router.post("/export-docx")
def export_docx(payload: PipPayload):
    answers = payload.answers or {}
    doc = DocxDocument()

    # Page margins — a hair tighter than Word's default for a cleaner look.
    for section in doc.sections:
        section.left_margin = Cm(2.0)
        section.right_margin = Cm(2.0)
        section.top_margin = Cm(1.8)
        section.bottom_margin = Cm(1.8)

    _configure_styles(doc)

    prop_name = _get_property_name(answers) or "Untitled Property"
    flag = _flag_from_q1(answers)
    address = _get_address(answers)

    # ── COVER BLOCK ─────────────────────────────────────────────────────
    # Small gold eyebrow
    p_eyebrow = doc.add_paragraph()
    p_eyebrow.paragraph_format.space_after = Pt(0)
    r_eye = p_eyebrow.add_run("PROPERTY IMPROVEMENT PLAN")
    r_eye.font.size = Pt(9)
    r_eye.font.bold = True
    r_eye.font.color.rgb = _GOLD

    # Big title — property name
    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_after = Pt(2)
    r_title = p_title.add_run(prop_name)
    r_title.font.name = "Calibri"
    r_title.font.size = Pt(28)
    r_title.font.bold = True
    r_title.font.color.rgb = _INK

    # Subtitle line — flag / address / keys
    subtitle_parts = []
    if flag:
        subtitle_parts.append(flag)
    if address:
        subtitle_parts.append(address)
    keys = _get_keys(answers)
    if keys:
        subtitle_parts.append(f"{keys} keys")
    if subtitle_parts:
        p_sub = doc.add_paragraph()
        p_sub.paragraph_format.space_after = Pt(6)
        r_sub = p_sub.add_run("  ·  ".join(subtitle_parts))
        r_sub.font.size = Pt(12)
        r_sub.font.color.rgb = _STONE

    _rule(doc)

    meta = doc.add_paragraph()
    meta.paragraph_format.space_before = Pt(0)
    r_meta = meta.add_run(f"Outline generated {datetime.utcnow().strftime('%B %d, %Y')}")
    r_meta.italic = True
    r_meta.font.size = Pt(9)
    r_meta.font.color.rgb = _STONE

    # ── QUICK FACTS TABLE ──────────────────────────────────────────────
    facts = [
        ("Property type", _render_primary(answers.get("q3"))),
        ("Year built", _get_year_built(answers)),
        ("Year of last renovation", _get_year_last_reno(answers)),
        ("Renovation trigger", _render_primary(answers.get("q6"))),
        ("Target repositioning", _render_primary(answers.get("q7"))),
        ("Budget range", _render_primary(answers.get("q8"))),
        ("Operational status", _render_primary(answers.get("q9"))),
        ("Level of renovation", _render_primary(answers.get("q10"))),
    ]
    facts = [(k, v) for k, v in facts if v not in (None, "")]
    if facts:
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(12)
        h.paragraph_format.space_after = Pt(4)
        r = h.add_run("AT A GLANCE")
        r.font.size = Pt(10)
        r.font.bold = True
        r.font.color.rgb = _GOLD

        tbl = doc.add_table(rows=len(facts), cols=2)
        tbl.autofit = False
        # Set column widths for predictable layout
        for row in tbl.rows:
            row.cells[0].width = Cm(5.0)
            row.cells[1].width = Cm(11.5)
        for i, (k, v) in enumerate(facts):
            _add_kv_row(tbl, i, k, v)
            # Subtle shading on every other row
            if i % 2 == 0:
                for c in tbl.rows[i].cells:
                    _cell_shade(c, _MIST)

    # ── BODY ───────────────────────────────────────────────────────────
    current_tier: Optional[int] = None
    q_counter = 0
    for q in QUESTION_META:
        ans = answers.get(q["id"])
        primary = _answer_primary_text(ans)
        sub_rows = _answer_sub_rows(ans)
        if not primary and not sub_rows:
            continue
        q_counter += 1
        if q["tier"] != current_tier:
            current_tier = q["tier"]
            _add_section_band(doc, TIER_HEADERS[current_tier])
        _render_answer_block(doc, q["title"], q_counter, q["tier"], ans)

    # ── FOOTER ─────────────────────────────────────────────────────────
    _rule(doc, color=_SAND_RGB())
    footer = doc.add_paragraph()
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = footer.add_run(
        "Generated by the Gencom PIP Generator. A branded Word template can replace this layout "
        "without changing the underlying content."
    )
    r.italic = True
    r.font.size = Pt(8.5)
    r.font.color.rgb = _STONE

    # Stream back
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)
    safe = "".join(c for c in prop_name if c.isalnum() or c in " -_")[:80] or "PIP"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{safe} - PIP Outline.docx"'},
    )


def _SAND_RGB() -> RGBColor:
    return RGBColor(0xE7, 0xE0, 0xD1)


def _render_primary(v: Any) -> Optional[str]:
    if v is None or v == "":
        return None
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        prim = v.get("primary")
        if prim == "Other":
            return str(v.get("other") or "") or "Other"
        return str(prim) if prim else None
    return str(v)


# ─── Import to Budget Generator ────────────────────────────────────────────
class PipImportResponse(BaseModel):
    property_id: str


@router.post("/import-to-property", response_model=PipImportResponse)
def import_to_property(payload: PipPayload, db: Session = Depends(get_db)):
    """Create a new Property pre-populated from the PIP answers, then let
    the caller navigate straight into that property's Setup page."""
    from api.properties import create_property as _create_property  # avoid circular import
    from schemas.property import PropertyCreate

    answers = payload.answers or {}

    # Parse address into components heuristically — Setup page lets the user
    # correct them.
    raw_addr = _get_address(answers) or ""
    parts = [p.strip() for p in raw_addr.split(",") if p.strip()]
    street = parts[0] if parts else None
    city = parts[1] if len(parts) >= 2 else None
    state = parts[2].split()[0] if len(parts) >= 3 else None

    # Room mix → Property.guestroom_mix shape (we use the common keys here,
    # user can refine on Setup).
    mix_source = answers.get("q5") or {}
    mix = {}
    if isinstance(mix_source, dict):
        std = mix_source.get("standard")
        suite = mix_source.get("suite")
        if isinstance(std, (int, float)):
            mix["king"] = int(std)
        if isinstance(suite, (int, float)):
            mix["junior_suite"] = int(suite)

    # Build the property payload.
    prop_payload = PropertyCreate(
        name=_get_property_name(answers) or "Untitled (from PIP Generator)",
        address=street,
        city=city,
        state=state,
        target_brand=_flag_from_q1(answers),
        property_type=_render_primary(answers.get("q3")),
        year_built=_get_year_built(answers),
        year_last_renovated=_get_year_last_reno(answers),
        keys=_get_keys(answers),
        guestroom_mix=mix or None,
    )
    prop = _create_property(prop_payload, db=db)

    # Attach the PIP answers to the deal_notes as a short summary so context
    # isn't lost when the user moves to the budget generator.
    summary_lines: list[str] = ["Generated from PIP Generator."]
    for q in QUESTION_META:
        lines = _answer_lines(answers.get(q["id"]))
        if not lines:
            continue
        summary_lines.append(f"- {q['title']}: {'; '.join(lines)}")
    db_prop = db.get(Property, prop.id)
    if db_prop is not None:
        existing = db_prop.deal_notes or ""
        db_prop.deal_notes = ("\n\n".join([existing.strip(), "\n".join(summary_lines)])
                              if existing else "\n".join(summary_lines))
        db.commit()

    return PipImportResponse(property_id=prop.id)


# ─── AI helpers ────────────────────────────────────────────────────────────
class PropertyLookupRequest(BaseModel):
    name: str


@router.post("/ai-lookup-property")
def ai_lookup_property(body: PropertyLookupRequest):
    """Given a property name, ask Claude to return what it knows — flag,
    address, property type, age, key count, room mix. Frontend uses the
    result to pre-populate Q1–Q5 of the PIP questionnaire.

    Note: Claude's knowledge has a cutoff and may not have the latest info.
    The response includes a confidence field; the frontend should surface
    that so users can verify anything that matters."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Property name is required.")
    prompt = load_prompt("pip_property_lookup")
    try:
        out = claude_client.complete_json(
            system=prompt,
            user_content=[text_block(name)],
            max_tokens=2000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))
    return out


class ScopeRecommendRequest(BaseModel):
    answers: dict[str, Any]


@router.post("/ai-recommend-scope")
def ai_recommend_scope(body: ScopeRecommendRequest):
    """Given the current PIP answers, ask Claude for additional scope items
    the user may have overlooked. Returns a list of {category, item, reason,
    priority} suggestions the UI can render as checkboxes."""
    answers = body.answers or {}
    prompt = load_prompt(
        "pip_scope_recommend",
        substitutions={"answers_json": json.dumps(answers, indent=2, default=str)},
    )
    try:
        out = claude_client.complete_json(
            system=prompt,
            user_content=[text_block("Please produce the recommendations JSON.")],
            max_tokens=3000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))
    return out
