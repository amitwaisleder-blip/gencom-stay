// Block 9 — Cash Flow (EUR 000s).
// Columns: Dec-25 | Y1 | Y2 | Y3 | Y4 | Y5 | Total.
//
// Editable (Phase 4): CAPEX draw schedule, IM costs, Tax Payable
// (unlevered + levered), Promote. Every other row is a pure function of
// the inputs above + the P&L and Financing blocks.

import BlockShell, { Row } from "./BlockShell";
import EditableCell, { DerivedCell } from "./EditableCell";
import type { Assumptions, EngineOutputs } from "../types";
import { fmtMoneyParen } from "../format";


const LABEL_W = 210;
const COL_W = 80;


export default function CashflowBlock({
  a, out, onChange, onUpload,
}: {
  a: Assumptions;
  out: EngineOutputs;
  onChange: (patch: Partial<Assumptions>) => void;
  onUpload?: () => void;
}) {
  const cf = out.cashflow;
  const n = a.exit.holdPeriod;
  const headerLabels = ["Dec-25", ...Array.from({ length: n }, (_, i) => `Y${i + 1}`), "Total"];
  const sum = (arr: readonly number[]) => arr.reduce((s, v) => s + v, 0);

  // -------- mutators ---------
  function setCapex(i: number, v: number) {
    const next = [...a.cashflow.capexDrawSchedule];
    while (next.length < n) next.push(0);
    next[i] = v;
    onChange({ cashflow: { ...a.cashflow, capexDrawSchedule: next } });
  }
  function setIm(i: number, v: number) {
    const next = [...a.cashflow.imCosts];
    while (next.length < n) next.push(0);
    next[i] = v;
    onChange({ cashflow: { ...a.cashflow, imCosts: next } });
  }
  function setTaxU(i: number, v: number) {
    const next = [...a.cashflow.taxPayableUnlevered];
    while (next.length < n) next.push(0);
    next[i] = v;
    onChange({ cashflow: { ...a.cashflow, taxPayableUnlevered: next } });
  }
  function setTaxL(i: number, v: number) {
    const next = [...a.cashflow.taxPayableLevered];
    while (next.length < n) next.push(0);
    next[i] = v;
    onChange({ cashflow: { ...a.cashflow, taxPayableLevered: next } });
  }
  function setPromote(v: number) {
    onChange({ cashflow: { ...a.cashflow, promoteY5: v } });
  }

  /** Derived row helper — renders the whole series as DerivedCells. */
  const DerivedRow = ({
    label, series, total, bold, derivation,
  }: {
    label: string;
    series: readonly number[];
    total?: number;
    bold?: boolean;
    derivation?: string;
  }) => (
    <Row label={label} bold={bold}>
      {series.map((v, i) => (
        <DerivedCell key={i} width={COL_W} bold={bold} derivation={derivation}>
          {v === 0 ? "-" : fmtMoneyParen(v)}
        </DerivedCell>
      ))}
      <DerivedCell width={COL_W} bold={bold}>
        {typeof total === "number" ? fmtMoneyParen(total) : ""}
      </DerivedCell>
    </Row>
  );

  return (
    <BlockShell title="Cash Flow (EUR 000s)" onUpload={onUpload}>
      <table className="w-full">
        <thead>
          <tr className="bg-[#f0ebd9] border-b border-[#d9d4c8]">
            <td style={{ width: LABEL_W }} />
            {headerLabels.map((lbl, i) => (
              <td
                key={i}
                className="px-2 py-1 text-[10px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f] text-right"
                style={{ width: COL_W }}
              >
                {lbl}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          <DerivedRow
            label="Total Acquisition Cost"
            series={cf.totalAcquisitionCost}
            total={sum(cf.totalAcquisitionCost)}
            derivation="− (Total Unlevered − CAPEX) on Dec-25"
          />
          <DerivedRow
            label="NOI"
            series={zeroPlusOperating(out.pnl.noi, n)}
            total={sum(out.pnl.noi)}
            derivation="From P&L NOI row"
          />
          <DerivedRow
            label="Net proceeds"
            series={cf.netProceedsAtExit}
            total={sum(cf.netProceedsAtExit)}
            derivation="Gross sales × (1 − transaction costs) at exit year"
          />

          {/* CAPEX Total — editable as draws, rendered negative in CF */}
          <Row label="CAPEX Total">
            <DerivedCell width={COL_W}>-</DerivedCell>
            {Array.from({ length: n }, (_, i) => (
              <EditableCell
                key={i}
                width={COL_W}
                kind="money"
                value={a.cashflow.capexDrawSchedule[i] ?? 0}
                display={cf.capexTotal[i + 1] === 0 ? "-" : fmtMoneyParen(cf.capexTotal[i + 1])}
                onChange={(v) => setCapex(i, v as number)}
                title="CAPEX facility draw for this year — enter positive value; engine shows it as negative in CF"
              />
            ))}
            <DerivedCell width={COL_W}>{fmtMoneyParen(sum(cf.capexTotal))}</DerivedCell>
          </Row>

          {/* IM Costs — editable */}
          <Row label="IM Costs">
            <DerivedCell width={COL_W}>-</DerivedCell>
            {Array.from({ length: n }, (_, i) => (
              <EditableCell
                key={i}
                width={COL_W}
                kind="money"
                value={a.cashflow.imCosts[i] ?? 0}
                display={cf.imCosts[i + 1] === 0 ? "-" : fmtMoneyParen(cf.imCosts[i + 1])}
                onChange={(v) => setIm(i, v as number)}
                title="Annual asset management / oversight fee — enter positive"
              />
            ))}
            <DerivedCell width={COL_W}>{fmtMoneyParen(sum(cf.imCosts))}</DerivedCell>
          </Row>

          <DerivedRow label="Unlevered, Pre-tax CF" series={cf.unleveredPretaxCF} total={cf.unleveredPretaxTotal} bold
            derivation="Acq + NOI + CAPEX + IM + Net proceeds (in final year)" />

          {/* Tax Payable - Unlevered — editable */}
          <Row label="Tax Payable* – Unlevered">
            <DerivedCell width={COL_W}>-</DerivedCell>
            {Array.from({ length: n }, (_, i) => (
              <EditableCell
                key={i}
                width={COL_W}
                kind="money"
                value={a.cashflow.taxPayableUnlevered[i] ?? 0}
                display={cf.taxPayableUnlevered[i + 1] === 0 ? "-" : fmtMoneyParen(cf.taxPayableUnlevered[i + 1])}
                onChange={(v) => setTaxU(i, v as number)}
                title="Unlevered tax payable in this year — enter positive"
              />
            ))}
            <DerivedCell width={COL_W}>{fmtMoneyParen(sum(cf.taxPayableUnlevered))}</DerivedCell>
          </Row>

          <DerivedRow label="Unlevered, Post-tax CF" series={cf.unleveredPosttaxCF} total={cf.unleveredPosttaxTotal} bold
            derivation="Unlevered pre-tax CF − tax payable" />

          <DerivedRow label="Financing Proceeds" series={cf.financingProceeds} total={sum(cf.financingProceeds)}
            derivation="+ Acq loan at close; − repayment at exit" />
          <DerivedRow label="CAPEX Facility" series={cf.capexFacility} total={sum(cf.capexFacility)}
            derivation="+ draws during hold; − full repayment at exit" />
          <DerivedRow label="Amortization acq. Loan" series={cf.amortizationAcqLoan} total={sum(cf.amortizationAcqLoan)}
            derivation="Acq loan face × annual amort %" />
          <DerivedRow label="Amortisation CAPEX facility" series={cf.amortizationCapexFacility} total={sum(cf.amortizationCapexFacility)}
            derivation="CAPEX facility face × annual amort %" />
          <DerivedRow label="Financing costs" series={cf.financingCosts} total={sum(cf.financingCosts)}
            derivation="Closing cost on Dec-25" />
          <DerivedRow label="Commitment Fees" series={cf.commitmentFees} total={sum(cf.commitmentFees)}
            derivation="Commitment fee % × BOY undrawn CAPEX facility" />
          <DerivedRow label="Interest" series={cf.interest} total={sum(cf.interest)}
            derivation="Applicable rate × BOY debt balance" />

          <DerivedRow label="Levered Pre-tax CF" series={cf.leveredPretaxCF} total={cf.leveredPretaxTotal} bold
            derivation="Unlevered pre-tax CF + all financing line items" />

          {/* Tax Payable - Levered — editable */}
          <Row label="Tax Payable* – Levered">
            <DerivedCell width={COL_W}>-</DerivedCell>
            {Array.from({ length: n }, (_, i) => (
              <EditableCell
                key={i}
                width={COL_W}
                kind="money"
                value={a.cashflow.taxPayableLevered[i] ?? 0}
                display={cf.taxPayableLevered[i + 1] === 0 ? "-" : fmtMoneyParen(cf.taxPayableLevered[i + 1])}
                onChange={(v) => setTaxL(i, v as number)}
                title="Levered tax payable in this year — enter positive"
              />
            ))}
            <DerivedCell width={COL_W}>{fmtMoneyParen(sum(cf.taxPayableLevered))}</DerivedCell>
          </Row>

          <DerivedRow label="Levered, Post-tax CF" series={cf.leveredPosttaxCF} total={cf.leveredPosttaxTotal} bold />

          {/* Promote — editable (Y5 only) */}
          <Row label="Promote">
            {Array.from({ length: n }, (_, i) => {
              if (i === n - 1) return (
                <EditableCell
                  key={i}
                  width={COL_W}
                  kind="money"
                  value={a.cashflow.promoteY5}
                  display={a.cashflow.promoteY5 === 0 ? "-" : fmtMoneyParen(-a.cashflow.promoteY5)}
                  onChange={(v) => setPromote(v as number)}
                  title="Sponsor promote paid at exit (enter positive)"
                />
              );
              return <DerivedCell key={i} width={COL_W}>-</DerivedCell>;
            })}
            <DerivedCell width={COL_W}>-</DerivedCell>
            <DerivedCell width={COL_W}>{fmtMoneyParen(sum(cf.promote))}</DerivedCell>
          </Row>

          <DerivedRow label="Levered, Post-tax Post Promote CF" series={cf.leveredPosttaxPostPromoteCF}
            total={cf.leveredPosttaxPostPromoteTotal} bold />
        </tbody>
      </table>
      <div className="px-2.5 py-2 text-[10px] italic text-[#6b6f78] border-t border-[#ece6d7]">
        Note (*) Tax Analysis Pending
      </div>
    </BlockShell>
  );
}


function zeroPlusOperating(arr: readonly number[], n: number): number[] {
  return [0, ...arr.slice(0, n)];
}
