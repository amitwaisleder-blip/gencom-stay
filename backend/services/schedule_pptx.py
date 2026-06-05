"""PowerPoint export for the Schedule Generator.

Three-slide deck for owner / executive review:
  1. Title slide — project name, type, start/end dates, duration
  2. Gantt slide — task list left, weekly grid right with colored bars
  3. Milestones slide — milestone summary table + warnings

Uses python-pptx (already installed for fast_budget pptx).
"""
from __future__ import annotations

import io
from datetime import date, timedelta

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN

from services.schedule_engine import Schedule, Task


GENCOM_GREEN = RGBColor(0x2D, 0x5A, 0x27)
GENCOM_GOLD  = RGBColor(0xB8, 0x95, 0x55)
SAND         = RGBColor(0xD9, 0xD4, 0xC8)
MIST         = RGBColor(0xF5, 0xF3, 0xEE)
PHASE_FILL   = RGBColor(0xEF, 0xE7, 0xD2)
BAR_DEP      = RGBColor(0x6F, 0xA8, 0x88)
BAR_IND      = GENCOM_GOLD
INK          = RGBColor(0x1A, 0x1D, 0x24)
STONE        = RGBColor(0x6B, 0x6F, 0x78)
WHITE        = RGBColor(0xFF, 0xFF, 0xFF)
WARN_BG      = RGBColor(0xFF, 0xF7, 0xE0)
WARN_BR      = RGBColor(0xF0, 0xD0, 0x66)


def _fmt(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def write_schedule_pptx(sched: Schedule) -> io.BytesIO:
    prs = Presentation()
    # Widescreen 16:9 — better fit for a Gantt strip than 4:3.
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    blank = prs.slide_layouts[6]  # blank layout — we draw everything ourselves
    _slide_title(prs.slides.add_slide(blank), sched)
    _slide_gantt(prs.slides.add_slide(blank), sched)
    _slide_milestones(prs.slides.add_slide(blank), sched)

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf


# ── slide 1: cover ────────────────────────────────────────────────────────

def _slide_title(slide, sched: Schedule) -> None:
    # Gold band along the bottom matches the rest of the deck
    _rect(slide, Inches(0), Inches(7.0), Inches(13.333), Inches(0.5), GENCOM_GOLD)

    # Project name
    tx = _textbox(slide, Inches(0.7), Inches(2.0), Inches(12), Inches(1.4),
                  sched.project_name, font_size=44, bold=True, color=GENCOM_GREEN)

    # Sub line — type, task count
    sub = (f"{sched.project_type.replace('_', ' ').title()}  ·  "
           f"{sum(1 for t in sched.tasks if t.type != 'phase_header')} tasks  ·  "
           f"generated {date.today().strftime('%m/%d/%Y')}")
    _textbox(slide, Inches(0.7), Inches(3.4), Inches(12), Inches(0.6),
             sub, font_size=18, color=STONE)

    # Key-stat row
    if sched.tasks:
        start = min(t.start for t in sched.tasks)
        end = max(t.end for t in sched.tasks)
        weeks = round((end - start).days / 7, 1)
        stats = [
            ("START", _fmt(start)),
            ("FINAL COMPLETION", _fmt(end)),
            ("DURATION", f"{weeks} weeks"),
            ("PHASES", f"{sum(1 for t in sched.tasks if t.type == 'phase_header')}"),
        ]
        x = Inches(0.7)
        cell_w = Inches(3.0)
        for i, (label, value) in enumerate(stats):
            sx = Inches(0.7 + i * 3.1)
            _rect(slide, sx, Inches(4.5), cell_w, Inches(1.4), MIST, border=SAND)
            _textbox(slide, sx, Inches(4.7), cell_w, Inches(0.4),
                     label, font_size=10, color=STONE, align="center", bold=True)
            _textbox(slide, sx, Inches(5.1), cell_w, Inches(0.7),
                     value, font_size=20, color=GENCOM_GREEN, bold=True, align="center")

    # Footer brand
    _textbox(slide, Inches(0.7), Inches(7.05), Inches(12), Inches(0.4),
             "Gencom Dashboard — Schedule Generator", font_size=10, color=WHITE, bold=True)


# ── slide 2: Gantt ────────────────────────────────────────────────────────

def _slide_gantt(slide, sched: Schedule) -> None:
    # Title bar
    _rect(slide, Inches(0), Inches(0), Inches(13.333), Inches(0.55), GENCOM_GREEN)
    _textbox(slide, Inches(0.4), Inches(0.05), Inches(13), Inches(0.45),
             f"{sched.project_name} — Schedule", font_size=18, bold=True, color=WHITE)

    if not sched.tasks:
        return

    starts = [t.start for t in sched.tasks]
    ends = [t.end for t in sched.tasks]
    weeks = []
    cur = _monday(min(starts))
    last = _monday(max(ends)) + timedelta(days=7)
    while cur <= last:
        weeks.append(cur)
        cur += timedelta(days=7)

    # Layout: info panel left, grid right.
    info_w = Inches(4.0)
    grid_x = Inches(0.4) + info_w
    grid_w = Inches(13.333 - 0.4 - 0.4) - info_w
    cell_w = grid_w / max(1, len(weeks))

    top = Inches(0.7)
    info_x = Inches(0.4)

    # Month banner row
    months = []
    span_s = 0
    prev_month = -1
    for i, m in enumerate(weeks):
        if m.month != prev_month:
            if prev_month != -1:
                months.append((weeks[span_s].strftime("%b %y"), span_s, i - span_s))
            span_s = i
            prev_month = m.month
    months.append((weeks[span_s].strftime("%b %y"), span_s, len(weeks) - span_s))

    banner_h = Inches(0.32)
    for label, col_s, span in months:
        _rect(slide, grid_x + cell_w * col_s, top, cell_w * span, banner_h, GENCOM_GOLD)
        _textbox(slide, grid_x + cell_w * col_s, top, cell_w * span, banner_h,
                 label, font_size=9, color=WHITE, bold=True, align="center")

    # Column header row
    head_top = top + banner_h
    head_h = Inches(0.32)
    _rect(slide, info_x, head_top, info_w, head_h, GENCOM_GREEN)
    _textbox(slide, info_x + Inches(0.1), head_top, info_w - Inches(0.2), head_h,
             "TASK / MILESTONE", font_size=9, color=WHITE, bold=True)
    # Leave the grid head row empty (the month banner already labels it)

    # Body rows — keep the row height tight so we fit. If too many tasks,
    # truncate gracefully and indicate overflow.
    body_top = head_top + head_h
    avail_h = Inches(7.5) - body_top - Inches(0.2)
    max_rows = max(8, int(avail_h / Inches(0.22)))
    tasks = sched.tasks[:max_rows]
    overflow = len(sched.tasks) - len(tasks)
    row_h = avail_h / max(1, len(tasks))
    if row_h > Inches(0.30):
        row_h = Inches(0.30)

    for i, t in enumerate(tasks):
        y = body_top + row_h * i
        is_phase = t.type == "phase_header"
        is_milestone = t.type == "milestone"
        bg = PHASE_FILL if is_phase else (MIST if i % 2 else WHITE)
        _rect(slide, info_x, y, info_w, row_h, bg)
        _rect(slide, grid_x, y, grid_w, row_h, bg)
        # Task label
        indent_in = Inches(0.1 + 0.18 * t.indent)
        label = (t.name[:45]) if len(t.name) > 45 else t.name
        _textbox(slide, info_x + indent_in, y, info_w - indent_in, row_h,
                 label, font_size=9, color=GENCOM_GREEN if is_phase else INK,
                 bold=is_phase)

        # Bar
        s_col = max(0, (_monday(t.start) - weeks[0]).days // 7)
        e_col = max(s_col + 1, (_monday(t.end) - weeks[0]).days // 7 + 1)
        bx = grid_x + cell_w * s_col
        bw = max(cell_w * 0.6, cell_w * (e_col - s_col) - Emu(20000))
        bh = row_h - Inches(0.10)
        by = y + Inches(0.05)
        if is_milestone:
            _diamond(slide, bx, by, Inches(0.15), bh, GENCOM_GOLD)
        else:
            color = GENCOM_GOLD if (is_phase or t.type == "independent") else BAR_DEP
            _rect(slide, bx, by, bw, bh, color, border=None, rounded=True)

    if overflow > 0:
        _textbox(slide, info_x, Inches(7.2), Inches(12), Inches(0.25),
                 f"… +{overflow} more tasks (full list in Excel/PDF export)",
                 font_size=9, color=STONE, italic=True)


# ── slide 3: milestones + warnings ───────────────────────────────────────

def _slide_milestones(slide, sched: Schedule) -> None:
    _rect(slide, Inches(0), Inches(0), Inches(13.333), Inches(0.55), GENCOM_GREEN)
    _textbox(slide, Inches(0.4), Inches(0.05), Inches(13), Inches(0.45),
             "Milestones", font_size=18, bold=True, color=WHITE)

    # Two-column layout: milestones left (always), warnings right (if any)
    has_warn = bool(sched.warnings)
    ms_w = Inches(7.5) if has_warn else Inches(12.5)

    # Milestone table
    head_y = Inches(0.9)
    head_h = Inches(0.35)
    cols = [("Milestone", Inches(3.5)), ("Start", Inches(1.4)),
            ("End", Inches(1.4)), ("Duration", Inches(1.2))]
    table_x = Inches(0.4)
    cx = table_x
    _rect(slide, table_x, head_y, ms_w, head_h, GENCOM_GREEN)
    for label, w in cols:
        _textbox(slide, cx + Inches(0.15), head_y, w, head_h,
                 label, font_size=10, color=WHITE, bold=True)
        cx += w
    row_y = head_y + head_h
    row_h = Inches(0.30)
    for i, m in enumerate(sched.milestones):
        if row_y + row_h > Inches(7.2): break
        bg = MIST if i % 2 else WHITE
        _rect(slide, table_x, row_y, ms_w, row_h, bg)
        cx = table_x
        for label, w in zip([m.name, _fmt(m.start), _fmt(m.end), m.duration], [c[1] for c in cols]):
            _textbox(slide, cx + Inches(0.15), row_y, w, row_h,
                     str(label)[:42], font_size=10, color=INK)
            cx += w
        row_y += row_h

    # Warnings
    if has_warn:
        wx = table_x + ms_w + Inches(0.4)
        ww = Inches(13.333 - 0.4) - wx
        _rect(slide, wx, head_y, ww, Inches(6.0), WARN_BG, border=WARN_BR)
        _textbox(slide, wx + Inches(0.2), head_y + Inches(0.1), ww - Inches(0.4), Inches(0.4),
                 "Notes", font_size=12, bold=True, color=RGBColor(0x8A, 0x6A, 0x00))
        ty = head_y + Inches(0.55)
        for w in sched.warnings:
            _textbox(slide, wx + Inches(0.3), ty, ww - Inches(0.5), Inches(0.6),
                     f"• {w}", font_size=10, color=INK)
            ty += Inches(0.6)


# ── shape helpers ─────────────────────────────────────────────────────────

def _rect(slide, x, y, w, h, fill_color, border=False, rounded=False):
    shape_id = MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE
    s = slide.shapes.add_shape(shape_id, x, y, w, h)
    s.fill.solid()
    s.fill.fore_color.rgb = fill_color
    if border is None:
        s.line.fill.background()
    elif border is False:
        # default thin gray
        s.line.color.rgb = SAND
        s.line.width = Pt(0.5)
    else:
        s.line.color.rgb = border
        s.line.width = Pt(0.75)
    s.shadow.inherit = False
    if rounded:
        # Tighten the corner radius — default is too round for thin bars.
        try:
            s.adjustments[0] = 0.25
        except Exception:
            pass
    return s


def _diamond(slide, x, y, w, h, fill_color):
    s = slide.shapes.add_shape(MSO_SHAPE.DIAMOND, x, y, w, h)
    s.fill.solid()
    s.fill.fore_color.rgb = fill_color
    s.line.fill.background()
    return s


def _textbox(slide, x, y, w, h, text, *, font_size=10, color=INK,
             bold=False, italic=False, align="left"):
    tx = slide.shapes.add_textbox(x, y, w, h)
    tf = tx.text_frame
    tf.margin_left = Pt(2)
    tf.margin_right = Pt(2)
    tf.margin_top = Pt(0)
    tf.margin_bottom = Pt(0)
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}.get(align, PP_ALIGN.LEFT)
    run = p.add_run()
    run.text = text
    run.font.size = Pt(font_size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    run.font.name = "Inter"
    return tx
