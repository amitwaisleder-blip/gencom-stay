import { useEffect, useMemo, useRef, useState } from "react";
import { capexApi, fmtMoney } from "../lib/capexApi";
import { useLocalStorageState } from "../lib/useLocalStorageState";
import type { CapexLine } from "../lib/types";
import { ViewTabsBar } from "./BudgetTable";

type ImportResult = Awaited<ReturnType<typeof capexApi.importCashflow>>;

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function CashflowView({
  hotelId,
  projectId,
  lines,
  yearStart,
  yearEnd,
  monthStart,
  monthEnd,
  view,
  setView,
  onLineUpdated,
}: {
  /** Used to scope the persisted year selection — different hotels remember
   *  their own last-viewed year. */
  hotelId: string;
  /** Required for the Export button — the cashflow xlsx is project-scoped
   *  with optional hotel filter. */
  projectId: string;
  lines: CapexLine[];
  yearStart: number;
  yearEnd: number;
  /** Optional month-level bounds. When set, the start year only shows months
   *  ≥ monthStart and the end year only shows months ≤ monthEnd. Months
   *  outside that window are hidden everywhere — header, cells, totals. */
  monthStart?: number;
  monthEnd?: number;
  view: "budget" | "cashflow" | "invoices";
  setView: (v: "budget" | "cashflow" | "invoices") => void;
  onLineUpdated: (line: CapexLine) => void;
}) {
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = yearStart; y <= yearEnd; y++) out.push(y);
    return out;
  }, [yearStart, yearEnd]);

  // Months the project actually spans for a given year. Start year is
  // clipped to monthStart, end year to monthEnd; in-between years are full.
  // For a single-year project both bounds apply to the same year.
  function visibleMonthsForYear(year: number): number[] {
    const lo = year === yearStart && monthStart ? monthStart : 1;
    const hi = year === yearEnd && monthEnd ? monthEnd : 12;
    if (lo > hi) return [];
    const out: number[] = [];
    for (let m = lo; m <= hi; m++) out.push(m);
    return out;
  }

  // Persist the selected year per hotel so navigating away to another tab
  // (or back to the budget table) and returning lands the user on the same
  // year they were last viewing — not the project's start year.
  const [selectedYear, setSelectedYearRaw] = useLocalStorageState<number>(
    `capex-cashflow-year:${hotelId}`,
    years[0] ?? new Date().getFullYear(),
  );
  // If a stored year falls outside the current project range (e.g. years
  // were trimmed in project edit), snap to the nearest valid year so the
  // table renders something useful.
  const validYear = years.includes(selectedYear)
    ? selectedYear
    : years[0] ?? new Date().getFullYear();
  const setSelectedYear = setSelectedYearRaw;

  // Months visible for the currently selected year. Drives the column count
  // for the table and every monthly total / cell render below.
  const visibleMonths = useMemo(
    () => visibleMonthsForYear(validYear),
    // visibleMonthsForYear closes over yearStart/yearEnd/monthStart/monthEnd
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validYear, yearStart, yearEnd, monthStart, monthEnd],
  );

  // Per-year totals across all lines for the strip at the top. Only counts
  // months inside the project's window so a value lingering in an
  // out-of-range month from a prior trim doesn't inflate the year total.
  const yearTotals = useMemo(() => {
    const t: Record<number, number> = {};
    for (const y of years) {
      const monthsInRange = visibleMonthsForYear(y);
      let sum = 0;
      for (const l of lines) {
        const months = l.cashflow?.[String(y)] ?? {};
        for (const m of monthsInRange) sum += Number(months[String(m)] ?? 0) || 0;
      }
      t[y] = sum;
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, years, monthStart, monthEnd]);

  // Monthly totals for the bottom row of the selected year — one entry per
  // visible month, in the same order as the header.
  const monthTotals = useMemo(() => {
    return visibleMonths.map((m) => {
      let sum = 0;
      for (const l of lines) {
        const months = l.cashflow?.[String(validYear)] ?? {};
        sum += Number(months[String(m)] ?? 0) || 0;
      }
      return sum;
    });
  }, [lines, validYear, visibleMonths]);

  function downloadExport() {
    window.location.href = capexApi.exportCashflowUrl(projectId, hotelId);
  }

  function openHtmlExport() {
    // New tab — user can print, save, or copy/paste from there. The
    // server returns text/html with no Content-Disposition so the
    // browser renders it inline.
    window.open(capexApi.exportCashflowHtmlUrl(projectId, hotelId), "_blank", "noopener");
  }

  function downloadHtmlExport() {
    window.location.href = capexApi.exportCashflowHtmlUrl(projectId, hotelId, { download: true });
  }

  const [importing, setImporting] = useState(false);

  // Per-hotel persisted toggles for the three meta columns. Each defaults to
  // visible; the user can hide any combination via the Columns menu.
  type MetaCol = "vendor" | "code" | "project_name";
  const [metaVisible, setMetaVisible] = useLocalStorageState<Record<MetaCol, boolean>>(
    `capex-cashflow-meta-cols:${hotelId}`,
    { vendor: true, code: true, project_name: true },
  );
  function toggleMeta(col: MetaCol) {
    setMetaVisible({ ...metaVisible, [col]: !metaVisible[col] });
  }
  // Render order of meta columns when visible.
  const META_ORDER: { id: MetaCol; label: string; width: number }[] = [
    { id: "code", label: "Code", width: 110 },
    { id: "vendor", label: "Vendor", width: 200 },
    { id: "project_name", label: "Project name", width: 220 },
  ];
  const visibleMetaCols = META_ORDER.filter((c) => metaVisible[c.id]);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);

  // Click a meta-column header to sort by it; cycles asc → desc → none.
  type SortDir = "asc" | "desc";
  const [sort, setSort] = useLocalStorageState<{ col: MetaCol; dir: SortDir } | null>(
    `capex-cashflow-sort:${hotelId}`,
    null,
  );
  function cycleSort(col: MetaCol) {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  }
  const sortedLines = useMemo(() => {
    if (!sort) return lines;
    const col = sort.col;
    const dir = sort.dir === "asc" ? 1 : -1;
    function key(l: CapexLine): string {
      if (col === "vendor") return (l.vendor ?? "").toLowerCase();
      if (col === "code") return (l.code ?? "").toLowerCase();
      return (l.project_name ?? "").toLowerCase();
    }
    return [...lines].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      // Empty strings sink to the bottom regardless of direction so a sort
      // never floats a wall of "—" rows to the top.
      if (!ka && kb) return 1;
      if (ka && !kb) return -1;
      if (ka < kb) return -1 * dir;
      if (ka > kb) return 1 * dir;
      return 0;
    });
  }, [lines, sort]);

  async function refreshAfterImport() {
    // Re-pull lines for this hotel and bubble each one up so the parent's
    // setLines map keeps every other piece of state intact (sort, expanded
    // rows, etc.) instead of remounting.
    try {
      const fresh = await capexApi.listLines(hotelId);
      for (const line of fresh) onLineUpdated(line);
    } catch {
      /* swallow — the import already succeeded server-side. */
    }
  }

  if (lines.length === 0) {
    return (
      <div className="space-y-2">
        <ViewTabsBar view={view} setView={setView} />
        <div className="rounded-xl border border-dashed border-gencom-sand bg-gencom-mist/40 p-12 text-center text-sm text-gencom-stone">
          No lines yet — add or upload a budget first to see cashflow.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ViewTabsBar
        view={view}
        setView={setView}
        showLabel={false}
        leftExtras={
          <>
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`text-[11px] px-2 py-1 rounded-md border transition tabular-nums ${
                  selectedYear === y
                    ? "border-emerald-700 bg-emerald-700 text-white font-semibold"
                    : "border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
                }`}
              >
                {y}
              </button>
            ))}
          </>
        }
        rightExtras={
          <>
            <div className="relative">
              <button
                onClick={() => setColumnsMenuOpen((o) => !o)}
                className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone whitespace-nowrap inline-flex items-center gap-1.5"
                title="Show or hide vendor / code / project name columns"
              >
                <span aria-hidden>☰</span> Columns
                <span className="text-[10px] uppercase tracking-wider text-gencom-stone/70">
                  ({visibleMetaCols.length} shown)
                </span>
              </button>
              {columnsMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setColumnsMenuOpen(false)} />
                  <div className="absolute z-50 mt-1 right-0 w-56 bg-white rounded-md border border-gencom-sand shadow-xl p-3">
                    <div className="t-eyebrow mb-2">Visible columns</div>
                    <div className="flex flex-wrap gap-1.5">
                      {META_ORDER.map((c) => {
                        const visible = metaVisible[c.id];
                        return (
                          <button
                            key={c.id}
                            onClick={() => toggleMeta(c.id)}
                            className={`text-[11px] px-2 py-1 rounded-full border ${
                              visible
                                ? "bg-emerald-700 text-white border-emerald-700"
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
            <button
              onClick={() => setImporting(true)}
              className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone whitespace-nowrap inline-flex items-center gap-1.5"
              title="Import a cashflow xlsx (same shape as Export)"
            >
              <span aria-hidden>📥</span> Import
            </button>
            <button
              onClick={downloadExport}
              className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone whitespace-nowrap inline-flex items-center gap-1.5"
              title="Download cashflow as xlsx"
            >
              <span aria-hidden>📊</span> Export
            </button>
            {/* HTML export — opens a styled, printable view in a new tab.
                The chevron downloads the same content as a .html file. */}
            <div className="inline-flex">
              <button
                onClick={openHtmlExport}
                className="text-xs px-3 py-1.5 rounded-l-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone whitespace-nowrap inline-flex items-center gap-1.5"
                title="Open cashflow as a styled HTML page (print, share, or paste into a doc)"
              >
                <span aria-hidden>🌐</span> HTML
              </button>
              <button
                onClick={downloadHtmlExport}
                className="text-xs px-2 py-1.5 rounded-r-md border border-l-0 border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone whitespace-nowrap"
                title="Download as .html file"
                aria-label="Download HTML"
              >
                ⤓
              </button>
            </div>
          </>
        }
      />

      {importing && (
        <ImportCashflowModal
          projectId={projectId}
          hotelId={hotelId}
          onClose={() => setImporting(false)}
          onApplied={async () => {
            await refreshAfterImport();
          }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border-2 border-gencom-sand bg-white">
        {/* tableLayout: fixed locks column widths to the colgroup so a long
            decimal value typed into a month cell can't push other columns
            sideways. Each month gets a fixed 80px slot. */}
        <table
          className="w-full text-xs border-collapse"
          style={{
            minWidth: `${
              visibleMetaCols.reduce((acc, c) => acc + c.width, 0) +
              visibleMonths.length * 80 +
              120
            }px`,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {visibleMetaCols.length === 0 ? (
              <col style={{ width: "120px" }} />
            ) : (
              visibleMetaCols.map((c) => <col key={c.id} style={{ width: `${c.width}px` }} />)
            )}
            {visibleMonths.map((m) => (
              <col key={m} style={{ width: "80px" }} />
            ))}
            <col style={{ width: "120px" }} />
          </colgroup>
          <thead className="bg-gencom-mist/60 text-[10px] uppercase tracking-wider text-gencom-stone sticky top-0 z-10">
            <tr>
              {visibleMetaCols.length === 0 ? (
                <th className="px-3 py-2 text-left font-semibold border-b border-gencom-sand whitespace-nowrap">
                  Line
                </th>
              ) : (
                visibleMetaCols.map((c) => {
                  const active = sort?.col === c.id;
                  const arrow = !active ? "↕" : sort?.dir === "asc" ? "↑" : "↓";
                  return (
                    <th
                      key={c.id}
                      className="px-3 py-2 text-left font-semibold border-b border-gencom-sand whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onClick={() => cycleSort(c.id)}
                        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-gencom-ink ${
                          active ? "text-gencom-ink" : ""
                        }`}
                        title={`Sort by ${c.label.toLowerCase()}`}
                      >
                        {c.label}
                        <span className="text-[9px] text-gencom-stone/80">{arrow}</span>
                      </button>
                    </th>
                  );
                })
              )}
              {visibleMonths.map((m) => (
                <th
                  key={m}
                  className="px-2 py-2 text-right font-semibold border-b border-gencom-sand"
                >
                  {MONTH_LABELS[m - 1]}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold border-b border-gencom-sand whitespace-nowrap">
                {validYear} total
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedLines.map((line) => (
              <CashflowRow
                key={line.id}
                line={line}
                year={validYear}
                visibleMonths={visibleMonths}
                metaCols={visibleMetaCols}
                onLineUpdated={onLineUpdated}
              />
            ))}
            <tr className="bg-gencom-mist/40 border-t-2 border-gencom-sand">
              {visibleMetaCols.length === 0 ? (
                <td className="px-3 py-2 text-[11px] uppercase tracking-wider text-gencom-stone font-semibold">
                  Total
                </td>
              ) : (
                visibleMetaCols.map((c, i) => (
                  <td
                    key={c.id}
                    className="px-3 py-2 text-[11px] uppercase tracking-wider text-gencom-stone font-semibold"
                  >
                    {i === 0 ? "Total" : ""}
                  </td>
                ))
              )}
              {monthTotals.map((t, idx) => (
                <td
                  key={idx}
                  className="px-2 py-2 text-right font-mono font-semibold text-gencom-ink"
                >
                  {t > 0 ? fmtMoney(t) : "—"}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono font-bold text-gencom-ink">
                {fmtMoney(yearTotals[validYear] ?? 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gencom-stone italic">
        Click any cell to edit. Spend on the budget table rolls up from these monthly values.
      </p>
    </div>
  );
}


function CashflowRow({
  line,
  year,
  visibleMonths,
  metaCols,
  onLineUpdated,
}: {
  line: CapexLine;
  year: number;
  visibleMonths: number[];
  metaCols: { id: "vendor" | "code" | "project_name"; label: string; width: number }[];
  onLineUpdated: (line: CapexLine) => void;
}) {
  const months = line.cashflow?.[String(year)] ?? {};
  // Sum only the in-range months — keeps the per-row year total consistent
  // with the column header / footer totals when months are clipped.
  const yearTotal = visibleMonths.reduce(
    (acc, m) => acc + (Number(months[String(m)] ?? 0) || 0),
    0,
  );
  function metaValue(col: "vendor" | "code" | "project_name"): string {
    if (col === "vendor") return line.vendor ?? "—";
    if (col === "code") return line.code ?? "—";
    return line.project_name ?? "—";
  }

  async function patchCell(month: number, value: number) {
    const newCashflow: Record<string, Record<string, number>> = {};
    // Deep clone existing.
    for (const [y, ms] of Object.entries(line.cashflow ?? {})) {
      newCashflow[y] = { ...ms };
    }
    if (!newCashflow[String(year)]) newCashflow[String(year)] = {};
    newCashflow[String(year)][String(month)] = value;

    // Roll the new year sum into year_data.spend so the budget table reflects
    // it without a refetch.
    const newYearData: Record<string, { forecast?: number; spend?: number }> = {};
    for (const [y, info] of Object.entries(line.year_data ?? {})) {
      newYearData[y] = { ...info };
    }
    const yearSum = Object.values(newCashflow[String(year)]).reduce(
      (acc, v) => acc + (Number(v) || 0),
      0,
    );
    newYearData[String(year)] = {
      ...(newYearData[String(year)] ?? {}),
      spend: yearSum,
      forecast: newYearData[String(year)]?.forecast ?? 0,
    };

    try {
      const updated = await capexApi.updateLine(line.id, {
        cashflow: newCashflow,
        year_data: newYearData,
      });
      onLineUpdated(updated);
    } catch (e) {
      console.error("[cashflow] patch failed", e);
    }
  }

  return (
    <tr className="border-t border-gencom-sand/60 hover:bg-gencom-mist/20">
      {metaCols.length === 0 ? (
        // No meta cols visible — fall back to a compact one-cell summary so
        // the row still has an identifying anchor on the left.
        <td className="px-3 py-1.5 align-top">
          <div className="text-[10px] text-gencom-stone truncate">
            {[line.code, line.vendor, line.project_name].filter(Boolean).join(" · ") || "—"}
          </div>
        </td>
      ) : (
        metaCols.map((c) => (
          <td key={c.id} className="px-3 py-1.5 align-top">
            <div className="text-gencom-ink font-medium truncate" title={metaValue(c.id)}>
              {metaValue(c.id)}
            </div>
          </td>
        ))
      )}
      {visibleMonths.map((m) => {
        const v = Number(months[String(m)] ?? 0) || 0;
        return (
          <CashflowCell
            key={m}
            value={v}
            onCommit={(next) => patchCell(m, next)}
          />
        );
      })}
      <td className="px-3 py-1.5 text-right font-mono font-semibold text-gencom-ink">
        {yearTotal > 0 ? fmtMoney(yearTotal) : "—"}
      </td>
    </tr>
  );
}


function CashflowCell({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(String(value));

  if (!editing) {
    return (
      <td
        className="px-2 py-1.5 text-right font-mono cursor-text hover:bg-gencom-gold/10 overflow-hidden"
        onClick={() => {
          // Round when seeding the draft so we don't show
          // "28804.149999999998" — it's just float drift from a prior rollup.
          setDraft(value === 0 ? "" : String(Math.round(value * 100) / 100));
          setEditing(true);
        }}
      >
        <span className={value > 0 ? "text-gencom-ink" : "text-gencom-stone/40"}>
          {value > 0 ? fmtMoney(value) : "—"}
        </span>
      </td>
    );
  }

  function commit() {
    setEditing(false);
    const raw = Number(draft.replace(/[$,\s]/g, "")) || 0;
    // Round to cents to keep the stored value stable across edit cycles.
    const num = Math.round(raw * 100) / 100;
    if (num !== value) onCommit(num);
  }

  return (
    // overflow-hidden + min-w-0 keep the input from making the td grow when
    // the user types a long decimal; the table-layout: fixed width on the
    // <col> still wins.
    <td className="px-1 py-0.5 overflow-hidden">
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(String(value));
            setEditing(false);
          }
        }}
        className="block w-full min-w-0 px-1.5 py-1 border border-gencom-gold rounded text-right font-mono text-xs"
      />
    </td>
  );
}


function ImportCashflowModal({
  projectId,
  hotelId,
  onClose,
  onApplied,
}: {
  projectId: string;
  hotelId?: string;
  onClose: () => void;
  onApplied: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const r = await capexApi.importCashflow(projectId, file, hotelId);
      setResult(r);
      await onApplied();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl border-2 border-gencom-sand shadow-2xl w-full max-w-lg">
        <div className="px-5 py-3 border-b border-gencom-sand flex items-center justify-between">
          <div>
            <div className="t-eyebrow">Import cashflow</div>
            <h2 className="font-display text-lg font-bold text-gencom-ink uppercase tracking-wide">
              Upload xlsx
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gencom-stone hover:text-gencom-ink text-xl leading-none px-2"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-3">
          {!result && (
            <>
              <p className="text-xs text-gencom-stone">
                Upload an xlsx using the same column layout as the Export
                (line code in column A, monthly values under year banners).
                Rows are matched to existing budget lines by code; values
                overwrite the cashflow for the years included in the file.
              </p>
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFile(f);
                }}
                className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition ${
                  dragOver
                    ? "border-gencom-gold bg-gencom-gold/10"
                    : "border-gencom-sand bg-gencom-mist/40 hover:border-gencom-stone"
                } ${busy ? "opacity-60 pointer-events-none" : ""}`}
              >
                <div className="text-3xl mb-1">{busy ? "⏳" : "📥"}</div>
                <div className="text-sm font-semibold text-gencom-ink">
                  {busy ? "Importing…" : "Drop xlsx or click to choose"}
                </div>
                <div className="text-[11px] text-gencom-stone mt-1">.xlsx only</div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
              </div>
              {error && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {error}
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-2 text-xs">
              <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800">
                Updated <span className="font-semibold">{result.matched_count}</span> line
                {result.matched_count === 1 ? "" : "s"}.
              </div>
              {result.unmatched.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  <div className="font-semibold mb-1">
                    {result.unmatched.length} unmatched row
                    {result.unmatched.length === 1 ? "" : "s"} (no line with that code):
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5 max-h-40 overflow-y-auto">
                    {result.unmatched.map((u) => (
                      <li key={u.row}>
                        Row {u.row}: <span className="font-mono">{u.code}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gencom-sand flex items-center justify-end gap-2 bg-gencom-mist/30">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
          >
            {result ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
