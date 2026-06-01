"""
Template ingestion — reads the user's Gencom budget template and detects structure.

Spec Section 7.2: on first run, scan the template and present detected structure to
user. They confirm/correct mapping. Mapping stored in template_map.json.

**Detector**: the Gencom template uses column B for section headers and `SUBTOTAL`
rows to close each section. Column A is empty. We scan columns A and B across all
sheets for bold, non-empty text. Any header containing "SUBTOTAL", "TOTAL", or
"BUDGET" is treated as a terminator, not a division. Each division captures its
starting row and the row range of line items beneath it (until the next header or
a SUBTOTAL).

The "line item row range" is what the Excel writer will populate during export.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from openpyxl.worksheet.worksheet import Worksheet

from config import TEMPLATE_MAP_PATH, TEMPLATE_PATH


# Words that indicate a "closer" row (not a new division).
TERMINATOR_KEYWORDS = ("SUBTOTAL", "TOTAL", "BUDGET", "COMBINED")
# Words to exclude as non-division header rows even if bold.
HEADER_NOISE = ("AREA", "DESCRIPTION", "KEYS", "QTY", "UNIT", "COST")


def template_exists() -> bool:
    return TEMPLATE_PATH.exists()


def _cell_is_bold(cell) -> bool:
    return bool(cell.font and cell.font.bold)


def _first_bold_nonempty_cell(ws: Worksheet, row: int, max_col: int = 8):
    """Return the first bold, non-empty text cell in this row (cols 1..max_col)."""
    for c in range(1, max_col + 1):
        cell = ws.cell(row=row, column=c)
        if cell.value is None:
            continue
        if not _cell_is_bold(cell):
            continue
        text = str(cell.value).strip()
        if text:
            return cell, text
    return None, None


def _is_terminator(text: str) -> bool:
    up = text.upper()
    return any(k in up for k in TERMINATOR_KEYWORDS)


def _is_noise_header(text: str) -> bool:
    up = text.upper().strip()
    if up in HEADER_NOISE:
        return True
    # Pure numbers or measurements like "253 KEYS" — a word or two followed by digits
    # OR starting with digits — are property header metadata, not divisions.
    if any(ch.isdigit() for ch in text) and len(text) < 20:
        return True
    # Dates parsed as strings.
    if text[:4].isdigit() and "-" in text:
        return True
    return False


def _scan_sheet(ws: Worksheet, max_rows: int = 200) -> list[dict[str, Any]]:
    """Find divisions on a single sheet.

    A division is a bold row whose first non-empty cell (in A/B/C) contains
    plain header text (not a SUBTOTAL or column header). Each division's
    `line_start` and `line_end` bracket the rows of line items beneath it.
    """
    candidates: list[dict[str, Any]] = []
    for row_idx in range(1, min(ws.max_row, max_rows) + 1):
        cell, text = _first_bold_nonempty_cell(ws, row_idx)
        if cell is None or text is None:
            continue
        if _is_terminator(text):
            candidates.append({"row": row_idx, "text": text, "kind": "terminator", "col": cell.column})
            continue
        if _is_noise_header(text):
            continue
        # Likely a division header.
        candidates.append({"row": row_idx, "text": text, "kind": "division", "col": cell.column})

    # Pair each division with the next terminator (or next division) to get its row range.
    divisions: list[dict[str, Any]] = []
    for i, c in enumerate(candidates):
        if c["kind"] != "division":
            continue
        line_start = c["row"] + 1
        line_end = c["row"]
        total_row: int | None = None
        for later in candidates[i + 1 :]:
            if later["kind"] == "terminator":
                total_row = later["row"]
                line_end = later["row"] - 1
                break
            if later["kind"] == "division":
                line_end = later["row"] - 1
                break
        else:
            line_end = min(ws.max_row, max_rows)

        divisions.append({
            "name": c["text"],
            "sheet": ws.title,
            "row": c["row"],
            "header_col": c["col"],
            "line_start": line_start,
            "line_end": line_end,
            "total_row": total_row,
        })
    return divisions


def scan_template() -> dict[str, Any]:
    if not template_exists():
        return {"found": False, "sheets": [], "divisions": []}

    wb = load_workbook(TEMPLATE_PATH, data_only=False, keep_vba=False)
    sheets_info: list[dict[str, Any]] = []
    all_divisions: list[dict[str, Any]] = []

    for ws in wb.worksheets:
        divs = _scan_sheet(ws)
        # Keep the bold_rows preview for the sheet summary.
        bold_rows = []
        for row_idx in range(1, min(ws.max_row, 200) + 1):
            cell, text = _first_bold_nonempty_cell(ws, row_idx)
            if cell is not None and text is not None:
                bold_rows.append({"row": row_idx, "text": text})
        sheets_info.append({
            "name": ws.title,
            "max_row": ws.max_row,
            "max_col": ws.max_column,
            "bold_rows": bold_rows,
        })
        all_divisions.extend(divs)

    return {
        "found": True,
        "path": str(TEMPLATE_PATH),
        "sheets": sheets_info,
        "divisions": all_divisions,
    }


def load_template_map() -> dict[str, Any] | None:
    if not TEMPLATE_MAP_PATH.exists():
        return None
    with TEMPLATE_MAP_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_template_map(data: dict[str, Any]) -> None:
    with TEMPLATE_MAP_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def list_divisions() -> list[str]:
    """Return the current division list — from saved map if present, else from a scan."""
    mapping = load_template_map()
    if mapping and "divisions" in mapping:
        return [d["name"] for d in mapping["divisions"]]
    scan = scan_template()
    return [d["name"] for d in scan.get("divisions", [])]
