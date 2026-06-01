"""PDF export for the Schedule Generator.

Builds a landscape-letter PDF with the same structural pieces as the Excel /
HTML exports: project banner, Gantt grid (task list + month/week headers +
colored bars), milestone summary, and warnings.

Uses fpdf2 because it's pure Python (no system dependencies) and handles
landscape + multi-page tables cleanly.
"""
from __future__ import annotations

import io
from datetime import date, timedelta

from fpdf import FPDF

from services.schedule_engine import Schedule, Task


# ── color palette (matches Excel/HTML exports) ───────────────────────────
GENCOM_GREEN = (45, 90, 39)
GENCOM_GOLD = (184, 149, 85)
SAND = (217, 212, 200)
MIST = (245, 243, 238)
PHASE_FILL = (239, 231, 210)
BAR_DEPENDENT = (111, 168, 138)
BAR_INDEPENDENT = (184, 149, 85)
INK = (26, 29, 36)
STONE = (107, 111, 120)


# Layout constants — landscape letter (792 x 612 pt) at fpdf's default mm.
# fpdf2 defaults to mm; we use mm throughout for predictable spacing.
PAGE_W = 279.4   # 11" landscape
PAGE_H = 215.9
MARGIN = 12

# Fixed-info column widths (mm)
COL_TASK = 75
COL_TYPE = 18
COL_START = 22
COL_END = 22
COL_WKS = 12
INFO_W = COL_TASK + COL_TYPE + COL_START + COL_END + COL_WKS  # 149


def _fmt(d: date) -> str:
    return d.strftime("%m/%d/%Y")


# Helvetica in fpdf2 is latin-1 only — sanitize Unicode punctuation that creeps
# in from auto-formatting (em-dash, smart quotes) to ASCII equivalents so we
# don't have to ship a TTF Unicode font with the deployment.
_TRANS = str.maketrans({
    "—": "-",  # em-dash
    "–": "-",  # en-dash
    "‘": "'",  # left single quote
    "’": "'",  # right single quote
    "“": '"',  # left double quote
    "”": '"',  # right double quote
    "…": "...", # ellipsis
    " ": " ",  # non-breaking space
    "→": "->", # right arrow (used in some warning strings)
    "·": "*",  # middle dot
})


def _safe(s: str) -> str:
    if s is None:
        return ""
    return str(s).translate(_TRANS)


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def write_schedule_pdf(sched: Schedule) -> io.BytesIO:
    pdf = FPDF(orientation="L", unit="mm", format="Letter")
    pdf.set_auto_page_break(auto=False)
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.add_page()

    _header(pdf, sched)
    _gantt(pdf, sched)
    _milestones(pdf, sched)
    _warnings(pdf, sched)
    _footer(pdf)

    buf = io.BytesIO()
    # fpdf2 returns bytearray from .output(); coerce to bytes for BytesIO.
    buf.write(bytes(pdf.output()))
    buf.seek(0)
    return buf


def _header(pdf: FPDF, sched: Schedule) -> None:
    pdf.set_xy(MARGIN, MARGIN)
    pdf.set_text_color(*GENCOM_GREEN)
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 8, _safe(sched.project_name), ln=True)
    pdf.set_text_color(*STONE)
    pdf.set_font("Helvetica", "", 9)
    sub = (f"{sched.project_type.replace('_', ' ').title()} - "
           f"{sum(1 for t in sched.tasks if t.type != 'phase_header')} tasks - "
           f"generated {date.today().strftime('%m/%d/%Y')}")
    pdf.cell(0, 5, _safe(sub), ln=True)
    pdf.ln(2)


def _gantt(pdf: FPDF, sched: Schedule) -> None:
    if not sched.tasks:
        return

    grid_w_avail = PAGE_W - 2 * MARGIN - INFO_W
    starts = [t.start for t in sched.tasks]
    ends = [t.end for t in sched.tasks]
    span_start = _monday(min(starts))
    span_end = _monday(max(ends)) + timedelta(days=7)
    weeks = []
    cur = span_start
    while cur <= span_end:
        weeks.append(cur)
        cur += timedelta(days=7)
    if not weeks:
        return
    cell_w = max(2.0, min(6.0, grid_w_avail / len(weeks)))
    grid_w = cell_w * len(weeks)

    # ── month banner row ─────────────────────────────────────────────────
    y = pdf.get_y()
    pdf.set_fill_color(*GENCOM_GOLD)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 7)

    months = []
    span_s = 0
    prev_month = -1
    for i, m in enumerate(weeks):
        if m.month != prev_month:
            if prev_month != -1:
                months.append((weeks[span_s].strftime("%b %Y"), span_s, i - span_s))
            span_s = i
            prev_month = m.month
    months.append((weeks[span_s].strftime("%b %Y"), span_s, len(weeks) - span_s))

    # Info-area placeholder fill
    pdf.set_xy(MARGIN, y)
    pdf.set_fill_color(*GENCOM_GREEN)
    pdf.cell(INFO_W, 5, "", border=0, fill=True)
    # Month banner
    x = MARGIN + INFO_W
    pdf.set_fill_color(*GENCOM_GOLD)
    for label, col_s, span in months:
        w = span * cell_w
        pdf.set_xy(x + col_s * cell_w, y)
        pdf.cell(w, 5, _safe(label[:int(w * 0.7)]), border=0, align="C", fill=True)

    # ── column headers ───────────────────────────────────────────────────
    y2 = y + 5
    pdf.set_xy(MARGIN, y2)
    pdf.set_fill_color(*GENCOM_GREEN)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(COL_TASK, 6, "TASK / MILESTONE", border=0, align="L", fill=True)
    pdf.cell(COL_TYPE, 6, "TYPE", border=0, align="C", fill=True)
    pdf.cell(COL_START, 6, "START", border=0, align="C", fill=True)
    pdf.cell(COL_END, 6, "END", border=0, align="C", fill=True)
    pdf.cell(COL_WKS, 6, "WKS", border=0, align="C", fill=True)
    # Week-number row in the grid area
    pdf.set_fill_color(*MIST)
    pdf.set_text_color(*GENCOM_GREEN)
    pdf.set_font("Helvetica", "", 6)
    for i, m in enumerate(weeks):
        pdf.set_xy(MARGIN + INFO_W + i * cell_w, y2)
        pdf.cell(cell_w, 6, str(m.day), border=0, align="C", fill=True)

    # ── body rows ────────────────────────────────────────────────────────
    row_h = 5
    cur_y = y2 + row_h + 1
    for t in sched.tasks:
        if cur_y + row_h > PAGE_H - MARGIN - 6:
            _footer(pdf)
            pdf.add_page()
            cur_y = MARGIN
        _row(pdf, t, cur_y, weeks, cell_w)
        cur_y += row_h
    pdf.set_y(cur_y + 4)


def _row(pdf: FPDF, t: Task, y: float, weeks: list[date], cell_w: float) -> None:
    is_phase = t.type == "phase_header"
    is_milestone = t.type == "milestone"

    # Info cells
    if is_phase:
        pdf.set_fill_color(*PHASE_FILL)
        pdf.set_text_color(*GENCOM_GREEN)
        pdf.set_font("Helvetica", "B", 7.5)
    else:
        pdf.set_fill_color(255, 255, 255)
        pdf.set_text_color(*INK)
        pdf.set_font("Helvetica", "", 7.5)

    indent = "  " * t.indent
    pdf.set_xy(MARGIN, y)
    pdf.cell(COL_TASK, 5, _safe(indent + (t.name[:50] if len(t.name) > 50 else t.name)), border="B", fill=is_phase)

    pdf.set_font("Helvetica", "I", 7)
    type_label = "" if is_phase else ("Milestone" if is_milestone else t.type.capitalize())
    pdf.cell(COL_TYPE, 5, _safe(type_label), border="B", align="C", fill=is_phase)

    pdf.set_font("Helvetica", "", 7)
    pdf.cell(COL_START, 5, _fmt(t.start), border="B", align="C", fill=is_phase)
    pdf.cell(COL_END, 5, _fmt(t.end), border="B", align="C", fill=is_phase)
    pdf.cell(COL_WKS, 5, "-" if is_milestone else f"{t.weeks}", border="B", align="C", fill=is_phase)

    # ── Gantt bar ────────────────────────────────────────────────────────
    if not weeks:
        return
    monday0 = weeks[0]
    s_col = max(0, (_monday(t.start) - monday0).days // 7)
    e_col = max(s_col + 1, (_monday(t.end) - monday0).days // 7 + 1)
    bar_x = MARGIN + INFO_W + s_col * cell_w
    bar_w = max(cell_w * 0.8, (e_col - s_col) * cell_w - 0.5)

    if is_milestone:
        # Diamond: rotated square ~ approximated by a small filled rect
        pdf.set_fill_color(*GENCOM_GOLD)
        pdf.rect(bar_x - 1.5, y + 1.0, 3, 3, "F")
    elif is_phase:
        pdf.set_fill_color(*GENCOM_GOLD)
        pdf.rect(bar_x, y + 0.8, bar_w, 3.4, "F")
    elif t.type == "independent":
        pdf.set_fill_color(*BAR_INDEPENDENT)
        pdf.rect(bar_x, y + 0.8, bar_w, 3.4, "F")
    else:
        pdf.set_fill_color(*BAR_DEPENDENT)
        pdf.rect(bar_x, y + 0.8, bar_w, 3.4, "F")


def _milestones(pdf: FPDF, sched: Schedule) -> None:
    if not sched.milestones:
        return
    if pdf.get_y() + 30 > PAGE_H - MARGIN:
        _footer(pdf)
        pdf.add_page()

    pdf.set_text_color(*GENCOM_GREEN)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, "Milestones", ln=True)
    pdf.set_fill_color(*GENCOM_GREEN)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(80, 6, "Milestone", border=0, fill=True)
    pdf.cell(28, 6, "Start", border=0, align="C", fill=True)
    pdf.cell(28, 6, "End", border=0, align="C", fill=True)
    pdf.cell(28, 6, "Duration", border=0, align="C", fill=True)
    pdf.ln()
    pdf.set_text_color(*INK)
    pdf.set_font("Helvetica", "", 8)
    for m in sched.milestones:
        if pdf.get_y() + 5 > PAGE_H - MARGIN - 6:
            _footer(pdf)
            pdf.add_page()
        pdf.cell(80, 5, _safe(m.name[:55]), border="B")
        pdf.cell(28, 5, _fmt(m.start), border="B", align="C")
        pdf.cell(28, 5, _fmt(m.end), border="B", align="C")
        pdf.cell(28, 5, _safe(m.duration), border="B", align="C")
        pdf.ln()


def _warnings(pdf: FPDF, sched: Schedule) -> None:
    if not sched.warnings:
        return
    pdf.ln(3)
    if pdf.get_y() + 20 > PAGE_H - MARGIN:
        _footer(pdf)
        pdf.add_page()
    pdf.set_text_color(138, 106, 0)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "Notes", ln=True)
    pdf.set_text_color(*INK)
    pdf.set_font("Helvetica", "", 8)
    for w in sched.warnings:
        pdf.multi_cell(0, 4.5, _safe(f"* {w}"))


def _footer(pdf: FPDF) -> None:
    pdf.set_y(PAGE_H - MARGIN + 2)
    pdf.set_text_color(*STONE)
    pdf.set_font("Helvetica", "I", 7)
    pdf.cell(0, 4, _safe(f"Generated by Gencom Dashboard - Schedule Generator - page {pdf.page_no()}"), align="C")
