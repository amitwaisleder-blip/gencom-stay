// Export modal — Phase 9.
//
// Four formats: JSON (round-trip), CSV (paste-into-Excel), XLSX (full
// IC workbook via SheetJS), PDF (browser-print of the dedicated print
// route). All four are fully client-side.

import type { Assumptions, EngineOutputs } from "../types";
import { exportCsv, exportJson, exportPdf, exportXlsx } from "../exports";


export default function ExportModal({
  dealId, dealName, assumptions, out, onClose,
}: {
  dealId: string;
  dealName: string;
  assumptions: Assumptions;
  out: EngineOutputs;
  onClose: () => void;
}) {
  const doJson = () => { exportJson(dealName, assumptions, out); onClose(); };
  const doCsv  = () => { exportCsv(dealName, assumptions, out); onClose(); };
  const doXlsx = () => { exportXlsx(dealName, assumptions, out); onClose(); };
  const doPdf  = () => { exportPdf(dealId); onClose(); };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-[#faf7f1] border border-[#d9d4c8] rounded-lg shadow-xl w-[460px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-[#ece6d7]">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#b89555] font-semibold">
              Export
            </div>
            <h2 className="font-serif-display text-2xl leading-tight mt-1">{dealName}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#6b6f78] hover:text-[#1a1d24] text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 grid grid-cols-2 gap-3">
          <Card
            label="Excel (.xlsx)"
            sub="Multi-sheet IC workbook — Summary, P&L, Cash Flow, Returns, Sensitivity"
            onClick={doXlsx}
            accent="#1e3a5f"
          />
          <Card
            label="PDF (print)"
            sub="One-page summary via browser print dialog"
            onClick={doPdf}
            accent="#1a1d24"
          />
          <Card
            label="CSV"
            sub="Stacked tables — for paste-into-Excel workflows"
            onClick={doCsv}
            accent="#6b6f78"
          />
          <Card
            label="JSON"
            sub="Full assumptions + engine outputs for diffs / re-import"
            onClick={doJson}
            accent="#6b6f78"
          />
        </div>

        <div className="px-6 py-3 border-t border-[#ece6d7] text-[10px] italic text-[#6b6f78]">
          All exports reflect the active scenario (Downside / Base / Upside) as shown on screen.
        </div>
      </div>
    </div>
  );
}


function Card({
  label, sub, onClick, accent,
}: { label: string; sub: string; onClick: () => void; accent: string }) {
  return (
    <button
      onClick={onClick}
      className="text-left bg-white border border-[#ece6d7] rounded-md p-3 hover:border-[#b89555] hover:bg-[#faf7f1] transition-colors"
    >
      <div className="font-serif-display text-[15px] text-[#1a1d24]" style={{ color: accent }}>
        {label}
      </div>
      <div className="mt-1 text-[10px] text-[#6b6f78] leading-relaxed">{sub}</div>
    </button>
  );
}
