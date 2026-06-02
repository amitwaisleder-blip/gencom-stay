import { useEffect, useMemo, useState } from "react";
import { capexApi, fmtDateShort, fmtMoney } from "../lib/capexApi";
import {
  LINE_STATUS_OPTIONS,
  type BreakdownItem,
  type CapexDocument,
  type CapexLine,
  type CapexLineStatus,
  type CapexProject,
} from "../lib/types";
import { FieldLabel, GhostButton, PrimaryButton, TextInput } from "../wizards/sharedWizardUI";
import { statusLabel, statusPillClasses } from "./helpers";
import { InvoiceUploadModal } from "../invoices/InvoiceUploadModal";
import { UploadBudgetModal } from "./UploadBudgetModal";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatCurrency(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseCurrency(s: string): number {
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function CurrencyInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const display = focused ? draft : formatCurrency(value || 0);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={() => {
        setDraft(value ? String(value) : "");
        setFocused(true);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        onChange(parseCurrency(raw));
      }}
      onBlur={() => setFocused(false)}
      className={className}
    />
  );
}

export function RowEditModal({
  line,
  yearStart,
  yearEnd,
  project,
  allLines,
  onClose,
  onSaved,
  onDeleted,
  onLinesChanged,
}: {
  line: CapexLine;
  yearStart: number;
  yearEnd: number;
  /** Current project + every line on this hotel — used to power the in-modal
   *  invoice and budget upload flows that are scoped to this specific line. */
  project: CapexProject;
  allLines: CapexLine[];
  onClose: () => void;
  onSaved: (updated: CapexLine) => void;
  onDeleted: (id: string) => void;
  /** Called whenever an in-modal upload (invoice / budget) modifies one or
   *  more lines. The parent merges the updates into its own `lines` state so
   *  the table reflects the change after the modal closes. */
  onLinesChanged: (updated: CapexLine[]) => void;
}) {
  const [draft, setDraft] = useState<CapexLine>(line);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [documents, setDocuments] = useState<CapexDocument[] | null>(null);
  const [periodMode, setPeriodMode] = useState<"year" | "month">("year");
  const [editingBreakdown, setEditingBreakdown] = useState(false);
  const [invoiceUploadOpen, setInvoiceUploadOpen] = useState(false);
  const [budgetUploadOpen, setBudgetUploadOpen] = useState(false);

  useEffect(() => {
    setDraft(line);
  }, [line]);

  useEffect(() => {
    let cancelled = false;
    capexApi
      .listLineDocuments(line.id)
      .then((rows) => {
        if (!cancelled) setDocuments(rows);
      })
      .catch(() => {
        if (!cancelled) setDocuments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [line.id]);

  async function detachDocument(docId: string) {
    try {
      await capexApi.deleteDocument(docId);
      setDocuments((prev) => (prev ?? []).filter((d) => d.id !== docId));
    } catch (e) {
      setError(String(e));
    }
  }

  function patch(p: Partial<CapexLine>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }

  function patchYear(year: number, key: "forecast" | "spend", value: number) {
    setDraft((prev) => {
      const yd = { ...(prev.year_data ?? {}) };
      const cur = { ...(yd[String(year)] ?? {}) };
      cur[key] = value;
      yd[String(year)] = cur;
      return { ...prev, year_data: yd };
    });
  }

  // Set monthly cashflow for a year+month and roll the year's spend total
  // back into year_data.spend so the yearly view stays in sync.
  function patchMonth(year: number, month: number, value: number) {
    setDraft((prev) => {
      const cf: Record<string, Record<string, number>> = { ...(prev.cashflow ?? {}) };
      const months = { ...(cf[String(year)] ?? {}) };
      months[String(month)] = value;
      cf[String(year)] = months;
      const yearTotal = Object.values(months).reduce((a, b) => a + (Number(b) || 0), 0);
      const yd = { ...(prev.year_data ?? {}) };
      const cur = { ...(yd[String(year)] ?? {}) };
      cur.spend = yearTotal;
      yd[String(year)] = cur;
      return { ...prev, cashflow: cf, year_data: yd };
    });
  }

  function patchBreakdown(idx: number, p: Partial<BreakdownItem>) {
    setDraft((prev) => {
      const list = [...(prev.breakdown ?? [])];
      const cur = { ...list[idx], ...p };
      // Auto-recompute total when qty + unit_cost are both numeric and the
      // edit didn't explicitly set a total. Saves the user a third field.
      if (
        ("qty" in p || "unit_cost" in p) &&
        !("total" in p) &&
        cur.qty != null &&
        cur.unit_cost != null
      ) {
        cur.total = Number(cur.qty) * Number(cur.unit_cost);
      }
      list[idx] = cur;
      return { ...prev, breakdown: list };
    });
  }

  function addBreakdownItem() {
    setDraft((prev) => ({
      ...prev,
      breakdown: [
        ...(prev.breakdown ?? []),
        { label: "", description: null, vendor: null, qty: null, unit: null, unit_cost: null, total: 0, notes: null },
      ],
    }));
  }

  function removeBreakdownItem(idx: number) {
    setDraft((prev) => {
      const list = (prev.breakdown ?? []).filter((_, i) => i !== idx);
      return { ...prev, breakdown: list.length > 0 ? list : null };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await capexApi.updateLine(draft.id, {
        code: draft.code,
        group: draft.group,
        category: draft.category,
        project_name: draft.project_name,
        description: draft.description,
        vendor: draft.vendor,
        original_total_budget: draft.original_total_budget,
        forecast_total_budget: draft.forecast_total_budget,
        notes: draft.notes,
        status: draft.status,
        year_data: draft.year_data,
        cashflow: draft.cashflow,
        breakdown: draft.breakdown,
      });
      onSaved(updated);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  async function doDelete() {
    setSaving(true);
    try {
      await capexApi.deleteLine(line.id);
      onDeleted(line.id);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  const years: number[] = [];
  for (let y = yearStart; y <= yearEnd; y++) years.push(y);

  return (
    <div
      className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="t-eyebrow">Edit line</div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-gencom-ink">
              {draft.code || draft.project_name || "Untitled line"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gencom-stone hover:text-gencom-ink text-xl w-8 h-8 rounded-md hover:bg-gencom-mist"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <FieldLabel>Code</FieldLabel>
            <TextInput value={draft.code ?? ""} onChange={(v) => patch({ code: v || null })} />
          </div>
          <div>
            <FieldLabel>Group</FieldLabel>
            <TextInput value={draft.group ?? ""} onChange={(v) => patch({ group: v || null })} />
          </div>
          <div>
            <FieldLabel>Category</FieldLabel>
            <TextInput value={draft.category ?? ""} onChange={(v) => patch({ category: v || null })} />
          </div>
          <div>
            <FieldLabel>Project name</FieldLabel>
            <TextInput
              value={draft.project_name ?? ""}
              onChange={(v) => patch({ project_name: v || null })}
            />
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <span
              className={`inline-flex w-full items-center rounded-md border px-2 py-1.5 text-sm font-semibold ${statusPillClasses(
                draft.status,
              )}`}
            >
              <select
                value={draft.status ?? ""}
                onChange={(e) =>
                  patch({ status: (e.target.value || null) as CapexLineStatus | null })
                }
                className="bg-transparent outline-none border-0 w-full text-sm font-semibold cursor-pointer appearance-none"
              >
                <option value="">{statusLabel(null)}</option>
                {LINE_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div>
            <FieldLabel>Vendor</FieldLabel>
            <TextInput value={draft.vendor ?? ""} onChange={(v) => patch({ vendor: v || null })} />
          </div>
          <div className="col-span-2 md:col-span-3">
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={draft.description ?? ""}
              onChange={(e) => patch({ description: e.target.value || null })}
              rows={2}
              className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
            />
          </div>
          <div>
            <FieldLabel>Original total budget</FieldLabel>
            <CurrencyInput
              value={draft.original_total_budget ?? 0}
              onChange={(n) => patch({ original_total_budget: n })}
              className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
            />
          </div>
          <div>
            <FieldLabel>Forecast total budget</FieldLabel>
            <CurrencyInput
              value={draft.forecast_total_budget ?? 0}
              onChange={(n) => patch({ forecast_total_budget: n })}
              className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <FieldLabel>
              {periodMode === "year" ? "Per-year forecast and spend" : "Per-month spend"}
            </FieldLabel>
            <div className="inline-flex rounded-md border-2 border-gencom-sand bg-white overflow-hidden t-eyebrow normal-case">
              <button
                type="button"
                onClick={() => setPeriodMode("year")}
                className={`px-3 py-1 transition ${
                  periodMode === "year"
                    ? "bg-gencom-green text-white"
                    : "text-gencom-stone hover:text-gencom-green hover:bg-gencom-greensoft"
                }`}
              >
                Year
              </button>
              <button
                type="button"
                onClick={() => setPeriodMode("month")}
                className={`px-3 py-1 border-l-2 border-gencom-sand transition ${
                  periodMode === "month"
                    ? "bg-gencom-green text-white"
                    : "text-gencom-stone hover:text-gencom-green hover:bg-gencom-greensoft"
                }`}
              >
                Month
              </button>
            </div>
          </div>

          {periodMode === "year" ? (
            <div className="rounded-md border border-gencom-sand overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gencom-mist/60 text-[11px] uppercase tracking-wider text-gencom-stone">
                  <tr>
                    <th className="px-3 py-2 text-left">Year</th>
                    <th className="px-3 py-2 text-right">Forecast</th>
                    <th className="px-3 py-2 text-right">Spend-to-date</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => {
                    const cur = draft.year_data?.[String(y)] ?? {};
                    return (
                      <tr key={y} className="border-t border-gencom-sand">
                        <td className="px-3 py-1.5 font-semibold text-gencom-ink">{y}</td>
                        <td className="px-3 py-1.5 text-right">
                          <CurrencyInput
                            value={cur.forecast ?? 0}
                            onChange={(n) => patchYear(y, "forecast", n)}
                            className="w-36 px-2 py-1 border border-gencom-sand rounded text-right tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <CurrencyInput
                            value={cur.spend ?? 0}
                            onChange={(n) => patchYear(y, "spend", n)}
                            className="w-36 px-2 py-1 border border-gencom-sand rounded text-right tabular-nums"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-md border border-gencom-sand overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gencom-mist/60 text-[10px] uppercase tracking-wider text-gencom-stone">
                  <tr>
                    <th className="px-2 py-1.5 text-left sticky left-0 bg-gencom-mist/60">Year</th>
                    {MONTH_LABELS.map((m) => (
                      <th key={m} className="px-1.5 py-1.5 text-right">{m}</th>
                    ))}
                    <th className="px-2 py-1.5 text-right border-l border-gencom-sand">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map((y) => {
                    const months = draft.cashflow?.[String(y)] ?? {};
                    const yearTotal = Object.values(months).reduce(
                      (a, b) => a + (Number(b) || 0),
                      0,
                    );
                    return (
                      <tr key={y} className="border-t border-gencom-sand">
                        <td className="px-2 py-1.5 font-semibold text-gencom-ink sticky left-0 bg-white">
                          {y}
                        </td>
                        {MONTH_LABELS.map((_, idx) => {
                          const m = idx + 1;
                          const v = Number(months[String(m)] ?? 0) || 0;
                          return (
                            <td key={m} className="px-0.5 py-0.5">
                              <input
                                type="number"
                                value={v}
                                onChange={(e) =>
                                  patchMonth(y, m, Number(e.target.value) || 0)
                                }
                                className="w-full px-1 py-1 border border-gencom-sand rounded text-right text-[11px] tabular-nums"
                              />
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5 text-right text-gencom-ink font-semibold border-l border-gencom-sand tabular-nums">
                          {fmtMoney(yearTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 text-[11px] text-gencom-stone">
            {periodMode === "year"
              ? "Spend will eventually be auto-rolled from invoices (Round C). For now you can record values manually."
              : "Monthly spend rolls up into the year's spend-to-date automatically."}
          </p>
        </div>

        <div className="mt-4">
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={draft.notes ?? ""}
            onChange={(e) => patch({ notes: e.target.value || null })}
            rows={2}
            className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
          />
        </div>

        {((draft.breakdown && draft.breakdown.length > 0) || editingBreakdown) && (
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <FieldLabel>
                Cost breakdown ({(draft.breakdown ?? []).length} items)
              </FieldLabel>
              <button
                type="button"
                onClick={() => setEditingBreakdown((v) => !v)}
                className={`text-xs px-3 py-1 rounded-md border whitespace-nowrap transition ${
                  editingBreakdown
                    ? "border-gencom-green bg-gencom-green text-white font-semibold hover:bg-gencom-green"
                    : "border-gencom-sand bg-white text-gencom-stone hover:text-gencom-green hover:border-gencom-green"
                }`}
                title={
                  editingBreakdown
                    ? "Lock the breakdown rows"
                    : "Edit existing items, add new ones, or remove items"
                }
              >
                {editingBreakdown ? "✓ Done" : "✎ Edit"}
              </button>
            </div>
            <div className="rounded-md border border-gencom-sand overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gencom-mist/60 text-[10px] uppercase tracking-wider text-gencom-stone">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Item</th>
                    <th className="px-3 py-1.5 text-right">Qty</th>
                    <th className="px-3 py-1.5 text-left">Unit</th>
                    <th className="px-3 py-1.5 text-right">Unit cost</th>
                    <th className="px-3 py-1.5 text-right">Total</th>
                    {editingBreakdown && <th className="px-2 py-1.5"></th>}
                  </tr>
                </thead>
                <tbody>
                  {(draft.breakdown ?? []).map((it, idx) => (
                    <tr key={idx} className="border-t border-gencom-sand/50">
                      {editingBreakdown ? (
                        <>
                          <td className="px-2 py-1.5 align-top space-y-1">
                            <input
                              type="text"
                              value={it.label ?? ""}
                              onChange={(e) => patchBreakdown(idx, { label: e.target.value })}
                              placeholder="Item label"
                              className="w-full px-2 py-1 border border-gencom-sand rounded text-[11px] font-medium"
                            />
                            <input
                              type="text"
                              value={it.vendor ?? ""}
                              onChange={(e) => patchBreakdown(idx, { vendor: e.target.value || null })}
                              placeholder="Vendor (optional)"
                              className="w-full px-2 py-1 border border-gencom-sand rounded text-[10px] text-gencom-stone"
                            />
                            <textarea
                              value={it.description ?? ""}
                              onChange={(e) =>
                                patchBreakdown(idx, { description: e.target.value || null })
                              }
                              placeholder="Description (optional)"
                              rows={1}
                              className="w-full px-2 py-1 border border-gencom-sand rounded text-[10px] text-gencom-stone resize-y"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input
                              type="number"
                              value={it.qty ?? ""}
                              onChange={(e) =>
                                patchBreakdown(idx, {
                                  qty: e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                              className="w-16 px-1.5 py-1 border border-gencom-sand rounded text-right text-[11px] tabular-nums"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input
                              type="text"
                              value={it.unit ?? ""}
                              onChange={(e) => patchBreakdown(idx, { unit: e.target.value || null })}
                              className="w-20 px-1.5 py-1 border border-gencom-sand rounded text-[11px]"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input
                              type="number"
                              value={it.unit_cost ?? ""}
                              onChange={(e) =>
                                patchBreakdown(idx, {
                                  unit_cost: e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                              className="w-24 px-1.5 py-1 border border-gencom-sand rounded text-right text-[11px] tabular-nums"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input
                              type="number"
                              value={it.total ?? 0}
                              onChange={(e) =>
                                patchBreakdown(idx, { total: Number(e.target.value) || 0 })
                              }
                              className="w-28 px-1.5 py-1 border border-gencom-sand rounded text-right text-[11px] tabular-nums font-semibold"
                            />
                          </td>
                          <td className="px-1 py-1.5 align-top text-right">
                            <button
                              type="button"
                              onClick={() => removeBreakdownItem(idx)}
                              className="text-[11px] text-red-600 hover:text-red-800"
                              title="Remove item"
                            >
                              ✕
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-1.5">
                            <div className="text-gencom-ink">{it.label || "—"}</div>
                            {it.vendor && <div className="text-[10px] text-gencom-stone">{it.vendor}</div>}
                            {it.description && (
                              <div className="text-[10px] text-gencom-stone/80 line-clamp-2">{it.description}</div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">{it.qty ?? "—"}</td>
                          <td className="px-3 py-1.5">{it.unit ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right">
                            {it.unit_cost != null ? fmtMoney(it.unit_cost) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right text-gencom-ink font-semibold">{fmtMoney(it.total)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                  <tr className="border-t border-gencom-sand bg-gencom-mist/30">
                    <td
                      colSpan={editingBreakdown ? 5 : 4}
                      className="px-3 py-1.5 text-right text-[11px] uppercase tracking-wider text-gencom-stone font-semibold"
                    >
                      Breakdown subtotal
                    </td>
                    <td
                      colSpan={editingBreakdown ? 2 : 1}
                      className="px-3 py-1.5 text-right text-gencom-ink font-bold"
                    >
                      {fmtMoney((draft.breakdown ?? []).reduce((acc, it) => acc + (it.total ?? 0), 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {editingBreakdown ? (
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={addBreakdownItem}
                  className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-green hover:border-gencom-green"
                >
                  + Add item
                </button>
                <p className="text-[10px] text-gencom-stone italic">
                  Total auto-fills from qty × unit cost when both are set; override it manually if needed.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-[10px] text-gencom-stone">
                Click <span className="font-semibold">Edit</span> to adjust an item or add a new one.
              </p>
            )}
          </div>
        )}
        {(!draft.breakdown || draft.breakdown.length === 0) && !editingBreakdown && (
          <div className="mt-5">
            <FieldLabel>Cost breakdown</FieldLabel>
            <button
              type="button"
              onClick={() => {
                setEditingBreakdown(true);
                addBreakdownItem();
              }}
              className="text-xs px-3 py-1.5 rounded-md border border-dashed border-gencom-sand bg-white text-gencom-stone hover:text-gencom-green hover:border-gencom-green"
            >
              + Add first cost-breakdown item
            </button>
          </div>
        )}

        <div className="mt-5">
          <FieldLabel>Attach a file to this line</FieldLabel>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setInvoiceUploadOpen(true)}
              className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-green hover:border-gencom-green inline-flex items-center gap-1.5"
              title="Upload a vendor invoice — pre-targeted to this line"
            >
              <span aria-hidden>🧾</span> Upload invoice
            </button>
            <button
              type="button"
              onClick={() => setBudgetUploadOpen(true)}
              className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-green hover:border-gencom-green inline-flex items-center gap-1.5"
              title="Upload a budget / proposal — sub-items roll into this line"
            >
              <span aria-hidden>📄</span> Upload budget / proposal
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gencom-stone">
            Invoice uploads pre-select this line as the match. Budget uploads default to "apply to existing line" with this line selected.
          </p>
        </div>

        {documents && documents.length > 0 && (
          <div className="mt-5">
            <FieldLabel>Attached documents ({documents.length})</FieldLabel>
            <div className="space-y-2">
              {documents.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-gencom-sand bg-gencom-mist/30 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                          d.doc_type === "contract"
                            ? "bg-gencom-greensoft text-gencom-green border border-gencom-green/20"
                            : d.doc_type === "agreement"
                            ? "bg-gencom-sand/40 text-gencom-stone border border-gencom-sand"
                            : "bg-gencom-gold/10 text-gencom-gold border border-gencom-gold/40"
                        }`}
                      >
                        {d.doc_type}
                      </span>
                      <a
                        href={d.file_path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-gencom-ink font-medium truncate hover:underline"
                        title={d.original_filename ?? ""}
                      >
                        {d.original_filename ?? d.file_path.split("/").pop()}
                      </a>
                      {d.updates_forecast && (
                        <span className="text-[10px] text-gencom-gold uppercase tracking-wider font-semibold">
                          ★ updated forecast
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gencom-stone mt-0.5 truncate">
                      {[d.vendor, d.amount != null ? fmtMoney(d.amount) : null, fmtDateShort(d.created_at)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => detachDocument(d.id)}
                    className="text-[11px] text-red-600 hover:text-red-800 whitespace-nowrap"
                    title="Detach this document (does NOT roll back the forecast)"
                  >
                    Detach
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-gencom-stone">
              Detaching removes the reference but does not undo any forecast changes the document originally caused.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-700">Delete this line?</span>
              <button
                type="button"
                onClick={doDelete}
                disabled={saving}
                className="px-3 py-1.5 rounded-md bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                Yes, delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-md border border-gencom-sand text-xs text-gencom-stone hover:text-gencom-ink"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Delete line
            </button>
          )}
          <div className="flex gap-3">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </PrimaryButton>
          </div>
        </div>
      </div>
      {invoiceUploadOpen && (
        <InvoiceUploadModal
          project={project}
          allLines={allLines}
          preselectedLineId={line.id}
          onClose={() => setInvoiceUploadOpen(false)}
          onApplied={(updatedLines) => {
            onLinesChanged(updatedLines);
            const refreshed = updatedLines.find((l) => l.id === draft.id);
            if (refreshed) setDraft(refreshed);
            setInvoiceUploadOpen(false);
          }}
        />
      )}
      {budgetUploadOpen && (
        <UploadBudgetModal
          hotelId={line.hotel_id}
          existingLines={allLines}
          preselectedLineId={line.id}
          defaultApplyMode="existing"
          onClose={() => setBudgetUploadOpen(false)}
          onCreated={(created) => {
            onLinesChanged(created);
            setBudgetUploadOpen(false);
          }}
          onAppliedToLine={(updated) => {
            onLinesChanged([updated]);
            if (updated.id === draft.id) setDraft(updated);
            setBudgetUploadOpen(false);
          }}
        />
      )}
    </div>
  );
}


export function NewLineModal({
  hotelId,
  existingVendors = [],
  onClose,
  onCreated,
}: {
  hotelId: string;
  /** Vendors already used on this project — surfaced as suggestions in the
   *  vendor combobox so the user picks instead of retyping (and instead of
   *  introducing one-off variant spellings of the same firm). */
  existingVendors?: string[];
  onClose: () => void;
  onCreated: (line: CapexLine) => void;
}) {
  const [code, setCode] = useState("");
  const [group, setGroup] = useState("");
  const [category, setCategory] = useState("");
  const [projectName, setProjectName] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [originalBudget, setOriginalBudget] = useState(0);
  const [forecastBudget, setForecastBudget] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const line = await capexApi.createLine(hotelId, {
        code: code || null,
        group: group || null,
        category: category || null,
        project_name: projectName || null,
        vendor: vendor.trim() || null,
        description: description || null,
        original_total_budget: originalBudget || 0,
        forecast_total_budget: forecastBudget || originalBudget || 0,
      });
      onCreated(line);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="t-eyebrow">Add line</div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-gencom-ink">
              New budget line
            </h2>
          </div>
          <button onClick={onClose} className="text-gencom-stone hover:text-gencom-ink text-xl w-8 h-8 rounded-md hover:bg-gencom-mist" aria-label="Close">
            ×
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <FieldLabel>Code</FieldLabel>
            <TextInput value={code} onChange={setCode} placeholder="e.g. 01.10" />
          </div>
          <div>
            <FieldLabel>Group</FieldLabel>
            <TextInput value={group} onChange={setGroup} placeholder="e.g. Hard Costs" />
          </div>
          <div>
            <FieldLabel>Category</FieldLabel>
            <TextInput value={category} onChange={setCategory} placeholder="e.g. Guestrooms" />
          </div>
          <div className="col-span-2 md:col-span-2">
            <FieldLabel>Project name</FieldLabel>
            <TextInput value={projectName} onChange={setProjectName} placeholder="e.g. Soft Goods Refresh" />
          </div>
          <div>
            <FieldLabel>Vendor</FieldLabel>
            <VendorCombobox
              value={vendor}
              onChange={setVendor}
              suggestions={existingVendors}
              placeholder="Pick or type new"
            />
          </div>
          <div className="col-span-2 md:col-span-3">
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
            />
          </div>
          <div>
            <FieldLabel>Original budget</FieldLabel>
            <TextInput type="number" value={originalBudget} onChange={(v) => setOriginalBudget(Number(v) || 0)} />
          </div>
          <div>
            <FieldLabel>Forecast budget</FieldLabel>
            <TextInput type="number" value={forecastBudget} onChange={(v) => setForecastBudget(Number(v) || 0)} />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={submitting}>
            {submitting ? "Adding…" : "Add line"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}


function VendorCombobox({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
}) {
  // Combobox: free-form text input that surfaces existing vendor names as
  // suggestions. Picking a suggestion fills the input with that exact name
  // — keeps spelling/casing consistent across lines on the same project.
  // Typing a new name is fine; the input value is the source of truth.
  const [open, setOpen] = useState(false);
  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const s of suggestions) {
      const k = s.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      dedup.push(s.trim());
    }
    if (!q) return dedup.slice(0, 8);
    return dedup
      .filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      .slice(0, 8);
  }, [value, suggestions]);

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Defer close so a click on a suggestion fires before the dropdown
          // unmounts.
          setTimeout(() => setOpen(false), 120);
        }}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 left-0 right-0 bg-white border border-gencom-sand rounded-md shadow-lg max-h-56 overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gencom-stone bg-gencom-mist/40 border-b border-gencom-sand">
            Existing vendors
          </div>
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                // mouseDown fires before the input's blur, so this commits
                // the pick before the dropdown closes.
                e.preventDefault();
                onChange(s);
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 text-sm text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {open && value.trim() && !suggestions.some((s) => s.trim().toLowerCase() === value.trim().toLowerCase()) && (
        <div className="mt-1 text-[10px] text-gencom-gold uppercase tracking-wider">
          ✦ Will create new vendor "{value.trim()}"
        </div>
      )}
    </div>
  );
}
