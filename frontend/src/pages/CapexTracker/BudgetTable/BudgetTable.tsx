import { useEffect, useMemo, useRef, useState } from "react";
import { capexApi, fmtMoney } from "../lib/capexApi";
import { useLocalStorageState } from "../lib/useLocalStorageState";
import { LINE_STATUS_OPTIONS, type BreakdownItem, type CapexLine, type CapexLineStatus } from "../lib/types";
import { allColumns, type ColumnDef, type ColumnId } from "./columns";
import {
  codeCompare,
  lineBalance,
  lineSpendToDate,
  lineYearForecast,
  lineYearProjected,
  lineYearSpend,
  statusLabel,
  statusPillClasses,
} from "./helpers";
import { BudgetGeneratorImportModal } from "./BudgetGeneratorImportModal";
import { CashflowView } from "./CashflowView";
import { EditableCell } from "./EditableCell";
import { InvoicesView } from "./InvoicesView";
import { NewLineModal, RowEditModal } from "./RowEditModal";
import { UploadBudgetModal } from "./UploadBudgetModal";
import type { CapexProject } from "../lib/types";

const CURRENT_YEAR = new Date().getFullYear();

type SortDir = "asc" | "desc";
type SortState = { columnId: ColumnId; dir: SortDir } | null;

type TablePrefs = {
  hiddenColumns?: ColumnId[];
  columnWidthOverrides?: Record<string, number>;
  sort?: SortState;
};

const PREFS_KEY_PREFIX = "capex-tracker-budget-prefs:";

function loadTablePrefs(hotelId: string): TablePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY_PREFIX + hotelId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveTablePrefs(hotelId: string, prefs: TablePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY_PREFIX + hotelId, JSON.stringify(prefs));
  } catch {
    // Quota / private mode — silent fail is fine; prefs just won't survive.
  }
}


export function BudgetTable({
  hotelId,
  yearStart,
  yearEnd,
  project,
  onUploadInvoice,
  onUploadContract,
  refreshKey,
}: {
  hotelId: string;
  yearStart: number;
  yearEnd: number;
  /** Required for the Invoices view which queries invoices project-wide. */
  project: CapexProject;
  /** Optional — when supplied, the combined Upload menu surfaces these
   *  alongside Upload Budget. Wired by HotelView/SingleHotelLanding so the
   *  three upload modals share one trigger on the toolbar. */
  onUploadInvoice?: () => void;
  onUploadContract?: () => void;
  /** Bumped by the parent after an upload so we refetch lines without
   *  unmounting — preserves the active view tab and any in-flight UI state. */
  refreshKey?: number;
}) {
  const [lines, setLines] = useState<CapexLine[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  // Persist the active view tab per hotel so navigating away and back
  // (or refreshing the page) returns to whichever tab the user was on.
  const [view, setView] = useLocalStorageState<"budget" | "cashflow" | "invoices">(
    `capex-view-tab:${hotelId}`,
    "budget",
  );
  const [editMode, setEditMode] = useState(false);

  const allColumnDefs = useMemo(() => allColumns(yearStart, yearEnd), [yearStart, yearEnd]);
  // Per-hotel persisted prefs: hidden columns, column widths, sort. Loaded
  // synchronously on first render so the table never flashes a default state
  // before the saved preferences kick in.
  const prefs = useMemo(() => loadTablePrefs(hotelId), [hotelId]);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(
    () => new Set<ColumnId>(prefs.hiddenColumns ?? []),
  );
  const [sort, setSort] = useState<SortState>(prefs.sort ?? { columnId: "code", dir: "asc" });
  const [groupFilter, setGroupFilter] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>("");
  // Bulk-select mode: lets the assistant pick several lines and apply a
  // status change in one shot. Toggled from the Edit menu.
  const [selectionMode, setSelectionMode] = useState<boolean>(false);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState<boolean>(false);
  // Per-column pixel width overrides set by drag-resize handles on the headers.
  // When present, take precedence over the formula width.
  const [columnWidthOverrides, setColumnWidthOverrides] = useState<Record<string, number>>(
    prefs.columnWidthOverrides ?? {},
  );

  // Persist preferences whenever they change so the next visit reads them back.
  useEffect(() => {
    saveTablePrefs(hotelId, {
      hiddenColumns: Array.from(hiddenColumns),
      columnWidthOverrides,
      sort,
    });
  }, [hotelId, hiddenColumns, columnWidthOverrides, sort]);
  // The global width slider was removed in favor of per-column drag handles —
  // a fixed adjust=0 keeps the formula widths as the default starting point.
  const widthAdjust = 0;

  function setColumnOverride(columnId: ColumnId, width: number) {
    setColumnWidthOverrides((prev) => ({ ...prev, [columnId]: Math.max(60, width) }));
  }
  function clearColumnOverride(columnId: ColumnId) {
    setColumnWidthOverrides((prev) => {
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    capexApi
      .listLines(hotelId)
      .then((rows) => {
        if (!cancelled) setLines(rows);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [hotelId, refreshKey]);

  const columns = useMemo(
    () => allColumnDefs.filter((c) => !hiddenColumns.has(c.id)),
    [allColumnDefs, hiddenColumns],
  );

  // Discover unique groups + categories for filter UI.
  const availableGroups = useMemo(() => {
    const s = new Set<string>();
    (lines ?? []).forEach((l) => s.add((l.group ?? "").trim() || "(ungrouped)"));
    return Array.from(s).sort();
  }, [lines]);
  const availableCategories = useMemo(() => {
    const s = new Set<string>();
    (lines ?? []).forEach((l) => s.add((l.category ?? "").trim() || "(uncategorized)"));
    return Array.from(s).sort();
  }, [lines]);

  // Apply filters + sort.
  const filteredSortedLines = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let arr = (lines ?? []).filter((l) => {
      const g = (l.group ?? "").trim() || "(ungrouped)";
      const c = (l.category ?? "").trim() || "(uncategorized)";
      if (groupFilter.size > 0 && !groupFilter.has(g)) return false;
      if (categoryFilter.size > 0 && !categoryFilter.has(c)) return false;
      if (q) {
        const haystack = [l.code, l.description, l.project_name, l.vendor, l.group, l.category, l.notes]
          .map((s) => (s ?? "").toLowerCase())
          .join("  ");
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    if (sort) {
      const dirMul = sort.dir === "asc" ? 1 : -1;
      arr = [...arr].sort((a, b) => {
        const av = sortValue(a, sort.columnId);
        const bv = sortValue(b, sort.columnId);
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dirMul;
        if (sort.columnId === "code") return codeCompare(String(av), String(bv)) * dirMul;
        return String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true, sensitivity: "base" }) * dirMul;
      });
    }
    return arr;
  }, [lines, groupFilter, categoryFilter, searchQuery, sort]);

  const editingLine = lines?.find((l) => l.id === editingId) ?? null;

  function toggleHidden(id: ColumnId) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setSortFor(columnId: ColumnId) {
    setSort((prev) => {
      if (!prev || prev.columnId !== columnId) return { columnId, dir: "asc" };
      if (prev.dir === "asc") return { columnId, dir: "desc" };
      return null;
    });
  }

  function toggleGroupFilter(g: string) {
    setGroupFilter((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }
  function toggleCategoryFilter(c: string) {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  function clearFilters() {
    setGroupFilter(new Set());
    setCategoryFilter(new Set());
    setSearchQuery("");
  }

  function onLineSaved(updated: CapexLine) {
    setLines((prev) => (prev ?? []).map((l) => (l.id === updated.id ? updated : l)));
    setEditingId(null);
  }

  function onLineDeleted(id: string) {
    setLines((prev) => (prev ?? []).filter((l) => l.id !== id));
    setEditingId(null);
  }

  function onLineCreated(line: CapexLine) {
    setLines((prev) => [...(prev ?? []), line]);
    setAdding(false);
  }

  function toggleLineSelection(id: string) {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedLineIds(new Set());
  }

  async function applyBulkStatus(status: CapexLineStatus | null) {
    const ids = Array.from(selectedLineIds);
    if (ids.length === 0) return;
    setBulkSaving(true);
    try {
      const updated = await Promise.all(
        ids.map((id) => capexApi.updateLine(id, { status })),
      );
      setLines((prev) =>
        (prev ?? []).map((l) => updated.find((u) => u.id === l.id) ?? l),
      );
      exitSelectionMode();
    } catch (e) {
      console.error("[bulk status] failed", e);
    } finally {
      setBulkSaving(false);
    }
  }

  function onLinesUploaded(created: CapexLine[]) {
    setLines((prev) => [...(prev ?? []), ...created]);
    setUploading(false);
  }

  function onLinesImported(created: CapexLine[]) {
    setLines((prev) => [...(prev ?? []), ...created]);
    setImporting(false);
  }

  if (loadError) {
    return <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">{loadError}</div>;
  }
  if (lines === null) {
    return <div className="text-sm text-gencom-stone">Loading lines…</div>;
  }

  const filtersActive =
    groupFilter.size > 0 || categoryFilter.size > 0 || searchQuery.trim() !== "";

  return (
    <div className="space-y-2">
      {view === "cashflow" ? (
        <CashflowView
          hotelId={hotelId}
          projectId={project.id}
          lines={lines}
          yearStart={yearStart}
          yearEnd={yearEnd}
          monthStart={project.month_start ?? undefined}
          monthEnd={project.month_end ?? undefined}
          view={view}
          setView={setView}
          onLineUpdated={(updated) =>
            setLines((prev) => (prev ?? []).map((l) => (l.id === updated.id ? updated : l)))
          }
        />
      ) : view === "invoices" ? (
        <InvoicesView
          project={project}
          hotelId={hotelId}
          hotelLineIds={new Set((lines ?? []).map((l) => l.id))}
          hotelLines={lines ?? []}
          yearStart={yearStart}
          yearEnd={yearEnd}
          view={view}
          setView={setView}
          refreshKey={refreshKey}
          onUploadInvoice={onUploadInvoice}
        />
      ) : (
        <>
      <Toolbar
        view={view}
        setView={setView}
        onAdd={() => setAdding(true)}
        onUploadBudget={() => setUploading(true)}
        onUploadInvoice={onUploadInvoice}
        onUploadContract={onUploadContract}
        onImport={() => setImporting(true)}
        editMode={editMode}
        toggleEditMode={() => setEditMode((v) => !v)}
        availableGroups={availableGroups}
        availableCategories={availableCategories}
        groupFilter={groupFilter}
        categoryFilter={categoryFilter}
        toggleGroupFilter={toggleGroupFilter}
        toggleCategoryFilter={toggleCategoryFilter}
        clearFilters={clearFilters}
        filtersActive={filtersActive}
        allColumnDefs={allColumnDefs}
        hiddenColumns={hiddenColumns}
        toggleHidden={toggleHidden}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectionMode={selectionMode}
        onToggleSelectionMode={() => {
          if (selectionMode) exitSelectionMode();
          else {
            setSelectionMode(true);
            setSelectedLineIds(new Set());
          }
        }}
      />

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedLineIds.size}
          totalLines={(lines ?? []).length}
          allSelectedInView={
            filteredSortedLines.length > 0 &&
            filteredSortedLines.every((l) => selectedLineIds.has(l.id))
          }
          onSelectAllVisible={(checked) => {
            setSelectedLineIds((prev) => {
              const next = new Set(prev);
              if (checked) {
                for (const l of filteredSortedLines) next.add(l.id);
              } else {
                for (const l of filteredSortedLines) next.delete(l.id);
              }
              return next;
            });
          }}
          onApplyStatus={applyBulkStatus}
          onCancel={exitSelectionMode}
          saving={bulkSaving}
        />
      )}

      <div className="overflow-x-auto rounded-xl border-2 border-gencom-sand bg-white">
        <table
          className="w-full text-xs border-collapse"
          style={{ minWidth: `${tableMinWidth(columns, widthAdjust, columnWidthOverrides)}px`, tableLayout: "fixed" }}
        >
          <colgroup>
            {selectionMode && <col style={{ width: "32px" }} />}
            {columns.map((c) => (
              <col
                key={c.id}
                style={{ width: `${effectiveColumnWidth(c, widthAdjust, columnWidthOverrides)}px` }}
              />
            ))}
            <col style={{ width: "40px" }} />
          </colgroup>
          <thead className="bg-gencom-mist/60 text-[11px] uppercase tracking-wider text-gencom-stone">
            <tr>
              {selectionMode && (
                <th className="px-2 py-2 border-b border-gencom-sand">
                  <input
                    type="checkbox"
                    checked={
                      filteredSortedLines.length > 0 &&
                      filteredSortedLines.every((l) => selectedLineIds.has(l.id))
                    }
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedLineIds((prev) => {
                        const next = new Set(prev);
                        if (checked) for (const l of filteredSortedLines) next.add(l.id);
                        else for (const l of filteredSortedLines) next.delete(l.id);
                        return next;
                      });
                    }}
                    aria-label="Select all visible"
                    className="h-3.5 w-3.5 cursor-pointer"
                  />
                </th>
              )}
              {columns.map((c) => (
                <SortableHeader
                  key={c.id}
                  col={c}
                  sort={sort}
                  onClick={() => c.sortable && setSortFor(c.id)}
                  currentWidth={effectiveColumnWidth(c, widthAdjust, columnWidthOverrides)}
                  onResize={(w) => setColumnOverride(c.id, w)}
                  onResetWidth={() => clearColumnOverride(c.id)}
                />
              ))}
              <th className="w-10 px-2 py-2 border-b border-gencom-sand"></th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1 + (selectionMode ? 1 : 0)} className="px-6 py-12 text-center">
                  <div className="text-gencom-stone text-sm mb-2">No lines yet.</div>
                  <p className="text-xs text-gencom-stone/80 max-w-md mx-auto">
                    Upload an existing budget to auto-populate scope, cost breakdown, budget, and vendor — or add lines manually.
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                    <button
                      onClick={() => setUploading(true)}
                      className="text-xs px-4 py-2 rounded-md bg-gencom-green text-white font-semibold hover:bg-gencom-green"
                    >
                      📄 Upload budget
                    </button>
                    <button
                      onClick={() => setImporting(true)}
                      className="text-xs px-4 py-2 rounded-md border border-gencom-gold bg-gencom-gold/10 text-gencom-ink font-semibold hover:bg-gencom-gold/20"
                    >
                      ⇄ Import from Budget Generator
                    </button>
                    <button
                      onClick={() => setAdding(true)}
                      className="text-xs px-4 py-2 rounded-md border border-gencom-sand text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
                    >
                      + Add line manually
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {filteredSortedLines.length === 0 && lines.length > 0 && (
              <tr>
                <td colSpan={columns.length + 1 + (selectionMode ? 1 : 0)} className="px-6 py-10 text-center text-sm text-gencom-stone">
                  No lines match the active filters.
                </td>
              </tr>
            )}
            {filteredSortedLines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                columns={columns}
                expanded={expandedLineId === line.id}
                onToggleExpand={() =>
                  setExpandedLineId((prev) => (prev === line.id ? null : line.id))
                }
                onEdit={() => setEditingId(line.id)}
                editMode={editMode}
                onCommitField={async (field, value) => {
                  try {
                    const updated = await capexApi.updateLine(line.id, { [field]: value } as Partial<CapexLine>);
                    setLines((prev) => (prev ?? []).map((l) => (l.id === updated.id ? updated : l)));
                  } catch (e) {
                    console.error("[budget] inline commit failed", e);
                  }
                }}
                selectionMode={selectionMode}
                selected={selectedLineIds.has(line.id)}
                onToggleSelected={() => toggleLineSelection(line.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
        </>
      )}

      {editingLine && (
        <RowEditModal
          line={editingLine}
          yearStart={yearStart}
          yearEnd={yearEnd}
          project={project}
          allLines={lines ?? []}
          onClose={() => setEditingId(null)}
          onSaved={onLineSaved}
          onDeleted={onLineDeleted}
          onLinesChanged={(updated) => {
            if (updated.length === 0) return;
            setLines((prev) => {
              const idx = new Map(updated.map((u) => [u.id, u]));
              const base = prev ?? [];
              const merged = base.map((l) => idx.get(l.id) ?? l);
              const known = new Set(base.map((l) => l.id));
              for (const u of updated) {
                if (!known.has(u.id)) merged.push(u);
              }
              return merged;
            });
          }}
        />
      )}
      {adding && (
        <NewLineModal
          hotelId={hotelId}
          existingVendors={Array.from(
            new Set(
              (lines ?? [])
                .map((l) => (l.vendor ?? "").trim())
                .filter((v): v is string => !!v),
            ),
          ).sort((a, b) => a.localeCompare(b))}
          onClose={() => setAdding(false)}
          onCreated={onLineCreated}
        />
      )}
      {uploading && (
        <UploadBudgetModal
          hotelId={hotelId}
          existingLines={lines ?? []}
          onClose={() => setUploading(false)}
          onCreated={onLinesUploaded}
          onAppliedToLine={(updated) => {
            setLines((prev) => (prev ?? []).map((l) => (l.id === updated.id ? updated : l)));
            setUploading(false);
          }}
          onMerged={({ created, updated }) => {
            setLines((prev) => {
              const base = prev ?? [];
              const idx = new Map(updated.map((u) => [u.id, u]));
              const merged = base.map((l) => idx.get(l.id) ?? l);
              return [...merged, ...created];
            });
            setUploading(false);
          }}
        />
      )}
      {importing && (
        <BudgetGeneratorImportModal
          hotelId={hotelId}
          onClose={() => setImporting(false)}
          onImported={onLinesImported}
        />
      )}
    </div>
  );
}


/** Per-column pixel width derived from defaultWeight × the user's slider.
 *  Slider is in [-100, +100]:
 *    -100 → text columns shrink (more compact)
 *    +100 → text columns widen (more spacious)
 *  Year columns nudge in the opposite direction so the user's adjustment
 *  trades width between them.
 */
function columnPxWidth(c: ColumnDef, widthAdjust: number): number {
  const baseUnit = 80; // px per defaultWeight unit at adjust=0
  const isYear = c.variant === "year";
  // Map slider -100..+100 to a 0.6..1.6 multiplier.
  const adj = widthAdjust / 100; // -1..+1
  const textMul = 1 + adj * 0.6;
  const yearMul = 1 - adj * 0.4;
  const mul = isYear ? yearMul : textMul;
  // Don't let any column collapse below 60px.
  return Math.max(60, Math.round(c.defaultWeight * baseUnit * mul));
}

function effectiveColumnWidth(
  c: ColumnDef,
  widthAdjust: number,
  overrides: Record<string, number>,
): number {
  const o = overrides[c.id];
  if (typeof o === "number" && Number.isFinite(o)) return Math.max(60, o);
  return columnPxWidth(c, widthAdjust);
}

function tableMinWidth(
  columns: ColumnDef[],
  widthAdjust: number,
  overrides: Record<string, number> = {},
): number {
  const cols = columns.reduce((acc, c) => acc + effectiveColumnWidth(c, widthAdjust, overrides), 0);
  return cols + 40;
}


function sortValue(line: CapexLine, columnId: ColumnId): string | number {
  switch (columnId) {
    case "code":
      return line.code ?? "";
    case "group":
      return line.group ?? "";
    case "category":
      return line.category ?? "";
    case "project_name":
      return line.project_name ?? "";
    case "vendor":
      return line.vendor ?? "";
    case "description":
      return line.description ?? "";
    case "status":
      return line.status ?? "";
    case "original_total_budget":
      return line.original_total_budget ?? 0;
    case "forecast_total_budget":
      return line.forecast_total_budget ?? 0;
    case "balance":
      return lineBalance(line);
    case "notes":
      return line.notes ?? "";
    default:
      if (typeof columnId === "string" && columnId.startsWith("year_")) {
        const year = Number(columnId.slice(5));
        return lineYearSpend(line, year) || lineYearForecast(line, year);
      }
      return "";
  }
}


/** Stand-alone view-tabs strip with optional left/right slots. Uses the
 *  same 3-column grid as the Budget toolbar so the centered tabs sit at
 *  exactly the same horizontal position no matter what side controls a
 *  given view renders. Pass leftExtras/rightExtras to embed view-specific
 *  controls (e.g. Cashflow's year picker) inside the same bubble. */
export function ViewTabsBar({
  view,
  setView,
  leftExtras,
  rightExtras,
  showLabel = true,
}: {
  view: "budget" | "cashflow" | "invoices";
  setView: (v: "budget" | "cashflow" | "invoices") => void;
  leftExtras?: React.ReactNode;
  rightExtras?: React.ReactNode;
  /** Hide the "Table view" eyebrow label. Cashflow uses this to keep the
   *  toolbar compact since its year buttons are self-explanatory. */
  showLabel?: boolean;
}) {
  return (
    <div className="grid items-center gap-4 px-1 py-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        {showLabel && (
          <span className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold">
            Table view
          </span>
        )}
        {leftExtras}
      </div>
      <div className="flex justify-center">
        <ViewTabs view={view} setView={setView} />
      </div>
      <div className="flex items-center justify-end gap-3 flex-wrap min-w-0">
        {rightExtras}
      </div>
    </div>
  );
}


/** Just the three Budget/Cashflow/Invoices buttons, no surrounding bubble.
 *  Drop-in for any toolbar that wants to embed the switcher. */
export function ViewTabs({
  view,
  setView,
}: {
  view: "budget" | "cashflow" | "invoices";
  setView: (v: "budget" | "cashflow" | "invoices") => void;
}) {
  return (
    <div className="inline-flex rounded-md border-2 border-gencom-sand bg-white overflow-hidden t-eyebrow uppercase">
      {([
        { id: "budget", label: "Budget" },
        { id: "cashflow", label: "Cashflow" },
        { id: "invoices", label: "Invoices" },
      ] as const).map((v, i) => (
        <button
          key={v.id}
          onClick={() => setView(v.id)}
          className={`w-28 py-1.5 text-center transition uppercase tracking-wider ${i > 0 ? "border-l-2 border-gencom-sand" : ""} ${
            view === v.id
              ? "bg-gencom-green text-white"
              : "text-gencom-stone hover:text-gencom-green hover:bg-gencom-greensoft"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}


function Toolbar({
  view,
  setView,
  onAdd,
  onUploadBudget,
  onUploadInvoice,
  onUploadContract,
  onImport,
  editMode,
  toggleEditMode,
  availableGroups,
  availableCategories,
  groupFilter,
  categoryFilter,
  toggleGroupFilter,
  toggleCategoryFilter,
  clearFilters,
  filtersActive,
  allColumnDefs,
  hiddenColumns,
  toggleHidden,
  searchQuery,
  setSearchQuery,
  selectionMode,
  onToggleSelectionMode,
}: {
  view: "budget" | "cashflow" | "invoices";
  setView: (v: "budget" | "cashflow" | "invoices") => void;
  onAdd: () => void;
  onUploadBudget: () => void;
  onUploadInvoice?: () => void;
  onUploadContract?: () => void;
  onImport: () => void;
  editMode: boolean;
  toggleEditMode: () => void;
  availableGroups: string[];
  availableCategories: string[];
  groupFilter: Set<string>;
  categoryFilter: Set<string>;
  toggleGroupFilter: (g: string) => void;
  toggleCategoryFilter: (c: string) => void;
  clearFilters: () => void;
  filtersActive: boolean;
  allColumnDefs: ColumnDef[];
  hiddenColumns: Set<ColumnId>;
  toggleHidden: (id: ColumnId) => void;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
}) {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  // Budget-only controls (filter, columns, edit, import, upload, add line)
  // collapse to nothing on the cashflow/invoices views — only the view tabs
  // and the "Table view" label remain to anchor the toolbar.
  const showBudgetControls = view === "budget";
  return (
    <div className="space-y-3">
      {/* Three-column grid: left, centered tabs, right. The tabs sit in their
          own auto-sized middle column with 1fr on each side, so they remain
          visually centered no matter how heavy the side controls are. This
          stops the tab strip from drifting when switching views. */}
      <div className="grid items-center gap-4 px-1 py-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {showBudgetControls && (
            <>
              {/* Filter / Columns / Search — same height (h-9), shared
                  borders, search expands within the available width. */}
              <div className="relative">
                <button
                  onClick={() => setFilterMenuOpen((o) => !o)}
                  className={`inline-flex items-center gap-1.5 text-xs h-9 px-3 rounded-md border transition w-28 justify-center ${
                    filtersActive
                      ? "border-gencom-gold bg-gencom-gold/10 text-gencom-ink font-semibold"
                      : "border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
                  }`}
                  title="Filter visible lines by group and category"
                >
                  <span aria-hidden>⏵</span> Filter
                </button>
                {filterMenuOpen && (
                  <FilterMenu
                    onClose={() => setFilterMenuOpen(false)}
                    availableGroups={availableGroups}
                    availableCategories={availableCategories}
                    groupFilter={groupFilter}
                    categoryFilter={categoryFilter}
                    toggleGroupFilter={toggleGroupFilter}
                    toggleCategoryFilter={toggleCategoryFilter}
                    clearFilters={clearFilters}
                  />
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setColumnsMenuOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 text-xs h-9 px-3 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone w-28 justify-center"
                  title="Show or hide columns"
                >
                  <span aria-hidden>☰</span> Columns
                </button>
                {columnsMenuOpen && (
                  <ColumnsMenu
                    onClose={() => setColumnsMenuOpen(false)}
                    allColumnDefs={allColumnDefs}
                    hiddenColumns={hiddenColumns}
                    toggleHidden={toggleHidden}
                  />
                )}
              </div>
              <div className="relative">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search…"
                  aria-label="Search code, description, vendor"
                  title="Search code, description, vendor, group, category, or notes"
                  className="text-xs h-9 pl-7 pr-7 rounded-md border border-gencom-sand bg-white text-gencom-ink placeholder:text-gencom-stone/70 focus:outline-none focus:ring-2 focus:ring-gencom-gold/30 focus:border-gencom-gold/60 w-28"
                />
                <span aria-hidden className="absolute left-2 top-1/2 -translate-y-1/2 text-gencom-stone text-xs">⌕</span>
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gencom-stone hover:text-gencom-ink text-xs"
                  >
                    ×
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex justify-center">
          <ViewTabs view={view} setView={setView} />
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap min-w-0">
          {showBudgetControls && (
            <EditMenu
              editMode={editMode}
              toggleEditMode={toggleEditMode}
              onAdd={onAdd}
              selectionMode={selectionMode}
              onToggleSelectionMode={onToggleSelectionMode}
              onUploadBudget={onUploadBudget}
              onUploadInvoice={onUploadInvoice}
              onUploadContract={onUploadContract}
              onImport={onImport}
            />
          )}
        </div>
      </div>
    </div>
  );
}


function EditMenu({
  editMode,
  toggleEditMode,
  onAdd,
  selectionMode,
  onToggleSelectionMode,
  onUploadBudget,
  onUploadInvoice,
  onUploadContract,
  onImport,
}: {
  editMode: boolean;
  toggleEditMode: () => void;
  onAdd: () => void;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
  onUploadBudget: () => void;
  onUploadInvoice?: () => void;
  onUploadContract?: () => void;
  onImport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const isActive = editMode || selectionMode;
  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className={`text-xs h-9 px-3 rounded-md border whitespace-nowrap inline-flex items-center gap-1.5 ${
            isActive
              ? "border-gencom-green bg-gencom-green text-white font-semibold hover:bg-gencom-green"
              : "border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
          }`}
          title="Edit cells, add a line, edit multiple, or upload"
        >
          <span aria-hidden>✎</span> Edit <span className="text-[9px] opacity-70">▾</span>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute z-50 mt-1 right-0 w-72 bg-white rounded-md border border-gencom-sand shadow-xl py-1.5">
              <button
                onClick={() => {
                  setOpen(false);
                  toggleEditMode();
                }}
                className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition flex items-start gap-3"
              >
                <span className="text-lg leading-none mt-0.5">{editMode ? "✓" : "✎"}</span>
                <span className="flex-1 min-w-0">
                  <span className="block t-body font-semibold">
                    {editMode ? "Stop inline edit" : "Inline edit"}
                  </span>
                  <span className="block t-micro leading-snug">
                    Click any cell to change values without opening the row modal.
                  </span>
                </span>
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onAdd();
                }}
                className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition flex items-start gap-3"
              >
                <span className="text-lg leading-none mt-0.5">＋</span>
                <span className="flex-1 min-w-0">
                  <span className="block t-body font-semibold">Add line</span>
                  <span className="block t-micro leading-snug">
                    Insert a new budget line manually.
                  </span>
                </span>
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  onToggleSelectionMode();
                }}
                className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition flex items-start gap-3"
              >
                <span className="text-lg leading-none mt-0.5">{selectionMode ? "✕" : "☑"}</span>
                <span className="flex-1 min-w-0">
                  <span className="block t-body font-semibold">
                    {selectionMode ? "Exit multi-select" : "Edit multiple"}
                  </span>
                  <span className="block t-micro leading-snug">
                    Pick several lines and bulk-update their status (e.g. mark several Completed).
                  </span>
                </span>
              </button>
              <div className="my-1 border-t border-gencom-sand/60" />
              <button
                onClick={() => {
                  setOpen(false);
                  setChooserOpen(true);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition flex items-start gap-3"
              >
                <span className="text-lg leading-none mt-0.5">📤</span>
                <span className="flex-1 min-w-0">
                  <span className="block t-body font-semibold">Upload</span>
                  <span className="block t-micro leading-snug">
                    Budget, invoice, contract / proposal, or import from another property.
                  </span>
                </span>
              </button>
            </div>
          </>
        )}
      </div>

      {chooserOpen && (
        <UploadChooserModal
          onClose={() => setChooserOpen(false)}
          onPick={(kind) => {
            setChooserOpen(false);
            if (kind === "budget") onUploadBudget();
            else if (kind === "invoice") onUploadInvoice?.();
            else if (kind === "contract") onUploadContract?.();
            else if (kind === "import") onImport();
          }}
          allowInvoice={!!onUploadInvoice}
          allowContract={!!onUploadContract}
        />
      )}
    </>
  );
}


type UploadKind = "budget" | "invoice" | "contract" | "import";

function UploadChooserModal({
  onClose,
  onPick,
  allowInvoice,
  allowContract,
}: {
  onClose: () => void;
  onPick: (kind: UploadKind) => void;
  allowInvoice: boolean;
  allowContract: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tiles: Array<{
    kind: UploadKind;
    label: string;
    icon: string;
    blurb: string;
    accept?: string;
    disabled?: boolean;
    droppable: boolean;
  }> = [
    {
      kind: "budget",
      label: "Budget",
      icon: "📄",
      blurb: "Existing capex budget — PDF, Excel, or DOCX.",
      accept: ".pdf,.xlsx,.xls,.docx",
      droppable: true,
    },
    {
      kind: "invoice",
      label: "Invoice",
      icon: "🧾",
      blurb: "Vendor invoice — Claude auto-matches to a budget line.",
      accept: ".pdf,.png,.jpg,.jpeg",
      disabled: !allowInvoice,
      droppable: true,
    },
    {
      kind: "contract",
      label: "Contract / Proposal",
      icon: "📑",
      blurb: "Executed contract, agreement, or proposal — attach to a line.",
      accept: ".pdf,.docx",
      disabled: !allowContract,
      droppable: true,
    },
    {
      kind: "import",
      label: "Import from property",
      icon: "⇄",
      blurb: "Pull scope from a Budget Generator property — no file needed.",
      droppable: false,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl border border-gencom-sand shadow-2xl w-full max-w-3xl"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gencom-sand">
          <div>
            <div className="t-eyebrow">Upload</div>
            <div className="t-h2 mt-0.5">Choose what to upload</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gencom-stone hover:text-gencom-ink text-lg leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {tiles.map((t) => (
            <UploadChoiceTile
              key={t.kind}
              icon={t.icon}
              label={t.label}
              blurb={t.blurb}
              accept={t.accept}
              droppable={t.droppable}
              disabled={t.disabled}
              onPick={() => onPick(t.kind)}
            />
          ))}
        </div>
        <div className="px-5 py-2.5 border-t border-gencom-sand bg-gencom-mist/30 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs h-9 px-3 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}


function UploadChoiceTile({
  icon,
  label,
  blurb,
  accept,
  droppable,
  disabled,
  onPick,
}: {
  icon: string;
  label: string;
  blurb: string;
  accept?: string;
  droppable: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function clickTile() {
    if (disabled) return;
    if (droppable && inputRef.current) inputRef.current.click();
    else onPick();
  }

  function handleDrop(e: React.DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragOver(false);
    if (disabled || !droppable) return;
    // We can't reliably hand the file off to the underlying upload modal
    // without lifting state up, so for now treat the drop as the "open
    // this uploader" signal and let the modal's own drop zone take the
    // file again — friction is one re-drop, but the routing is correct.
    onPick();
  }

  return (
    <button
      type="button"
      onClick={clickTile}
      disabled={disabled}
      onDragOver={(e) => {
        if (disabled || !droppable) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={
        "text-left rounded-lg border-2 p-4 transition relative " +
        (disabled
          ? "border-gencom-sand bg-gencom-mist/20 text-gencom-stone/50 cursor-not-allowed"
          : dragOver
          ? "border-gencom-green bg-gencom-greensoft"
          : "border-dashed border-gencom-sand bg-white hover:border-gencom-green hover:bg-gencom-greensoft/40")
      }
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="t-body font-semibold text-gencom-ink">{label}</div>
          <div className="t-micro leading-snug mt-0.5 text-gencom-stone">{blurb}</div>
          {droppable && !disabled && (
            <div className="mt-2 text-[10px] uppercase tracking-wider text-gencom-stone/70">
              Click to browse · or drop a file
            </div>
          )}
          {!droppable && !disabled && (
            <div className="mt-2 text-[10px] uppercase tracking-wider text-gencom-stone/70">
              Click to choose property
            </div>
          )}
        </div>
      </div>
      {droppable && (
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={() => {
            // Same caveat as drop: route to the underlying uploader. The
            // user's chosen file isn't carried forward yet — they'll
            // re-pick or re-drop in the next modal. (Lifting file state
            // through every uploader is the cleanup if this becomes
            // annoying in practice.)
            onPick();
          }}
        />
      )}
    </button>
  );
}


function BulkActionBar({
  selectedCount,
  totalLines,
  allSelectedInView,
  onSelectAllVisible,
  onApplyStatus,
  onCancel,
  saving,
}: {
  selectedCount: number;
  totalLines: number;
  allSelectedInView: boolean;
  onSelectAllVisible: (checked: boolean) => void;
  onApplyStatus: (status: CapexLineStatus | null) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="rounded-md border border-gencom-green/20 bg-gencom-greensoft px-4 py-2 flex items-center gap-3 flex-wrap">
      <label className="inline-flex items-center gap-2 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allSelectedInView}
          onChange={(e) => onSelectAllVisible(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        <span className="text-gencom-ink">
          {allSelectedInView ? "Deselect all visible" : "Select all visible"}
        </span>
      </label>
      <span className="text-xs text-gencom-ink font-semibold">
        {selectedCount} selected
        <span className="text-gencom-stone font-normal"> of {totalLines}</span>
      </span>
      <div className="flex-1" />
      <span className="text-[11px] uppercase tracking-wider text-gencom-stone font-semibold">
        Mark as
      </span>
      {LINE_STATUS_OPTIONS.map((s) => (
        <button
          key={s}
          onClick={() => onApplyStatus(s)}
          disabled={selectedCount === 0 || saving}
          className="text-xs h-8 px-3 rounded-md border border-gencom-green/30 bg-white text-gencom-ink hover:bg-gencom-greensoft disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {s === "in-progress"
            ? "In-Progress"
            : s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      ))}
      <button
        onClick={() => onApplyStatus(null)}
        disabled={selectedCount === 0 || saving}
        className="text-xs h-8 px-3 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      >
        Clear status
      </button>
      <button
        onClick={onCancel}
        className="text-xs h-8 px-3 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone whitespace-nowrap"
      >
        Cancel
      </button>
    </div>
  );
}


function FilterMenu({
  onClose,
  availableGroups,
  availableCategories,
  groupFilter,
  categoryFilter,
  toggleGroupFilter,
  toggleCategoryFilter,
  clearFilters,
}: {
  onClose: () => void;
  availableGroups: string[];
  availableCategories: string[];
  groupFilter: Set<string>;
  categoryFilter: Set<string>;
  toggleGroupFilter: (g: string) => void;
  toggleCategoryFilter: (c: string) => void;
  clearFilters: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute z-50 mt-1 left-0 w-80 bg-white rounded-md border border-gencom-sand shadow-xl p-3 max-h-[60vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="t-eyebrow">Filter</span>
          <button onClick={clearFilters} className="text-[10px] uppercase tracking-wider text-gencom-stone hover:text-gencom-ink">
            Clear
          </button>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-gencom-stone mb-1 mt-2">Group</div>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {availableGroups.map((g) => (
            <button
              key={g}
              onClick={() => toggleGroupFilter(g)}
              className={`text-[11px] px-2 py-1 rounded-full border ${
                groupFilter.has(g)
                  ? "bg-gencom-green text-white border-gencom-green"
                  : "border-gencom-sand text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-gencom-stone mb-1">Category</div>
        <div className="flex flex-wrap gap-1.5">
          {availableCategories.map((c) => (
            <button
              key={c}
              onClick={() => toggleCategoryFilter(c)}
              className={`text-[11px] px-2 py-1 rounded-full border ${
                categoryFilter.has(c)
                  ? "bg-gencom-green text-white border-gencom-green"
                  : "border-gencom-sand text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}


function ColumnsMenu({
  onClose,
  allColumnDefs,
  hiddenColumns,
  toggleHidden,
}: {
  onClose: () => void;
  allColumnDefs: ColumnDef[];
  hiddenColumns: Set<ColumnId>;
  toggleHidden: (id: ColumnId) => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute z-50 mt-1 left-0 w-72 bg-white rounded-md border border-gencom-sand shadow-xl p-3 max-h-[60vh] overflow-y-auto">
        <div className="t-eyebrow mb-2">Visible columns</div>
        <div className="flex flex-wrap gap-1.5">
          {allColumnDefs.map((c) => {
            const visible = !hiddenColumns.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleHidden(c.id)}
                className={`text-[11px] px-2 py-1 rounded-full border ${
                  visible
                    ? "bg-gencom-green text-white border-gencom-green"
                    : "border-gencom-sand text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}


function SortableHeader({
  col,
  sort,
  onClick,
  currentWidth,
  onResize,
  onResetWidth,
}: {
  col: ColumnDef;
  sort: SortState;
  onClick: () => void;
  currentWidth: number;
  onResize: (px: number) => void;
  onResetWidth: () => void;
}) {
  const isSorted = sort?.columnId === col.id;

  function startDrag(e: React.PointerEvent) {
    // Don't let the parent <th>'s click handler fire (it'd toggle sort).
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = currentWidth;
    // Capture the pointer so move/up keep firing on the handle even when the
    // cursor briefly leaves its (narrow) bounds during a fast drag.
    const target = e.currentTarget as Element;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(ev: PointerEvent) {
      const next = startWidth + (ev.clientX - startX);
      onResize(next);
    }
    function onUp(ev: PointerEvent) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        target.releasePointerCapture(ev.pointerId);
      } catch {}
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <th
      className={`relative px-3 py-2 ${col.align === "right" ? "text-right" : "text-left"} font-semibold border-b border-gencom-sand align-bottom whitespace-normal break-words leading-tight ${
        col.sortable ? "cursor-pointer select-none hover:text-gencom-ink" : ""
      }`}
      onClick={col.sortable ? onClick : undefined}
    >
      {col.label}
      {col.sortable && (
        <span className={`ml-1 ${isSorted ? "text-gencom-ink" : "text-gencom-stone/30"}`}>
          {isSorted ? (sort?.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      )}
      {/* Drag-to-resize handle on the right edge. 10px wide so it's findable
          on hover (gold tint indicator) without being visually noisy at
          rest. Double-click resets the column width. */}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${col.label} column`}
        onPointerDown={startDrag}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onResetWidth();
        }}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-0 right-0 h-full w-2.5 cursor-col-resize z-10 hover:bg-gencom-gold/30"
        title="Drag to resize · double-click to reset"
      />
    </th>
  );
}


function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-[11px] uppercase tracking-wider text-gencom-stone font-semibold">
        {label}
      </div>
      <div className="font-display text-2xl md:text-3xl font-bold text-gencom-ink mt-1 tabular-nums">
        {fmtMoney(value)}
      </div>
    </div>
  );
}


function LineRow({
  line,
  columns,
  expanded,
  onToggleExpand,
  onEdit,
  editMode,
  onCommitField,
  selectionMode,
  selected,
  onToggleSelected,
}: {
  line: CapexLine;
  columns: ColumnDef[];
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  editMode: boolean;
  onCommitField: (field: keyof CapexLine, value: string | number | null) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
}) {
  const breakdown = line.breakdown ?? [];
  const hasBreakdown = breakdown.length > 0;
  const totalSpan = columns.length + 1 + (selectionMode ? 1 : 0);
  // Completed lines de-emphasize: dim the text but keep cells interactive
  // so the assistant can still edit, expand, and re-status the row.
  const isCompleted = line.status === "completed";

  function handleRowClick() {
    // Selection mode: row clicks toggle the checkbox instead of opening
    // the row modal. Inline edit mode also preempts the modal.
    if (selectionMode) {
      onToggleSelected?.();
      return;
    }
    if (editMode) return;
    onEdit();
  }

  return (
    <>
      <tr
        className={`border-t border-gencom-sand/60 group transition cursor-pointer ${
          expanded ? "bg-gencom-mist/40" : selected ? "bg-gencom-greensoft/60" : "hover:bg-gencom-mist/20"
        } ${isCompleted ? "text-gencom-stone/60" : ""}`}
        onClick={handleRowClick}
      >
        {selectionMode && (
          <td className="pl-3 pr-1 py-2 align-top w-7" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelected?.()}
              aria-label="Select line"
              className="h-3.5 w-3.5 cursor-pointer"
            />
          </td>
        )}
        {columns.map((c, i) => {
          const wrap = c.id === "description" || c.id === "notes";
          // overflow-hidden on every cell prevents content from bleeding into
          // the next column when the column is narrow. wrap-allowed columns
          // (description, notes) line-clamp inside the cell; everything else
          // uses truncate (ellipsis on overflow).
          const cellClasses =
            `px-3 py-2 align-top ${c.align === "right" ? "text-right" : "text-left"} ` +
            (c.variant === "year" ? "font-mono " : "") +
            (wrap ? "whitespace-normal " : "whitespace-nowrap truncate ") +
            "overflow-hidden";
          return (
            <td key={c.id} className={cellClasses}>
              {i === 0 ? (
                hasBreakdown ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpand();
                    }}
                    className="mr-1 text-gencom-gold hover:text-gencom-ink align-middle inline-block w-4"
                    title={expanded ? "Collapse breakdown" : "Expand breakdown"}
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="inline-block w-4" />
                )
              ) : null}
              {renderCell(line, c, editMode, onCommitField)}
              {i === 0 && hasBreakdown && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-gencom-gold align-middle">
                  {breakdown.length} items
                </span>
              )}
            </td>
          );
        })}
        <td className="px-2 py-2 text-right align-top">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="text-gencom-stone/40 group-hover:text-gencom-ink transition w-6 h-6 rounded hover:bg-gencom-mist"
            title="Edit line"
          >
            ✎
          </button>
        </td>
      </tr>
      {expanded && hasBreakdown && (
        <tr className="bg-gencom-mist/20">
          <td colSpan={totalSpan} className="px-6 py-3">
            <BreakdownTable items={breakdown} />
          </td>
        </tr>
      )}
    </>
  );
}


function BreakdownTable({ items }: { items: import("../lib/types").BreakdownItem[] }) {
  const subtotal = items.reduce((acc, it) => acc + (it.total ?? 0), 0);
  return (
    <div className="rounded-md border border-gencom-sand bg-white">
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gencom-stone border-b border-gencom-sand bg-gencom-mist/40">
        Cost breakdown
      </div>
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-gencom-stone/80">
          <tr>
            <th className="px-3 py-1.5 text-left font-semibold">Item</th>
            <th className="px-3 py-1.5 text-left font-semibold">Description</th>
            <th className="px-3 py-1.5 text-right font-semibold">Qty</th>
            <th className="px-3 py-1.5 text-left font-semibold">Unit</th>
            <th className="px-3 py-1.5 text-right font-semibold">Unit cost</th>
            <th className="px-3 py-1.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={idx} className="border-t border-gencom-sand/50">
              <td className="px-3 py-1.5">
                <div className="text-gencom-ink font-medium">{it.label}</div>
                {it.vendor && <div className="text-[10px] text-gencom-stone">{it.vendor}</div>}
              </td>
              <td className="px-3 py-1.5 text-gencom-stone">
                <div className="line-clamp-2 max-w-[280px]">{it.description ?? "—"}</div>
                {it.notes && <div className="text-[10px] italic text-gencom-stone/80 mt-0.5">{it.notes}</div>}
              </td>
              <td className="px-3 py-1.5 text-right text-gencom-stone">{it.qty ?? "—"}</td>
              <td className="px-3 py-1.5 text-gencom-stone">{it.unit ?? "—"}</td>
              <td className="px-3 py-1.5 text-right text-gencom-stone">{it.unit_cost != null ? fmtMoney(it.unit_cost) : "—"}</td>
              <td className="px-3 py-1.5 text-right text-gencom-ink font-semibold">{fmtMoney(it.total)}</td>
            </tr>
          ))}
          <tr className="border-t border-gencom-sand bg-gencom-mist/30">
            <td colSpan={5} className="px-3 py-1.5 text-right text-[11px] uppercase tracking-wider text-gencom-stone font-semibold">
              Breakdown subtotal
            </td>
            <td className="px-3 py-1.5 text-right text-gencom-ink font-bold">{fmtMoney(subtotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}


function renderCell(
  line: CapexLine,
  c: ColumnDef,
  editMode: boolean = false,
  onCommit: (field: keyof CapexLine, value: string | number | null) => void = () => {},
) {
  // The status pill is always interactive (with or without editMode) — it's
  // a tightly-bounded enum, so an inline dropdown is friendlier than forcing
  // the user to open the row modal just to flip a status.
  if (c.id === "status") {
    return (
      <StatusPicker
        value={line.status ?? null}
        onChange={(v) => onCommit("status", v)}
      />
    );
  }

  // Editable text + currency columns swap to an inline input when edit mode
  // is on. Non-editable columns (balance, year columns) render normally.
  if (editMode) {
    const textFields = ["code", "group", "category", "project_name", "vendor", "description", "notes"] as const;
    if ((textFields as readonly string[]).includes(c.id as string)) {
      const field = c.id as (typeof textFields)[number];
      return (
        <EditableCell
          value={line[field] ?? null}
          type="text"
          onCommit={(v) => onCommit(field, v)}
        />
      );
    }
    if (c.id === "original_total_budget" || c.id === "forecast_total_budget") {
      const field = c.id as "original_total_budget" | "forecast_total_budget";
      return (
        <EditableCell
          value={line[field] ?? 0}
          type="number"
          align="right"
          onCommit={(v) => onCommit(field, v)}
        />
      );
    }
    // Fall through to normal rendering for non-editable columns.
  }

  switch (c.id) {
    case "code":
      return line.code ?? "—";
    case "group":
      return line.group ?? "—";
    case "category":
      return line.category ?? "—";
    case "project_name":
      return line.project_name ?? "—";
    case "vendor":
      return line.vendor ?? "—";
    case "description":
      return (
        <span className="text-gencom-stone text-[12px] line-clamp-2">
          {line.description ?? "—"}
        </span>
      );
    case "original_total_budget":
      return fmtMoney(line.original_total_budget);
    case "forecast_total_budget":
      return fmtMoney(line.forecast_total_budget);
    case "balance": {
      const bal = lineBalance(line);
      return (
        <span className={bal < 0 ? "text-red-700 font-semibold" : ""}>{fmtMoney(bal)}</span>
      );
    }
    case "notes":
      return (
        <span className="text-gencom-stone/80 text-[12px] line-clamp-2">
          {line.notes ?? "—"}
        </span>
      );
    default:
      if (typeof c.id === "string" && c.id.startsWith("year_")) {
        const year = Number(c.id.slice(5));
        const spend = lineYearSpend(line, year);
        const forecast = lineYearForecast(line, year);
        if (year === CURRENT_YEAR) {
          const projected = lineYearProjected(line);
          // Spent on top (charcoal), projected below (muted gold) — same
          // info as before but stacked so both numbers are easier to read
          // and don't get squished in a narrow column.
          return (
            <span className="inline-flex flex-col items-end leading-tight">
              <span className="text-gencom-ink">{fmtMoney(spend)}</span>
              <span className="text-gencom-gold text-[11px]">{fmtMoney(projected)}</span>
            </span>
          );
        }
        const value = spend || forecast;
        return <span className={spend ? "text-gencom-ink" : "text-gencom-stone/70"}>{fmtMoney(value)}</span>;
      }
      return null;
  }
}


function StatusPicker({
  value,
  onChange,
}: {
  value: CapexLineStatus | null;
  onChange: (v: CapexLineStatus | null) => void;
}) {
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center rounded-full border text-[10px] uppercase tracking-wider font-semibold pl-2 pr-1 py-0.5 ${statusPillClasses(value)}`}
    >
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as CapexLineStatus | null)}
        className="bg-transparent outline-none border-0 text-[10px] uppercase tracking-wider font-semibold pr-3 cursor-pointer appearance-none"
        style={{ minWidth: "5.5rem" }}
        title="Set status"
      >
        <option value="">{statusLabel(null)}</option>
        {LINE_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {statusLabel(s)}
          </option>
        ))}
      </select>
    </span>
  );
}
