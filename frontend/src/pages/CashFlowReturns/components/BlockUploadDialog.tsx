// Per-block upload dialog. The Workspace mounts ONE of these at a
// time, scoped to whichever block's "Upload Doc" button was clicked.
//
// Flow:
//   1. User picks a PDF / XLSX / DOCX.
//   2. POST /api/cash-flow-returns/extract-block with form { file, block }.
//   3. Backend returns { block, patch: { ...partial subtree } }.
//   4. We hand the patch back via onApply; the workspace merges it
//      into the active scenario.
//
// Block-scoped extraction means a debt term sheet only updates the
// financing fields (it doesn't hallucinate P&L), and a one-page exit
// memo only updates the exit fields. Source-of-truth for which fields
// belong in each block lives in backend/api/cash_flow_returns.py.

import { useCallback, useRef, useState } from "react";
import type { Assumptions } from "../types";

export type BlockKey = "costs" | "financing" | "exit" | "pnl" | "cashflow";

const BLOCK_LABEL: Record<BlockKey, string> = {
  costs:     "Costs / Uses",
  financing: "Financing",
  exit:      "Exit",
  pnl:       "P&L Projections",
  cashflow:  "Cash Flow",
};

const BLOCK_HINT: Record<BlockKey, string> = {
  costs:
    "Drop a sources-and-uses table or acquisition-cost breakdown. We'll update only the cost fields — financing, P&L, exit stay as-is.",
  financing:
    "Drop a debt term sheet, sources-of-funds page, or financing summary. We'll update only the financing fields.",
  exit:
    "Drop an exit-summary page, returns waterfall, or disposition memo. We'll update only the exit fields (cap rate, hold, transaction costs).",
  pnl:
    "Drop a P&L projection, operating model, or revenue build. We'll update only the per-year P&L fields.",
  cashflow:
    "Drop a CAPEX schedule, tax build, or asset-management fee schedule. We'll update only the cash-flow fields.",
};

type Stage = "pick" | "uploading" | "applied" | "error";

type ApiResponse = {
  block: string;
  patch: Record<string, unknown>;
  _source_filename?: string;
};

export default function BlockUploadDialog({
  block, onClose, onApply,
}: {
  block: BlockKey;
  onClose: () => void;
  /** Apply a partial assumptions patch to the active scenario. The
   *  caller decides how to merge — typically onPatch({ [block]: {...} }). */
  onApply: (block: BlockKey, patch: Record<string, unknown>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("pick");
  const [errMsg, setErrMsg] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const [appliedFields, setAppliedFields] = useState<string[]>([]);

  const uploadAndExtract = useCallback(async (file: File) => {
    setStage("uploading");
    setErrMsg("");
    setFilename(file.name);

    const form = new FormData();
    form.append("file", file);
    form.append("block", block);

    try {
      const res = await fetch("/api/cash-flow-returns/extract-block", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Extraction failed (${res.status}): ${text.slice(0, 400)}`);
      }
      const data: ApiResponse = await res.json();
      onApply(block, data.patch);
      setAppliedFields(Object.keys(data.patch));
      setStage("applied");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setStage("error");
    }
  }, [block, onApply]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[#faf7f1] border border-[#d9d4c8] rounded-lg shadow-xl w-[520px] max-w-[92vw] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-[#ece6d7]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#b89555] font-semibold">
              Upload doc · scoped to one block
            </div>
            <h2 className="font-serif-display text-2xl leading-tight mt-1">
              {BLOCK_LABEL[block]}
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

        {stage === "pick" && (
          <div className="px-6 py-5">
            <p className="text-[13px] leading-relaxed text-[#4a4d54]">
              {BLOCK_HINT[block]}
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-5 w-full border-2 border-dashed border-[#d9d4c8] hover:border-[#b89555] hover:bg-white rounded-md px-6 py-8 text-center transition-colors"
            >
              <div className="font-serif-display text-lg text-[#1a1d24]">
                Drop or choose a file
              </div>
              <div className="text-[11px] text-[#6b6f78] mt-1">PDF · XLSX · DOCX</div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf,.xlsx,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAndExtract(f);
              }}
            />
            <div className="mt-4 text-[10px] italic text-[#6b6f78]">
              Fields not present in the document keep their current value — we never
              overwrite with a guess.
            </div>
          </div>
        )}

        {stage === "uploading" && (
          <div className="px-6 py-10 text-center">
            <div className="font-serif-display text-lg text-[#1a1d24]">
              Reading <span className="italic">{filename}</span>…
            </div>
            <div className="text-[12px] text-[#6b6f78] mt-2">
              Claude is pulling {BLOCK_LABEL[block].toLowerCase()} fields out of the document.
            </div>
            <div className="mt-5 mx-auto w-40 h-1 bg-[#ece6d7] overflow-hidden rounded-full">
              <div className="h-full bg-[#b89555] animate-pulse" style={{ width: "60%" }} />
            </div>
          </div>
        )}

        {stage === "applied" && (
          <div className="px-6 py-5">
            <div className="font-serif-display text-lg text-[#1a1d24]">
              Applied to {BLOCK_LABEL[block]} block
            </div>
            <div className="mt-1 text-[12px] text-[#6b6f78]">
              {appliedFields.length} field{appliedFields.length === 1 ? "" : "s"} updated from{" "}
              <span className="italic">{filename}</span>.
            </div>
            {appliedFields.length > 0 && (
              <ul className="mt-3 bg-white border border-[#ece6d7] rounded-md p-3 text-[11px] font-mono text-[#4a4d54] leading-relaxed max-h-40 overflow-auto">
                {appliedFields.map((f) => <li key={f}>{f}</li>)}
              </ul>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-md text-[12px] font-semibold text-white"
                style={{ background: "#1a1d24" }}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div className="px-6 py-5">
            <div className="font-serif-display text-lg text-[#b04040]">Extraction failed</div>
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
                Try another file
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Helper for callers that merge a block patch into a full Assumptions
 *  object. Returned shape is `Partial<Assumptions>` ready to feed
 *  `onPatch({ ...next })`. Only the targeted subtree is touched — every
 *  other field inherits from the existing scenario. */
export function applyBlockPatch(
  current: Assumptions, block: BlockKey, patch: Record<string, unknown>,
): Partial<Assumptions> {
  // Patch is a partial of one of the subtrees; merge field-by-field
  // so omitted fields keep their current values.
  const existing = (current as unknown as Record<string, Record<string, unknown>>)[block] ?? {};
  return { [block]: { ...existing, ...patch } } as Partial<Assumptions>;
}
