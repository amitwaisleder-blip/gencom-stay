// Block 14 (Phase 8) — Debt Sizing.
//
// Compares the current debt (derived from LTV + LTC inputs) against
// the four sizing constraints — LTV/LTC, DSCR, and Debt Yield. The
// binding constraint is highlighted gold. Informational only: the
// block does not rewrite LTV/LTC automatically.

import BlockShell, { Row } from "./BlockShell";
import EditableCell, { DerivedCell } from "./EditableCell";
import type { Assumptions, EngineOutputs } from "../types";
import { fmtMoney, fmtMultiplier, fmtPct } from "../format";


const NUM_COL = 156;


export default function DebtSizingBlock({
  a, out, onChange,
}: {
  a: Assumptions;
  out: EngineOutputs;
  onChange: (patch: Partial<Assumptions>) => void;
}) {
  const d = out.debtSizing;
  const minDscr = a.financing.minDscr ?? 1.30;
  const minDebtYield = a.financing.minDebtYield ?? 0.09;

  function setFinancing<K extends keyof Assumptions["financing"]>(
    k: K, v: Assumptions["financing"][K],
  ) {
    onChange({ financing: { ...a.financing, [k]: v } });
  }

  const bindingLabel: Record<typeof d.binding, string> = {
    size: "LTV + LTC",
    dscr: "DSCR",
    dy: "Debt Yield",
  };

  const rowStyle = (tag: "size" | "dscr" | "dy") =>
    tag === d.binding
      ? { background: "#f3ecdc" }
      : undefined;

  return (
    <BlockShell title="Debt Sizing (EUR 000s)">
      <table className="w-full">
        <tbody>
          <Row label="Min DSCR">
            <EditableCell width={NUM_COL} kind="decimal" digits={2} value={minDscr}
              onChange={(v) => setFinancing("minDscr", v as number)} />
          </Row>
          <Row label="Min Debt Yield">
            <EditableCell width={NUM_COL} kind="pct" digits={2} value={minDebtYield}
              onChange={(v) => setFinancing("minDebtYield", v as number)} />
          </Row>

          <tr>
            <td colSpan={2} className="px-2 pt-2 pb-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f]">
              Max debt per constraint
            </td>
          </tr>

          <tr style={rowStyle("size")}>
            <td className="px-2 py-[3px] text-[11px]">LTV + LTC</td>
            <DerivedCell width={NUM_COL} derivation="Acq Price × LTV + CAPEX Budget × LTC">
              {fmtMoney(d.maxBySize)}
            </DerivedCell>
          </tr>
          <tr style={rowStyle("dscr")}>
            <td className="px-2 py-[3px] text-[11px]">DSCR cap</td>
            <DerivedCell width={NUM_COL} derivation={`Y1 NOI ÷ (min DSCR × applicable rate) at ${fmtPct(d.rate, 2)}`}>
              {fmtMoney(d.maxByDscr)}
            </DerivedCell>
          </tr>
          <tr style={rowStyle("dy")}>
            <td className="px-2 py-[3px] text-[11px]">Debt Yield cap</td>
            <DerivedCell width={NUM_COL} derivation="Y1 NOI ÷ min Debt Yield">
              {fmtMoney(d.maxByDebtYield)}
            </DerivedCell>
          </tr>

          <Row label="Binding" bold>
            <DerivedCell width={NUM_COL} bold derivation="Smallest of the three caps">
              {bindingLabel[d.binding]}
            </DerivedCell>
          </Row>
          <Row label="Max Total Debt" bold>
            <DerivedCell width={NUM_COL} bold>{fmtMoney(d.maxTotal)}</DerivedCell>
          </Row>

          <tr>
            <td colSpan={2} className="px-2 pt-2 pb-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f]">
              Current vs. Max
            </td>
          </tr>
          <Row label="Current Debt">
            <DerivedCell width={NUM_COL} derivation="From Sources block">
              {fmtMoney(d.currentTotalDebt)}
            </DerivedCell>
          </Row>
          <Row label="Headroom" subtle>
            <DerivedCell width={NUM_COL} subtle>
              {d.headroom >= 0 ? fmtMoney(d.headroom) : `(${fmtMoney(-d.headroom)})`}
            </DerivedCell>
          </Row>
          <Row label="Y1 DSCR" subtle>
            <DerivedCell width={NUM_COL} subtle derivation="Y1 NOI ÷ (rate × current debt)">
              {isFinite(d.dscrY1) ? fmtMultiplier(d.dscrY1, 2) : "—"}
            </DerivedCell>
          </Row>
          <Row label="Y1 Debt Yield" subtle>
            <DerivedCell width={NUM_COL} subtle derivation="Y1 NOI ÷ current debt">
              {isFinite(d.debtYieldY1) ? fmtPct(d.debtYieldY1, 2) : "—"}
            </DerivedCell>
          </Row>
        </tbody>
      </table>
    </BlockShell>
  );
}
