import { useEffect, useState } from "react";
import { SplitsEditor } from "./InvoiceUploadModal";
import { capexApi, fmtMoney } from "../lib/capexApi";
import type { CapexInvoice, CapexLine, CapexProject, InvoiceSplit } from "../lib/types";
import {
  FieldLabel,
  GhostButton,
  PrimaryButton,
  TextInput,
} from "../wizards/sharedWizardUI";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function InvoiceEditModal({
  invoice,
  project,
  allLines,
  onClose,
  onSaved,
  onDeleted,
}: {
  invoice: CapexInvoice;
  project: CapexProject;
  allLines: CapexLine[];
  onClose: () => void;
  onSaved: (updated: CapexInvoice) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<CapexInvoice>(invoice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [splitMode, setSplitMode] = useState<boolean>((invoice.splits ?? []).length > 0);
  const [splits, setSplits] = useState<InvoiceSplit[]>(invoice.splits ?? []);

  useEffect(() => {
    setDraft(invoice);
    setSplits(invoice.splits ?? []);
    setSplitMode((invoice.splits ?? []).length > 0);
  }, [invoice]);

  function patch(p: Partial<CapexInvoice>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const validSplits = splitMode ? splits.filter((s) => s.line_id && (s.amount || 0) > 0) : [];
      if (splitMode && validSplits.length === 0) {
        setError("Add at least one split with a line and amount, or switch to single-line.");
        setSaving(false);
        return;
      }
      if (splitMode) {
        const sumSplits = validSplits.reduce((a, s) => a + (s.amount || 0), 0);
        if (Math.abs(sumSplits - draft.total_amount) > 1) {
          setError(
            `Splits sum to ${sumSplits.toFixed(2)} but invoice total is ${draft.total_amount.toFixed(2)}. ` +
              "Adjust amounts so they match (or change the invoice total).",
          );
          setSaving(false);
          return;
        }
      }
      const updated = await capexApi.updateInvoice(invoice.id, {
        line_id: splitMode ? validSplits[0]?.line_id ?? null : draft.line_id,
        vendor: draft.vendor,
        invoice_number: draft.invoice_number,
        invoice_date: draft.invoice_date,
        total_amount: draft.total_amount,
        description: draft.description,
        applied_year: splitMode ? validSplits[0]?.applied_year ?? null : draft.applied_year,
        applied_month: splitMode ? validSplits[0]?.applied_month ?? null : draft.applied_month,
        splits: splitMode ? validSplits : null,
        match_status: draft.match_status === "pending" ? "manual" : draft.match_status,
        date_paid: draft.date_paid,
        payment_notes: draft.payment_notes,
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
      await capexApi.deleteInvoice(invoice.id);
      onDeleted(invoice.id);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  const years: number[] = [];
  for (let y = project.year_start; y <= project.year_end; y++) years.push(y);

  const isPaid = !!(draft.date_paid && draft.date_paid.trim());

  return (
    <div
      className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="t-eyebrow">Invoice</div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-gencom-ink">
              {draft.vendor || draft.invoice_number || "Untitled invoice"}
            </h2>
            <p className="text-xs text-gencom-stone mt-1">
              {draft.original_filename ? draft.original_filename : "—"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gencom-stone hover:text-gencom-ink text-xl w-8 h-8 rounded-md hover:bg-gencom-mist"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Preview / open file */}
        <div className="mb-5 rounded-lg border-2 border-gencom-sand bg-gencom-mist/40 px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="t-eyebrow">Source file</div>
            <div className="text-sm text-gencom-ink mt-0.5 truncate" title={draft.original_filename ?? ""}>
              {draft.original_filename ?? "—"}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className={`text-xs px-3 py-1.5 rounded-md border whitespace-nowrap transition ${
                previewOpen
                  ? "border-emerald-700 bg-emerald-700 text-white font-semibold hover:bg-emerald-800"
                  : "border-gencom-sand bg-white text-gencom-stone hover:text-emerald-700 hover:border-emerald-700"
              }`}
              title={previewOpen ? "Hide inline preview" : "Preview the file inline below"}
            >
              {previewOpen ? "✓ Previewing" : "👁 Preview"}
            </button>
            <a
              href={draft.file_path}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone whitespace-nowrap"
            >
              Open file ↗
            </a>
          </div>
        </div>

        {previewOpen && (
          <div className="mb-5 rounded-lg border-2 border-gencom-sand bg-gencom-mist/20 overflow-hidden">
            <FilePreview src={draft.file_path} filename={draft.original_filename ?? ""} />
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <FieldLabel>Vendor</FieldLabel>
            <TextInput value={draft.vendor ?? ""} onChange={(v) => patch({ vendor: v || null })} />
          </div>
          <div>
            <FieldLabel>Invoice #</FieldLabel>
            <TextInput
              value={draft.invoice_number ?? ""}
              onChange={(v) => patch({ invoice_number: v || null })}
            />
          </div>
          <div>
            <FieldLabel>Invoice date (YYYY-MM-DD)</FieldLabel>
            <TextInput
              value={draft.invoice_date ?? ""}
              onChange={(v) => patch({ invoice_date: v || null })}
            />
          </div>
          <div>
            <FieldLabel>Amount</FieldLabel>
            <TextInput
              type="number"
              value={draft.total_amount}
              onChange={(v) => patch({ total_amount: Number(v) || 0 })}
            />
          </div>
          <div className="col-span-2">
            <FieldLabel>Description</FieldLabel>
            <TextInput
              value={draft.description ?? ""}
              onChange={(v) => patch({ description: v || null })}
            />
          </div>
        </div>

        <div className="mt-5">
          <div className="inline-flex rounded-md border-2 border-gencom-sand bg-white overflow-hidden t-eyebrow normal-case mb-2">
            <button
              type="button"
              onClick={() => setSplitMode(false)}
              className={`px-4 py-1.5 transition ${
                !splitMode
                  ? "bg-emerald-700 text-white"
                  : "text-gencom-stone hover:text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              Single line
            </button>
            <button
              type="button"
              onClick={() => setSplitMode(true)}
              className={`px-4 py-1.5 border-l-2 border-gencom-sand transition ${
                splitMode
                  ? "bg-emerald-700 text-white"
                  : "text-gencom-stone hover:text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              Split across lines{" "}
              {splits.length > 0 && (
                <span className="ml-1 text-[9px] opacity-80">({splits.length})</span>
              )}
            </button>
          </div>

          {splitMode ? (
            <SplitsEditor
              splits={splits}
              setSplits={setSplits}
              allLines={allLines}
              totalAmount={draft.total_amount}
              appliedYear={draft.applied_year ?? project.year_start}
              appliedMonth={draft.applied_month ?? 1}
            />
          ) : (
            <div className="rounded-md border-2 border-gencom-sand bg-gencom-mist/30 p-4">
              <FieldLabel required>Applied to budget line</FieldLabel>
              <select
                value={draft.line_id ?? ""}
                onChange={(e) => patch({ line_id: e.target.value || null })}
                className="w-full px-3 py-2 border border-gencom-sand rounded-md t-body bg-white focus:outline-none focus:border-emerald-700"
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
                    value={draft.applied_year ?? ""}
                    onChange={(e) => patch({ applied_year: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gencom-sand rounded-md t-body bg-white focus:outline-none focus:border-emerald-700"
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
                    value={draft.applied_month ?? ""}
                    onChange={(e) => patch({ applied_month: e.target.value ? Number(e.target.value) : null })}
                    className="w-full px-3 py-2 border border-gencom-sand rounded-md t-body bg-white focus:outline-none focus:border-emerald-700"
                  >
                    <option value="">—</option>
                    {MONTHS.map((m, idx) => (
                      <option key={m} value={idx + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 rounded-md border-2 border-gencom-sand bg-white p-4">
          <FieldLabel>Payment status</FieldLabel>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="date"
              value={draft.date_paid ?? ""}
              onChange={(e) => patch({ date_paid: e.target.value || null })}
              className="px-2 py-1 border border-gencom-sand rounded text-sm focus:outline-none focus:border-emerald-700"
            />
            {isPaid ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] uppercase tracking-wider font-semibold border border-emerald-200">
                ● Paid
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] uppercase tracking-wider font-semibold border border-amber-200">
                ● Unpaid
              </span>
            )}
            {isPaid && (
              <button
                type="button"
                onClick={() => patch({ date_paid: null })}
                className="text-[11px] text-red-600 hover:text-red-800"
              >
                Clear date paid
              </button>
            )}
          </div>
          <div className="mt-3">
            <FieldLabel>Payment notes</FieldLabel>
            <textarea
              value={draft.payment_notes ?? ""}
              onChange={(e) => patch({ payment_notes: e.target.value || null })}
              rows={2}
              className="w-full px-3 py-2 border border-gencom-sand rounded-md t-body bg-white focus:outline-none focus:border-emerald-700"
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-700">Delete this invoice?</span>
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
              Delete invoice
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
    </div>
  );
}


function FilePreview({ src, filename }: { src: string; filename: string }) {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext);
  const isPdf = ext === "pdf";

  if (isImage) {
    return (
      <div className="bg-white max-h-[60vh] overflow-y-auto p-3 flex justify-center">
        <img src={src} alt={filename} className="max-w-full h-auto" />
      </div>
    );
  }
  if (isPdf) {
    return (
      <iframe
        src={src}
        title={filename}
        className="w-full h-[60vh] bg-white"
      />
    );
  }
  // Excel / DOCX / CSV / unknown — browsers can't render these inline; show
  // a friendly fallback instead of a broken iframe.
  return (
    <div className="bg-white p-6 text-center">
      <div className="text-sm text-gencom-stone">
        Inline preview isn't supported for <span className="font-mono">{ext || "this"}</span> files.
      </div>
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
      >
        Download / open in a new tab ↗
      </a>
    </div>
  );
}
