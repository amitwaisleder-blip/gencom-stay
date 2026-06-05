// Cash Flow Returns — pipeline landing page.
//
// Phase 6 turned the single Paris LXR row into a static registry of
// four seeded deals. Phase 7 merges user-uploaded deals from the
// localStorage-backed extracted-deals store on top, and enables the
// "+ New Deal" button to launch the PDF-upload → Claude-extract flow.

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { runModel } from "../engine";
import { DEALS, type DealRecord } from "../deals";
import { listExtractedDeals } from "../extractedDealsStore";
import { fmtMoney, fmtMultiplier, fmtPct } from "../format";
import NewDealModal from "../components/NewDealModal";


export default function Dashboard() {
  // A version counter we bump whenever the extracted-deals store
  // changes so the pipeline rows recompute. The modal only updates on
  // save (and calls onClose), so bumping here is enough.
  const [version, setVersion] = useState(0);
  const [showModal, setShowModal] = useState(false);

  const rows = useMemo(() => {
    const merged: DealRecord[] = [...DEALS, ...listExtractedDeals()];
    return merged.map((d) => {
      const out = runModel(d.seed);
      return {
        id: d.id,
        name: d.name,
        location: d.location,
        status: d.status,
        description: d.description,
        acquisitionPrice: d.seed.costs.acquisitionPrice,
        totalCost: out.costs.totalLevered,
        unleveredIrr: out.returns.unleveredPretax.irr,
        leveredIrr: out.returns.leveredPretax.irr,
        em: out.returns.leveredPretax.em,
        hold: d.seed.exit.holdPeriod,
        exitCap: d.seed.exit.exitCapRate,
        modified: d.modified,
        isExtracted: !DEALS.find((s) => s.id === d.id),
      };
    });
  // version intentionally in the dep list so store writes trigger re-run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const handleModalClose = useCallback(() => {
    setShowModal(false);
    setVersion((v) => v + 1);
  }, []);

  return (
    <div className="-mx-6 -my-8 min-h-[calc(100vh-100px)] bg-[#faf7f1] text-[#1a1d24]">
      <div className="max-w-[1400px] mx-auto px-6 py-10">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">
              Gencom Underwriting
            </div>
            <h1 className="font-serif-display text-4xl md:text-5xl leading-tight mt-2">
              Cash Flow Returns
            </h1>
            <p className="text-[14px] leading-relaxed text-[#6b6f78] max-w-xl mt-2">
              Live financial models for every hotel deal in the Gencom pipeline.
              Each deal is a full Hamilton-style underwriting workspace with
              editable assumptions, live recalc, scenario toggle, and four
              sensitivity grids.
            </p>
            <div className="mt-4 h-px w-16 bg-[#b89555]" />
          </div>
          <button
            onClick={() => setShowModal(true)}
            title="Upload an IC package and let Claude extract the assumptions"
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-semibold text-white hover:bg-[#2a2d34] transition-colors"
            style={{ background: "#1a1d24" }}
          >
            <span className="text-base leading-none">＋</span>
            <span>New Deal</span>
          </button>
        </header>

        <div className="mt-8 bg-white border border-[#ece6d7] rounded-lg overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[#faf7f1] border-b border-[#ece6d7] text-[10px] uppercase tracking-[0.15em] text-[#6b6f78]">
                <th className="text-left px-4 py-2">Deal</th>
                <th className="text-left px-4 py-2">Location</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-right px-4 py-2">Acq Price</th>
                <th className="text-right px-4 py-2">Total Cost</th>
                <th className="text-right px-4 py-2">Unlev IRR</th>
                <th className="text-right px-4 py-2">Lev IRR</th>
                <th className="text-right px-4 py-2">EM</th>
                <th className="text-right px-4 py-2">Hold</th>
                <th className="text-right px-4 py-2">Exit Cap</th>
                <th className="text-right px-4 py-2">Modified</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-t border-[#ece6d7] hover:bg-[#faf7f1]/60">
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/cash-flow-returns/${d.id}`}
                      title={d.description}
                      className="font-serif-display text-[17px] text-[#1a1d24] hover:text-[#b89555]"
                    >
                      {d.name}
                    </Link>
                    {d.isExtracted && (
                      <span
                        title="Extracted from an uploaded IC package"
                        className="ml-2 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] font-semibold rounded-full align-middle"
                        style={{ background: "#f3ecdc", color: "#b89555" }}
                      >
                        Uploaded
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[#4a4d54]">{d.location}</td>
                  <td className="px-4 py-2.5">
                    <StatusChip status={d.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">€{fmtMoney(d.acquisitionPrice)}k</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">€{fmtMoney(d.totalCost)}k</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtPct(d.unleveredIrr, 1)}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold">{fmtPct(d.leveredIrr, 1)}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtMultiplier(d.em)}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{d.hold} yrs</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmtPct(d.exitCap, 2)}</td>
                  <td className="px-4 py-2.5 text-right text-[11px] text-[#6b6f78]">{d.modified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 text-[11px] text-[#6b6f78] max-w-2xl leading-relaxed">
          <span className="font-semibold text-[#1a1d24]">Cash Flow Returns · v1 complete.</span>{" "}
          Live calculation engine with PDF-fidelity fixture, Downside/Base/Upside scenarios,
          multi-deal pipeline, PIP upload + Claude extraction, debt sizing, IRR waterfall,
          and XLSX / PDF / CSV / JSON exports. Click any deal to open its workspace.
        </div>
      </div>

      {showModal && <NewDealModal onClose={handleModalClose} />}
    </div>
  );
}


function StatusChip({ status }: { status: string }) {
  const tone: { bg: string; fg: string } = (() => {
    switch (status) {
      case "Modeling":    return { bg: "#f0ebd9", fg: "#1e3a5f" };
      case "In Scoping":  return { bg: "#f3ecdc", fg: "#8a6f3a" };
      case "IC Approved": return { bg: "#e4ead9", fg: "#3a5f2e" };
      case "Closed":      return { bg: "#e6e6e6", fg: "#4a4d54" };
      default:            return { bg: "#f0ebd9", fg: "#1e3a5f" };
    }
  })();
  return (
    <span
      className="px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold rounded-full"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {status}
    </span>
  );
}
