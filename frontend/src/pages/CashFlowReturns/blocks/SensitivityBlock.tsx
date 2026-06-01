// Blocks 10-13 — Sensitivity Analysis grids (Unlevered/Levered × Pre/Post-tax).
// Each grid is Price Per Key (rows) × Exit Cap Rate (columns) with IRR
// values. A subtle gold-tinted heatmap cues relative performance across
// the grid while staying within the Gencom luxury palette.

import BlockShell, { Num, Row } from "./BlockShell";
import type { Range } from "../types";
import { fmtPct } from "../format";


const LABEL_W = 105;
const COL_W = 62;


export default function SensitivityBlock({
  title, range, keys,
}: { title: string; range: Range; keys: number }) {
  // Grid extent used to drive the heatmap tint.
  const flat = range.matrix.flat().filter((n) => Number.isFinite(n));
  const lo = Math.min(...flat);
  const hi = Math.max(...flat);
  const span = Math.max(1e-6, hi - lo);

  function heat(v: number): string {
    const t = Math.min(1, Math.max(0, (v - lo) / span));
    // Gold-tint gradient from sand-white (low) to muted gold (high).
    const alpha = 0.06 + t * 0.24;
    return `rgba(184, 149, 85, ${alpha.toFixed(3)})`;
  }

  return (
    <BlockShell title={title} accent="#345577">
      <table className="w-full">
        <thead>
          <tr className="bg-[#f0ebd9] border-b border-[#d9d4c8]">
            <td
              colSpan={2}
              className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f] text-left"
              style={{ width: LABEL_W + COL_W }}
            >
              Price Per Key
            </td>
            <td
              colSpan={range.capCols.length}
              className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f] text-center"
            >
              Exit Cap Rate
            </td>
          </tr>
          <tr className="bg-[#faf6e7] border-b border-[#d9d4c8]">
            <td className="px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#6b6f78] font-semibold" style={{ width: LABEL_W }}>EUR 000s</td>
            <td className="px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[#6b6f78] font-semibold text-right" style={{ width: COL_W }}>EUR</td>
            {range.capCols.map((c, i) => (
              <td
                key={i}
                className="px-2 py-1 text-[10px] font-mono tabular-nums font-semibold text-[#1a1d24] text-right"
                style={{ width: COL_W }}
              >
                {fmtPct(c, 2)}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {range.priceRows.map((price, ri) => (
            <Row key={ri} label={price.toLocaleString("en-US")}>
              <Num width={COL_W}>{`${Math.round(price / keys).toLocaleString("en-US")}k`}</Num>
              {range.matrix[ri].map((val, ci) => (
                <td
                  key={ci}
                  className="px-2 py-[3px] align-middle text-right font-mono tabular-nums text-[11px] text-[#1a1d24]"
                  style={{ width: COL_W, background: heat(val) }}
                >
                  {fmtPct(val, 1)}
                </td>
              ))}
            </Row>
          ))}
        </tbody>
      </table>
    </BlockShell>
  );
}
