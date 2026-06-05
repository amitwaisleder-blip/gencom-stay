// Scenario engine — derives Downside / Upside variants from a Base
// Assumptions set by flexing the most-sensitive hotel drivers:
// occupancy, ADR growth, operating margins (via GOP/EBITDA/NOI absolute
// overrides), and the exit cap rate. The derived scenarios are a
// starting point — the user can override any cell in any scenario
// independently once the toggle swaps which scenario is editable.

import type { Assumptions } from "./types";


export type ScenarioKey = "downside" | "base" | "upside";

export const SCENARIO_KEYS: readonly ScenarioKey[] = ["downside", "base", "upside"] as const;

export const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  downside: "Downside",
  base: "Base",
  upside: "Upside",
};


function scaleArr(arr: number[], f: number): number[] {
  return arr.map((v) => Math.round(v * f));
}
function scaleOpt(
  arr: (number | null)[] | undefined,
  f: number,
): (number | null)[] | undefined {
  return arr?.map((v) => (v == null ? v : Math.round(v * f)));
}


export function buildDownside(base: Assumptions): Assumptions {
  return {
    ...base,
    exit: { ...base.exit, exitCapRate: base.exit.exitCapRate + 0.0050 },
    pnl: {
      ...base.pnl,
      // Shave occupancy by 400bps (floored at 0)
      occupancy: base.pnl.occupancy.map((v) => Math.max(0, v - 0.04)),
      // Reduce ADR growth by 100bps per applicable year (keep Y1 absolute)
      adrGrowth: base.pnl.adrGrowth.map((g) => (g == null ? g : Math.max(0, g - 0.01))),
      totalRevenueOverride: scaleOpt(base.pnl.totalRevenueOverride, 0.92),
      gop:    { ...base.pnl.gop,    absoluteOverride: scaleOpt(base.pnl.gop.absoluteOverride,    0.88) },
      ebitda: { ...base.pnl.ebitda, absoluteOverride: scaleOpt(base.pnl.ebitda.absoluteOverride, 0.86) },
      noi:    { ...base.pnl.noi,    absoluteOverride: scaleOpt(base.pnl.noi.absoluteOverride,    0.85) },
    },
    cashflow: {
      ...base.cashflow,
      taxPayableUnlevered: scaleArr(base.cashflow.taxPayableUnlevered, 0.85),
      taxPayableLevered:   scaleArr(base.cashflow.taxPayableLevered,   0.85),
      promoteY5: Math.round(base.cashflow.promoteY5 * 0.3),
    },
  };
}


export function buildUpside(base: Assumptions): Assumptions {
  return {
    ...base,
    exit: { ...base.exit, exitCapRate: Math.max(0.01, base.exit.exitCapRate - 0.0025) },
    pnl: {
      ...base.pnl,
      occupancy: base.pnl.occupancy.map((v) => Math.min(0.85, v + 0.02)),
      adrGrowth: base.pnl.adrGrowth.map((g) => (g == null ? g : g + 0.005)),
      totalRevenueOverride: scaleOpt(base.pnl.totalRevenueOverride, 1.08),
      gop:    { ...base.pnl.gop,    absoluteOverride: scaleOpt(base.pnl.gop.absoluteOverride,    1.10) },
      ebitda: { ...base.pnl.ebitda, absoluteOverride: scaleOpt(base.pnl.ebitda.absoluteOverride, 1.12) },
      noi:    { ...base.pnl.noi,    absoluteOverride: scaleOpt(base.pnl.noi.absoluteOverride,    1.13) },
    },
    cashflow: {
      ...base.cashflow,
      taxPayableUnlevered: scaleArr(base.cashflow.taxPayableUnlevered, 1.15),
      taxPayableLevered:   scaleArr(base.cashflow.taxPayableLevered,   1.15),
      promoteY5: Math.round(base.cashflow.promoteY5 * 1.5),
    },
  };
}


export function buildScenarios(base: Assumptions): Record<ScenarioKey, Assumptions> {
  return {
    downside: buildDownside(base),
    base: base,
    upside: buildUpside(base),
  };
}
