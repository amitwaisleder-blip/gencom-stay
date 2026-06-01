// Block 15 (Phase 8) — IRR Waterfall.
//
// Given the LP's leveraged post-tax cash flow (pre-promote) and the
// configured waterfall (pref + IRR tiers), compute the tier-by-tier
// GP carry and the LP's post-promote IRR. Pure derivation — does NOT
// write back to cashflow.promoteY5 automatically. The user can copy
// the "Total GP Carry" figure into the Promote cell in the Cash Flow
// block if they want the rest of the model to reflect it.

import { useCallback } from "react";
import BlockShell, { Row } from "./BlockShell";
import EditableCell, { DerivedCell } from "./EditableCell";
import type { Assumptions, EngineOutputs } from "../types";
import { fmtMoney, fmtPct } from "../format";


const LABEL_W = 170;
const NUM_W = 96;


export default function WaterfallBlock({
  a, out, onChange,
}: {
  a: Assumptions;
  out: EngineOutputs;
  onChange: (patch: Partial<Assumptions>) => void;
}) {
  const wf = a.waterfall;
  const result = out.waterfall;

  const enable = useCallback(() => {
    onChange({
      waterfall: {
        prefIrr: 0.08,
        tiers: [
          { upperIrr: 0.12, lpShare: 0.80 },
          { upperIrr: 0.18, lpShare: 0.70 },
          { upperIrr: null, lpShare: 0.60 },
        ],
      },
    });
  }, [onChange]);

  const disable = useCallback(() => {
    onChange({ waterfall: undefined });
  }, [onChange]);

  function setPref(v: number) {
    if (!wf) return;
    onChange({ waterfall: { ...wf, prefIrr: v } });
  }
  function setTier(i: number, patch: Partial<NonNullable<Assumptions["waterfall"]>["tiers"][number]>) {
    if (!wf) return;
    const next = wf.tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t);
    onChange({ waterfall: { ...wf, tiers: next } });
  }

  const applyPromote = useCallback(() => {
    if (!result) return;
    onChange({
      cashflow: {
        ...a.cashflow,
        promoteY5: Math.round(result.totalGpCarry),
      },
    });
  }, [a.cashflow, result, onChange]);

  if (!wf || !result) {
    return (
      <BlockShell title="IRR Waterfall">
        <div className="px-3 py-4 text-[11px] text-[#4a4d54] leading-relaxed">
          Add a promote-tier waterfall to decompose LP vs. GP cash flows
          by hurdle. Default structure: <span className="font-semibold">8% pref</span> →
          80/20 to 12% → 70/30 to 18% → 60/40 above.
          <div className="mt-2">
            <button
              onClick={enable}
              className="px-3 py-1 rounded-md text-[11px] font-semibold text-white"
              style={{ background: "#1a1d24" }}
            >
              Enable Waterfall
            </button>
          </div>
        </div>
      </BlockShell>
    );
  }

  return (
    <BlockShell title="IRR Waterfall">
      <table className="w-full">
        <thead>
          <tr className="bg-[#f0ebd9] border-b border-[#d9d4c8]">
            <td style={{ width: LABEL_W }} />
            <td className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f] text-right" style={{ width: NUM_W }}>LP Share</td>
            <td className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f] text-right" style={{ width: NUM_W }}>Pool</td>
            <td className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f] text-right" style={{ width: NUM_W }}>LP Take</td>
            <td className="px-2 py-1 text-[9px] uppercase tracking-[0.12em] font-semibold text-[#1e3a5f] text-right" style={{ width: NUM_W }}>GP Carry</td>
          </tr>
        </thead>
        <tbody>
          {/* Pref row — no split, LP keeps everything up to pref */}
          <Row label="Pref (LP IRR hurdle)">
            <EditableCell width={NUM_W} kind="pct" digits={1} value={wf.prefIrr}
              onChange={(v) => setPref(v as number)} />
            <DerivedCell width={NUM_W} subtle>—</DerivedCell>
            <DerivedCell width={NUM_W} subtle>—</DerivedCell>
            <DerivedCell width={NUM_W} subtle>—</DerivedCell>
          </Row>

          {/* Tier rows */}
          {wf.tiers.map((t, i) => {
            const r = result.tiers[i];
            return (
              <Row key={i} label={r?.label ?? `Tier ${i + 1}`}>
                <EditableCell width={NUM_W} kind="pct" digits={0} value={t.lpShare}
                  onChange={(v) => setTier(i, { lpShare: v as number })} />
                <DerivedCell width={NUM_W}>{r ? fmtMoney(r.poolSize) : "—"}</DerivedCell>
                <DerivedCell width={NUM_W}>{r ? fmtMoney(r.lpTake) : "—"}</DerivedCell>
                <DerivedCell width={NUM_W} bold>{r ? fmtMoney(r.gpCarry) : "—"}</DerivedCell>
              </Row>
            );
          })}

          <Row label="Total GP Carry" bold>
            <DerivedCell width={NUM_W} bold>—</DerivedCell>
            <DerivedCell width={NUM_W} bold>—</DerivedCell>
            <DerivedCell width={NUM_W} bold>—</DerivedCell>
            <DerivedCell width={NUM_W} bold>{fmtMoney(result.totalGpCarry)}</DerivedCell>
          </Row>
        </tbody>
      </table>

      <div className="px-2.5 py-2 border-t border-[#ece6d7] bg-[#faf7f1] text-[11px] space-y-1">
        <div className="flex justify-between">
          <span className="text-[#4a4d54]">LP equity</span>
          <span className="font-mono tabular-nums">{fmtMoney(result.lpEquity)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#4a4d54]">LP IRR — pre-promote</span>
          <span className="font-mono tabular-nums">{fmtPct(result.lpIrrPrePromote, 1)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#4a4d54] font-semibold">LP IRR — post-promote</span>
          <span className="font-mono tabular-nums font-semibold text-[#b89555]">{fmtPct(result.lpIrrPostPromote, 1)}</span>
        </div>
      </div>

      <div className="px-2.5 py-2 border-t border-[#ece6d7] flex items-center justify-between gap-2">
        <div className="text-[10px] italic text-[#6b6f78] leading-tight">
          Informational only — click below to copy the waterfall carry
          into Cash Flow's Promote cell.
        </div>
        <div className="flex gap-2">
          <button
            onClick={applyPromote}
            title="Write totalGpCarry into cashflow.promoteY5"
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold text-white whitespace-nowrap"
            style={{ background: "#1a1d24" }}
          >
            → Apply to Promote
          </button>
          <button
            onClick={disable}
            title="Remove waterfall configuration"
            className="px-2.5 py-1 rounded-md text-[10px] font-semibold text-[#6b6f78] border border-[#d9d4c8]"
          >
            Disable
          </button>
        </div>
      </div>
    </BlockShell>
  );
}
