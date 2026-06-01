// Print-friendly summary — Phase 9 (PDF export surface).
//
// The Export modal opens this route in a new tab and relies on the
// browser's native print dialog (Ctrl+P → Save as PDF) to produce the
// PDF. The layout is tuned for A4/Letter portrait, avoids horizontal
// scrolling, and collapses the Base-scenario assumptions into a tight
// one-to-two-page IC summary.

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { runModel } from "../engine";
import { getDeal } from "../deals";
import { fmtMoney, fmtMultiplier, fmtPct, fmtDecimal } from "../format";


export default function DealPrint() {
  const { dealId } = useParams<{ dealId: string }>();
  const deal = dealId ? getDeal(dealId) : undefined;

  useEffect(() => {
    if (!deal) return;
    // Small delay so fonts load and layout settles before the print
    // dialog snapshots the page.
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [deal]);

  if (!deal) {
    return <div className="p-10 text-center">Deal not found.</div>;
  }

  const a = deal.seed;
  const out = runModel(a);
  const years = out.pnl.years.map((y) => `Dec-${String(y).slice(-2)}`);

  return (
    <div className="cfr-print bg-white text-[#1a1d24] min-h-screen">
      {/* Page — sized for A4 portrait with ~20mm margins */}
      <div className="mx-auto" style={{ width: "180mm", padding: "10mm 0" }}>
        {/* Header */}
        <header className="pb-2 mb-3 border-b-2 border-[#b89555]">
          <div className="text-[9px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">
            Gencom Underwriting · Cash Flow Returns
          </div>
          <h1 className="font-serif-display text-3xl leading-tight mt-1">{deal.name}</h1>
          <div className="text-[10px] text-[#6b6f78] mt-0.5">
            {deal.location} · Acquisition Year {a.acquisitionYear} · EUR 000s
          </div>
          <div className="text-[9px] italic text-[#6b6f78] mt-0.5">
            Printed {new Date().toLocaleString()}
          </div>
        </header>

        {/* Headline metrics */}
        <section className="grid grid-cols-4 gap-2 mb-3">
          <Metric label="Unlev IRR" value={fmtPct(out.returns.unleveredPretax.irr, 1)} />
          <Metric label="Lev IRR" value={fmtPct(out.returns.leveredPretax.irr, 1)} highlight />
          <Metric label="Lev EM" value={fmtMultiplier(out.returns.leveredPretax.em)} />
          <Metric label="Post-Promote" value={fmtPct(out.returns.postPromote.irr, 1)} />
        </section>

        {/* Costs + Sources */}
        <section className="grid grid-cols-2 gap-3 mb-3">
          <TableBlock title="Costs / Uses">
            <KV label="Acquisition Price" value={fmtMoney(a.costs.acquisitionPrice)} />
            <KV label="CAPEX Budget" value={fmtMoney(a.costs.capexBudget)} />
            <KV label="Due Diligence" value={fmtMoney(a.costs.dueDiligence)} />
            <KV label="Acq/Transition Fees" value={fmtMoney(a.costs.acquisitionTransitionFees)} />
            <KV label="Transfer Tax" value={fmtMoney(a.costs.transferTax)} />
            <KV label="Legal Fees" value={fmtMoney(a.costs.legalFees)} />
            <KV label="Total Unlevered" value={fmtMoney(out.costs.totalUnlevered)} bold />
            <KV label="Financing Costs" value={fmtMoney(out.costs.financingCostsAmount)} />
            <KV label="Total Levered" value={fmtMoney(out.costs.totalLevered)} bold />
          </TableBlock>

          <TableBlock title="Sources / Financing">
            <KV label="Debt" value={fmtMoney(out.sources.debt)} />
            <KV label="Equity" value={fmtMoney(out.sources.equity)} />
            <KV label="Total" value={fmtMoney(out.sources.total)} bold />
            <KV label="LTV" value={fmtPct(a.financing.ltv, 1)} />
            <KV label="LTC" value={fmtPct(a.financing.ltc, 1)} />
            <KV label="Applicable Rate" value={fmtPct(out.financing.applicableRate, 2)} />
            <KV label="Exit Cap Rate" value={fmtPct(a.exit.exitCapRate, 2)} />
            <KV label="Gross Sales Price" value={fmtMoney(out.exit.grossSalesPrice)} bold />
            <KV label="EBITDA Multiple" value={fmtMultiplier(out.exit.ebitdaMultiple)} />
          </TableBlock>
        </section>

        {/* P&L */}
        <section className="mb-3">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#1e3a5f] mb-1">
            Profit &amp; Loss
          </div>
          <table className="w-full text-[9px] border border-[#ece6d7]">
            <thead>
              <tr className="bg-[#f0ebd9]">
                <th className="text-left px-2 py-1">Line</th>
                {years.map((y) => <th key={y} className="text-right px-2 py-1">{y}</th>)}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              <Tr label="Occupancy" vals={out.pnl.occupancy.map((v) => fmtPct(v, 1))} />
              <Tr label="ADR" vals={out.pnl.adr.map((v) => fmtDecimal(v, 2))} />
              <Tr label="RevPAR" vals={out.pnl.revpar.map((v) => fmtDecimal(v, 2))} />
              <Tr label="Total Revenue" vals={out.pnl.totalRevenue.map(fmtMoney)} bold />
              <Tr label="GOP" vals={out.pnl.gop.map(fmtMoney)} />
              <Tr label="EBITDA" vals={out.pnl.ebitda.map(fmtMoney)} />
              <Tr label="NOI" vals={out.pnl.noi.map(fmtMoney)} bold />
            </tbody>
          </table>
        </section>

        {/* Cash Flow (condensed) */}
        <section className="mb-3">
          <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#1e3a5f] mb-1">
            Cash Flow (condensed, EUR 000s)
          </div>
          <table className="w-full text-[9px] border border-[#ece6d7]">
            <thead>
              <tr className="bg-[#f0ebd9]">
                <th className="text-left px-2 py-1">Line</th>
                <th className="text-right px-2 py-1">Dec-25</th>
                {Array.from({ length: a.exit.holdPeriod }, (_, i) => (
                  <th key={i} className="text-right px-2 py-1">Y{i + 1}</th>
                ))}
                <th className="text-right px-2 py-1">Total</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              <Tr label="Unlev Pre-tax CF" vals={[...out.cashflow.unleveredPretaxCF.map(fmtMoney), fmtMoney(out.cashflow.unleveredPretaxTotal)]} bold />
              <Tr label="Unlev Post-tax CF" vals={[...out.cashflow.unleveredPosttaxCF.map(fmtMoney), fmtMoney(out.cashflow.unleveredPosttaxTotal)]} />
              <Tr label="Lev Pre-tax CF" vals={[...out.cashflow.leveredPretaxCF.map(fmtMoney), fmtMoney(out.cashflow.leveredPretaxTotal)]} />
              <Tr label="Lev Post-tax CF" vals={[...out.cashflow.leveredPosttaxCF.map(fmtMoney), fmtMoney(out.cashflow.leveredPosttaxTotal)]} bold />
              <Tr label="Post-Promote CF" vals={[...out.cashflow.leveredPosttaxPostPromoteCF.map(fmtMoney), fmtMoney(out.cashflow.leveredPosttaxPostPromoteTotal)]} bold />
            </tbody>
          </table>
        </section>

        {/* Returns detail + Debt sizing */}
        <section className="grid grid-cols-2 gap-3 mb-3">
          <TableBlock title="Returns Detail">
            {(["unleveredPretax", "unleveredPosttax", "leveredPretax", "leveredPosttax", "postPromote"] as const).map((k) => (
              <KV key={k} label={returnsLabel(k)}
                value={`${fmtPct(out.returns[k].irr, 1)} · ${fmtMultiplier(out.returns[k].em)}`} />
            ))}
          </TableBlock>
          <TableBlock title="Debt Sizing">
            <KV label="Current Debt" value={fmtMoney(out.debtSizing.currentTotalDebt)} />
            <KV label="Max by LTV + LTC" value={fmtMoney(out.debtSizing.maxBySize)} />
            <KV label="Max by DSCR" value={fmtMoney(out.debtSizing.maxByDscr)} />
            <KV label="Max by Debt Yield" value={fmtMoney(out.debtSizing.maxByDebtYield)} />
            <KV label="Binding" value={out.debtSizing.binding.toUpperCase()} bold />
            <KV label="Headroom" value={fmtMoney(out.debtSizing.headroom)} />
            <KV label="Y1 DSCR" value={isFinite(out.debtSizing.dscrY1) ? fmtMultiplier(out.debtSizing.dscrY1, 2) : "—"} />
            <KV label="Y1 Debt Yield" value={isFinite(out.debtSizing.debtYieldY1) ? fmtPct(out.debtSizing.debtYieldY1, 2) : "—"} />
          </TableBlock>
        </section>

        {/* Waterfall — conditional */}
        {out.waterfall && (
          <section className="mb-3">
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#1e3a5f] mb-1">
              IRR Waterfall
            </div>
            <table className="w-full text-[9px] border border-[#ece6d7]">
              <thead>
                <tr className="bg-[#f0ebd9]">
                  <th className="text-left px-2 py-1">Tier</th>
                  <th className="text-right px-2 py-1">LP Share</th>
                  <th className="text-right px-2 py-1">Pool</th>
                  <th className="text-right px-2 py-1">LP Take</th>
                  <th className="text-right px-2 py-1">GP Carry</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {out.waterfall.tiers.map((t, i) => (
                  <tr key={i} className="border-t border-[#ece6d7]">
                    <td className="px-2 py-0.5">{t.label}</td>
                    <td className="text-right px-2 py-0.5">{fmtPct(t.lpShare, 0)}</td>
                    <td className="text-right px-2 py-0.5">{fmtMoney(t.poolSize)}</td>
                    <td className="text-right px-2 py-0.5">{fmtMoney(t.lpTake)}</td>
                    <td className="text-right px-2 py-0.5 font-semibold">{fmtMoney(t.gpCarry)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[#1e3a5f] font-semibold">
                  <td className="px-2 py-0.5">LP IRR: {fmtPct(out.waterfall.lpIrrPrePromote, 1)} pre → {fmtPct(out.waterfall.lpIrrPostPromote, 1)} post</td>
                  <td colSpan={3} className="text-right px-2 py-0.5">Total GP Carry</td>
                  <td className="text-right px-2 py-0.5 text-[#b89555]">{fmtMoney(out.waterfall.totalGpCarry)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        )}

        {/* Notes — conditional */}
        {a.notes && a.notes.trim() && (
          <section className="mb-3">
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#1e3a5f] mb-1">
              Notes
            </div>
            <div className="text-[10px] leading-relaxed text-[#1a1d24] whitespace-pre-wrap p-2 border border-[#ece6d7] rounded">
              {a.notes}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="mt-4 pt-2 border-t border-[#ece6d7] text-[8px] italic text-[#6b6f78] leading-relaxed">
          Disclaimer: This analysis has been prepared based on information made
          available and Gencom's general experience in the hotel industry.
          Projections are subject to uncertainty and variation. For information
          only; not an inducement for action or investment.
        </footer>
      </div>
    </div>
  );
}


function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border border-[#ece6d7] rounded px-2 py-1.5 bg-[#faf7f1]">
      <div className="text-[8px] uppercase tracking-[0.15em] text-[#6b6f78]">{label}</div>
      <div className={`font-mono tabular-nums font-semibold text-[14px] ${highlight ? "text-[#b89555]" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function TableBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#1e3a5f] mb-1">
        {title}
      </div>
      <div className="border border-[#ece6d7] rounded divide-y divide-[#ece6d7] text-[10px]">
        {children}
      </div>
    </div>
  );
}

function KV({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between px-2 py-0.5 ${bold ? "font-semibold bg-[#f5f1e5]" : ""}`}>
      <span className="text-[#4a4d54]">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function Tr({ label, vals, bold }: { label: string; vals: string[]; bold?: boolean }) {
  return (
    <tr className={`border-t border-[#ece6d7] ${bold ? "bg-[#f5f1e5] font-semibold" : ""}`}>
      <td className="px-2 py-0.5 text-left">{label}</td>
      {vals.map((v, i) => <td key={i} className="px-2 py-0.5 text-right">{v}</td>)}
    </tr>
  );
}

function returnsLabel(k: string): string {
  switch (k) {
    case "unleveredPretax": return "Unlevered Pre-tax";
    case "unleveredPosttax": return "Unlevered Post-tax";
    case "leveredPretax": return "Levered Pre-tax";
    case "leveredPosttax": return "Levered Post-tax";
    case "postPromote": return "Post-Promote";
    default: return k;
  }
}
