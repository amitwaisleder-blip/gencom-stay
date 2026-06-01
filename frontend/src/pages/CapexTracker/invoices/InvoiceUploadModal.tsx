import { useEffect, useMemo, useRef, useState } from "react";
import { capexApi, fmtMoney } from "../lib/capexApi";
import type {
  CapexInvoice,
  CapexLine,
  CapexProject,
  InvoiceParseLineMatch,
  InvoiceParseResult,
  InvoiceSplit,
} from "../lib/types";
import { FieldLabel, GhostButton, PrimaryButton, TextInput } from "../wizards/sharedWizardUI";
import { SaveCopyButton } from "../components/SaveCopyButton";

type UploadConflict = {
  kind: "duplicate" | "missing_vendor" | "missing_invoice_number" | "date_out_of_range" | "zero_amount";
  detail: string;
};

type Stage = "pick" | "parsing" | "review" | "saving" | "done";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function InvoiceUploadModal({
  project,
  allLines,
  preselectedLineId,
  onClose,
  onApplied,
}: {
  project: CapexProject;
  allLines: CapexLine[];
  /** When set, pre-selects this line as the match so the upload flow opens
   *  ready to attribute the invoice to it. The user can still re-pick
   *  another line in the review stage. */
  preselectedLineId?: string;
  onClose: () => void;
  onApplied: (updatedLines: CapexLine[]) => void;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<InvoiceParseResult | null>(null);
  // Keep the original File around so the post-parse "Save a copy" button
  // can write the same bytes the user uploaded into the user's chosen
  // folder (Box, Desktop, etc.).
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Backdrop click was dismissing the modal mid-edit (clicking between
  // fields, dropdowns closing onto the backdrop, etc.). Escape + the
  // explicit Cancel/× buttons + Save are the only ways out now.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // User-edited fields after parse
  const [vendor, setVendor] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [totalAmount, setTotalAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [appliedYear, setAppliedYear] = useState<number>(new Date().getFullYear());
  const [appliedMonth, setAppliedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedLineId, setSelectedLineId] = useState<string>(preselectedLineId ?? "");

  // Multi-line splits
  const [splitMode, setSplitMode] = useState<boolean>(false);
  const [splits, setSplits] = useState<InvoiceSplit[]>([]);

  // Existing invoices on this project — used to flag duplicates during review.
  // Fetched once on mount; cheap because the list is small per project.
  const [existingInvoices, setExistingInvoices] = useState<CapexInvoice[]>([]);
  useEffect(() => {
    let cancelled = false;
    capexApi
      .listInvoices(project.id)
      .then((rows) => {
        if (!cancelled) setExistingInvoices(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const lineMap = useMemo(() => {
    const m = new Map<string, CapexLine>();
    allLines.forEach((l) => m.set(l.id, l));
    return m;
  }, [allLines]);

  // Conflicts surface in review stage as a soft warning banner — they don't
  // block submit, but they catch obvious mistakes before the user commits.
  const conflicts = useMemo<UploadConflict[]>(() => {
    if (stage !== "review" || !parsed) return [];
    const out: UploadConflict[] = [];
    const v = vendor.trim();
    const n = invoiceNumber.trim();
    if (!v) out.push({ kind: "missing_vendor", detail: "Vendor is empty — Claude couldn't extract one and you haven't filled it in." });
    if (!n) out.push({ kind: "missing_invoice_number", detail: "Invoice # is empty — duplicates can't be detected without it." });
    if (totalAmount <= 0) {
      out.push({ kind: "zero_amount", detail: `Amount is ${fmtMoney(totalAmount)}. Double-check the parsed total.` });
    }
    if (invoiceDate) {
      // Compare just the year. invoice_date is "YYYY-MM-DD" or similar.
      const yearMatch = invoiceDate.match(/(\d{4})/);
      const y = yearMatch ? Number(yearMatch[1]) : NaN;
      if (Number.isFinite(y) && (y < project.year_start || y > project.year_end)) {
        out.push({
          kind: "date_out_of_range",
          detail: `Invoice date ${invoiceDate} is outside the project range ${project.year_start}–${project.year_end}.`,
        });
      }
    }
    if (v && n) {
      // Duplicate detection — case-insensitive vendor + invoice_number match
      // against any existing invoice on this project.
      const dup = existingInvoices.find(
        (i) =>
          (i.vendor ?? "").trim().toLowerCase() === v.toLowerCase() &&
          (i.invoice_number ?? "").trim().toLowerCase() === n.toLowerCase(),
      );
      if (dup) {
        const when = dup.invoice_date ?? dup.created_at?.slice(0, 10) ?? "(unknown date)";
        out.push({
          kind: "duplicate",
          detail: `${v} · #${n} already exists for ${fmtMoney(dup.total_amount)} dated ${when}. Confirm this isn't the same invoice re-uploaded.`,
        });
      }
    }
    return out;
  }, [stage, parsed, vendor, invoiceNumber, totalAmount, invoiceDate, existingInvoices, project.year_start, project.year_end]);

  useEffect(() => {
    if (!parsed) return;
    setVendor(parsed.vendor ?? "");
    setInvoiceNumber(parsed.invoice_number ?? "");
    setInvoiceDate(parsed.invoice_date ?? "");
    setTotalAmount(parsed.total_amount ?? 0);
    setDescription(parsed.description ?? "");
    if (parsed.suggested_year) setAppliedYear(parsed.suggested_year);
    if (parsed.suggested_month) setAppliedMonth(parsed.suggested_month);
    if (parsed.above_threshold && parsed.best_match) {
      setSelectedLineId(parsed.best_match.line_id);
    } else if (!preselectedLineId) {
      setSelectedLineId("");
    }
    // Populate splits when Claude suggested any. Default to split mode if 2+
    // splits were proposed, since that means the invoice clearly covers
    // multiple scopes — the user just needs to confirm/adjust.
    const cf = parsed.suggested_splits ?? [];
    if (cf.length > 1) {
      setSplitMode(true);
      setSplits(
        cf.map((s) => ({
          line_id: s.suggested_line_id ?? null,
          amount: s.amount,
          applied_year: parsed.suggested_year ?? null,
          applied_month: parsed.suggested_month ?? null,
          label: s.label,
          description: s.description,
          code: s.code,
        })),
      );
    } else {
      setSplitMode(false);
      setSplits([]);
    }
  }, [parsed]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    setPickedFile(file);
    setError(null);
    setStage("parsing");
    try {
      const r = await capexApi.uploadInvoice(project.id, file);
      setParsed(r);
      setStage("review");
    } catch (e) {
      setError(String(e));
      setStage("pick");
    }
  }

  async function applyInvoice() {
    if (!parsed) return;
    if (splitMode) {
      const validSplits = splits.filter((s) => s.line_id && s.amount > 0);
      if (validSplits.length === 0) {
        setError("Add at least one split with a line and amount.");
        return;
      }
      const sumSplits = validSplits.reduce((a, s) => a + s.amount, 0);
      if (Math.abs(sumSplits - totalAmount) > 1) {
        setError(
          `Splits sum to ${sumSplits.toFixed(2)} but invoice total is ${totalAmount.toFixed(2)}. ` +
            "Adjust amounts so they match (or override the invoice total).",
        );
        return;
      }
    } else if (!selectedLineId) {
      setError("Pick a budget line to apply this invoice to.");
      return;
    }
    if (appliedYear < project.year_start || appliedYear > project.year_end) {
      setError(`Year must be between ${project.year_start} and ${project.year_end}.`);
      return;
    }
    setError(null);
    setStage("saving");
    try {
      const payload = splitMode
        ? {
            splits: splits
              .filter((s) => s.line_id && s.amount > 0)
              .map((s) => ({
                ...s,
                applied_year: s.applied_year ?? appliedYear,
                applied_month: s.applied_month ?? appliedMonth,
              })),
            vendor: vendor || null,
            invoice_number: invoiceNumber || null,
            invoice_date: invoiceDate || null,
            total_amount: totalAmount,
            description: description || null,
            match_status: "manual" as const,
          }
        : {
            line_id: selectedLineId,
            applied_year: appliedYear,
            applied_month: appliedMonth,
            vendor: vendor || null,
            invoice_number: invoiceNumber || null,
            invoice_date: invoiceDate || null,
            total_amount: totalAmount,
            description: description || null,
            match_status:
              parsed.above_threshold && parsed.best_match?.line_id === selectedLineId
                ? ("matched" as const)
                : ("manual" as const),
          };
      await capexApi.applyInvoice(project.id, parsed.invoice_id, payload);
      // Re-fetch the affected hotel's lines so the parent table sees the
      // updated spend.
      const line = lineMap.get(selectedLineId);
      if (line) {
        const updatedLines = await capexApi.listLines(line.hotel_id);
        onApplied(updatedLines);
      } else {
        onApplied([]);
      }
      setStage("done");
    } catch (e) {
      setError(String(e));
      setStage("review");
    }
  }

  const headerTitle =
    stage === "review"
      ? "Confirm invoice match"
      : stage === "done"
      ? "Invoice applied"
      : "Upload invoice";

  return (
    <div
      className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="t-eyebrow">Invoice intake</div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-gencom-ink">
              {headerTitle}
            </h2>
            <p className="text-xs text-gencom-stone mt-1">
              Claude extracts vendor, amount, and date — and ranks every budget line by match confidence.
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

        {stage === "pick" && (
          <PickStage
            dragOver={dragOver}
            setDragOver={setDragOver}
            inputRef={inputRef}
            handleFiles={handleFiles}
          />
        )}

        {stage === "parsing" && (
          <div className="py-16 text-center">
            <Spinner large />
            <div className="text-sm text-gencom-stone mt-3">
              Parsing the invoice and scoring against {allLines.length} budget lines…
            </div>
          </div>
        )}

        {stage === "review" && parsed && conflicts.length > 0 && (
          <ConflictBanner conflicts={conflicts} />
        )}

        {stage === "review" && parsed && (
          <ReviewStage
            parsed={parsed}
            allLines={allLines}
            project={project}
            vendor={vendor}
            setVendor={setVendor}
            invoiceNumber={invoiceNumber}
            setInvoiceNumber={setInvoiceNumber}
            invoiceDate={invoiceDate}
            setInvoiceDate={setInvoiceDate}
            totalAmount={totalAmount}
            setTotalAmount={setTotalAmount}
            description={description}
            setDescription={setDescription}
            appliedYear={appliedYear}
            setAppliedYear={setAppliedYear}
            appliedMonth={appliedMonth}
            setAppliedMonth={setAppliedMonth}
            selectedLineId={selectedLineId}
            setSelectedLineId={setSelectedLineId}
            lineMap={lineMap}
            splitMode={splitMode}
            setSplitMode={setSplitMode}
            splits={splits}
            setSplits={setSplits}
          />
        )}

        {stage === "saving" && (
          <div className="py-16 text-center">
            <Spinner large />
            <div className="text-sm text-gencom-stone mt-3">Applying invoice to the line…</div>
          </div>
        )}

        {stage === "done" && (
          <div className="py-12 text-center">
            <div className="text-5xl mb-2">✓</div>
            <div className="font-display text-lg uppercase tracking-wide text-gencom-ink">
              Invoice applied
            </div>
            <p className="text-sm text-gencom-stone mt-2">
              {fmtMoney(totalAmount)} from {vendor || "—"} added to the line's {appliedYear} spend.
            </p>
            <div className="mt-5 flex justify-center">
              <SaveCopyButton
                file={pickedFile}
                kind="invoice"
                metadata={{
                  vendor,
                  invoice_number: invoiceNumber,
                  invoice_date: invoiceDate,
                  total_amount: totalAmount,
                  applied_year: appliedYear,
                  applied_month: appliedMonth,
                  project_name: project.name,
                }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          {stage === "review" && (
            <>
              <GhostButton onClick={onClose}>Cancel</GhostButton>
              <PrimaryButton onClick={applyInvoice} disabled={!selectedLineId}>
                Apply invoice
              </PrimaryButton>
            </>
          )}
          {stage === "done" && <PrimaryButton onClick={onClose}>Done</PrimaryButton>}
          {stage === "pick" && <GhostButton onClick={onClose}>Cancel</GhostButton>}
        </div>
      </div>
    </div>
  );
}


function PickStage({
  dragOver,
  setDragOver,
  inputRef,
  handleFiles,
}: {
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  handleFiles: (files: FileList | null) => void;
}) {
  return (
    <div>
      <div
        className={`relative rounded-xl border-2 border-dashed cursor-pointer transition aspect-[3/1] flex items-center justify-center ${
          dragOver
            ? "border-gencom-gold bg-gencom-gold/10"
            : "border-gencom-sand bg-gencom-mist hover:border-gencom-stone"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="text-center px-4">
          <div className="text-4xl mb-2">🧾</div>
          <div className="text-sm font-semibold text-gencom-ink">Drop an invoice here, or click to choose</div>
          <div className="text-[11px] text-gencom-stone mt-1">PDF, image (PNG/JPG/WEBP), XLSX, DOCX, CSV</div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}


function ReviewStage({
  parsed,
  allLines,
  project,
  vendor,
  setVendor,
  invoiceNumber,
  setInvoiceNumber,
  invoiceDate,
  setInvoiceDate,
  totalAmount,
  setTotalAmount,
  description,
  setDescription,
  appliedYear,
  setAppliedYear,
  appliedMonth,
  setAppliedMonth,
  selectedLineId,
  setSelectedLineId,
  lineMap,
  splitMode,
  setSplitMode,
  splits,
  setSplits,
}: {
  parsed: InvoiceParseResult;
  allLines: CapexLine[];
  project: CapexProject;
  vendor: string;
  setVendor: (v: string) => void;
  invoiceNumber: string;
  setInvoiceNumber: (v: string) => void;
  invoiceDate: string;
  setInvoiceDate: (v: string) => void;
  totalAmount: number;
  setTotalAmount: (v: number) => void;
  description: string;
  setDescription: (v: string) => void;
  appliedYear: number;
  setAppliedYear: (v: number) => void;
  appliedMonth: number;
  setAppliedMonth: (v: number) => void;
  selectedLineId: string;
  setSelectedLineId: (v: string) => void;
  lineMap: Map<string, CapexLine>;
  splitMode: boolean;
  setSplitMode: (v: boolean) => void;
  splits: InvoiceSplit[];
  setSplits: React.Dispatch<React.SetStateAction<InvoiceSplit[]>>;
}) {
  const matchBadge =
    parsed.above_threshold ? (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] uppercase tracking-wider font-semibold border border-emerald-200">
        ● High-confidence match
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[10px] uppercase tracking-wider font-semibold border border-amber-200">
        ● Needs review
      </span>
    );

  const years: number[] = [];
  for (let y = project.year_start; y <= project.year_end; y++) years.push(y);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {matchBadge}
        <span className="text-xs text-gencom-stone">
          {parsed.best_match
            ? `Best match: ${(parsed.best_match.confidence * 100).toFixed(0)}% (threshold ${(parsed.threshold * 100).toFixed(0)}%)`
            : "No matching budget line found"}
        </span>
      </div>

      {parsed.notes && (
        <div className="rounded-md border border-gencom-sand bg-gencom-mist/40 px-3 py-2 text-xs text-gencom-stone italic">
          <span className="font-semibold not-italic text-gencom-ink">Claude notes: </span>
          {parsed.notes}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <FieldLabel>Vendor</FieldLabel>
          <TextInput value={vendor} onChange={setVendor} />
        </div>
        <div>
          <FieldLabel>Invoice #</FieldLabel>
          <TextInput value={invoiceNumber} onChange={setInvoiceNumber} />
        </div>
        <div>
          <FieldLabel>Invoice date (YYYY-MM-DD)</FieldLabel>
          <TextInput value={invoiceDate} onChange={setInvoiceDate} />
        </div>
        <div>
          <FieldLabel>Amount</FieldLabel>
          <TextInput
            type="number"
            value={totalAmount}
            onChange={(v) => setTotalAmount(Number(v) || 0)}
          />
        </div>
        <div className="col-span-2 md:col-span-2">
          <FieldLabel>Description</FieldLabel>
          <TextInput value={description} onChange={setDescription} />
        </div>
      </div>

      <div className="inline-flex rounded-md border-2 border-gencom-sand bg-white overflow-hidden t-eyebrow normal-case">
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
          {parsed.suggested_splits.length > 1 && (
            <span className="ml-1 text-[9px] opacity-80">
              ({parsed.suggested_splits.length} suggested)
            </span>
          )}
        </button>
      </div>

      {splitMode ? (
        <SplitsEditor
          splits={splits}
          setSplits={setSplits}
          allLines={allLines}
          totalAmount={totalAmount}
          appliedYear={appliedYear}
          appliedMonth={appliedMonth}
        />
      ) : (
        <div className="rounded-md border-2 border-gencom-sand bg-gencom-mist/30 p-3">
          <FieldLabel required>Apply to budget line</FieldLabel>
          {parsed.matches.length > 0 ? (
            <div className="space-y-1.5">
              {parsed.matches.map((m) => (
                <MatchRow
                  key={m.line_id}
                  match={m}
                  line={lineMap.get(m.line_id)}
                  selected={selectedLineId === m.line_id}
                  onSelect={() => setSelectedLineId(m.line_id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-xs text-gencom-stone italic">
              No suggestions from Claude — pick a line manually below.
            </div>
          )}
          <div className="mt-3">
            <FieldLabel>Or pick any line manually</FieldLabel>
            <select
              value={selectedLineId}
              onChange={(e) => setSelectedLineId(e.target.value)}
              className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:border-emerald-700"
            >
              <option value="">— select a line —</option>
              {allLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {[l.code, l.group, l.category, l.project_name].filter(Boolean).join(" · ")} —{" "}
                  {fmtMoney(l.forecast_total_budget)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel required>Apply to year</FieldLabel>
          <select
            value={appliedYear}
            onChange={(e) => setAppliedYear(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel required>Apply to month</FieldLabel>
          <select
            value={appliedMonth}
            onChange={(e) => setAppliedMonth(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
          >
            {MONTHS.map((m, idx) => (
              <option key={m} value={idx + 1}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-gencom-stone">
        Default month comes from the invoice date when Claude can read it; change it if the work was actually performed in a different period.
      </p>
    </div>
  );
}


function MatchRow({
  match,
  line,
  selected,
  onSelect,
}: {
  match: InvoiceParseLineMatch;
  line: CapexLine | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  if (!line) return null;
  const conf = Math.round(match.confidence * 100);
  const confColor =
    match.confidence >= 0.75
      ? "text-emerald-700"
      : match.confidence >= 0.5
      ? "text-gencom-gold"
      : "text-red-700";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-lg border-2 transition ${
        selected
          ? "border-emerald-700 bg-emerald-50"
          : "border-gencom-sand bg-white hover:border-emerald-700 hover:bg-emerald-50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-gencom-ink font-semibold truncate">
            {[line.code, line.project_name].filter(Boolean).join(" · ") || "Untitled line"}
          </div>
          <div className="text-[11px] text-gencom-stone truncate">
            {[line.group, line.category, line.vendor].filter(Boolean).join(" · ")}
          </div>
          {match.reason && (
            <div className="text-[11px] text-gencom-stone/80 italic mt-0.5 line-clamp-2">
              {match.reason}
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`text-sm font-bold ${confColor}`}>{conf}%</div>
          <div className="text-[10px] text-gencom-stone uppercase tracking-wider">
            {fmtMoney(line.forecast_total_budget)}
          </div>
        </div>
      </div>
    </button>
  );
}


function Spinner({ large }: { large?: boolean }) {
  const size = large ? "h-8 w-8" : "h-3 w-3";
  return (
    <svg className={`animate-spin ${size} mx-auto text-gencom-gold`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}


export function SplitsEditor({
  splits,
  setSplits,
  allLines,
  totalAmount,
  appliedYear,
  appliedMonth,
}: {
  splits: InvoiceSplit[];
  setSplits: React.Dispatch<React.SetStateAction<InvoiceSplit[]>>;
  allLines: CapexLine[];
  totalAmount: number;
  appliedYear: number;
  appliedMonth: number;
}) {
  const sumSplits = splits.reduce((acc, s) => acc + (s.amount || 0), 0);
  const diff = totalAmount - sumSplits;

  function patch(idx: number, p: Partial<InvoiceSplit>) {
    setSplits((prev) => prev.map((s, i) => (i === idx ? { ...s, ...p } : s)));
  }

  function add() {
    setSplits((prev) => [
      ...prev,
      {
        line_id: null,
        amount: Math.max(diff, 0),
        applied_year: appliedYear,
        applied_month: appliedMonth,
        label: null,
      },
    ]);
  }

  function remove(idx: number) {
    setSplits((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="rounded-md border-2 border-gencom-sand bg-gencom-mist/30 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="t-eyebrow">Apply to multiple budget lines</div>
        <div className="text-[11px] text-gencom-stone">
          Sum of splits:{" "}
          <span
            className={`font-semibold tabular-nums ${
              Math.abs(diff) < 1
                ? "text-emerald-700"
                : "text-amber-700"
            }`}
          >
            {fmtMoney(sumSplits)}
          </span>{" "}
          / total {fmtMoney(totalAmount)}
          {Math.abs(diff) >= 1 && (
            <span className="ml-2 text-amber-700">
              ({diff > 0 ? "+" : ""}
              {fmtMoney(diff)} unallocated)
            </span>
          )}
        </div>
      </div>

      {splits.length === 0 ? (
        <div className="text-xs text-gencom-stone italic px-1 py-2">
          No splits yet. Click "+ Add split" to start, or switch to Single line.
        </div>
      ) : (
        <div className="space-y-2">
          {splits.map((s, idx) => (
            <SplitRow
              key={idx}
              split={s}
              allLines={allLines}
              onChange={(p) => patch(idx, p)}
              onRemove={() => remove(idx)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="text-xs uppercase tracking-wider font-semibold text-gencom-stone hover:text-emerald-700"
      >
        + Add split
      </button>
    </div>
  );
}


function SplitRow({
  split,
  allLines,
  onChange,
  onRemove,
}: {
  split: InvoiceSplit;
  allLines: CapexLine[];
  onChange: (p: Partial<InvoiceSplit>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-gencom-sand bg-white px-3 py-2">
      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <FieldLabel>Budget line</FieldLabel>
          <select
            value={split.line_id ?? ""}
            onChange={(e) => onChange({ line_id: e.target.value || null })}
            className="w-full px-2 py-1.5 border border-gencom-sand rounded-md text-xs focus:outline-none focus:border-emerald-700"
          >
            <option value="">— select a line —</option>
            {allLines.map((l) => (
              <option key={l.id} value={l.id}>
                {[l.code, l.group, l.category, l.project_name].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </div>
        <div className="w-32">
          <FieldLabel>Amount</FieldLabel>
          <input
            type="number"
            value={split.amount}
            onChange={(e) => onChange({ amount: Number(e.target.value) || 0 })}
            className="w-full px-2 py-1.5 border border-gencom-sand rounded-md text-xs text-right font-mono focus:outline-none focus:border-emerald-700"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] text-red-600 hover:text-red-800 px-2 py-1.5"
          title="Remove this split"
        >
          ✕
        </button>
      </div>
      {(split.label || split.description || split.code) && (
        <div className="mt-1 text-[10px] text-gencom-stone italic line-clamp-2">
          {[split.code && `[${split.code}]`, split.label, split.description].filter(Boolean).join(" — ")}
        </div>
      )}
    </div>
  );
}


function ConflictBanner({ conflicts }: { conflicts: UploadConflict[] }) {
  // Soft warning shown above the review form. Doesn't block submit — the user
  // may have a legitimate reason to proceed (e.g. a re-issued invoice with
  // the same number). Surface it loudly enough that they don't miss it.
  const KIND_LABEL: Record<UploadConflict["kind"], string> = {
    duplicate: "Duplicate",
    missing_vendor: "Missing vendor",
    missing_invoice_number: "Missing invoice #",
    date_out_of_range: "Date out of range",
    zero_amount: "Zero amount",
  };
  return (
    <div className="mb-4 rounded-md border-2 border-amber-300 bg-amber-50 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-amber-900 text-sm font-semibold">
          ⚠ {conflicts.length === 1 ? "1 possible conflict" : `${conflicts.length} possible conflicts`}
        </span>
        <span className="text-[11px] text-amber-800/80">
          You can still apply this invoice — review each item below first.
        </span>
      </div>
      <ul className="space-y-1">
        {conflicts.map((c, idx) => (
          <li key={idx} className="flex items-start gap-2 text-[12px] text-amber-900">
            <span
              className={`mt-0.5 inline-block px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-semibold flex-shrink-0 ${
                c.kind === "duplicate"
                  ? "bg-red-100 text-red-800"
                  : "bg-amber-100 text-amber-900"
              }`}
            >
              {KIND_LABEL[c.kind]}
            </span>
            <span className="leading-snug">{c.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
