// Block 6 — Profit & Loss Statement / Pro Forma.
// Horizontal year columns Dec-25..Dec-30 with Projected sub-header.
//
// Editable (Phase 4): Keys, Occupancy, ADR Y1, ADR growth Y2..Yn, Total
// Revenue, GOP, EBITDA, NOI per year. Every other row is derived from
// the engine and carries a derivation tooltip.

import BlockShell, { Row } from "./BlockShell";
import EditableCell, { DerivedCell } from "./EditableCell";
import type { Assumptions, EngineOutputs } from "../types";
import { fmtMoney, fmtDecimal, fmtPct, fmtBps } from "../format";


const LABEL_W = 180;
const YEAR_W = 80;


export default function PnlBlock({
  a, out, onChange, onUpload,
}: {
  a: Assumptions;
  out: EngineOutputs;
  onChange: (patch: Partial<Assumptions>) => void;
  onUpload?: () => void;
}) {
  const years = [null, ...out.pnl.years];
  const N = out.pnl.years.length;
  const p = out.pnl;

  function setKeys(i: number, v: number) {
    const next = [...a.pnl.keys]; next[i] = v;
    onChange({ pnl: { ...a.pnl, keys: next } });
  }
  function setOccupancy(i: number, v: number) {
    const next = [...a.pnl.occupancy]; next[i] = v;
    onChange({ pnl: { ...a.pnl, occupancy: next } });
  }
  function setAdrY1(v: number) { onChange({ pnl: { ...a.pnl, adrY1: v } }); }
  function setAdrGrowth(i: number, v: number) {
    const next = [...a.pnl.adrGrowth]; next[i] = v;
    onChange({ pnl: { ...a.pnl, adrGrowth: next } });
  }
  function setRevenue(i: number, v: number) {
    const next = [...(a.pnl.totalRevenueOverride ?? [])];
    while (next.length < N) next.push(null);
    next[i] = v;
    onChange({ pnl: { ...a.pnl, totalRevenueOverride: next } });
  }
  function setAbsLine(line: "gop" | "ebitda" | "noi", i: number, v: number) {
    const next = [...(a.pnl[line].absoluteOverride ?? [])];
    while (next.length < N) next.push(null);
    next[i] = v;
    onChange({
      pnl: {
        ...a.pnl,
        [line]: { ...a.pnl[line], absoluteOverride: next },
      },
    });
  }

  // Blank cell for the Dec-25 column — visually holds the space without
  // implying an editable value.
  const blank = (key: string) => (
    <td key={key} className="px-2 py-[3px]" style={{ width: YEAR_W }} />
  );

  return (
    <BlockShell title="Profit & Loss Statement / Pro Forma (EUR 000s)" onUpload={onUpload}>
      <table className="w-full">
        <thead>
          <tr className="bg-[#eae2c9] border-b border-[#d9d4c8]">
            <td style={{ width: LABEL_W }} />
            <td />
            <td colSpan={N} className="py-1 text-[10px] italic text-center text-[#1e3a5f] tracking-[0.12em] uppercase font-semibold">
              Projected
            </td>
            <td />
          </tr>
          <tr className="bg-[#f0ebd9] border-b border-[#d9d4c8]">
            <td style={{ width: LABEL_W }} />
            {years.map((y, i) => (
              <td
                key={i}
                className="px-2 py-1 text-[10px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f] text-right"
                style={{ width: YEAR_W }}
              >
                {y ? `Dec-${String(y).slice(-2)}` : "Dec-25"}
              </td>
            ))}
            <td
              className="px-2 py-1 text-[10px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f] text-right"
              style={{ width: YEAR_W }}
            >
              CAGR (30-19)
            </td>
          </tr>
        </thead>
        <tbody>
          {/* Keys — editable per year */}
          <Row label="Keys">
            {blank("keys-d25")}
            {p.keys.map((v, i) => (
              <EditableCell key={i} width={YEAR_W} kind="int" value={v}
                onChange={(nv) => setKeys(i, nv as number)} />
            ))}
            <DerivedCell width={YEAR_W} />
          </Row>

          {/* Occupancy — editable per year */}
          <Row label="Occupancy" bold>
            {blank("occ-d25")}
            {p.occupancy.map((v, i) => (
              <EditableCell key={i} width={YEAR_W} kind="pct" digits={1} bold value={v}
                onChange={(nv) => setOccupancy(i, nv as number)} />
            ))}
            <DerivedCell width={YEAR_W} bold />
          </Row>
          <Row label="% change in bps" subtle>
            {blank("bps-d25")}
            {p.occupancyChangeBps.map((v, i) => (
              <DerivedCell key={i} width={YEAR_W} subtle derivation="YoY occupancy Δ in basis points">
                {typeof v === "number" ? fmtBps(v) : ""}
              </DerivedCell>
            ))}
            <DerivedCell width={YEAR_W} subtle />
          </Row>

          {/* ADR Y1 editable; Y2..Yn editable via the growth row below */}
          <Row label="ADR" bold>
            {blank("adr-d25")}
            <EditableCell width={YEAR_W} kind="decimal" digits={2} bold value={a.pnl.adrY1}
              onChange={(v) => setAdrY1(v as number)} />
            {p.adr.slice(1).map((v, i) => (
              <DerivedCell key={i} width={YEAR_W} bold derivation={`ADR Y${i + 1} × (1 + growth Y${i + 2})`}>
                {fmtDecimal(v, 2)}
              </DerivedCell>
            ))}
            <DerivedCell width={YEAR_W} bold />
          </Row>
          <Row label="% growth" subtle>
            {blank("adr-growth-d25")}
            <DerivedCell width={YEAR_W} subtle />
            {a.pnl.adrGrowth.slice(1).map((g, i) => (
              <EditableCell key={i} width={YEAR_W} kind="pct" digits={1} subtle value={g ?? 0}
                onChange={(nv) => setAdrGrowth(i + 1, nv as number)} />
            ))}
            <DerivedCell width={YEAR_W} subtle />
          </Row>

          <Row label="RevPAR" bold>
            {blank("rp-d25")}
            {p.revpar.map((v, i) => (
              <DerivedCell key={i} width={YEAR_W} bold derivation="ADR × Occupancy">
                {fmtDecimal(v, 2)}
              </DerivedCell>
            ))}
            <DerivedCell width={YEAR_W} bold />
          </Row>
          <Row label="% growth" subtle>
            {blank("rp-g-d25")}
            {p.revparGrowth.map((v, i) => (
              <DerivedCell key={i} width={YEAR_W} subtle>
                {typeof v === "number" ? fmtPct(v, 1) : ""}
              </DerivedCell>
            ))}
            <DerivedCell width={YEAR_W} subtle />
          </Row>

          {/* Revenue — editable per year (overrides rooms-only calc) */}
          <Row label="Total Revenue" bold>
            {blank("rev-d25")}
            {p.totalRevenue.map((v, i) => (
              <EditableCell key={i} width={YEAR_W} kind="money" bold value={v}
                onChange={(nv) => setRevenue(i, nv as number)} />
            ))}
            <DerivedCell width={YEAR_W} bold />
          </Row>
          <Row label="% growth" subtle>
            {blank("rev-g-d25")}
            {p.revenueGrowth.map((v, i) => (
              <DerivedCell key={i} width={YEAR_W} subtle>
                {typeof v === "number" ? fmtPct(v, 1) : ""}
              </DerivedCell>
            ))}
            <DerivedCell width={YEAR_W} subtle />
          </Row>

          {/* GOP / EBITDA / NOI — editable absolute values per year */}
          {(["gop", "ebitda", "noi"] as const).map((line) => {
            const label = line.toUpperCase();
            const values = p[line];
            const growth = p[`${line}Growth` as const];
            const margin = p[`${line}Margin` as const];
            const flow = p[`${line}Flowthrough` as const];
            return (
              <>
                <Row key={`${line}-val`} label={label} bold>
                  {blank(`${line}-d25`)}
                  {values.map((v, i) => (
                    <EditableCell key={i} width={YEAR_W} kind="money" bold value={v}
                      onChange={(nv) => setAbsLine(line, i, nv as number)} />
                  ))}
                  <DerivedCell width={YEAR_W} bold />
                </Row>
                <Row key={`${line}-g`} label="% growth" subtle>
                  {blank(`${line}-g-d25`)}
                  {growth.map((v, i) => (
                    <DerivedCell key={i} width={YEAR_W} subtle>
                      {typeof v === "number" ? fmtPct(v, 1) : ""}
                    </DerivedCell>
                  ))}
                  <DerivedCell width={YEAR_W} subtle />
                </Row>
                <Row key={`${line}-m`} label="% margin" subtle>
                  {blank(`${line}-m-d25`)}
                  {margin.map((v, i) => (
                    <DerivedCell key={i} width={YEAR_W} subtle derivation={`${label} ÷ Total Revenue`}>
                      {fmtPct(v, 1)}
                    </DerivedCell>
                  ))}
                  <DerivedCell width={YEAR_W} subtle />
                </Row>
                <Row key={`${line}-f`} label="% flowthrough" subtle>
                  {blank(`${line}-f-d25`)}
                  {flow.map((v, i) => (
                    <DerivedCell key={i} width={YEAR_W} subtle derivation="Δ profit ÷ Δ revenue (Y1 = margin)">
                      {typeof v === "number" ? fmtPct(v, 1) : ""}
                    </DerivedCell>
                  ))}
                  <DerivedCell width={YEAR_W} subtle />
                </Row>
              </>
            );
          })}
        </tbody>
      </table>
    </BlockShell>
  );
}
