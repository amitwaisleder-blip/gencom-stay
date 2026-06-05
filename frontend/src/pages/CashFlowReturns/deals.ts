// Deal registry — Gencom hotel pipeline. Phase 6 turns the single
// Paris LXR seed into a small multi-deal portfolio so the pipeline
// table has real variety and the workspace can be reused for any
// registered deal.
//
// The Paris LXR seed is the PDF-fidelity fixture driving the engine
// unit tests. The three additional deals are illustrative: realistic
// hotel economics (EUR 000s) rather than PDF reconstructions.

import type { Assumptions } from "./types";
import { PARIS_LXR_SEED } from "./seed";
import { getExtractedDeal } from "./extractedDealsStore";


export type DealStatus = "Modeling" | "In Scoping" | "IC Approved" | "Closed";

export type DealRecord = {
  id: string;
  name: string;
  location: string;
  status: DealStatus;
  modified: string;        // ISO date
  description: string;     // one-line thesis shown on hover
  seed: Assumptions;
};


// --- Rome Palazzo — ultra-luxury conversion, 90 keys ------------------
const ROME_PALAZZO_SEED: Assumptions = {
  acquisitionYear: 2025,
  costs: {
    acquisitionPrice: 32_000,
    capexBudget: 18_000,
    dueDiligence: 500,
    acquisitionTransitionFees: 2_000,
    transferTax: 3_000,
    legalFees: 500,
  },
  financing: {
    ltv: 0.55,
    ltc: 1.00,
    financingCostsPct: 0.01,
    baseRateLabel: "3m EURIBOR",
    baseRate: 0.0209,
    spreadBps: 300,
    commitmentFeePct: 0.0025,
    annualAmortAcqLoan: 0,
    annualAmortCapexFacility: 0,
  },
  exit: {
    firstYear: 2026,
    exitYear: 2030,
    holdPeriod: 5,
    exitCapRate: 0.045,
    transactionCosts: 0.01,
  },
  pnl: {
    keys: [90, 90, 90, 90, 90],
    occupancy: [0.58, 0.66, 0.70, 0.71, 0.71],
    adrY1: 750,
    adrGrowth: [null, 0.04, 0.03, 0.03, 0.03],
    totalRevenueOverride: [19_300, 22_800, 24_900, 26_000, 26_800],
    gop:    { absoluteOverride: [8_700,  10_300, 11_200, 11_700, 12_100] },
    ebitda: { absoluteOverride: [7_300,  8_700,  9_500,  9_900,  10_200] },
    noi:    { absoluteOverride: [7_900,  9_300,  10_200, 10_700, 11_000] },
  },
  cashflow: {
    capexDrawSchedule: [12_000, 6_000, 0, 0, 0],
    imCosts: [350, 350, 350, 350, 350],
    taxPayableUnlevered: [400, 800, 1_100, 1_200, 1_250],
    taxPayableLevered: [50, 100, 200, 300, 400],
    promoteY5: 5_000,
  },
  notes: "",
};


// --- Munich Flagship — business+leisure hybrid, 180 keys --------------
const MUNICH_SEED: Assumptions = {
  acquisitionYear: 2025,
  costs: {
    acquisitionPrice: 33_000,
    capexBudget: 5_000,
    dueDiligence: 300,
    acquisitionTransitionFees: 1_200,
    transferTax: 1_800,
    legalFees: 350,
  },
  financing: {
    ltv: 0.62,
    ltc: 1.00,
    financingCostsPct: 0.01,
    baseRateLabel: "3m EURIBOR",
    baseRate: 0.0209,
    spreadBps: 225,
    commitmentFeePct: 0.0025,
    annualAmortAcqLoan: 0,
    annualAmortCapexFacility: 0,
  },
  exit: {
    firstYear: 2026,
    exitYear: 2030,
    holdPeriod: 5,
    exitCapRate: 0.0625,
    transactionCosts: 0.01,
  },
  pnl: {
    keys: [180, 180, 180, 180, 180],
    occupancy: [0.70, 0.74, 0.75, 0.75, 0.75],
    adrY1: 230,
    adrGrowth: [null, 0.02, 0.02, 0.02, 0.02],
    totalRevenueOverride: [11_500, 12_800, 13_200, 13_500, 13_700],
    gop:    { absoluteOverride: [4_600, 5_100, 5_300, 5_400, 5_500] },
    ebitda: { absoluteOverride: [4_000, 4_500, 4_600, 4_700, 4_800] },
    noi:    { absoluteOverride: [4_400, 4_900, 5_000, 5_100, 5_200] },
  },
  cashflow: {
    capexDrawSchedule: [3_500, 1_500, 0, 0, 0],
    imCosts: [280, 280, 280, 280, 280],
    taxPayableUnlevered: [300, 600, 700, 750, 800],
    taxPayableLevered: [0, 50, 100, 150, 200],
    promoteY5: 2_500,
  },
  notes: "",
};


// --- Lisbon Boutique — opportunistic value-add, 65 keys ---------------
const LISBON_SEED: Assumptions = {
  acquisitionYear: 2025,
  costs: {
    acquisitionPrice: 9_500,
    capexBudget: 3_500,
    dueDiligence: 150,
    acquisitionTransitionFees: 400,
    transferTax: 550,
    legalFees: 180,
  },
  financing: {
    ltv: 0.60,
    ltc: 1.00,
    financingCostsPct: 0.01,
    baseRateLabel: "3m EURIBOR",
    baseRate: 0.0209,
    spreadBps: 275,
    commitmentFeePct: 0.0025,
    annualAmortAcqLoan: 0,
    annualAmortCapexFacility: 0,
  },
  exit: {
    firstYear: 2026,
    exitYear: 2030,
    holdPeriod: 5,
    exitCapRate: 0.070,
    transactionCosts: 0.01,
  },
  pnl: {
    keys: [65, 65, 65, 65, 65],
    occupancy: [0.65, 0.72, 0.76, 0.77, 0.77],
    adrY1: 280,
    adrGrowth: [null, 0.03, 0.03, 0.03, 0.03],
    totalRevenueOverride: [5_500, 6_700, 7_300, 7_500, 7_700],
    gop:    { absoluteOverride: [2_300, 2_800, 3_100, 3_200, 3_200] },
    ebitda: { absoluteOverride: [2_000, 2_400, 2_600, 2_700, 2_800] },
    noi:    { absoluteOverride: [2_200, 2_700, 2_900, 3_000, 3_100] },
  },
  cashflow: {
    capexDrawSchedule: [2_500, 1_000, 0, 0, 0],
    imCosts: [120, 120, 120, 120, 120],
    taxPayableUnlevered: [150, 300, 400, 450, 500],
    taxPayableLevered: [0, 30, 80, 120, 180],
    promoteY5: 1_200,
  },
  notes: "",
};


export const DEALS: readonly DealRecord[] = [
  {
    id: "paris-lxr",
    name: "Paris LXR",
    location: "Paris, France",
    status: "Modeling",
    modified: "2025-07-01",
    description: "120-key Opéra-district luxury acquisition — Hamilton IC package.",
    seed: PARIS_LXR_SEED,
  },
  {
    id: "rome-palazzo",
    name: "Rome Palazzo",
    location: "Rome, Italy",
    status: "Modeling",
    modified: "2026-03-18",
    description: "90-key Via Condotti ultra-luxury conversion — €200k/key reno.",
    seed: ROME_PALAZZO_SEED,
  },
  {
    id: "munich-flagship",
    name: "Munich Flagship",
    location: "Munich, Germany",
    status: "In Scoping",
    modified: "2026-04-02",
    description: "180-key business+leisure hybrid, light reno.",
    seed: MUNICH_SEED,
  },
  {
    id: "lisbon-boutique",
    name: "Lisbon Boutique",
    location: "Lisbon, Portugal",
    status: "In Scoping",
    modified: "2026-04-11",
    description: "65-key Alfama-district opportunistic value-add.",
    seed: LISBON_SEED,
  },
] as const;


export function getDeal(id: string): DealRecord | undefined {
  const seeded = DEALS.find((d) => d.id === id);
  if (seeded) return seeded;
  return getExtractedDeal(id);
}
