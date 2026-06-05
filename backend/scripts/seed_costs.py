"""Seed the Cost Database from data/cost_seed.xlsx (the FFE Pricing Database).

Two data shapes are imported:

1. **DATABASE tab** — vendor-level project prices, one row per item. These become
   CostDatabaseItem records with source="actual_project".
2. **Upscale / Upper Upscale / Luxury tabs** — Nehmer & HVS per-key benchmark
   ranges broken into scope sections (e.g. "Guestroom Softgoods Refurbishment").
   These become CostDatabaseItem records with source="benchmark" and the section
   stored in notes for later filtering.

Idempotent: wipes all rows whose source is "actual_project" or "benchmark"
before reseeding. User-added rows (source="user_seeded") are preserved.

Run from backend/:
    ./venv/Scripts/python.exe scripts/seed_costs.py
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make backend/ importable when run as a script from any cwd.
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from openpyxl import load_workbook
from sqlalchemy import delete

from config import DATA_DIR
from db import SessionLocal, init_db
from models.entities import CostDatabaseItem

SEED_PATH = DATA_DIR / "cost_seed.xlsx"

TIER_MAP = {
    "Luxury": "luxury",
    "Upper Upscale": "upper_upscale",
    "Upscale": "upscale",
}


def _norm_tier(raw: str | None) -> str | None:
    if not raw:
        return None
    for k, v in TIER_MAP.items():
        if k.lower() == str(raw).strip().lower():
            return v
    return None


def import_database_tab(ws) -> list[CostDatabaseItem]:
    """Row 3 is the header row for the DATABASE sheet."""
    headers = [str(ws.cell(row=3, column=c).value or "").strip() for c in range(1, ws.max_column + 1)]
    col = {h: i + 1 for i, h in enumerate(headers) if h}

    def get(row_idx: int, key: str):
        c = col.get(key)
        if not c:
            return None
        return ws.cell(row=row_idx, column=c).value

    items: list[CostDatabaseItem] = []
    for r in range(4, ws.max_row + 1):
        item_name = get(r, "ITEM / FFE CATEGORY")
        unit_cost = get(r, "UNIT COST")
        if not item_name or unit_cost in (None, ""):
            continue
        tier = _norm_tier(get(r, "PROPERTY TYPE"))
        if not tier:
            continue
        try:
            cost = float(unit_cost)
        except (TypeError, ValueError):
            continue
        sub = get(r, "SUB-TYPE / DESCRIPTION") or ""
        vendor = get(r, "VENDOR") or ""
        year = get(r, "YEAR")
        project = get(r, "PROPERTY / PROJECT NAME") or ""
        notes_parts = [p for p in (str(sub).strip(), f"Vendor: {vendor}" if vendor else "", f"Project: {project}" if project else "", f"Year: {year}" if year else "") if p]
        items.append(CostDatabaseItem(
            item_name=str(item_name).strip(),
            unit=str(get(r, "UNIT") or "each").strip().lower(),
            brand_tier=tier,
            suggested_cost=cost,
            source="actual_project",
            notes=" | ".join(notes_parts) or None,
        ))
    return items


def import_tier_tab(ws, tier: str) -> list[CostDatabaseItem]:
    """Tier tabs have repeating blocks:
        <section title row>
        <section subtitle row>  (e.g. "Prototype: 304 guestrooms")
        Line Item | Range Low | Range High | Average
        <item rows>
        <blank>
        <next section...>

    We track the currently active section by remembering the most recent
    non-"Line Item" header block, and we treat any numeric row (cols B and C
    both numeric) as a data row.
    """
    items: list[CostDatabaseItem] = []
    current_section = ""

    for r in range(1, ws.max_row + 1):
        a = ws.cell(row=r, column=1).value
        b = ws.cell(row=r, column=2).value
        c = ws.cell(row=r, column=3).value
        d = ws.cell(row=r, column=4).value

        a_str = str(a).strip() if a is not None else ""
        # Blank row resets nothing — section persists across blanks.

        # Header row: "Line Item"
        if a_str.lower() == "line item":
            continue

        # Section title row: col A non-empty, cols B/C/D all empty or non-numeric.
        def is_num(x):
            if x is None:
                return False
            try:
                float(x)
                return True
            except (TypeError, ValueError):
                return False

        if a_str and not (is_num(b) and is_num(c)):
            current_section = a_str[:120]
            continue

        # Data row: need text in A and numbers in B/C (low/high).
        if a_str and is_num(b) and is_num(c):
            low = float(b)
            high = float(c)
            avg = float(d) if is_num(d) else (low + high) / 2
            items.append(CostDatabaseItem(
                item_name=a_str,
                unit="per key",
                brand_tier=tier,
                suggested_cost=avg,
                historical_range_low=low,
                historical_range_high=high,
                source="benchmark",
                notes=f"Nehmer & HVS · {current_section}" if current_section else "Nehmer & HVS",
            ))
    return items


def main():
    if not SEED_PATH.exists():
        print(f"ERROR: {SEED_PATH} not found. Place the FFE Pricing Database there first.")
        sys.exit(1)

    init_db()
    wb = load_workbook(SEED_PATH, data_only=True)
    print(f"Loaded {SEED_PATH.name}, sheets: {wb.sheetnames}")

    all_items: list[CostDatabaseItem] = []

    if "DATABASE" in wb.sheetnames:
        db_items = import_database_tab(wb["DATABASE"])
        print(f"  DATABASE: {len(db_items)} actual-project rows")
        all_items.extend(db_items)

    for sheet_name, tier in TIER_MAP.items():
        if sheet_name in wb.sheetnames:
            tier_items = import_tier_tab(wb[sheet_name], tier)
            print(f"  {sheet_name}: {len(tier_items)} benchmark rows")
            all_items.extend(tier_items)

    with SessionLocal() as s:
        # Wipe prior seeded rows so re-running is idempotent; keep user-entered rows.
        s.execute(delete(CostDatabaseItem).where(CostDatabaseItem.source.in_(["actual_project", "benchmark"])))
        s.add_all(all_items)
        s.commit()
        total = s.query(CostDatabaseItem).count()

    print(f"\nSeeded {len(all_items)} rows. Total in CostDatabaseItem: {total}")


if __name__ == "__main__":
    main()
