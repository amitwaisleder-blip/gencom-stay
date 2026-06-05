// Left-column blocks — Costs/Uses, Sources, Financing, Exit, Notes.
// Phase 4 makes every input cell editable, wired to a shared onChange
// callback that updates the single Assumptions state at the workspace
// level. Derived cells (per-key, totals, applicable rate, gross sales
// price, etc.) keep their Num styling with a tooltip that documents
// the derivation.

import BlockShell, { Row, SubHeaderRow } from "./BlockShell";
import EditableCell, { DerivedCell } from "./EditableCell";
import type { Assumptions, EngineOutputs } from "../types";
import { fmtMoney, fmtPerKey, fmtPct, fmtDecimal, fmtMultiplier } from "../format";


const FIRST_COL = 170;
const NUM_COL = 78;


export function CostsUsesBlock({
  a, out, onChange, onUpload,
}: {
  a: Assumptions;
  out: EngineOutputs;
  onChange: (patch: Partial<Assumptions>) => void;
  onUpload?: () => void;
}) {
  function setCost<K extends keyof Assumptions["costs"]>(k: K, v: number) {
    onChange({ costs: { ...a.costs, [k]: v } });
  }

  return (
    <BlockShell title="Costs / Uses at acquisition (EUR 000s)" onUpload={onUpload}>
      <table className="w-full">
        <tbody>
          <SubHeaderRow firstColWidth={FIRST_COL} labels={[
            { text: "" },
            { text: "EUR 000s", align: "right" },
            { text: "Per Key", align: "right" },
          ]} />

          <Row label="Acquisition Price">
            <EditableCell width={NUM_COL} kind="money" value={a.costs.acquisitionPrice}
              onChange={(v) => setCost("acquisitionPrice", v as number)} />
            <DerivedCell width={NUM_COL} derivation={`= ${a.costs.acquisitionPrice} ÷ ${a.pnl.keys[0]} keys`}>
              {fmtPerKey(out.costs.perKey.acquisitionPrice)}
            </DerivedCell>
          </Row>
          <Row label="CAPEX Budget">
            <EditableCell width={NUM_COL} kind="money" value={a.costs.capexBudget}
              onChange={(v) => setCost("capexBudget", v as number)} />
            <DerivedCell width={NUM_COL}>{fmtPerKey(out.costs.perKey.capexBudget)}</DerivedCell>
          </Row>
          <Row label="Due Diligence">
            <EditableCell width={NUM_COL} kind="money" value={a.costs.dueDiligence}
              onChange={(v) => setCost("dueDiligence", v as number)} />
            <DerivedCell width={NUM_COL}>{fmtPerKey(out.costs.perKey.dueDiligence)}</DerivedCell>
          </Row>
          <Row label="Acquisition/Transition Fees">
            <EditableCell width={NUM_COL} kind="money" value={a.costs.acquisitionTransitionFees}
              onChange={(v) => setCost("acquisitionTransitionFees", v as number)} />
            <DerivedCell width={NUM_COL}>{fmtPerKey(out.costs.perKey.acquisitionTransitionFees)}</DerivedCell>
          </Row>
          <Row label="Transfer Tax">
            <EditableCell width={NUM_COL} kind="money" value={a.costs.transferTax}
              onChange={(v) => setCost("transferTax", v as number)} />
            <DerivedCell width={NUM_COL}>{fmtPerKey(out.costs.perKey.transferTax)}</DerivedCell>
          </Row>
          <Row label="Legal Fees">
            <EditableCell width={NUM_COL} kind="money" value={a.costs.legalFees}
              onChange={(v) => setCost("legalFees", v as number)} />
            <DerivedCell width={NUM_COL}>{fmtPerKey(out.costs.perKey.legalFees)}</DerivedCell>
          </Row>

          <Row label="Total Costs: Unlevered" bold>
            <DerivedCell width={NUM_COL} bold derivation="Sum of costs/uses rows">
              {fmtMoney(out.costs.totalUnlevered)}
            </DerivedCell>
            <DerivedCell width={NUM_COL} bold>{fmtPerKey(out.costs.perKey.totalUnlevered)}</DerivedCell>
          </Row>
          <Row label="Financing Costs">
            <DerivedCell width={NUM_COL} derivation={`= ${fmtPct(a.financing.financingCostsPct, 1)} × (debt + CAPEX facility)`}>
              {fmtMoney(out.costs.financingCostsAmount)}
            </DerivedCell>
            <DerivedCell width={NUM_COL}>{fmtPerKey(out.costs.perKey.financingCosts)}</DerivedCell>
          </Row>
          <Row label="Total Costs: Levered" bold>
            <DerivedCell width={NUM_COL} bold derivation="Unlevered total + financing costs">
              {fmtMoney(out.costs.totalLevered)}
            </DerivedCell>
            <DerivedCell width={NUM_COL} bold>{fmtPerKey(out.costs.perKey.totalLevered)}</DerivedCell>
          </Row>
        </tbody>
      </table>
    </BlockShell>
  );
}


export function SourcesBlock({ out }: { out: EngineOutputs }) {
  // Sources are entirely derived from costs + LTV/LTC inputs — no direct
  // editing. Tooltips document the derivation.
  return (
    <BlockShell title="Sources (EUR 000s)">
      <table className="w-full">
        <tbody>
          <SubHeaderRow firstColWidth={FIRST_COL} labels={[
            { text: "" },
            { text: "EUR 000s", align: "right" },
            { text: "Per Key", align: "right" },
          ]} />
          <Row label="Debt">
            <DerivedCell width={NUM_COL} derivation="Acq Loan (PP × LTV) + Max CAPEX Facility (CAPEX × LTC)">
              {fmtMoney(out.sources.debt)}
            </DerivedCell>
            <DerivedCell width={NUM_COL}>{fmtPerKey(out.sources.perKey.debt)}</DerivedCell>
          </Row>
          <Row label="Equity">
            <DerivedCell width={NUM_COL} derivation="Total Levered Cost − Debt">
              {fmtMoney(out.sources.equity)}
            </DerivedCell>
            <DerivedCell width={NUM_COL}>{fmtPerKey(out.sources.perKey.equity)}</DerivedCell>
          </Row>
          <Row label="Total" bold>
            <DerivedCell width={NUM_COL} bold derivation="Debt + Equity (must equal Total Levered)">
              {fmtMoney(out.sources.total)}
            </DerivedCell>
            <DerivedCell width={NUM_COL} bold>{fmtPerKey(out.sources.perKey.total)}</DerivedCell>
          </Row>
        </tbody>
      </table>
    </BlockShell>
  );
}


export function FinancingBlock({
  a, out, onChange, onUpload,
}: {
  a: Assumptions;
  out: EngineOutputs;
  onChange: (patch: Partial<Assumptions>) => void;
  onUpload?: () => void;
}) {
  const f = a.financing;
  function set<K extends keyof Assumptions["financing"]>(k: K, v: Assumptions["financing"][K]) {
    onChange({ financing: { ...f, [k]: v } });
  }

  return (
    <BlockShell title="Financing Assumptions" onUpload={onUpload}>
      <table className="w-full">
        <tbody>
          <Row label="LTV (LTPP)">
            <EditableCell width={NUM_COL * 2} kind="pct" digits={1} value={f.ltv}
              onChange={(v) => set("ltv", v as number)} />
          </Row>
          <Row label="Proceeds acq. Loan (EUR '000s)" subtle>
            <DerivedCell width={NUM_COL * 2} subtle derivation="Acquisition Price × LTV">
              {fmtMoney(out.sources.acqLoanProceeds)}
            </DerivedCell>
          </Row>
          <Row label="LTC (LTCAPEX)">
            <EditableCell width={NUM_COL * 2} kind="pct" digits={1} value={f.ltc}
              onChange={(v) => set("ltc", v as number)} />
          </Row>
          <Row label="Maximum CAPEX Facility (EUR '000s)" subtle>
            <DerivedCell width={NUM_COL * 2} subtle derivation="CAPEX Budget × LTC">
              {fmtMoney(out.sources.maxCapexFacility)}
            </DerivedCell>
          </Row>
          <Row label="Financing Costs (PP+CAPEX)">
            <EditableCell width={NUM_COL} kind="pct" digits={1} value={f.financingCostsPct}
              onChange={(v) => set("financingCostsPct", v as number)} />
            <DerivedCell width={NUM_COL} derivation="% × (Acq Loan + Max CAPEX Facility)">
              {fmtMoney(out.costs.financingCostsAmount)}
            </DerivedCell>
          </Row>
          <Row label="Base Rate">
            <EditableCell width={NUM_COL} kind="text" value={f.baseRateLabel}
              onChange={(v) => set("baseRateLabel", v as string)} />
            <EditableCell width={NUM_COL} kind="pct" digits={2} value={f.baseRate}
              onChange={(v) => set("baseRate", v as number)} />
          </Row>
          <Row label="Spread (bps)">
            <EditableCell width={NUM_COL * 2} kind="pct" digits={2} value={f.spreadBps / 10000}
              onChange={(v) => set("spreadBps", (v as number) * 10000)} />
          </Row>
          <Row label="Applicable Rate" bold>
            <DerivedCell width={NUM_COL * 2} bold derivation="Base rate + spread">
              {fmtPct(out.financing.applicableRate, 2)}
            </DerivedCell>
          </Row>
          <Row label="Commitment Fee (undrawn CAPEX)">
            <EditableCell width={NUM_COL * 2} kind="pct" digits={2} value={f.commitmentFeePct}
              onChange={(v) => set("commitmentFeePct", v as number)} />
          </Row>
          <Row label="Annual Amort. Acq. Loan">
            <EditableCell width={NUM_COL} kind="pct" digits={1} value={f.annualAmortAcqLoan}
              onChange={(v) => set("annualAmortAcqLoan", v as number)} />
            <DerivedCell width={NUM_COL} subtle>0</DerivedCell>
          </Row>
          <Row label="Annual Amort. CAPEX Facility">
            <EditableCell width={NUM_COL} kind="pct" digits={1} value={f.annualAmortCapexFacility}
              onChange={(v) => set("annualAmortCapexFacility", v as number)} />
            <DerivedCell width={NUM_COL} subtle>TBC</DerivedCell>
          </Row>
        </tbody>
      </table>
    </BlockShell>
  );
}


export function ExitBlock({
  a, out, onChange, onUpload,
}: {
  a: Assumptions;
  out: EngineOutputs;
  onChange: (patch: Partial<Assumptions>) => void;
  onUpload?: () => void;
}) {
  const ex = a.exit;
  function set<K extends keyof Assumptions["exit"]>(k: K, v: Assumptions["exit"][K]) {
    onChange({ exit: { ...ex, [k]: v } });
  }

  return (
    <BlockShell title="Exit Assumptions" onUpload={onUpload}>
      <table className="w-full">
        <tbody>
          <Row label="First year">
            <EditableCell width={NUM_COL * 2} kind="int" value={ex.firstYear}
              onChange={(v) => set("firstYear", v as number)} />
          </Row>
          <Row label="Exit year">
            <EditableCell width={NUM_COL * 2} kind="int" value={ex.exitYear}
              onChange={(v) => set("exitYear", v as number)} />
          </Row>
          <Row label="Hold period (years)">
            <EditableCell width={NUM_COL * 2} kind="int" value={ex.holdPeriod}
              onChange={(v) => set("holdPeriod", v as number)} />
          </Row>
          <Row label="Exit cap rate">
            <EditableCell width={NUM_COL * 2} kind="pct" digits={2} value={ex.exitCapRate}
              onChange={(v) => set("exitCapRate", v as number)} />
          </Row>
          <Row label="Gross sales price (EUR 000s)">
            <DerivedCell width={NUM_COL * 2} derivation="TTM NOI ÷ Exit Cap Rate">
              {fmtMoney(out.exit.grossSalesPrice)}
            </DerivedCell>
          </Row>
          <Row label="Per Key (EUR 000s)" subtle>
            <DerivedCell width={NUM_COL * 2} subtle>{fmtDecimal(out.exit.grossSalesPricePerKey, 0)}</DerivedCell>
          </Row>
          <Row label="Transaction costs">
            <EditableCell width={NUM_COL * 2} kind="pct" digits={2} value={ex.transactionCosts}
              onChange={(v) => set("transactionCosts", v as number)} />
          </Row>
          <Row label="TTM EBITDA (EUR 000s)" subtle>
            <DerivedCell width={NUM_COL * 2} subtle derivation="Final-year EBITDA">
              {fmtMoney(out.exit.ttmEbitda)}
            </DerivedCell>
          </Row>
          <Row label="TTM NOI (EUR 000s)" subtle>
            <DerivedCell width={NUM_COL * 2} subtle derivation="Final-year NOI">
              {fmtMoney(out.exit.ttmNoi)}
            </DerivedCell>
          </Row>
          <Row label="EBITDA multiple" bold>
            <DerivedCell width={NUM_COL * 2} bold derivation="Gross sales price ÷ TTM EBITDA">
              {fmtMultiplier(out.exit.ebitdaMultiple, 1)}
            </DerivedCell>
          </Row>
        </tbody>
      </table>
    </BlockShell>
  );
}


export function NotesBlock({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) {
  return (
    <BlockShell title="Notes" collapsible>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Deal notes, assumptions rationale, open questions…"
        rows={6}
        className="w-full px-2.5 py-2 text-[11px] font-sans text-[#1a1d24] bg-white focus:outline-none focus:ring-1 focus:ring-[#b89555]/40 resize-y"
        style={{ minHeight: 120 }}
      />
    </BlockShell>
  );
}
