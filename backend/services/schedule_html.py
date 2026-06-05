"""HTML export for the Schedule Generator.

Builds a standalone, single-file HTML document with inline CSS — no external
assets — so it can be sent over email, dropped in Box, or hosted anywhere.
The layout mirrors the Excel Gantt: task list on the left, weekly grid with
month/week headers on the right, color-coded bars per task.
"""
from __future__ import annotations

from datetime import date, timedelta
from html import escape

from services.schedule_engine import Schedule, Task


_CELL_PX = 22       # weekly column width
_ROW_PX = 30        # body row height
_INFO_PX = 540      # left info panel width (task / type / start / end / wks)


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _fmt(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def _grid(start: date, end: date) -> list[date]:
    cur = _monday(start)
    last = _monday(end) + timedelta(days=7)
    out = []
    while cur <= last:
        out.append(cur)
        cur += timedelta(days=7)
    return out


def write_schedule_html(sched: Schedule) -> str:
    if not sched.tasks:
        return _empty_doc(sched.project_name)

    grid = _grid(min(t.start for t in sched.tasks), max(t.end for t in sched.tasks))
    grid_px = len(grid) * _CELL_PX

    # Group columns by month for the top banner.
    months: list[tuple[str, int, int]] = []  # (label, start_col, span)
    span_start = 0
    prev_month = None
    for i, m in enumerate(grid):
        if m.month != prev_month:
            if prev_month is not None:
                months.append((grid[span_start].strftime("%b %Y"), span_start, i - span_start))
            span_start = i
            prev_month = m.month
    months.append((grid[span_start].strftime("%b %Y"), span_start, len(grid) - span_start))

    # Build month banner row.
    month_cells = []
    for (label, col_start, span) in months:
        month_cells.append(
            f'<div class="month" style="left:{col_start * _CELL_PX}px; width:{span * _CELL_PX}px;">{escape(label)}</div>'
        )
    week_cells = "".join(
        f'<div class="week" style="left:{i * _CELL_PX}px; width:{_CELL_PX}px;">{m.day}</div>'
        for i, m in enumerate(grid)
    )

    # Body rows.
    body = []
    for i, t in enumerate(sched.tasks):
        body.append(_row_html(t, grid, i))

    # Milestone summary table.
    ms_rows = "".join(
        f'<tr><td>{escape(m.name)}</td><td>{_fmt(m.start)}</td>'
        f'<td>{_fmt(m.end)}</td><td>{escape(m.duration)}</td></tr>'
        for m in sched.milestones
    )

    warnings_html = ""
    if sched.warnings:
        items = "".join(f"<li>{escape(w)}</li>" for w in sched.warnings)
        warnings_html = f'<div class="warnings"><h3>Notes</h3><ul>{items}</ul></div>'

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{escape(sched.project_name)} — Schedule</title>
<style>
  :root {{
    --green: #2D5A27;
    --gold: #B89555;
    --sand: #d9d4c8;
    --mist: #f5f3ee;
    --ink: #1a1d24;
    --stone: #6b6f78;
  }}
  body {{ font-family: -apple-system, system-ui, "Segoe UI", Inter, sans-serif; color: var(--ink); margin: 0; padding: 24px; background: #fff; }}
  h1 {{ color: var(--green); margin: 0 0 4px 0; font-size: 24px; }}
  .subtitle {{ color: var(--stone); font-size: 13px; margin-bottom: 18px; }}
  .gantt {{ position: relative; border: 1px solid var(--sand); border-radius: 6px; overflow: auto; max-width: 100%; }}
  .gantt-inner {{ position: relative; width: {_INFO_PX + grid_px}px; }}
  .header-row {{ position: sticky; top: 0; background: #fff; z-index: 2; }}
  .month-row {{ height: 24px; position: relative; border-bottom: 1px solid var(--sand); background: var(--gold); color: #fff; }}
  .month {{ position: absolute; top: 0; height: 24px; line-height: 24px; text-align: center; font-size: 11px; font-weight: 700; border-right: 1px solid rgba(255,255,255,0.4); }}
  .week-row {{ height: 18px; position: relative; border-bottom: 1px solid var(--sand); background: var(--mist); }}
  .week {{ position: absolute; top: 0; height: 18px; line-height: 18px; text-align: center; font-size: 9px; color: var(--green); border-right: 1px solid var(--sand); }}
  .col-head-row {{ height: 28px; line-height: 28px; background: var(--green); color: #fff; font-size: 11px; font-weight: 700; display: flex; }}
  .col-head-row .info {{ width: {_INFO_PX}px; display: flex; padding-left: 12px; }}
  .col-head-row .info span {{ flex: 1; }}
  .col-head-row .info .task {{ flex: 3; }}
  .row {{ height: {_ROW_PX}px; position: relative; border-bottom: 1px solid var(--sand); }}
  .row.phase {{ background: rgba(184,149,85,0.18); font-weight: 700; color: var(--green); }}
  .row.dependent .bar {{ background: #6FA88A; }}
  .row.independent .bar {{ background: var(--gold); }}
  .row.milestone .bar {{ background: var(--gold); border-radius: 50%; width: 14px !important; height: 14px; top: 8px; }}
  .row.phase .bar {{ background: var(--gold); }}
  .info-cell {{ position: absolute; left: 0; top: 0; height: {_ROW_PX}px; width: {_INFO_PX}px; display: flex; align-items: center; padding-left: 12px; font-size: 12px; box-sizing: border-box; }}
  .info-cell .task {{ flex: 3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 8px; }}
  .info-cell .meta {{ flex: 1; font-size: 11px; color: var(--stone); text-align: center; }}
  .grid-cell {{ position: absolute; top: 0; height: {_ROW_PX}px; }}
  .bar {{ position: absolute; top: 8px; height: 14px; border-radius: 3px; }}
  .milestones {{ margin-top: 24px; }}
  .milestones h3 {{ color: var(--green); font-size: 16px; margin-bottom: 8px; }}
  .milestones table {{ border-collapse: collapse; width: 100%; max-width: 720px; font-size: 12px; }}
  .milestones th {{ background: var(--green); color: #fff; padding: 6px 10px; text-align: left; }}
  .milestones td {{ border: 1px solid var(--sand); padding: 6px 10px; }}
  .warnings {{ margin-top: 18px; padding: 10px 14px; background: #fff7e0; border: 1px solid #f0d066; border-radius: 6px; font-size: 12px; }}
  .warnings h3 {{ margin: 0 0 4px; font-size: 13px; color: #8a6a00; }}
  .warnings ul {{ margin: 0; padding-left: 20px; }}
  .footer {{ margin-top: 24px; font-size: 11px; color: var(--stone); }}
</style>
</head>
<body>
  <h1>{escape(sched.project_name)}</h1>
  <div class="subtitle">{escape(sched.project_type.replace("_", " ").title())} · {len(sched.tasks)} tasks · generated {date.today().isoformat()}</div>

  <div class="gantt">
    <div class="gantt-inner">
      <div class="header-row">
        <div class="col-head-row">
          <div class="info">
            <span class="task">TASK / MILESTONE</span>
            <span>TYPE</span>
            <span>START</span>
            <span>END</span>
            <span>WKS</span>
          </div>
        </div>
        <div class="month-row" style="margin-left:{_INFO_PX}px; width:{grid_px}px;">{"".join(month_cells)}</div>
        <div class="week-row" style="margin-left:{_INFO_PX}px; width:{grid_px}px;">{week_cells}</div>
      </div>
      {"".join(body)}
    </div>
  </div>

  <div class="milestones">
    <h3>Milestones</h3>
    <table>
      <thead><tr><th>Milestone</th><th>Start</th><th>End</th><th>Duration</th></tr></thead>
      <tbody>{ms_rows}</tbody>
    </table>
  </div>

  {warnings_html}

  <div class="footer">Generated by Gencom Dashboard — Schedule Generator</div>
</body>
</html>"""


def _row_html(t: Task, grid: list[date], i: int) -> str:
    type_label = "" if t.type == "phase_header" else (
        "Milestone" if t.type == "milestone" else t.type.capitalize()
    )
    weeks_label = "—" if t.type == "milestone" else str(t.weeks)
    indent = "&nbsp;&nbsp;&nbsp;&nbsp;" * t.indent
    cls = t.type if t.type != "phase_header" else "phase"

    # Find the bar's pixel range in the grid.
    monday0 = grid[0]
    start_col = max(0, (_monday(t.start) - monday0).days // 7)
    end_col = max(start_col + 1, (_monday(t.end) - monday0).days // 7 + 1)
    bar_left = _INFO_PX + start_col * _CELL_PX
    bar_width = max(_CELL_PX // 2, (end_col - start_col) * _CELL_PX - 2)

    return f"""
      <div class="row {cls}">
        <div class="info-cell">
          <span class="task">{indent}{escape(t.name)}</span>
          <span class="meta">{escape(type_label)}</span>
          <span class="meta">{_fmt(t.start)}</span>
          <span class="meta">{_fmt(t.end)}</span>
          <span class="meta">{escape(weeks_label)}</span>
        </div>
        <div class="bar" style="left:{bar_left}px; width:{bar_width}px;"></div>
      </div>"""


def _empty_doc(name: str) -> str:
    return (
        f"<!doctype html><html><body><h1>{escape(name)}</h1>"
        f"<p>No tasks generated.</p></body></html>"
    )
