// + New Deal modal.
//
// Flow:
//   1. User picks an IC-package PDF, an Excel UW model, or a Word doc.
//   2. We POST it to /api/cash-flow-returns/extract-deal, which runs
//      Claude on the document and returns a typed Assumptions bundle
//      plus deal metadata (name / location / description).
//      - PDFs use the native Anthropic document block.
//      - .xlsx / .docx are converted to text server-side first.
//      - Legacy .xls / .doc are rejected with a clear "re-save as new
//        format" message — neither openpyxl nor python-docx can read
//        the old binary formats.
//   3. The user reviews the extracted header (and can tweak name /
//      location / description), then saves. The new deal lands in
//      localStorage via extractedDealsStore.saveExtractedDeal and the
//      caller navigates into its workspace.
//
// Extraction confidence is variable — the engine accepts partial
// assumptions and fills in whatever the user edits later, so even a
// rough extraction is valuable as a starting point.

import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveExtractedDeal } from "../extractedDealsStore";
import type { Assumptions } from "../types";


type Stage = "pick" | "uploading" | "review" | "error";

type ExtractResponse = {
  deal?: {
    name?: string;
    location?: string;
    description?: string;
    source_page_reference?: number;
  };
  assumptions: Partial<Assumptions>;
  _source_filename?: string;
};


export default function NewDealModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("pick");
  const [errMsg, setErrMsg] = useState<string>("");
  const [filename, setFilename] = useState<string>("");

  // Review-stage form fields — pre-populated from the extraction.
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [assumptions, setAssumptions] = useState<Assumptions | null>(null);

  const uploadAndExtract = useCallback(async (file: File) => {
    setStage("uploading");
    setErrMsg("");
    setFilename(file.name);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/cash-flow-returns/extract-deal", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Extraction failed (${res.status}): ${text.slice(0, 400)}`);
      }
      const data: ExtractResponse = await res.json();
      const merged = mergeWithDefaults(data.assumptions);
      setAssumptions(merged);
      setName(data.deal?.name ?? "Untitled Deal");
      setLocation(data.deal?.location ?? "");
      setDescription(data.deal?.description ?? "");
      setStage("review");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (!assumptions) return;
    const rec = saveExtractedDeal({
      name: name.trim() || "Untitled Deal",
      location: location.trim(),
      description: description.trim(),
      seed: assumptions,
      sourceFilename: filename,
    });
    onClose();
    navigate(`/cash-flow-returns/${rec.id}`);
  }, [assumptions, name, location, description, filename, onClose, navigate]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[#faf7f1] border border-[#d9d4c8] rounded-lg shadow-xl w-[560px] max-w-[92vw] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-[#ece6d7]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#b89555] font-semibold">
              Gencom Underwriting
            </div>
            <h2 className="font-serif-display text-2xl leading-tight mt-1">
              New Deal from IC Package
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#6b6f78] hover:text-[#1a1d24] text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Stage: pick */}
        {stage === "pick" && (
          <div className="px-6 py-5">
            <p className="text-[13px] leading-relaxed text-[#4a4d54]">
              Upload an IC package, offering memorandum, or an existing UW model.
              Claude extracts costs, financing, P&amp;L projections, cash-flow
              assumptions, and exit parameters into a fully editable Base scenario.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-5 w-full border-2 border-dashed border-[#d9d4c8] hover:border-[#b89555] hover:bg-white rounded-md px-6 py-10 text-center transition-colors"
            >
              <div className="font-serif-display text-xl text-[#1a1d24]">
                Drop or choose a file
              </div>
              <div className="text-[11px] text-[#6b6f78] mt-1">
                PDF · XLSX · DOCX &nbsp;·&nbsp; IC package, OM, or UW model &nbsp;·&nbsp; up to ~50 MB
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf,.xlsx,.xls,.docx,.doc,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAndExtract(f);
              }}
            />
            <div className="mt-5 text-[10px] italic text-[#6b6f78]">
              Extraction typically takes 30–60 seconds. Missing fields are filled
              with sensible defaults — you can correct anything in the workspace.
              Legacy <code>.xls</code> / <code>.doc</code> aren't supported — re-save as the modern format and re-upload.
            </div>
          </div>
        )}

        {/* Stage: uploading */}
        {stage === "uploading" && (
          <div className="px-6 py-10 text-center">
            <div className="font-serif-display text-xl text-[#1a1d24]">
              Extracting <span className="italic">{filename}</span>…
            </div>
            <div className="text-[12px] text-[#6b6f78] mt-2">
              Claude is reading the document and mapping it to the assumptions model.
            </div>
            <div className="mt-5 mx-auto w-40 h-1 bg-[#ece6d7] overflow-hidden rounded-full">
              <div className="h-full bg-[#b89555] animate-pulse" style={{ width: "60%" }} />
            </div>
          </div>
        )}

        {/* Stage: review */}
        {stage === "review" && assumptions && (
          <div className="px-6 py-5">
            <p className="text-[12px] text-[#4a4d54]">
              Review the deal header. You can refine assumptions block-by-block
              inside the workspace after saving.
            </p>

            <label className="block mt-4 text-[10px] uppercase tracking-[0.15em] text-[#6b6f78] font-semibold">
              Deal name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full bg-white border border-[#d9d4c8] rounded-md px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-[#b89555]/40"
            />

            <label className="block mt-3 text-[10px] uppercase tracking-[0.15em] text-[#6b6f78] font-semibold">
              Location
            </label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, Country"
              className="mt-1 w-full bg-white border border-[#d9d4c8] rounded-md px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b89555]/40"
            />

            <label className="block mt-3 text-[10px] uppercase tracking-[0.15em] text-[#6b6f78] font-semibold">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="One-line thesis"
              className="mt-1 w-full bg-white border border-[#d9d4c8] rounded-md px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#b89555]/40 resize-none"
            />

            <ExtractedSummary a={assumptions} />

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-[12px] text-[#6b6f78] hover:text-[#1a1d24]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-1.5 rounded-md text-[12px] font-semibold text-white"
                style={{ background: "#1a1d24" }}
              >
                Create Deal →
              </button>
            </div>
          </div>
        )}

        {/* Stage: error */}
        {stage === "error" && (
          <div className="px-6 py-5">
            <div className="font-serif-display text-lg text-[#b04040]">
              Extraction failed
            </div>
            <pre className="mt-2 text-[11px] text-[#4a4d54] bg-white border border-[#ece6d7] rounded-md p-3 max-h-48 overflow-auto whitespace-pre-wrap">
              {errMsg}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-[12px] text-[#6b6f78] hover:text-[#1a1d24]"
              >
                Close
              </button>
              <button
                onClick={() => setStage("pick")}
                className="px-4 py-1.5 rounded-md text-[12px] font-semibold text-white"
                style={{ background: "#1a1d24" }}
              >
                Try another PDF
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function ExtractedSummary({ a }: { a: Assumptions }) {
  const n = a.exit.holdPeriod;
  const y1Rev = a.pnl.totalRevenueOverride?.[0];
  const y1Noi = a.pnl.noi.absoluteOverride?.[0];
  return (
    <div className="mt-4 bg-white border border-[#ece6d7] rounded-md divide-y divide-[#ece6d7] text-[12px]">
      <Row label="Acquisition Price" value={`${fmt(a.costs.acquisitionPrice)}k`} />
      <Row label="CAPEX Budget" value={`${fmt(a.costs.capexBudget)}k`} />
      <Row label="Keys" value={String(a.pnl.keys[0] ?? "—")} />
      <Row label="Hold Period" value={`${n} yrs`} />
      <Row label="Exit Cap Rate" value={`${(a.exit.exitCapRate * 100).toFixed(2)}%`} />
      <Row label="LTV" value={`${(a.financing.ltv * 100).toFixed(0)}%`} />
      <Row label="Y1 Revenue" value={y1Rev ? `${fmt(y1Rev)}k` : "—"} />
      <Row label="Y1 NOI" value={y1Noi ? `${fmt(y1Noi)}k` : "—"} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-3 py-1.5">
      <span className="text-[#6b6f78]">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}


// --- Defaults for missing extraction sub-trees ------------------------
// The prompt tells Claude to OMIT fields it can't infer. We fill in
// sensible defaults here so the engine never receives an undefined
// required field. The user can correct any of these in the workspace.
function mergeWithDefaults(a: Partial<Assumptions>): Assumptions {
  const hold = a.exit?.holdPeriod ?? 5;
  const pad = (arr: number[] | undefined, len: number, fill: number) => {
    const out = [...(arr ?? [])];
    while (out.length < len) out.push(fill);
    return out.slice(0, len);
  };
  const padOpt = (arr: (number | null)[] | undefined, len: number, fill: number | null) => {
    const out = [...(arr ?? [])];
    while (out.length < len) out.push(fill);
    return out.slice(0, len);
  };

  return {
    acquisitionYear: a.acquisitionYear ?? new Date().getFullYear(),
    costs: {
      acquisitionPrice: a.costs?.acquisitionPrice ?? 0,
      capexBudget: a.costs?.capexBudget ?? 0,
      dueDiligence: a.costs?.dueDiligence ?? 0,
      acquisitionTransitionFees: a.costs?.acquisitionTransitionFees ?? 0,
      transferTax: a.costs?.transferTax ?? 0,
      legalFees: a.costs?.legalFees ?? 0,
    },
    financing: {
      ltv: a.financing?.ltv ?? 0.60,
      ltc: a.financing?.ltc ?? 1.00,
      financingCostsPct: a.financing?.financingCostsPct ?? 0.01,
      baseRateLabel: a.financing?.baseRateLabel ?? "3m EURIBOR",
      baseRate: a.financing?.baseRate ?? 0.02,
      spreadBps: a.financing?.spreadBps ?? 250,
      commitmentFeePct: a.financing?.commitmentFeePct ?? 0.0025,
      annualAmortAcqLoan: a.financing?.annualAmortAcqLoan ?? 0,
      annualAmortCapexFacility: a.financing?.annualAmortCapexFacility ?? 0,
    },
    exit: {
      firstYear: a.exit?.firstYear ?? (a.acquisitionYear ?? new Date().getFullYear()) + 1,
      exitYear: a.exit?.exitYear ?? (a.acquisitionYear ?? new Date().getFullYear()) + hold,
      holdPeriod: hold,
      exitCapRate: a.exit?.exitCapRate ?? 0.06,
      transactionCosts: a.exit?.transactionCosts ?? 0.01,
    },
    pnl: {
      keys: pad(a.pnl?.keys, hold, a.pnl?.keys?.[0] ?? 100),
      occupancy: pad(a.pnl?.occupancy, hold, 0.70),
      adrY1: a.pnl?.adrY1 ?? 300,
      adrGrowth: padOpt(a.pnl?.adrGrowth, hold, 0.025),
      totalRevenueOverride: a.pnl?.totalRevenueOverride,
      gop:    { absoluteOverride: a.pnl?.gop?.absoluteOverride },
      ebitda: { absoluteOverride: a.pnl?.ebitda?.absoluteOverride },
      noi:    { absoluteOverride: a.pnl?.noi?.absoluteOverride },
    },
    cashflow: {
      capexDrawSchedule: pad(a.cashflow?.capexDrawSchedule, hold, 0),
      imCosts: pad(a.cashflow?.imCosts, hold, 0),
      taxPayableUnlevered: pad(a.cashflow?.taxPayableUnlevered, hold, 0),
      taxPayableLevered: pad(a.cashflow?.taxPayableLevered, hold, 0),
      promoteY5: a.cashflow?.promoteY5 ?? 0,
    },
    notes: a.notes ?? "",
  };
}
