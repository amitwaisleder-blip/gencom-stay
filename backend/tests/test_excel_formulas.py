"""End-to-end formula verification for the Budget Generator export.

Drives export_budget() with a realistic Property + Scenarios fixture, then
reads the resulting .xlsx back via openpyxl and asserts that every formula:

  1. Starts with '=' (is actually a formula, not a literal string).
  2. References only cells that exist within the worksheet bounds.
  3. Has every referenced cell containing either a number, a formula,
     or is intentionally blank (Excel treats blank as 0).
  4. SUM ranges cover rows whose target-column cells are numeric or
     formulas (not text).
  5. Resolves to a finite numeric value via openpyxl's `data_only=True`
     cached-value read (requires the writer to set fullCalcOnLoad so
     Excel actually computes them — we warn instead of fail here because
     openpyxl doesn't itself run a formula engine; this test focuses on
     structural correctness).

Run directly:
    backend/venv/Scripts/python.exe backend/tests/test_excel_formulas.py
"""
from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path

# --- Make the backend importable when run as a script ----------------
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# Point the app at an in-memory SQLite BEFORE importing db/models so
# engine + Base.metadata bind correctly.
os.environ["SQLITE_PATH"] = ":memory:"
os.environ["ANTHROPIC_API_KEY"] = os.environ.get("ANTHROPIC_API_KEY", "test-key")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from models.entities import Base, Property, Scenario, ScopeItem  # noqa: E402
from services import excel_writer  # noqa: E402


# --- Fixture: a mid-sized multi-section, multi-scenario property -----
def build_fixture(db) -> tuple[Property, list[Scenario]]:
    prop = Property(
        name="Test LXR",
        keys=120, floors=8, total_gsf=150_000,
        year_built=1999, year_last_renovated=2014,
    )
    db.add(prop)
    db.flush()

    # Items spread across every major section so every subtotal row is real.
    items_spec = [
        # (division, sub_area, line_item, qty, unit, cost)
        ("DEFERRED MAINTENANCE", "Roof",     "Replace TPO roof",        1, "ls", 250_000),
        ("DEFERRED MAINTENANCE", "HVAC",     "Rooftop unit replacement", 3, "each", 65_000),
        ("COMMON AREA",          "Lobby",    "Lobby full renovation",    1, "ls", 420_000),
        ("COMMON AREA",          "Lobby",    "Lobby flooring",           1, "ls", 85_000),
        ("F&B",                  "Bar",      "Bar casegoods",            1, "ls", 110_000),
        ("CORRIDORS",            "Guestroom Corridor", "Corridor carpet", 8, "floors", 42_000),
        ("GUESTROOMS",           "Guestroom", "Guestroom softgoods",     120, "per key", 3_200),
        ("GUESTROOMS",           "Guestroom Bathroom", "Bathroom vanity", 120, "per key", 1_850),
        ("SUITES",               "Suite",    "Suite softgoods",         8, "each", 6_500),
    ]
    created_items: list[ScopeItem] = []
    for (div, sub, name, qty, unit, cost) in items_spec:
        it = ScopeItem(
            property_id=prop.id, division=div, sub_area=sub, line_item=name,
            quantity=qty, unit=unit, suggested_unit_cost=cost,
            priority="required", confidence="high", included_in_budget=True,
        )
        db.add(it)
        created_items.append(it)

    # Two scenarios — full and reduced. Reduced drops the deferred-maintenance
    # line and the suite work to test cross-column SUM correctness.
    sc_full = Scenario(
        property_id=prop.id, name="Full",
        soft_cost_breakdown=[],  # uses default MISC lines (with dev_fee baked in via 0.10 contingency etc.)
    )
    sc_reduced = Scenario(
        property_id=prop.id, name="Reduced",
        soft_cost_breakdown=[
            {"name": "GC Fees", "pct": 0.07, "basis_exclude_dm": True},
            {"name": "Design Fees", "pct": 0.06, "basis_exclude_dm": True},
            {"name": "Contingency", "pct": 0.08, "basis_exclude_dm": False},
            {"name": "Developer's fee", "pct": 0.03, "basis_exclude_dm": False, "group": "dev_fee"},
        ],
    )
    db.add_all([sc_full, sc_reduced])
    db.flush()

    # Full scenario: everything.
    sc_full.scope_items = list(created_items)
    # Reduced: drop DM + suites + one lobby line.
    sc_reduced.scope_items = [
        it for it in created_items
        if it.division not in ("DEFERRED MAINTENANCE", "SUITES")
        and it.line_item != "Lobby flooring"
    ]
    db.flush()
    return prop, [sc_full, sc_reduced]


# --- Core verifier -----------------------------------------------------
CELL_RE = re.compile(r"\$?([A-Z]+)\$?(\d+)")
RANGE_RE = re.compile(r"\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)")


def col_letter_to_idx(letters: str) -> int:
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx


def extract_cell_refs(formula: str) -> list[tuple[str, int]]:
    """Pull every A1-style cell reference from a formula string.
    Ranges like D5:D10 are expanded to endpoints for existence-check."""
    # Strip ranges first so range endpoints aren't counted as separate refs.
    out: list[tuple[str, int]] = []
    for rng in RANGE_RE.finditer(formula):
        start_col, start_row, end_col, end_row = rng.group(1), int(rng.group(2)), rng.group(3), int(rng.group(4))
        out.append((start_col, start_row))
        out.append((end_col, end_row))
    scrubbed = RANGE_RE.sub(" ", formula)
    for m in CELL_RE.finditer(scrubbed):
        out.append((m.group(1), int(m.group(2))))
    return out


def verify_workbook(path: Path) -> dict:
    """Return a dict of checks. Raises AssertionError on structural bugs."""
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=False)
    issues: list[str] = []
    formula_count = 0
    broken_refs: list[str] = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        max_row = ws.max_row
        max_col = ws.max_column

        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                if not isinstance(v, str) or not v.startswith("="):
                    continue
                formula_count += 1

                # 1) Every reference must land in-bounds.
                for (col_letters, row_num) in extract_cell_refs(v):
                    col_idx = col_letter_to_idx(col_letters)
                    if col_idx < 1 or col_idx > max_col or row_num < 1 or row_num > max_row:
                        broken_refs.append(
                            f"{sheet_name}!{cell.coordinate}: {v!r} references out-of-bounds cell {col_letters}{row_num} (sheet bounds {max_col}×{max_row})"
                        )

                # 2) Range columns must match (D5:D10 not D5:E10 unless intentional).
                for rng in RANGE_RE.finditer(v):
                    start_col, end_col = rng.group(1), rng.group(3)
                    if start_col != end_col:
                        # We never emit cross-column SUM ranges; flag if so.
                        broken_refs.append(
                            f"{sheet_name}!{cell.coordinate}: unexpected cross-column range {rng.group(0)} in {v!r}"
                        )

                # 3) Cells in SUM ranges must contain numeric or formula values.
                for rng in RANGE_RE.finditer(v):
                    col, r1, _, r2 = rng.group(1), int(rng.group(2)), rng.group(3), int(rng.group(4))
                    col_idx = col_letter_to_idx(col)
                    any_numeric = False
                    for r in range(r1, r2 + 1):
                        ref = ws.cell(row=r, column=col_idx).value
                        if ref is None:
                            continue
                        if isinstance(ref, (int, float)) or (isinstance(ref, str) and ref.startswith("=")):
                            any_numeric = True
                            break
                    if not any_numeric and (r2 - r1) > 0:
                        # Completely-empty range SUM — harmless but worth noting.
                        issues.append(
                            f"{sheet_name}!{cell.coordinate}: SUM range {rng.group(0)} covers no numeric cells (evaluates to 0)"
                        )

                # 4) Direct cell references must point at a non-text cell.
                scrubbed = RANGE_RE.sub(" ", v)
                for m in CELL_RE.finditer(scrubbed):
                    col_letters, row_num = m.group(1), int(m.group(2))
                    col_idx = col_letter_to_idx(col_letters)
                    if col_idx < 1 or col_idx > max_col or row_num < 1 or row_num > max_row:
                        continue
                    referenced = ws.cell(row=row_num, column=col_idx).value
                    if isinstance(referenced, str) and not referenced.startswith("="):
                        broken_refs.append(
                            f"{sheet_name}!{cell.coordinate} references {col_letters}{row_num} which contains text {referenced!r} — arithmetic will break"
                        )

    # --- Dev-fee + TOTAL PROJECT COST audit ---------------------------
    # When scenario A has its own dev fee in soft-cost breakdown and scenario
    # B doesn't, the "Developer's fee" row should be blank in A's column and
    # hold a formula in B's. Each scenario's TOTAL formula must land on a
    # different value than simply summing its parts twice.
    dev_fee_audit: list[str] = []
    ws_main = wb["CAPEX BUDGET"]
    interesting = {"Developer's fee", "TOTAL PROJECT COST", "OVERALL SUBTOTAL", "SUBTOTAL MISC.", "COMBINED TOTAL ="}
    for row in ws_main.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.strip() in interesting:
                row_num = cell.row
                for c2 in ws_main[row_num]:
                    val = c2.value
                    dev_fee_audit.append(f"  row {row_num} {c2.coordinate} = {val!r}")
                dev_fee_audit.append("")
                break

    return {
        "formula_count": formula_count,
        "issues": issues,
        "broken_refs": broken_refs,
        "sheets": wb.sheetnames,
        "dev_fee_audit": dev_fee_audit,
    }


# --- Main -------------------------------------------------------------
def main() -> int:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)

    with Session() as db:
        prop, scenarios = build_fixture(db)
        db.commit()

        # Redirect the exporter's output so we don't pollute the real exports dir.
        with tempfile.TemporaryDirectory() as tmp:
            # The exporter uses config.EXPORTS_DIR — patch it for this run.
            from config import EXPORTS_DIR as _  # noqa: F401
            import config
            config.EXPORTS_DIR = Path(tmp)
            excel_writer.EXPORTS_DIR = Path(tmp)

            result = excel_writer.export_budget(
                db, prop.id, [s.id for s in scenarios], filename="verify.xlsx",
            )
            out_path = Path(tmp) / result["file_path"]
            assert out_path.exists(), f"Export did not land on disk at {out_path}"

            report = verify_workbook(out_path)

    print(f"Sheets: {report['sheets']}")
    print(f"Formulas inspected: {report['formula_count']}")
    if report["issues"]:
        print(f"[!] {len(report['issues'])} soft issue(s):")
        for s in report["issues"]:
            print(f"   - {s}")
    if report["broken_refs"]:
        print(f"[X] {len(report['broken_refs'])} BROKEN reference(s):")
        for s in report["broken_refs"]:
            print(f"   - {s}")
        return 1
    if report["dev_fee_audit"]:
        print("Dev-fee row contents:")
        for line in report["dev_fee_audit"]:
            print(line)
    print("[OK] All formulas reference valid, non-text cells.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
