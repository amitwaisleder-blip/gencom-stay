// Blocks 7 + 8 — Projected Returns tables (Pre-Tax + Post-Tax).
// Compact 4-row tables rendered side by side in the top-right of the
// canvas, mirroring the PDF.

import BlockShell, { Num, Row } from "./BlockShell";
import type { EngineOutputs, ReturnSet } from "../types";
import { fmtMoney, fmtPct, fmtMultiplier } from "../format";


const LABEL_W = 62;
const COL_W = 68;


export function ReturnsPreTaxBlock({ out }: { out: EngineOutputs }) {
  const { unleveredPretax: u, leveredPretax: l } = out.returns;
  return (
    <BlockShell title="Projected Returns: Pre-Tax">
      <table className="w-full">
        <thead>
          <tr className="bg-[#f0ebd9] border-b border-[#d9d4c8]">
            <td style={{ width: LABEL_W }} />
            <td className="px-2 py-1 text-[10px] italic text-[#1e3a5f] text-right font-semibold" style={{ width: COL_W }}>Unlevered</td>
            <td className="px-2 py-1 text-[10px] italic text-[#1e3a5f] text-right font-semibold" style={{ width: COL_W }}>Levered</td>
            <td className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-[#6b6f78] text-right" style={{ width: COL_W }}>CAGR (30-19)</td>
          </tr>
        </thead>
        <tbody>
          <ReturnRow label="Return" u={fmtPct(u.irr, 1)} l={fmtPct(l.irr, 1)} />
          <ReturnRow label="EM" u={fmtMultiplier(u.em)} l={fmtMultiplier(l.em)} />
          <ReturnRow label="Profit (000s)" u={fmtMoney(u.profit)} l={fmtMoney(l.profit)} />
          <ReturnRow label="Inv (000s)" u={fmtMoney(u.investment)} l={fmtMoney(l.investment)} />
        </tbody>
      </table>
    </BlockShell>
  );
}


export function ReturnsPostTaxBlock({ out }: { out: EngineOutputs }) {
  const { unleveredPosttax: u, leveredPosttax: l, postPromote: p } = out.returns;
  return (
    <BlockShell title="Projected Returns: Post-Tax">
      <table className="w-full">
        <thead>
          <tr className="bg-[#f0ebd9] border-b border-[#d9d4c8]">
            <td style={{ width: LABEL_W }} />
            <td className="px-2 py-1 text-[10px] italic text-[#1e3a5f] text-right font-semibold" style={{ width: COL_W }}>Unlevered</td>
            <td className="px-2 py-1 text-[10px] italic text-[#1e3a5f] text-right font-semibold" style={{ width: COL_W }}>Levered</td>
            <td className="px-2 py-1 text-[10px] italic text-[#1e3a5f] text-right font-semibold" style={{ width: COL_W }}>Post-Promote</td>
          </tr>
        </thead>
        <tbody>
          <ReturnRow label="Return" u={fmtPct(u.irr, 1)} l={fmtPct(l.irr, 1)} extra={fmtPct(p.irr, 1)} />
          <ReturnRow label="EM" u={fmtMultiplier(u.em)} l={fmtMultiplier(l.em)} extra={fmtMultiplier(p.em)} />
          <ReturnRow label="Profit (000s)" u={fmtMoney(u.profit)} l={fmtMoney(l.profit)} extra={fmtMoney(p.profit)} />
          <ReturnRow label="Inv (000s)" u={fmtMoney(u.investment)} l={fmtMoney(l.investment)} extra={fmtMoney(p.investment)} />
        </tbody>
      </table>
    </BlockShell>
  );
}


function ReturnRow({ label, u, l, extra }: { label: string; u: string; l: string; extra?: string }) {
  return (
    <Row label={label} bold>
      <Num bold>{u}</Num>
      <Num bold>{l}</Num>
      <Num bold>{extra ?? ""}</Num>
    </Row>
  );
}


// Convenience exports for backwards compatibility with future work.
export { ReturnsPreTaxBlock as Block7 };
export { ReturnsPostTaxBlock as Block8 };
export type { ReturnSet };
