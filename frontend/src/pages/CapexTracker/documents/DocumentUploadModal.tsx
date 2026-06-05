import { useEffect, useRef, useState } from "react";
import { capexApi, fmtMoney } from "../lib/capexApi";
import type {
  CapexLine,
  CapexProject,
  DocType,
  DocumentParseResult,
  ForecastAction,
} from "../lib/types";
import { FieldLabel, GhostButton, PrimaryButton, TextInput } from "../wizards/sharedWizardUI";
import { SaveCopyButton } from "../components/SaveCopyButton";

type Stage = "pick" | "parsing" | "review" | "saving" | "done";

const DOC_TYPE_HELP: Record<DocType, string> = {
  contract:
    "Executed contract or change order. Default behavior: update the line's forecast budget to this amount.",
  agreement:
    "Side letter / MOU / commitment that doesn't itself commit dollars. Default: don't change the forecast.",
  proposal:
    "Vendor quote or bid. Update the forecast only if it's signed / accepted; otherwise keep the existing forecast.",
};

export function DocumentUploadModal({
  project,
  allLines,
  defaultLineId,
  onClose,
  onApplied,
}: {
  project: CapexProject;
  allLines: CapexLine[];
  /** Pre-select a line — when the modal is opened from a line's edit panel. */
  defaultLineId?: string;
  onClose: () => void;
  onApplied: (updatedLineId: string) => void;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<DocumentParseResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);

  // Backdrop click was dismissing the modal mid-edit; only Escape + the
  // explicit Cancel/× buttons + Save can close now.
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
  const [docType, setDocType] = useState<DocType>("proposal");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [selectedLineId, setSelectedLineId] = useState<string>(defaultLineId ?? "");
  const [forecastAction, setForecastAction] = useState<ForecastAction>("none");
  const [customAmount, setCustomAmount] = useState<number>(0);

  useEffect(() => {
    if (!parsed) return;
    setDocType(parsed.suggested_doc_type ?? "proposal");
    setVendor(parsed.vendor ?? "");
    setAmount(parsed.amount ?? null);
    setNotes(parsed.notes ?? "");
    // Default forecast action based on doc type:
    //   contract  → update
    //   agreement → none
    //   proposal  → none (user opts in if it's executed)
    setForecastAction(parsed.suggested_doc_type === "contract" ? "update" : "none");
    if (parsed.amount != null) setCustomAmount(parsed.amount);
  }, [parsed]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    setPickedFile(file);
    setError(null);
    setStage("parsing");
    try {
      const r = await capexApi.uploadDocument(project.id, file);
      setParsed(r);
      setStage("review");
    } catch (e) {
      setError(String(e));
      setStage("pick");
    }
  }

  async function applyDocument() {
    if (!parsed) return;
    if (!selectedLineId) {
      setError("Pick a budget line to attach this document to.");
      return;
    }
    if (forecastAction === "custom" && (customAmount == null || customAmount < 0)) {
      setError("Custom forecast amount must be non-negative.");
      return;
    }
    if (forecastAction === "update" && amount == null) {
      setError("This document has no amount — pick 'Don't change' or set a custom amount.");
      return;
    }
    setError(null);
    setStage("saving");
    try {
      await capexApi.applyDocument(parsed.document_id, {
        line_id: selectedLineId,
        doc_type: docType,
        forecast_action: forecastAction,
        custom_amount: forecastAction === "custom" ? customAmount : undefined,
        vendor: vendor || null,
        amount: amount ?? undefined,
        notes: notes || null,
      });
      onApplied(selectedLineId);
      setStage("done");
    } catch (e) {
      setError(String(e));
      setStage("review");
    }
  }

  const headerTitle =
    stage === "review"
      ? "Attach document"
      : stage === "done"
      ? "Document attached"
      : "Upload contract / proposal";

  return (
    <div
      className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="t-eyebrow">Document intake</div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-gencom-ink">
              {headerTitle}
            </h2>
            <p className="text-xs text-gencom-stone mt-1">
              Claude reads the file, suggests a document type, vendor, and amount — then asks whether to update the line's forecast budget.
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
            <div className="text-sm text-gencom-stone mt-3">Parsing the document with Claude…</div>
          </div>
        )}

        {stage === "review" && parsed && (
          <ReviewStage
            parsed={parsed}
            allLines={allLines}
            project={project}
            docType={docType}
            setDocType={setDocType}
            vendor={vendor}
            setVendor={setVendor}
            amount={amount}
            setAmount={setAmount}
            notes={notes}
            setNotes={setNotes}
            selectedLineId={selectedLineId}
            setSelectedLineId={setSelectedLineId}
            forecastAction={forecastAction}
            setForecastAction={setForecastAction}
            customAmount={customAmount}
            setCustomAmount={setCustomAmount}
          />
        )}

        {stage === "saving" && (
          <div className="py-16 text-center">
            <Spinner large />
            <div className="text-sm text-gencom-stone mt-3">Attaching document to the line…</div>
          </div>
        )}

        {stage === "done" && (
          <div className="py-12 text-center">
            <div className="text-5xl mb-2">✓</div>
            <div className="font-display text-lg uppercase tracking-wide text-gencom-ink">
              Document attached
            </div>
            <p className="text-sm text-gencom-stone mt-2">
              {forecastAction === "none"
                ? "Stored on the line as a reference."
                : forecastAction === "update"
                ? `Forecast updated to ${fmtMoney(amount ?? 0)}.`
                : `Forecast updated to ${fmtMoney(customAmount)}.`}
            </p>
            <div className="mt-5 flex justify-center">
              <SaveCopyButton
                file={pickedFile}
                kind="contract"
                metadata={{
                  doc_type: docType,
                  vendor,
                  amount,
                  notes,
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
              <PrimaryButton onClick={applyDocument} disabled={!selectedLineId}>
                Attach document
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
          <div className="text-4xl mb-2">📑</div>
          <div className="text-sm font-semibold text-gencom-ink">Drop a contract / proposal here, or click to choose</div>
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
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gencom-stone">
        <div className="rounded-md border border-gencom-sand p-3">
          <div className="font-semibold text-gencom-ink mb-1">Executed contract</div>
          Signed contract or change order — typically updates the line's forecast budget to the new contract value.
        </div>
        <div className="rounded-md border border-gencom-sand p-3">
          <div className="font-semibold text-gencom-ink mb-1">Agreement</div>
          MOU, side letter, scope acknowledgement — kept on the line as reference, doesn't move the budget.
        </div>
        <div className="rounded-md border border-gencom-sand p-3">
          <div className="font-semibold text-gencom-ink mb-1">Executed proposal</div>
          Vendor quote that's been signed / accepted. Treat like a contract for forecast purposes.
        </div>
      </div>
    </div>
  );
}


function ReviewStage({
  parsed,
  allLines,
  project,
  docType,
  setDocType,
  vendor,
  setVendor,
  amount,
  setAmount,
  notes,
  setNotes,
  selectedLineId,
  setSelectedLineId,
  forecastAction,
  setForecastAction,
  customAmount,
  setCustomAmount,
}: {
  parsed: DocumentParseResult;
  allLines: CapexLine[];
  project: CapexProject;
  docType: DocType;
  setDocType: (v: DocType) => void;
  vendor: string;
  setVendor: (v: string) => void;
  amount: number | null;
  setAmount: (v: number | null) => void;
  notes: string;
  setNotes: (v: string) => void;
  selectedLineId: string;
  setSelectedLineId: (v: string) => void;
  forecastAction: ForecastAction;
  setForecastAction: (v: ForecastAction) => void;
  customAmount: number;
  setCustomAmount: (v: number) => void;
}) {
  const selected = allLines.find((l) => l.id === selectedLineId) ?? null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-md border border-gencom-sand bg-gencom-mist/40 p-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gencom-stone">Source</div>
          <div className="text-sm text-gencom-ink font-medium truncate" title={parsed.source_filename ?? ""}>
            {parsed.source_filename ?? "—"}
          </div>
          {parsed.scope_summary && (
            <div className="text-[11px] text-gencom-stone italic mt-0.5 line-clamp-2">{parsed.scope_summary}</div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gencom-stone">Document date</div>
          <div className="text-sm text-gencom-ink font-medium">{parsed.document_date ?? "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gencom-stone">AI confidence</div>
          <div className="text-sm font-semibold">
            {parsed.confidence === "high" ? (
              <span className="text-gencom-green">high</span>
            ) : parsed.confidence === "medium" ? (
              <span className="text-gencom-gold">medium</span>
            ) : parsed.confidence === "low" ? (
              <span className="text-red-700">low</span>
            ) : (
              <span className="text-gencom-stone">—</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <FieldLabel>Document type</FieldLabel>
        <div className="grid grid-cols-3 gap-2">
          {(["contract", "agreement", "proposal"] as DocType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setDocType(t);
                if (t === "contract") setForecastAction("update");
                else if (t === "agreement") setForecastAction("none");
              }}
              className={`px-3 py-2 rounded-lg border-2 text-sm transition text-left ${
                docType === t
                  ? "border-gencom-green bg-gencom-greensoft"
                  : "border-gencom-sand bg-white hover:border-gencom-green hover:bg-gencom-greensoft"
              }`}
            >
              <div className={`font-semibold capitalize ${docType === t ? "text-gencom-green" : "text-gencom-ink"}`}>
                {t}
              </div>
              <div className="text-[10px] text-gencom-stone mt-0.5 line-clamp-2 leading-tight">
                {DOC_TYPE_HELP[t]}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Vendor</FieldLabel>
          <TextInput value={vendor} onChange={setVendor} />
        </div>
        <div>
          <FieldLabel>Document amount</FieldLabel>
          <TextInput
            type="number"
            value={amount ?? 0}
            onChange={(v) => setAmount(v === "" ? null : Number(v))}
          />
        </div>
        <div className="col-span-2">
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
          />
        </div>
      </div>

      <div>
        <FieldLabel required>Attach to budget line</FieldLabel>
        <select
          value={selectedLineId}
          onChange={(e) => setSelectedLineId(e.target.value)}
          className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
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

      {selected && (
        <div className="rounded-md border border-gencom-sand bg-gencom-mist/30 p-4">
          <FieldLabel required>Update the forecast budget for this line?</FieldLabel>
          <div className="text-[11px] text-gencom-stone mb-3">
            Current forecast: <span className="font-semibold text-gencom-ink">{fmtMoney(selected.forecast_total_budget)}</span>
            {amount != null && (
              <>
                {" · "}This document: <span className="font-semibold text-gencom-ink">{fmtMoney(amount)}</span>
              </>
            )}
          </div>
          <div className="space-y-2">
            <ForecastChoice
              active={forecastAction === "update"}
              onClick={() => setForecastAction("update")}
              disabled={amount == null}
              title={`Yes — update forecast to ${amount != null ? fmtMoney(amount) : "document amount"}`}
              blurb="Use the document's amount as the new forecast. Recommended for executed contracts."
            />
            <ForecastChoice
              active={forecastAction === "none"}
              onClick={() => setForecastAction("none")}
              title="No — keep current forecast"
              blurb="Save the document as a reference only. Recommended for agreements / unsigned proposals."
            />
            <ForecastChoice
              active={forecastAction === "custom"}
              onClick={() => setForecastAction("custom")}
              title="Custom amount"
              blurb="Override the forecast with a value you set."
            />
            {forecastAction === "custom" && (
              <div className="pl-6">
                <TextInput
                  type="number"
                  value={customAmount}
                  onChange={(v) => setCustomAmount(Number(v) || 0)}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function ForecastChoice({
  active,
  onClick,
  disabled,
  title,
  blurb,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className={`w-full text-left px-3 py-2 rounded-lg border-2 transition ${
        active
          ? "border-gencom-green bg-gencom-greensoft"
          : "border-gencom-sand bg-white hover:border-gencom-green hover:bg-gencom-greensoft"
      } ${disabled ? "opacity-40 cursor-not-allowed hover:border-gencom-sand hover:bg-white" : "cursor-pointer"}`}
    >
      <div className={`t-body font-semibold ${active ? "text-gencom-green" : ""}`}>{title}</div>
      <div className="t-micro mt-0.5 leading-snug">{blurb}</div>
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
