"""Excel export service — builds the populated Capex budget workbook.

The layout matches `Capex - Template.xlsx` (simplified 4-column version).
Columns:
  B: AREA (sub-area label)
  C: DESCRIPTION (line item)
  D: BUDGET (money)
  E: NOTES

Structure:
  Row 1  — Title (col B) + date (col E)
  Row 2  — "<KEYS> KEYS" (B) | "COMBINED TOTAL =" (C) | total formula (D) | per-key formula (E)
  Row 3  — Column headers with dark green fill
  Sections in order: DEFERRED MAINTENANCE, COMMON AREA, F&B, CORRIDORS,
                     GUESTROOMS, SUITES. SIGNATURE SUITES items fold into SUITES.
    Each section: green header, items sorted by sub-area then alphabetically,
    subtotal row with SUM + per-key formula.
  OVERALL SUBTOTAL
  MISC. ITEMS (soft-cost lines from scenario.soft_cost_breakdown or defaults)
  SUBTOTAL MISC.
  Developer's fee (if not already in the breakdown)
  TOTAL PROJECT COST
A "Scope Detail" audit sheet is appended for full itemized history.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy.orm import Session

from config import EXPORTS_DIR
from models.entities import Property, Scenario, ScopeItem


# ─── Styling palette (matches Capex - Template.xlsx) ──────────────────
GENCOM_GREEN = "FF2D5A27"
LIGHT_GREEN_FILL = "FFE2EFDA"
ALT_ROW_FILL = "FFF7F9FC"
WHITE_FILL = "FFFFFFFF"
BORDER_GRAY = "FFD9D4C8"

ARIAL = "Arial"
MONEY_FMT = '"$"#,##0'

_THIN = Side(style="thin", color=BORDER_GRAY)
_MEDIUM_DARK = Side(style="medium", color=GENCOM_GREEN)
_BORDER_ALL_THIN = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)

# Column indices (1-based). Area + description are fixed; the budget and
# notes columns are computed at export time because each selected scenario
# gets its own column. See `_col_layout()` for the runtime layout.
COL_AREA = 2        # B
COL_DESCRIPTION = 3 # C
COL_BUDGET = 4      # D  (first budget column — still used for single-scenario exports)
COL_NOTES = 5       # E  (legacy notes column — overridden when N > 1 scenarios)
LAST_DATA_COL = 5   # inclusive — legacy default; recomputed per-export


def _col_layout(num_scenarios: int) -> dict:
    """Return column indexes that adapt to the number of scenarios being
    exported. Each scenario gets its own BUDGET column starting at D; NOTES
    always follows the final budget column. Single-scenario exports keep the
    original layout so older downstream consumers don't break."""
    n = max(1, num_scenarios)
    first_budget = COL_BUDGET
    last_budget = first_budget + n - 1
    notes = last_budget + 1
    return {
        "area": COL_AREA,
        "description": COL_DESCRIPTION,
        "budget_cols": list(range(first_budget, last_budget + 1)),
        "first_budget": first_budget,
        "last_budget": last_budget,
        "notes": notes,
        "last_data_col": notes,
    }


def _col_letter(idx: int) -> str:
    return get_column_letter(idx)


def _title_font():
    return Font(name=ARIAL, size=16, bold=True)


def _column_header_font():
    return Font(name=ARIAL, size=11, bold=True, color="FFFFFFFF")


def _subtotal_font():
    return Font(name=ARIAL, size=11, bold=True, color=GENCOM_GREEN)


def _section_header_font():
    return Font(name=ARIAL, size=11, bold=True, color=GENCOM_GREEN)


def _body_font():
    return Font(name=ARIAL, size=11)


def _final_subtotal_font():
    return Font(name=ARIAL, size=11, bold=True, color="FFFFFFFF")


# ─── Helpers ──────────────────────────────────────────────────────────
def _safe_filename(s: str) -> str:
    """Strip anything unsafe for a filename, using a SPACE for replacements
    (not underscore) and preserving the original spaces so the end result
    reads naturally (e.g. "RCCP Central Park" — not "RCCP_Central_Park")."""
    keep = "-.() abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    out_chars: list[str] = []
    for c in s:
        out_chars.append(c if c in keep else " ")
    cleaned = "".join(out_chars)
    cleaned = " ".join(cleaned.split())  # collapse whitespace runs
    return cleaned or "Property"


def _scenario_items(scenario: Scenario) -> list[ScopeItem]:
    return [i for i in scenario.scope_items if i.included_in_budget and not i.deleted]


def _group_by_division(items: Iterable[ScopeItem]) -> dict[str, list[ScopeItem]]:
    grouped: dict[str, list[ScopeItem]] = {}
    for it in items:
        grouped.setdefault(it.division or "Uncategorized", []).append(it)
    return grouped


_SECTION_ORDER: list[tuple[str, list[str]]] = [
    ("DEFERRED MAINTENANCE", ["DEFERRED MAINTENANCE"]),
    ("COMMON AREA", ["COMMON AREA", "MEETING SPACE"]),
    ("F&B", ["F&B"]),
    ("CORRIDORS", ["CORRIDORS"]),
    ("GUESTROOMS", ["GUESTROOMS"]),
    ("SUITES", ["SUITES", "SIGNATURE SUITES"]),
]


def _sub_area_for(item: ScopeItem, section: str) -> str:
    """Return col B (sub-area) label. Prefers the user-set `sub_area` field;
    falls back to keyword inference when empty."""
    explicit = getattr(item, "sub_area", None)
    if explicit and explicit.strip():
        return explicit.strip()
    label = (item.line_item or "").lower()
    desc = (item.description or "").lower()
    hay = label + " " + desc

    if section == "GUESTROOMS":
        if any(k in hay for k in ("bath", "shower", "tub", "vanity", "toilet", "sink", "faucet")):
            return "Guestroom Bathroom"
        return "Guestroom"
    if section == "SUITES":
        if any(k in hay for k in ("bath", "shower", "tub", "vanity", "toilet", "sink", "faucet", "powder")):
            return "Suite Bathroom"
        return "Suite"
    if section == "CORRIDORS":
        return "Guestroom Corridor"
    if section == "COMMON AREA":
        if "lobby" in hay: return "Lobby"
        if any(k in hay for k in ("meeting", "ballroom", "boardroom", "pre-function")): return "Meeting"
        if "fitness" in hay: return "Fitness"
        if any(k in hay for k in ("pool", "cabana", "deck")): return "Pool/Deck"
        if any(k in hay for k in ("restroom", "public bath")): return "Public Restroom"
        return "Common Area"
    if section == "F&B":
        if "club" in hay: return "Club Lounge"
        if "bar" in hay and "restaurant" not in hay: return "Bar"
        return "Lounge/Restaurant"
    if section == "DEFERRED MAINTENANCE":
        words = (item.line_item or "").split()
        return " ".join(words[:2]) if words else "DM"
    return section.title()


def _notes_for(item: ScopeItem) -> str:
    """Build a human-readable note line for col E."""
    unit_cost = item.override_unit_cost if item.override_unit_cost is not None else item.suggested_unit_cost
    if item.quantity is None or unit_cost is None:
        return item.notes or ""
    raw_qty = item.quantity or 0
    eff_qty = item.effective_quantity() if hasattr(item, "effective_quantity") else raw_qty

    def _fmt_num(n):
        try:
            return f"{int(n)}" if float(n).is_integer() else f"{n:,.2f}"
        except Exception:
            return str(n)

    unit = item.unit or "each"
    cost_str = f"${int(round(unit_cost)):,}"
    basis = item.multiplier_basis

    if basis == "keys_pct":
        base = f"{_fmt_num(raw_qty)}% of keys = {_fmt_num(eff_qty)} / {unit} / {cost_str}"
    elif basis in ("keys", "floors", "doubles", "suites"):
        base = f"{_fmt_num(raw_qty)} per {basis} × {_fmt_num(eff_qty)} / {unit} / {cost_str}"
    else:
        base = f"{_fmt_num(eff_qty)} / {unit} / {cost_str}"
    if item.notes:
        base += f" · {item.notes}"
    return base


# ─── Section writers ──────────────────────────────────────────────────
def _apply_header_band(ws: Worksheet, row: int, fill_color: str, border: Border, last_col: int = LAST_DATA_COL):
    """Fill cells from AREA through the last data column in `row` with the
    same fill + border so the band reads as one continuous row."""
    fill = PatternFill(start_color=fill_color, end_color=fill_color, fill_type="solid")
    for col in range(COL_AREA, last_col + 1):
        c = ws.cell(row=row, column=col)
        c.fill = fill
        c.border = border


def _property_info_rows(prop: Property) -> list[tuple[str, str]]:
    """Build the label/value pairs for the property info block. Only emits
    rows for fields that have data, so a sparse property gets a shorter block."""
    rows: list[tuple[str, str]] = []

    loc_parts = [p for p in (prop.address, prop.city, prop.state, prop.country) if p]
    if loc_parts:
        rows.append(("Address", ", ".join(loc_parts)))

    if prop.property_type:
        rows.append(("Property Type", prop.property_type.replace("_", " ").title()))

    # Keys / floors / GSF combined on one row
    stat_parts: list[str] = []
    if prop.keys: stat_parts.append(f"{prop.keys:,} keys")
    if prop.floors: stat_parts.append(f"{prop.floors} floors")
    if prop.total_gsf: stat_parts.append(f"{prop.total_gsf:,} GSF")
    if stat_parts:
        rows.append(("Keys / Floors / GSF", "  ·  ".join(stat_parts)))

    yr_parts: list[str] = []
    if prop.year_built: yr_parts.append(f"Built {prop.year_built}")
    if prop.year_last_renovated: yr_parts.append(f"Last renovated {prop.year_last_renovated}")
    if yr_parts:
        rows.append(("Year", "  ·  ".join(yr_parts)))

    return rows


def _write_title_and_headers(ws: Worksheet, prop: Property, scenarios: list[Scenario]) -> int:
    """Write the title, property info block, blank spacer, combined total row,
    blank spacer, and column headers. Returns the first row where section data
    should be written. When multiple scenarios are exported each gets its own
    BUDGET column, and the NOTES column shifts to the right of them."""
    keys = prop.keys or 0
    layout = _col_layout(len(scenarios))
    notes_col = layout["notes"]
    last_col = layout["last_data_col"]
    row = 1

    # Row 1: title + date
    t = ws.cell(row=row, column=COL_AREA, value=f"{(prop.name or 'PROPERTY').upper()} CAPEX BUDGET")
    t.font = _title_font()
    d = ws.cell(row=row, column=notes_col, value=datetime.now())
    d.number_format = "mm/dd/yy"
    d.font = Font(name=ARIAL, size=11, color=GENCOM_GREEN)
    d.alignment = Alignment(horizontal="right")
    row += 1

    # Property info block (label in col B, value spanning description..notes visually)
    label_font = Font(name=ARIAL, size=10, bold=True, color=GENCOM_GREEN)
    value_font = Font(name=ARIAL, size=10, color="FF333333")
    for label, value in _property_info_rows(prop):
        lc = ws.cell(row=row, column=COL_AREA, value=label)
        lc.font = label_font
        lc.alignment = Alignment(horizontal="left", vertical="center")
        vc = ws.cell(row=row, column=COL_DESCRIPTION, value=value)
        vc.font = value_font
        vc.alignment = Alignment(horizontal="left", vertical="center")
        # Merge description..notes so long values don't get clipped.
        ws.merge_cells(start_row=row, start_column=COL_DESCRIPTION,
                       end_row=row, end_column=notes_col)
        row += 1

    # Spacer row before the combined-total summary
    row += 1

    # Combined total row
    combined_total_row = row
    ws.cell(row=row, column=COL_AREA, value=f"{keys:,} KEYS").font = Font(name=ARIAL, size=12, bold=True)
    ct_label = ws.cell(row=row, column=COL_DESCRIPTION, value="COMBINED TOTAL =")
    ct_label.font = Font(name=ARIAL, size=12, bold=True)
    ct_label.alignment = Alignment(horizontal="right")
    # Budget + notes cells on this row are filled later once we know each
    # scenario's final-total row.
    row += 1

    # Blank spacer between the info/combined block and the budget tables
    row += 1

    # Column headers — dark green fill spanning AREA..NOTES.
    header_fill = PatternFill(start_color=GENCOM_GREEN, end_color=GENCOM_GREEN, fill_type="solid")
    header_border = Border(top=_MEDIUM_DARK, bottom=_MEDIUM_DARK)
    header_labels = {
        COL_AREA: "AREA",
        COL_DESCRIPTION: "DESCRIPTION",
        notes_col: "NOTES",
    }
    # One budget column per scenario, labelled with the scenario name.
    for i, sc in enumerate(scenarios):
        header_labels[layout["budget_cols"][i]] = (sc.name or f"Scenario {i + 1}").upper()

    for col in range(COL_AREA, last_col + 1):
        c = ws.cell(row=row, column=col, value=header_labels.get(col))
        c.font = _column_header_font()
        c.fill = header_fill
        c.alignment = Alignment(horizontal="left", vertical="center")
        c.border = header_border

    # Store the combined-total row on the worksheet for later fill-in.
    ws._combined_total_row = combined_total_row  # type: ignore[attr-defined]

    return row + 1  # first section row


def _write_section(
    ws: Worksheet, row: int, section_title: str, items: list[ScopeItem], keys: int,
    scenarios: list[Scenario], items_by_scenario: dict[str, set[str]],
) -> tuple[int, int]:
    """Write a section header, item rows (one row per item), and a subtotal
    row. Each scenario gets its own budget column; items not in a scenario
    leave that column blank so the SUM still works. Returns (subtotal_row,
    next_row)."""
    layout = _col_layout(len(scenarios))
    budget_cols = layout["budget_cols"]
    notes_col = layout["notes"]
    last_col = layout["last_data_col"]

    # Section header row
    hc = ws.cell(row=row, column=COL_AREA, value=section_title)
    hc.font = _section_header_font()
    _apply_header_band(ws, row, LIGHT_GREEN_FILL, Border(top=_THIN, bottom=_THIN), last_col=last_col)
    row += 1

    section_start = row
    for idx, item in enumerate(items):
        sub_area = _sub_area_for(item, section_title)
        ws.cell(row=row, column=COL_AREA, value=sub_area).font = _body_font()
        ws.cell(row=row, column=COL_DESCRIPTION, value=item.line_item or "").font = _body_font()

        # line_total is item-level (not scenario-specific). Show per scenario
        # only when the item is in that scenario's selection.
        line_total = item.line_total() if hasattr(item, "line_total") else (item.quantity or 0) * (
            item.override_unit_cost if item.override_unit_cost is not None else (item.suggested_unit_cost or 0)
        )
        line_total = round(line_total, 2)
        for sc, col in zip(scenarios, budget_cols):
            included = item.id in items_by_scenario.get(sc.id, set())
            cell = ws.cell(row=row, column=col, value=(line_total if included else None))
            cell.number_format = MONEY_FMT
            cell.font = _body_font()

        ws.cell(row=row, column=notes_col, value=_notes_for(item)).font = Font(
            name=ARIAL, size=10, italic=True,
        )
        if idx % 2 == 1:
            for col in range(COL_AREA, last_col + 1):
                ws.cell(row=row, column=col).fill = PatternFill(
                    start_color=ALT_ROW_FILL, end_color=ALT_ROW_FILL, fill_type="solid",
                )
        row += 1

    section_end = row - 1 if items else section_start
    if not items:
        row += 1  # leave a placeholder gap

    # Subtotal row — one SUM formula per scenario budget column.
    subtotal_row = row
    subtotal_border = Border(top=_THIN, bottom=_THIN)
    for col in range(COL_AREA, last_col + 1):
        ws.cell(row=row, column=col).border = subtotal_border
    c = ws.cell(row=row, column=COL_DESCRIPTION, value=f"{section_title} SUBTOTAL")
    c.font = _subtotal_font()
    c.alignment = Alignment(horizontal="right")
    for col in budget_cols:
        letter = _col_letter(col)
        formula = f"=SUM({letter}{section_start}:{letter}{section_end})" if items else 0
        dc = ws.cell(row=row, column=col, value=formula)
        dc.number_format = MONEY_FMT
        dc.font = _subtotal_font()
    if keys > 0:
        # Notes column shows the PRIMARY (first-selected) scenario's per-key
        # so the reader gets a quick $/key benchmark. Downstream scenarios
        # are covered by the overall + final-total per-key rows.
        primary_letter = _col_letter(budget_cols[0])
        ec = ws.cell(row=row, column=notes_col, value=f"={primary_letter}{row}/{keys}")
        ec.number_format = MONEY_FMT
        ec.font = Font(name=ARIAL, size=10, italic=True, color=GENCOM_GREEN)
        ec.alignment = Alignment(horizontal="right")

    row += 2  # blank row between sections
    return subtotal_row, row


def _write_overall_subtotal(
    ws: Worksheet, row: int, subtotal_rows: list[int], keys: int,
    scenarios: list[Scenario],
) -> int:
    layout = _col_layout(len(scenarios))
    budget_cols = layout["budget_cols"]
    notes_col = layout["notes"]
    last_col = layout["last_data_col"]

    overall_border = Border(top=_MEDIUM_DARK, bottom=_MEDIUM_DARK)
    for col in range(COL_AREA, last_col + 1):
        ws.cell(row=row, column=col).border = overall_border
    c = ws.cell(row=row, column=COL_DESCRIPTION, value="OVERALL SUBTOTAL")
    c.font = _subtotal_font()
    c.alignment = Alignment(horizontal="right")
    for col in budget_cols:
        letter = _col_letter(col)
        formula = "=" + "+".join(f"{letter}{r}" for r in subtotal_rows) if subtotal_rows else "=0"
        dc = ws.cell(row=row, column=col, value=formula)
        dc.number_format = MONEY_FMT
        dc.font = _subtotal_font()
    if keys > 0:
        primary_letter = _col_letter(budget_cols[0])
        ec = ws.cell(row=row, column=notes_col, value=f"={primary_letter}{row}/{keys}")
        ec.number_format = MONEY_FMT
        ec.font = Font(name=ARIAL, size=10, italic=True, color=GENCOM_GREEN)
        ec.alignment = Alignment(horizontal="right")
    return row


# ─── MISC / soft-cost section ────────────────────────────────────────
def _default_misc_lines(dm_row: int, overall_row: int) -> list[dict]:
    return [
        {"desc": "GC General Conditions, Insurance & Fees",
         "formula": f"=(D{overall_row}-D{dm_row})*0.08",
         "note": "8% of Subtotal (excluding DM)"},
        {"desc": "Attic Stock, Freight, Warehouse & Install",
         "formula": f"=(D{overall_row}-D{dm_row})*0.42",
         "note": "42% of FF&E, Carpet, Drapery"},
        {"desc": "Permits", "formula": "=30000", "note": "Placeholder"},
        {"desc": "Design Professionals (A/E/ID/PA)",
         "formula": f"=(D{overall_row}-D{dm_row})*0.08",
         "note": "8% of Subtotal (excluding DM)"},
        {"desc": "Project Management",
         "formula": f"=(D{overall_row}-D{dm_row})*0.06",
         "note": "6% of Subtotal (excluding DM)"},
        {"desc": "Purchasing Agent", "formula": "=175000", "note": "Estimate"},
        {"desc": "Contingency",
         "formula": f"=D{overall_row}*0.10",
         "note": "10% of Subtotal"},
    ]


def _soft_cost_lines_from_scenario(
    scenario: Scenario, dm_row: int, overall_row: int,
) -> list[dict]:
    bd = scenario.soft_cost_breakdown or []
    if not bd:
        return _default_misc_lines(dm_row, overall_row)
    out: list[dict] = []
    for line in bd:
        name = line.get("name") or "Soft cost"
        fixed = line.get("fixed")
        pct = line.get("pct")
        exclude_dm = line.get("basis_exclude_dm") is True or line.get("basis_exclude_dm") is None
        if fixed is not None:
            out.append({"desc": name, "formula": f"={float(fixed)}", "note": "Fixed"})
            continue
        if pct is not None:
            base_expr = f"(D{overall_row}-D{dm_row})" if exclude_dm else f"D{overall_row}"
            out.append({
                "desc": name,
                "formula": f"={base_expr}*{float(pct)}",
                "note": f"{float(pct) * 100:.1f}% of {'Subtotal ex-DM' if exclude_dm else 'Subtotal'}",
            })
    return out or _default_misc_lines(dm_row, overall_row)


def _scenario_has_dev_fee(scenario: Scenario) -> bool:
    bd = scenario.soft_cost_breakdown or []
    for line in bd:
        name = (line.get("name") or "").lower()
        group = (line.get("group") or "").lower()
        if group == "dev_fee" or "developer" in name or "dev fee" in name:
            return True
    return False


def _write_misc_section(
    ws: Worksheet, row: int, scenarios: list[Scenario], dm_row: int, overall_row: int, keys: int,
) -> tuple[int, Optional[int], int]:
    """Write MISC. ITEMS header, per-scenario soft-cost lines, subtotal row,
    optional dev-fee row, and the final TOTAL PROJECT COST row. Each scenario
    has its own budget column, so soft-cost formulas use that column's letter
    and reference its own overall-subtotal + dm-subtotal cells.

    The `misc_lines` come from the FIRST-selected (primary) scenario so the
    description column is stable; formulas adapt per column using letter math.
    """
    layout = _col_layout(len(scenarios))
    budget_cols = layout["budget_cols"]
    notes_col = layout["notes"]
    last_col = layout["last_data_col"]

    # MISC header — light green band with dark-green column sub-headers
    hc = ws.cell(row=row, column=COL_AREA, value="MISC. ITEMS")
    hc.font = _section_header_font()
    _apply_header_band(ws, row, LIGHT_GREEN_FILL, Border(top=_MEDIUM_DARK, bottom=_THIN), last_col=last_col)
    # Re-label budget cols + notes on this row (like the template), one label
    # per scenario column so the reader knows which column is which.
    header_fill = PatternFill(start_color=GENCOM_GREEN, end_color=GENCOM_GREEN, fill_type="solid")
    for i, col in enumerate(budget_cols):
        label = (scenarios[i].name or f"Scenario {i + 1}").upper()
        c = ws.cell(row=row, column=col, value=label)
        c.font = _column_header_font()
        c.fill = header_fill
        c.border = Border(top=_MEDIUM_DARK, bottom=_THIN)
    e_hdr = ws.cell(row=row, column=notes_col, value="NOTES")
    e_hdr.font = _column_header_font()
    e_hdr.fill = header_fill
    e_hdr.border = Border(top=_MEDIUM_DARK, bottom=_THIN)
    row += 1

    # The MISC line descriptions come from the first scenario; per-scenario
    # formulas are derived by rewriting "D<overall_row>" / "D<dm_row>" etc.
    # with each target column's letter.
    primary = scenarios[0]
    template_lines = _soft_cost_lines_from_scenario(primary, dm_row, overall_row)
    misc_start = row
    for idx, line in enumerate(template_lines):
        ws.cell(row=row, column=COL_DESCRIPTION, value=line["desc"]).font = _body_font()
        for col in budget_cols:
            letter = _col_letter(col)
            # Retarget the formula's column references (D) to this scenario's
            # column letter. The prompt-builder uses the legacy "D<row>" shape
            # exclusively, so this rewrite is safe.
            formula = line["formula"]
            if letter != "D" and formula.startswith("="):
                formula = _retarget_column(formula, "D", letter)
            dc = ws.cell(row=row, column=col, value=formula)
            dc.number_format = MONEY_FMT
            dc.font = _body_font()
        ws.cell(row=row, column=notes_col, value=line.get("note") or "").font = Font(
            name=ARIAL, size=10, italic=True,
        )
        if idx % 2 == 1:
            for col in range(COL_AREA, last_col + 1):
                ws.cell(row=row, column=col).fill = PatternFill(
                    start_color=ALT_ROW_FILL, end_color=ALT_ROW_FILL, fill_type="solid",
                )
        row += 1
    misc_end = row - 1

    # MISC subtotal — per scenario column
    misc_subtotal_row = row
    subtotal_border = Border(top=_THIN, bottom=_THIN)
    for col in range(COL_AREA, last_col + 1):
        ws.cell(row=row, column=col).border = subtotal_border
    c = ws.cell(row=row, column=COL_DESCRIPTION, value="SUBTOTAL MISC.")
    c.font = _subtotal_font()
    c.alignment = Alignment(horizontal="right")
    for col in budget_cols:
        letter = _col_letter(col)
        dc = ws.cell(row=row, column=col, value=f"=SUM({letter}{misc_start}:{letter}{misc_end})")
        dc.number_format = MONEY_FMT
        dc.font = _subtotal_font()
    row += 2

    # Developer's fee row — rendered once if ANY scenario lacks a dev-fee line
    # in its own soft-cost breakdown. Only the scenario columns that DON'T
    # already include it get the formula; scenarios that already have it get
    # a blank cell so the TOTAL PROJECT COST below sums to the right value
    # (no double-counting).
    dev_fee_row: Optional[int] = None
    per_scenario_has_dev_fee = [_scenario_has_dev_fee(sc) for sc in scenarios]
    if not all(per_scenario_has_dev_fee):
        dev_fee_row = row
        c = ws.cell(row=row, column=COL_DESCRIPTION, value="Developer's fee")
        c.font = _body_font()
        c.alignment = Alignment(horizontal="right")
        c.border = Border(top=_THIN)
        for i, col in enumerate(budget_cols):
            letter = _col_letter(col)
            if per_scenario_has_dev_fee[i]:
                # Already in the breakdown above — skip to avoid double-counting.
                dc = ws.cell(row=row, column=col, value=None)
            else:
                dc = ws.cell(
                    row=row, column=col,
                    value=f"=({letter}{overall_row}+{letter}{misc_subtotal_row})*0.04",
                )
                dc.number_format = MONEY_FMT
            dc.font = _body_font()
        ws.cell(row=row, column=notes_col, value="4% of (Subtotal + MISC) where not in soft costs").font = Font(
            name=ARIAL, size=10, italic=True,
        )
        row += 1

    # Final TOTAL PROJECT COST — per scenario
    final_row = row
    total_fill = PatternFill(start_color=GENCOM_GREEN, end_color=GENCOM_GREEN, fill_type="solid")
    total_border = Border(top=_MEDIUM_DARK, bottom=_MEDIUM_DARK)
    for col in range(COL_AREA, last_col + 1):
        cell = ws.cell(row=row, column=col)
        cell.fill = total_fill
        cell.border = total_border
    c = ws.cell(row=row, column=COL_DESCRIPTION, value="TOTAL PROJECT COST")
    c.font = _final_subtotal_font()
    c.alignment = Alignment(horizontal="right")
    for col in budget_cols:
        letter = _col_letter(col)
        total_formula = f"={letter}{overall_row}+{letter}{misc_subtotal_row}" + (
            f"+{letter}{dev_fee_row}" if dev_fee_row else ""
        )
        dc = ws.cell(row=row, column=col, value=total_formula)
        dc.number_format = MONEY_FMT
        dc.font = _final_subtotal_font()
    if keys > 0:
        primary_letter = _col_letter(budget_cols[0])
        ec = ws.cell(row=row, column=notes_col, value=f"={primary_letter}{row}/{keys}")
        ec.number_format = MONEY_FMT
        ec.font = Font(name=ARIAL, size=11, bold=True, italic=True, color="FFFFFFFF")
        ec.alignment = Alignment(horizontal="right")

    return misc_subtotal_row, dev_fee_row, final_row


def _retarget_column(formula: str, src: str, dst: str) -> str:
    """Rewrite cell references like "D12" or "D12:D30" to use `dst` as the
    column letter. Only single-letter column refs are rewritten so longer
    names like "DM" aren't accidentally caught.

    Handles: leading '=', arithmetic, parens, colons, multiplication.
    """
    import re
    pattern = re.compile(rf"(?<![A-Za-z]){src}(\d+)")
    return pattern.sub(rf"{dst}\1", formula)


# ─── Scope detail audit sheet ─────────────────────────────────────────
def _append_scope_detail_sheet(wb, property_: Property, scenarios: list[Scenario]):
    if "Scope Detail" in wb.sheetnames:
        del wb["Scope Detail"]
    ws = wb.create_sheet("Scope Detail")
    ws.sheet_view.showGridLines = False
    headers = [
        "Scenario", "Division", "Line Item", "Description", "Qty", "Unit",
        "Suggested $", "Override $", "Effective $", "Total", "Priority",
        "Source", "Page", "Confidence", "Included",
    ]
    header_fill = PatternFill(start_color=GENCOM_GREEN, end_color=GENCOM_GREEN, fill_type="solid")
    for i, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = _column_header_font()
        c.fill = header_fill
        c.alignment = Alignment(horizontal="left", vertical="center")
        c.border = _BORDER_ALL_THIN

    row_idx = 2
    for sc in scenarios:
        items = sorted(_scenario_items(sc), key=lambda i: (i.division, i.line_item))
        for it in items:
            effective = it.override_unit_cost if it.override_unit_cost is not None else (it.suggested_unit_cost or 0)
            eff_qty = it.effective_quantity()
            total = eff_qty * effective
            values = [
                sc.name, it.division, it.line_item, it.description or "", eff_qty,
                it.unit, it.suggested_unit_cost, it.override_unit_cost, effective, total,
                it.priority, it.source, it.source_page, it.confidence, it.included_in_budget,
            ]
            for col_idx, v in enumerate(values, start=1):
                c = ws.cell(row=row_idx, column=col_idx, value=v)
                c.border = _BORDER_ALL_THIN
            row_idx += 1

    widths = [22, 22, 30, 40, 8, 10, 12, 12, 12, 14, 12, 12, 6, 12, 10]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


# ─── Public API ───────────────────────────────────────────────────────
def export_budget(
    db: Session,
    property_id: str,
    scenario_ids: list[str],
    filename: Optional[str] = None,
    note: Optional[str] = None,
) -> dict:
    prop = db.get(Property, property_id)
    if not prop:
        raise ValueError(f"Property {property_id} not found")
    scenarios = [db.get(Scenario, sid) for sid in scenario_ids]
    scenarios = [s for s in scenarios if s is not None]
    if not scenarios:
        raise ValueError("No valid scenarios to export")

    primary = scenarios[0]
    keys = prop.keys or 0

    # Build the union of scope items across every selected scenario. Items
    # are shared across scenarios by id, but each scenario decides which are
    # included. `items_by_scenario` maps scenario.id -> set of item ids so the
    # row writer can blank out cells for scenarios that excluded an item.
    union: dict[str, ScopeItem] = {}
    items_by_scenario: dict[str, set[str]] = {}
    for sc in scenarios:
        sc_items = _scenario_items(sc)
        items_by_scenario[sc.id] = {it.id for it in sc_items}
        for it in sc_items:
            union.setdefault(it.id, it)
    items_by_div = _group_by_division(union.values())

    wb = Workbook()
    # Ensure Excel recalculates every formula on file open and when any
    # referenced cell changes. openpyxl's default sets fullCalcOnLoad=True
    # but leaves calcMode unset, which some Excel versions interpret as
    # "manual" — forcing "auto" here guarantees live recalc everywhere.
    wb.calculation.calcMode = "auto"
    wb.calculation.fullCalcOnLoad = True
    wb.calculation.calcCompleted = False
    ws = wb.active
    ws.title = "CAPEX BUDGET"

    # Hide gridlines for a cleaner printable/presentation look. Borders still
    # read because we paint them explicitly on the rows that need them.
    ws.sheet_view.showGridLines = False

    # Column widths — A spacer, B AREA, C DESCRIPTION, then N budget cols,
    # then NOTES. Every budget column gets the same generous width so the
    # scenario names fit in the header.
    layout = _col_layout(len(scenarios))
    ws.column_dimensions["A"].width = 4
    ws.column_dimensions[_col_letter(COL_AREA)].width = 27
    ws.column_dimensions[_col_letter(COL_DESCRIPTION)].width = 51
    for col in layout["budget_cols"]:
        ws.column_dimensions[_col_letter(col)].width = 22
    ws.column_dimensions[_col_letter(layout["notes"])].width = 53

    # Writes title + property info + spacer + combined total + spacer + headers,
    # returns the first row where section data should be written.
    row = _write_title_and_headers(ws, prop, scenarios)
    subtotal_rows: list[int] = []
    section_log: list[dict] = []

    for section_title, divisions in _SECTION_ORDER:
        items: list[ScopeItem] = []
        for div in divisions:
            items.extend(items_by_div.get(div, []))
        # Group by sub-area, then alphabetize within each sub-area.
        items.sort(key=lambda i: (_sub_area_for(i, section_title), (i.line_item or "").lower()))
        subtotal_row, row = _write_section(
            ws, row, section_title, items, keys, scenarios, items_by_scenario,
        )
        subtotal_rows.append(subtotal_row)
        section_log.append({"section": section_title, "count": len(items), "row": subtotal_row})

    # Uncategorized / other divisions → their own MISC. ITEMS section
    known_divs = {d for _, dl in _SECTION_ORDER for d in dl}
    other_items = [it for div, its in items_by_div.items() if div not in known_divs for it in its]
    if other_items:
        other_items.sort(key=lambda i: (i.line_item or "").lower())
        subtotal_row, row = _write_section(
            ws, row, "OTHER", other_items, keys, scenarios, items_by_scenario,
        )
        subtotal_rows.append(subtotal_row)
        section_log.append({"section": "OTHER", "count": len(other_items), "row": subtotal_row})

    overall_row = row
    _write_overall_subtotal(ws, overall_row, subtotal_rows, keys, scenarios)
    row += 2

    dm_row = subtotal_rows[0] if subtotal_rows else overall_row
    misc_subtotal_row, dev_fee_row, final_row = _write_misc_section(
        ws, row, scenarios, dm_row, overall_row, keys,
    )

    # Fill the combined-total row's BUDGET cells per scenario column now that
    # we know where each scenario's final total lives. Row index was stashed
    # on the worksheet by the header writer.
    ct_row = getattr(ws, "_combined_total_row", None)
    if ct_row:
        for col in layout["budget_cols"]:
            letter = _col_letter(col)
            d_ct = ws.cell(row=ct_row, column=col, value=f"={letter}{final_row}")
            d_ct.number_format = MONEY_FMT
            d_ct.font = Font(name=ARIAL, size=12, bold=True)
        if keys > 0:
            primary_letter = _col_letter(layout["budget_cols"][0])
            e_ct = ws.cell(row=ct_row, column=layout["notes"], value=f"={primary_letter}{ct_row}/{keys}")
            e_ct.number_format = MONEY_FMT
            e_ct.font = Font(name=ARIAL, size=12, bold=True, italic=True)
            e_ct.alignment = Alignment(horizontal="right")

    # Freeze below the combined-total row so the info block scrolls but the
    # key summary + column headers stay visible.
    freeze_row = (ct_row + 3) if ct_row else 4
    ws.freeze_panes = f"A{freeze_row}"

    _append_scope_detail_sheet(wb, prop, scenarios)

    # Local clock for the user-visible date; UTC timestamp only used as an
    # on-disk prefix below to keep historical exports uniquely named.
    now_local = datetime.now()
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")
    if not filename:
        date_str = now_local.strftime("%m.%d.%y")
        filename = f"{_safe_filename(prop.name or 'Property')} Budget {date_str}.xlsx"
    elif not filename.lower().endswith(".xlsx"):
        filename += ".xlsx"

    prop_export_dir = EXPORTS_DIR / property_id
    prop_export_dir.mkdir(parents=True, exist_ok=True)
    out_path = prop_export_dir / f"{ts}_{filename}"
    wb.save(out_path)

    rel = out_path.relative_to(EXPORTS_DIR).as_posix()
    return {
        "filename": filename,
        "file_path": rel,
        "scenarios_included": [s.id for s in scenarios],
        "note": note,
        "divisions_log": section_log,
    }
