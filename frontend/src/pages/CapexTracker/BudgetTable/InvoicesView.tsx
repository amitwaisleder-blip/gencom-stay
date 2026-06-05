import { useEffect, useMemo, useState } from "react";
import { InvoiceEditModal } from "../invoices/InvoiceEditModal";
import { SplitsEditor } from "../invoices/InvoiceUploadModal";
import { capexApi, fmtDateShort, fmtMoney } from "../lib/capexApi";
import type { CapexInvoice, CapexLine, CapexProject, InvoiceSplit } from "../lib/types";
import { FieldLabel } from "../wizards/sharedWizardUI";
import { ViewTabs, ViewTabsBar } from "./BudgetTable";

// Column model for the invoices table — mirrors the Budget table's column
// system so we get sort + drag-to-resize for free per column.
type InvoiceColumnId =
  | "vendor"
  | "invoice_number"
  | "project_code"
  | "total_amount"
  | "invoice_date"
  | "date_paid"
  | "status";

type InvoiceColumnDef = {
  id: InvoiceColumnId;
  label: string;
  align: "left" | "right";
  defaultWidth: number;
  sortable: boolean;
};

const INVOICE_COLUMNS: InvoiceColumnDef[] = [
  { id: "project_code", label: "Code", align: "left", defaultWidth: 110, sortable: true },
  { id: "vendor", label: "Vendor", align: "left", defaultWidth: 220, sortable: true },
  { id: "invoice_number", label: "Invoice #", align: "left", defaultWidth: 130, sortable: true },
  { id: "total_amount", label: "Amount", align: "right", defaultWidth: 110, sortable: true },
  { id: "invoice_date", label: "Date received", align: "left", defaultWidth: 130, sortable: true },
  { id: "date_paid", label: "Date paid", align: "left", defaultWidth: 180, sortable: true },
  { id: "status", label: "Status", align: "left", defaultWidth: 100, sortable: true },
];

type InvoiceSort = { columnId: InvoiceColumnId; dir: "asc" | "desc" } | null;

/** Resolve the budget-line code(s) an invoice rolls up to. Splits trump the
 *  top-level line_id when present — one invoice can span multiple lines. */
function projectCodeFor(inv: CapexInvoice, lineMap: Map<string, CapexLine>): string {
  const splits = inv.splits ?? [];
  if (splits.length > 0) {
    const codes = Array.from(
      new Set(
        splits
          .map((s) => s.code ?? (s.line_id ? lineMap.get(s.line_id)?.code ?? null : null))
          .filter((c): c is string => !!c && c.trim() !== ""),
      ),
    );
    return codes.join(" / ");
  }
  if (inv.line_id) {
    return lineMap.get(inv.line_id)?.code ?? "";
  }
  return "";
}

function invoiceSortValue(
  inv: CapexInvoice,
  columnId: InvoiceColumnId,
  lineMap: Map<string, CapexLine>,
): string | number {
  switch (columnId) {
    case "vendor":
      return (inv.vendor ?? "").toLowerCase();
    case "invoice_number":
      return (inv.invoice_number ?? "").toLowerCase();
    case "project_code":
      return projectCodeFor(inv, lineMap).toLowerCase();
    case "total_amount":
      return inv.total_amount ?? 0;
    case "invoice_date":
      return inv.invoice_date ?? "";
    case "date_paid":
      return inv.date_paid ?? "";
    case "status":
      return inv.date_paid && inv.date_paid.trim() ? "1-paid" : "0-unpaid";
    default:
      return "";
  }
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_NAMES_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type StatusFilter = "all" | "paid" | "unpaid";

export function InvoicesView({
  project,
  hotelLineIds,
  hotelLines,
  hotelId,
  yearStart,
  yearEnd,
  view,
  setView,
  refreshKey,
  onUploadInvoice,
}: {
  project: CapexProject;
  /** Set of line IDs that belong to the hotel currently in scope. When provided,
   *  we filter invoices to those whose line_id is in this set. */
  hotelLineIds: Set<string>;
  /** All lines in the hotel (used by the edit modal's line picker). */
  hotelLines: CapexLine[];
  /** Hotel ID to scope exports to. */
  hotelId?: string;
  yearStart: number;
  yearEnd: number;
  /** View switcher state — needed so this view can render the shared tabs
   *  in the middle of its own toolbar bubble. */
  view: "budget" | "cashflow" | "invoices";
  setView: (v: "budget" | "cashflow" | "invoices") => void;
  /** Bumped when an invoice is uploaded/applied so we refetch the list. */
  refreshKey?: number;
  /** Callback to open the InvoiceUploadModal — same one wired into the
   *  combined Upload menu in the toolbar. */
  onUploadInvoice?: () => void;
}) {
  const [invoices, setInvoices] = useState<CapexInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [invoiceNumQuery, setInvoiceNumQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [sort, setSort] = useState<InvoiceSort>({ columnId: "invoice_date", dir: "desc" });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [hiddenColumns, setHiddenColumns] = useState<Set<InvoiceColumnId>>(new Set());

  const visibleColumns = INVOICE_COLUMNS.filter((c) => !hiddenColumns.has(c.id));
  const totalShownColumns = visibleColumns.length;

  function toggleHiddenColumn(id: InvoiceColumnId) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const now = new Date();
  const [exportYear, setExportYear] = useState<number>(
    yearStart <= now.getFullYear() && now.getFullYear() <= yearEnd ? now.getFullYear() : yearStart,
  );
  const [exportMonth, setExportMonth] = useState<number>(now.getMonth() + 1);

  function effectiveWidth(c: InvoiceColumnDef): number {
    const o = columnWidths[c.id];
    if (typeof o === "number" && Number.isFinite(o)) return Math.max(70, o);
    return c.defaultWidth;
  }

  function setColumnOverride(id: InvoiceColumnId, width: number) {
    setColumnWidths((prev) => ({ ...prev, [id]: Math.max(70, width) }));
  }
  function clearColumnOverride(id: InvoiceColumnId) {
    setColumnWidths((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function setSortFor(columnId: InvoiceColumnId) {
    setSort((prev) => {
      if (!prev || prev.columnId !== columnId) return { columnId, dir: "asc" };
      if (prev.dir === "asc") return { columnId, dir: "desc" };
      return null;
    });
  }

  function refresh() {
    capexApi
      .listInvoices(project.id)
      .then(setInvoices)
      .catch((e) => setError(String(e)));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, refreshKey]);

  // Filter to current hotel scope.
  const scopedInvoices = useMemo(() => {
    if (!invoices) return [];
    if (hotelLineIds.size === 0) return invoices; // unscoped (project-level)
    return invoices.filter((i) => i.line_id && hotelLineIds.has(i.line_id));
  }, [invoices, hotelLineIds]);

  const vendors = useMemo(() => {
    const s = new Set<string>();
    scopedInvoices.forEach((i) => i.vendor && s.add(i.vendor));
    return Array.from(s).sort();
  }, [scopedInvoices]);

  const lineMap = useMemo(() => {
    const m = new Map<string, CapexLine>();
    for (const l of hotelLines) m.set(l.id, l);
    return m;
  }, [hotelLines]);

  const filtered = useMemo(() => {
    const q = invoiceNumQuery.trim().toLowerCase();
    let arr = scopedInvoices.filter((i) => {
      if (vendorFilter !== "all" && (i.vendor ?? "") !== vendorFilter) return false;
      const isPaid = !!(i.date_paid && i.date_paid.trim());
      if (statusFilter === "paid" && !isPaid) return false;
      if (statusFilter === "unpaid" && isPaid) return false;
      if (q && !(i.invoice_number ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort) {
      const dirMul = sort.dir === "asc" ? 1 : -1;
      arr = [...arr].sort((a, b) => {
        const av = invoiceSortValue(a, sort.columnId, lineMap);
        const bv = invoiceSortValue(b, sort.columnId, lineMap);
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dirMul;
        return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" }) * dirMul;
      });
    }
    return arr;
  }, [scopedInvoices, vendorFilter, statusFilter, invoiceNumQuery, sort, lineMap]);

  const filtersActive =
    vendorFilter !== "all" || statusFilter !== "all" || invoiceNumQuery.trim() !== "";

  function clearFilters() {
    setVendorFilter("all");
    setStatusFilter("all");
    setInvoiceNumQuery("");
  }

  // Detect issues: duplicates (same vendor + invoice_number), splits-sum
  // mismatch, unmatched invoices, missing required fields, dates outside the
  // project's year range, and zero/negative amounts. Operates on the
  // hotel-scoped set so the badge reflects what the user can see.
  type IssueKind =
    | "duplicate"
    | "split_mismatch"
    | "unmatched"
    | "missing_vendor"
    | "missing_invoice_number"
    | "date_out_of_range"
    | "zero_amount";
  const issues = useMemo(() => {
    const out: { invoiceId: string; kind: IssueKind; detail: string }[] = [];
    const seen = new Map<string, string[]>();
    for (const inv of scopedInvoices) {
      const key = `${(inv.vendor ?? "").toLowerCase().trim()}|${(inv.invoice_number ?? "").toLowerCase().trim()}`;
      if (!inv.vendor || !inv.invoice_number) continue;
      const arr = seen.get(key) ?? [];
      arr.push(inv.id);
      seen.set(key, arr);
    }
    for (const [key, ids] of seen) {
      if (ids.length < 2) continue;
      const [vendor, num] = key.split("|");
      ids.forEach((id) =>
        out.push({
          invoiceId: id,
          kind: "duplicate",
          detail: `${vendor} · invoice #${num} appears ${ids.length} times`,
        }),
      );
    }
    for (const inv of scopedInvoices) {
      const splits = inv.splits ?? [];
      if (splits.length > 0) {
        const sum = splits.reduce((a, s) => a + (s.amount || 0), 0);
        if (Math.abs(sum - inv.total_amount) > 1) {
          out.push({
            invoiceId: inv.id,
            kind: "split_mismatch",
            detail: `${inv.vendor ?? "Invoice"} ${inv.invoice_number ? "#" + inv.invoice_number : ""} — splits sum ${fmtMoney(sum)} ≠ total ${fmtMoney(inv.total_amount)}`,
          });
        }
      }
      if (!inv.line_id && splits.length === 0) {
        out.push({
          invoiceId: inv.id,
          kind: "unmatched",
          detail: `${inv.vendor ?? "Invoice"} ${inv.invoice_number ? "#" + inv.invoice_number : ""} — not yet applied to a budget line`,
        });
      }
      const tag = `${inv.vendor ?? "Invoice"} ${inv.invoice_number ? "#" + inv.invoice_number : ""}`.trim();
      if (!(inv.vendor ?? "").trim()) {
        out.push({ invoiceId: inv.id, kind: "missing_vendor", detail: `${tag} — vendor is empty` });
      }
      if (!(inv.invoice_number ?? "").trim()) {
        out.push({ invoiceId: inv.id, kind: "missing_invoice_number", detail: `${inv.vendor ?? "Invoice"} — invoice # is empty` });
      }
      if ((inv.total_amount ?? 0) <= 0) {
        out.push({ invoiceId: inv.id, kind: "zero_amount", detail: `${tag} — amount is ${fmtMoney(inv.total_amount ?? 0)}` });
      }
      if (inv.invoice_date) {
        const m = inv.invoice_date.match(/(\d{4})/);
        const y = m ? Number(m[1]) : NaN;
        if (Number.isFinite(y) && (y < yearStart || y > yearEnd)) {
          out.push({
            invoiceId: inv.id,
            kind: "date_out_of_range",
            detail: `${tag} — date ${inv.invoice_date} is outside project range ${yearStart}–${yearEnd}`,
          });
        }
      }
    }
    return out;
  }, [scopedInvoices, yearStart, yearEnd]);

  const totalCount = filtered.length;
  const totalAmount = filtered.reduce((acc, i) => acc + (i.total_amount ?? 0), 0);
  const paidAmount = filtered.reduce(
    (acc, i) => (i.date_paid ? acc + (i.total_amount ?? 0) : acc),
    0,
  );
  const unpaidAmount = totalAmount - paidAmount;

  const years: number[] = [];
  for (let y = yearStart; y <= yearEnd; y++) years.push(y);

  function downloadTracking() {
    const url = capexApi.exportInvoiceTrackingUrl(project.id, exportYear, exportMonth, hotelId);
    window.location.href = url;
  }
  function downloadFundingRequest() {
    const url = capexApi.exportFundingRequestUrl(project.id, exportYear, exportMonth, hotelId);
    window.location.href = url;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>
    );
  }
  if (!invoices) {
    return <div className="text-sm text-gencom-stone">Loading invoices…</div>;
  }
  if (scopedInvoices.length === 0) {
    return (
      <div className="space-y-2">
        <ViewTabsBar view={view} setView={setView} />
        <div className="rounded-xl border border-dashed border-gencom-sand bg-gencom-mist/40 p-12 text-center">
          <div className="text-sm text-gencom-stone">No invoices uploaded yet.</div>
          <p className="mt-2 text-xs text-gencom-stone/80 max-w-md mx-auto">
            Upload your first vendor invoice and Claude will auto-match it to a budget line.
          </p>
          {onUploadInvoice && (
            <button
              onClick={onUploadInvoice}
              className="mt-4 text-sm px-4 py-2 rounded-md bg-gencom-green text-white font-semibold hover:bg-gencom-greendark"
            >
              🧾 Upload invoice
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Single combined toolbar — three-column grid mirrors the Budget
          toolbar so the centered tabs land at the same x-position across
          views. Left: Table view + Filter + Issues. Center: tabs.
          Right: Export menu + Upload. */}
      <div className="grid items-center gap-4 px-1 py-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold">
          Table view
        </span>

        <div className="relative">
          <button
            onClick={() => setFilterMenuOpen((o) => !o)}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition ${
              filtersActive
                ? "border-gencom-gold bg-gencom-gold/10 text-gencom-ink font-semibold"
                : "border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
            }`}
            title="Filter invoices by vendor, status, or invoice #"
          >
            <span aria-hidden>⏵</span> Filter
            {filtersActive && (
              <span className="text-[10px] uppercase tracking-wider">active</span>
            )}
          </button>
          {filterMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFilterMenuOpen(false)} />
              <div className="absolute z-50 mt-1 left-0 w-80 bg-white rounded-md border border-gencom-sand shadow-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="t-eyebrow">Filter</span>
                  <button
                    onClick={clearFilters}
                    className="text-[10px] uppercase tracking-wider text-gencom-stone hover:text-gencom-ink"
                  >
                    Clear
                  </button>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-gencom-stone mb-1 mt-2">
                  Vendor
                </div>
                <select
                  value={vendorFilter}
                  onChange={(e) => setVendorFilter(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 border border-gencom-sand rounded bg-white"
                >
                  <option value="all">All vendors</option>
                  {vendors.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] uppercase tracking-wider text-gencom-stone mb-1 mt-3">
                  Invoice #
                </div>
                <input
                  type="text"
                  value={invoiceNumQuery}
                  onChange={(e) => setInvoiceNumQuery(e.target.value)}
                  placeholder="Search invoice #"
                  className="w-full text-xs px-2 py-1.5 border border-gencom-sand rounded bg-white focus:outline-none focus:border-gencom-green"
                />
                <div className="text-[10px] uppercase tracking-wider text-gencom-stone mb-1 mt-3">
                  Status
                </div>
                <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-[11px] uppercase tracking-wider bg-white">
                  {(["all", "unpaid", "paid"] as StatusFilter[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={`px-3 py-1 transition ${
                        statusFilter === s
                          ? "bg-gencom-green text-white font-semibold"
                          : "text-gencom-stone hover:text-gencom-ink"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setColumnsMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
            title="Show or hide columns"
          >
            <span aria-hidden>☰</span> Columns
            <span className="text-[10px] uppercase tracking-wider text-gencom-stone/70">
              ({totalShownColumns} shown)
            </span>
          </button>
          {columnsMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setColumnsMenuOpen(false)} />
              <div className="absolute z-50 mt-1 left-0 w-72 bg-white rounded-md border border-gencom-sand shadow-xl p-3 max-h-[60vh] overflow-y-auto">
                <div className="t-eyebrow mb-2">Visible columns</div>
                <div className="flex flex-wrap gap-1.5">
                  {INVOICE_COLUMNS.map((c) => {
                    const visible = !hiddenColumns.has(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleHiddenColumn(c.id)}
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
          )}
        </div>

        </div>
        <div className="flex justify-center">
          <ViewTabs view={view} setView={setView} />
        </div>
        <div className="flex items-center justify-end gap-3 flex-wrap min-w-0">

        {issues.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setIssuesOpen((v) => !v)}
              className="text-xs px-3 py-1.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 font-semibold hover:bg-amber-200 whitespace-nowrap"
              title="Click to see invoices that need attention"
            >
              ⚠ {issues.length} issue{issues.length === 1 ? "" : "s"}
            </button>
            {issuesOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 w-96 rounded-md border-2 border-amber-300 bg-white shadow-xl overflow-hidden">
                <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-900">
                    Needs attention
                  </span>
                  <button
                    onClick={() => setIssuesOpen(false)}
                    className="text-amber-700 hover:text-amber-900 text-sm"
                  >
                    ×
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-amber-100">
                  {issues.map((it, idx) => {
                    const kindMeta: Record<typeof it.kind, { label: string; cls: string }> = {
                      duplicate: { label: "DUP", cls: "bg-red-100 text-red-800" },
                      split_mismatch: { label: "SPLITS", cls: "bg-amber-100 text-amber-800" },
                      unmatched: { label: "OPEN", cls: "bg-blue-100 text-blue-800" },
                      missing_vendor: { label: "VENDOR", cls: "bg-amber-100 text-amber-900" },
                      missing_invoice_number: { label: "INV #", cls: "bg-amber-100 text-amber-900" },
                      date_out_of_range: { label: "DATE", cls: "bg-amber-100 text-amber-900" },
                      zero_amount: { label: "AMOUNT", cls: "bg-amber-100 text-amber-900" },
                    };
                    const meta = kindMeta[it.kind];
                    return (
                      <button
                        key={`${it.invoiceId}-${it.kind}-${idx}`}
                        onClick={() => {
                          setEditingInvoiceId(it.invoiceId);
                          setIssuesOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-start gap-2"
                      >
                        <span
                          className={`mt-0.5 inline-block px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-semibold flex-shrink-0 ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                        <span className="text-[11px] text-gencom-ink leading-snug">{it.detail}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <button
            onClick={() => setExportMenuOpen((o) => !o)}
            className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone whitespace-nowrap inline-flex items-center gap-1.5"
            title="Export the invoice tracking sheet or funding request for a month"
          >
            <span aria-hidden>📊</span> Export <span className="text-[9px] opacity-70">▾</span>
          </button>
          {exportMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
              <div className="absolute z-50 mt-1 right-0 w-72 bg-white rounded-md border border-gencom-sand shadow-xl p-3">
                <div className="t-eyebrow mb-2">Export month</div>
                <div className="flex gap-2 mb-3">
                  <select
                    value={exportMonth}
                    onChange={(e) => setExportMonth(Number(e.target.value))}
                    className="flex-1 text-xs px-2 py-1.5 border border-gencom-sand rounded bg-white"
                  >
                    {MONTH_NAMES.map((m, idx) => (
                      <option key={m} value={idx + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    value={exportYear}
                    onChange={(e) => setExportYear(Number(e.target.value))}
                    className="w-24 text-xs px-2 py-1.5 border border-gencom-sand rounded bg-white"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    downloadTracking();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition flex items-start gap-3 rounded"
                >
                  <span className="text-lg leading-none mt-0.5">📊</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-gencom-ink">Tracking sheet</span>
                    <span className="block text-[10px] text-gencom-stone leading-snug">
                      Invoice Tracking xlsx for the selected month
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setExportMenuOpen(false);
                    downloadFundingRequest();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-gencom-gold/10 transition flex items-start gap-3 rounded"
                >
                  <span className="text-lg leading-none mt-0.5">🏦</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-semibold text-gencom-ink">Funding Request</span>
                    <span className="block text-[10px] text-gencom-stone leading-snug">
                      Funding Request xlsx for the selected month
                    </span>
                  </span>
                </button>
              </div>
            </>
          )}
        </div>

        {onUploadInvoice && (
          <button
            onClick={onUploadInvoice}
            className="text-xs px-3 py-1.5 rounded-md bg-gencom-green text-white font-semibold hover:bg-gencom-greendark whitespace-nowrap"
            title="Upload another invoice"
          >
            + Upload invoice
          </button>
        )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Invoices" value={`${totalCount}`} muted />
        <Stat label="Paid" value={fmtMoney(paidAmount)} className="text-gencom-green" />
        <Stat label="Outstanding" value={fmtMoney(unpaidAmount)} className="text-gencom-gold" />
      </div>

      <div className="overflow-x-auto rounded-xl border-2 border-gencom-sand bg-white">
        <table
          className="w-full text-xs border-collapse"
          style={{
            minWidth: `${visibleColumns.reduce((acc, c) => acc + effectiveWidth(c), 0) + 96}px`,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.id} style={{ width: `${effectiveWidth(c)}px` }} />
            ))}
            <col style={{ width: "96px" }} />
          </colgroup>
          <thead className="bg-gencom-mist/60 text-[10px] uppercase tracking-wider text-gencom-stone">
            <tr>
              {visibleColumns.map((c) => (
                <InvoiceSortableHeader
                  key={c.id}
                  col={c}
                  sort={sort}
                  onClick={() => c.sortable && setSortFor(c.id)}
                  currentWidth={effectiveWidth(c)}
                  onResize={(w) => setColumnOverride(c.id, w)}
                  onResetWidth={() => clearColumnOverride(c.id)}
                />
              ))}
              <th className="px-3 py-2 border-b border-gencom-sand"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                project={project}
                allLines={hotelLines}
                visibleColumnIds={new Set(visibleColumns.map((c) => c.id))}
                expanded={expandedInvoiceId === inv.id}
                onToggleExpand={() =>
                  setExpandedInvoiceId((prev) => (prev === inv.id ? null : inv.id))
                }
                onUpdate={(updated) => {
                  setInvoices((prev) => (prev ?? []).map((i) => (i.id === updated.id ? updated : i)));
                }}
                onOpenEdit={() => setEditingInvoiceId(inv.id)}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + 1} className="px-6 py-10 text-center text-sm text-gencom-stone">
                  No invoices match the active filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gencom-stone italic">
        Click any row to expand and apply (or split) the invoice across budget lines. Use Edit for vendor, dates, or payment notes. Exports include invoices whose date received falls in {MONTH_NAMES_LONG[exportMonth - 1]} {exportYear}.
      </p>

      {editingInvoiceId && (
        (() => {
          const editing = (invoices ?? []).find((i) => i.id === editingInvoiceId);
          if (!editing) return null;
          return (
            <InvoiceEditModal
              invoice={editing}
              project={project}
              allLines={hotelLines}
              onClose={() => setEditingInvoiceId(null)}
              onSaved={(updated) => {
                setInvoices((prev) => (prev ?? []).map((i) => (i.id === updated.id ? updated : i)));
                setEditingInvoiceId(null);
              }}
              onDeleted={(id) => {
                setInvoices((prev) => (prev ?? []).filter((i) => i.id !== id));
                setEditingInvoiceId(null);
              }}
            />
          );
        })()
      )}
    </div>
  );
}


function InvoiceSortableHeader({
  col,
  sort,
  onClick,
  currentWidth,
  onResize,
  onResetWidth,
}: {
  col: InvoiceColumnDef;
  sort: InvoiceSort;
  onClick: () => void;
  currentWidth: number;
  onResize: (px: number) => void;
  onResetWidth: () => void;
}) {
  const isSorted = sort?.columnId === col.id;

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = currentWidth;
    // setPointerCapture keeps move/up firing on this element even if the
    // cursor briefly leaves the 6–12px handle bounds during a fast drag.
    const target = e.currentTarget as Element;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {}
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    function onMove(ev: PointerEvent) {
      onResize(startWidth + (ev.clientX - startX));
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
      className={`relative px-3 py-2 ${col.align === "right" ? "text-right" : "text-left"} font-semibold border-b border-gencom-sand whitespace-nowrap overflow-hidden truncate ${
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


function InvoiceRow({
  invoice,
  project,
  allLines,
  visibleColumnIds,
  expanded,
  onToggleExpand,
  onUpdate,
  onOpenEdit,
}: {
  invoice: CapexInvoice;
  project: CapexProject;
  allLines: CapexLine[];
  /** Set of column ids to render. Hidden columns are skipped entirely so the
   *  td count stays in sync with the colgroup. */
  visibleColumnIds: Set<InvoiceColumnId>;
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (updated: CapexInvoice) => void;
  onOpenEdit: () => void;
}) {
  const colVisible = (id: InvoiceColumnId) => visibleColumnIds.has(id);
  const expandedColSpan = visibleColumnIds.size + 1;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(invoice.date_paid ?? "");
  const [saving, setSaving] = useState(false);

  const isPaid = !!(invoice.date_paid && invoice.date_paid.trim());
  const splitCount = (invoice.splits ?? []).length;
  const lineMap = useMemo(() => {
    const m = new Map<string, CapexLine>();
    for (const l of allLines) m.set(l.id, l);
    return m;
  }, [allLines]);
  const projectCode = projectCodeFor(invoice, lineMap);

  async function commitDate(value: string | null) {
    setSaving(true);
    try {
      const updated = await capexApi.markInvoicePaid(invoice.id, value);
      onUpdate(updated);
      setEditing(false);
    } catch (e) {
      console.error("[invoice] mark-paid failed", e);
    } finally {
      setSaving(false);
    }
  }

  // Body cells toggle expansion; Mark-paid input + actions cell stop
  // propagation so they don't fire it.
  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand();
  };

  return (
    <>
      <tr
        className={`border-t border-gencom-sand/60 cursor-pointer transition ${
          expanded ? "bg-gencom-mist/40" : "hover:bg-gencom-mist/20"
        }`}
      >
        {colVisible("project_code") && (
        <td className="px-3 py-2 align-top whitespace-nowrap truncate overflow-hidden" onClick={toggleExpand}>
          <span className="mr-1 text-gencom-gold align-middle inline-block w-4" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
          <span className="font-medium text-gencom-ink">{projectCode || "—"}</span>
        </td>
        )}
        {colVisible("vendor") && (
        <td className="px-3 py-2 align-top whitespace-nowrap truncate overflow-hidden" onClick={toggleExpand}>
          <span className="font-medium text-gencom-ink">{invoice.vendor ?? "—"}</span>
          {splitCount > 0 && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-gencom-gold">
              split × {splitCount}
            </span>
          )}
        </td>
        )}
        {colVisible("invoice_number") && (
        <td className="px-3 py-2 align-top text-gencom-stone whitespace-nowrap truncate overflow-hidden" onClick={toggleExpand}>
          {invoice.invoice_number ?? "—"}
        </td>
        )}
        {colVisible("total_amount") && (
        <td className="px-3 py-2 align-top text-right font-mono text-gencom-ink whitespace-nowrap truncate overflow-hidden" onClick={toggleExpand}>
          {fmtMoney(invoice.total_amount)}
        </td>
        )}
        {colVisible("invoice_date") && (
        <td className="px-3 py-2 align-top text-gencom-stone whitespace-nowrap truncate overflow-hidden" onClick={toggleExpand}>
          {invoice.invoice_date ? fmtDateShort(invoice.invoice_date) : "—"}
        </td>
        )}
        {colVisible("date_paid") && (
        <td
          className="px-3 py-2 align-top whitespace-nowrap truncate overflow-hidden"
          onClick={(e) => (editing ? e.stopPropagation() : toggleExpand(e))}
        >
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                className="text-[11px] px-1.5 py-1 border border-gencom-gold rounded"
              />
              <button
                onClick={() => commitDate(draft || null)}
                disabled={saving}
                className="text-[10px] uppercase tracking-wider text-gencom-green hover:text-gencom-green font-semibold disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setDraft(invoice.date_paid ?? "");
                  setEditing(false);
                }}
                className="text-[10px] text-gencom-stone hover:text-gencom-ink"
              >
                ✕
              </button>
            </div>
          ) : (
            <span className={isPaid ? "text-gencom-ink" : "text-gencom-stone/50"}>
              {isPaid ? fmtDateShort(invoice.date_paid) : "—"}
            </span>
          )}
        </td>
        )}
        {colVisible("status") && (
        <td className="px-3 py-2 align-top whitespace-nowrap truncate overflow-hidden" onClick={toggleExpand}>
          {isPaid ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gencom-greensoft text-gencom-green text-[10px] uppercase tracking-wider font-semibold border border-gencom-green/20">
              ● Paid
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] uppercase tracking-wider font-semibold border border-amber-200">
              ● Unpaid
            </span>
          )}
        </td>
        )}
        <td
          className="px-3 py-2 align-top whitespace-nowrap text-right overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {!editing && (
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setDraft(invoice.date_paid ?? new Date().toISOString().slice(0, 10));
                  setEditing(true);
                }}
                className="text-[10px] uppercase tracking-wider text-gencom-stone hover:text-gencom-ink"
                title={isPaid ? "Edit paid date" : "Mark as paid"}
              >
                {isPaid ? "Paid ✎" : "Mark paid"}
              </button>
              {isPaid && (
                <button
                  onClick={() => commitDate(null)}
                  className="text-[10px] uppercase tracking-wider text-red-600 hover:text-red-800"
                  title="Mark as unpaid (clears the paid date)"
                >
                  Unpaid
                </button>
              )}
              <button
                onClick={onOpenEdit}
                className="text-gencom-stone/40 hover:text-gencom-ink transition w-6 h-6 rounded hover:bg-gencom-mist"
                title="Edit full invoice (vendor, dates, payment notes…)"
              >
                ✎
              </button>
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gencom-mist/20">
          <td colSpan={expandedColSpan} className="px-6 py-3 space-y-3">
            <InvoiceNotes
              description={invoice.description}
              paymentNotes={invoice.payment_notes}
            />
            <InvoiceApplyPanel
              invoice={invoice}
              project={project}
              allLines={allLines}
              onSaved={(updated) => {
                onUpdate(updated);
                onToggleExpand();
              }}
              onCancel={onToggleExpand}
            />
          </td>
        </tr>
      )}
    </>
  );
}


function InvoiceNotes({
  description,
  paymentNotes,
}: {
  description: string | null;
  paymentNotes: string | null;
}) {
  // Surfaces the long-form fields that used to live in a Notes table column.
  // Each field renders only when present so we don't show empty headers.
  const hasAny = !!(description?.trim() || paymentNotes?.trim());
  if (!hasAny) return null;
  return (
    <div className="rounded-md border border-gencom-sand bg-white p-3 text-xs">
      {description?.trim() && (
        <div className={paymentNotes?.trim() ? "mb-2" : ""}>
          <div className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold mb-0.5">
            Description
          </div>
          <div className="text-gencom-ink whitespace-pre-wrap">{description}</div>
        </div>
      )}
      {paymentNotes?.trim() && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold mb-0.5">
            Payment notes
          </div>
          <div className="text-gencom-ink whitespace-pre-wrap">{paymentNotes}</div>
        </div>
      )}
    </div>
  );
}


function InvoiceApplyPanel({
  invoice,
  project,
  allLines,
  onSaved,
  onCancel,
}: {
  invoice: CapexInvoice;
  project: CapexProject;
  allLines: CapexLine[];
  onSaved: (updated: CapexInvoice) => void;
  onCancel: () => void;
}) {
  // Mirrors the apply controls from InvoiceEditModal but inline. Single-line
  // mode applies the whole invoice to one budget line; split mode lets the
  // user spread different sections across multiple lines.
  const initialSplits = invoice.splits ?? [];
  const [splitMode, setSplitMode] = useState<boolean>(initialSplits.length > 0);
  const [splits, setSplits] = useState<InvoiceSplit[]>(initialSplits);
  const [lineId, setLineId] = useState<string | null>(invoice.line_id);
  const [appliedYear, setAppliedYear] = useState<number | null>(invoice.applied_year);
  const [appliedMonth, setAppliedMonth] = useState<number | null>(invoice.applied_month);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const years: number[] = [];
  for (let y = project.year_start; y <= project.year_end; y++) years.push(y);
  const MONTHS_SHORT = MONTH_NAMES;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const validSplits = splitMode ? splits.filter((s) => s.line_id && (s.amount || 0) > 0) : [];
      if (splitMode) {
        if (validSplits.length === 0) {
          setError("Add at least one split with a line and amount, or switch to single-line.");
          setSaving(false);
          return;
        }
        const sumSplits = validSplits.reduce((a, s) => a + (s.amount || 0), 0);
        if (Math.abs(sumSplits - invoice.total_amount) > 1) {
          setError(
            `Splits sum to ${sumSplits.toFixed(2)} but invoice total is ${invoice.total_amount.toFixed(2)}. ` +
              "Adjust amounts so they match.",
          );
          setSaving(false);
          return;
        }
      }
      const updated = await capexApi.updateInvoice(invoice.id, {
        line_id: splitMode ? validSplits[0]?.line_id ?? null : lineId,
        applied_year: splitMode ? validSplits[0]?.applied_year ?? null : appliedYear,
        applied_month: splitMode ? validSplits[0]?.applied_month ?? null : appliedMonth,
        splits: splitMode ? validSplits : null,
        match_status: invoice.match_status === "pending" ? "manual" : invoice.match_status,
      });
      onSaved(updated);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-gencom-sand bg-white p-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="t-eyebrow">Apply this invoice to budget</div>
        <div className="inline-flex rounded-md border-2 border-gencom-sand bg-white overflow-hidden t-eyebrow normal-case">
          <button
            type="button"
            onClick={() => setSplitMode(false)}
            className={`px-3 py-1 transition ${
              !splitMode
                ? "bg-gencom-green text-white"
                : "text-gencom-stone hover:text-gencom-green hover:bg-gencom-greensoft"
            }`}
          >
            Single line
          </button>
          <button
            type="button"
            onClick={() => setSplitMode(true)}
            className={`px-3 py-1 border-l-2 border-gencom-sand transition ${
              splitMode
                ? "bg-gencom-green text-white"
                : "text-gencom-stone hover:text-gencom-green hover:bg-gencom-greensoft"
            }`}
          >
            Split across lines{splits.length > 0 && (
              <span className="ml-1 text-[9px] opacity-80">({splits.length})</span>
            )}
          </button>
        </div>
      </div>

      {splitMode ? (
        <SplitsEditor
          splits={splits}
          setSplits={setSplits}
          allLines={allLines}
          totalAmount={invoice.total_amount}
          appliedYear={appliedYear ?? project.year_start}
          appliedMonth={appliedMonth ?? 1}
        />
      ) : (
        <div className="rounded-md border border-gencom-sand bg-gencom-mist/30 p-3">
          <FieldLabel required>Applied to budget line</FieldLabel>
          <select
            value={lineId ?? ""}
            onChange={(e) => setLineId(e.target.value || null)}
            className="w-full px-3 py-2 border border-gencom-sand rounded-md text-xs bg-white focus:outline-none focus:border-gencom-green"
          >
            <option value="">— unassigned —</option>
            {allLines.map((l) => (
              <option key={l.id} value={l.id}>
                {[l.code, l.group, l.category, l.project_name].filter(Boolean).join(" · ")} —{" "}
                {fmtMoney(l.forecast_total_budget)}
              </option>
            ))}
          </select>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Applied year</FieldLabel>
              <select
                value={appliedYear ?? ""}
                onChange={(e) => setAppliedYear(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-gencom-sand rounded-md text-xs bg-white focus:outline-none focus:border-gencom-green"
              >
                <option value="">—</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Applied month</FieldLabel>
              <select
                value={appliedMonth ?? ""}
                onChange={(e) => setAppliedMonth(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-gencom-sand rounded-md text-xs bg-white focus:outline-none focus:border-gencom-green"
              >
                <option value="">—</option>
                {MONTHS_SHORT.map((m, idx) => (
                  <option key={m} value={idx + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-xs px-4 py-1.5 rounded-md bg-gencom-green text-white font-semibold hover:bg-gencom-greendark disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}


function Stat({
  label,
  value,
  className = "",
  muted = false,
}: {
  label: string;
  value: string;
  className?: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border-2 border-gencom-sand bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold">
        {label}
      </div>
      <div className={`mt-0.5 font-display text-xl font-bold ${muted ? "text-gencom-stone" : "text-gencom-ink"} ${className}`}>
        {value}
      </div>
    </div>
  );
}
