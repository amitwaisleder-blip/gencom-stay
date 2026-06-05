// Paris LXR — seed assumptions pulled from the Hamilton Hotel Partners
// 7/1/2025 investment package PDF. This exact fixture drives the Phase 1
// engine unit tests; running runModel(parisLxrSeed) must reproduce the
// PDF's headline numbers within rounding tolerance.
//
// Every value references the corresponding cell/row in the PDF so it's
// easy to reconcile in the future.

import type { Assumptions } from "./types";


export const PARIS_LXR_SEED: Assumptions = {
  acquisitionYear: 2025,

  costs: {
    acquisitionPrice: 150_000,              // EUR 000s · PDF "Costs/Uses · Acquisition Price"
    capexBudget: 1_860,                     // PDF "CAPEX Budget"
    dueDiligence: 350,                      // PDF "Due Diligence"
    acquisitionTransitionFees: 1_500,       // PDF "Acquisition/Transition Fees"
    transferTax: 2_850,                     // PDF "Transfer Tax"
    legalFees: 400,                         // PDF "Legal Fees"
  },

  financing: {
    ltv: 0.60,                              // PDF "LTV (LTPP)"
    ltc: 1.00,                              // PDF "LTC (LTCAPEX)"
    financingCostsPct: 0.01,                // PDF "Financing Costs (PP+CAPEX) 1.0%"
    baseRateLabel: "3m EURIBOR",
    baseRate: 0.0209,                       // PDF "Base Rate 3m EURIBOR 2.09%"
    spreadBps: 250,                         // PDF "Spread (bps) 2.50%"
    commitmentFeePct: 0.0025,               // PDF "Commitment Fee (undrawn CAPEX) 0.25%"
    annualAmortAcqLoan: 0.00,
    annualAmortCapexFacility: 0.00,
  },

  exit: {
    firstYear: 2026,
    exitYear: 2030,
    holdPeriod: 5,
    exitCapRate: 0.05,                      // PDF "Exit cap rate 5.00%"
    transactionCosts: 0.01,                 // PDF "Transaction costs 1.00%"
  },

  pnl: {
    // Keys row constant across the projection.
    keys: [120, 120, 120, 120, 120],
    // Occupancy — PDF "Occupancy" row.
    occupancy: [0.606, 0.700, 0.729, 0.733, 0.733],
    adrY1: 558.14,                          // PDF Dec-26 ADR
    // Growth: [n/a, 3.0%, 2.5%, 2.5%, 2.5%] — Y1 is absolute; index i
    // applies growth from year i-1 → i in the engine.
    adrGrowth: [null, 0.03, 0.025, 0.025, 0.025],

    // Total Revenue overrides — rooms-only driven by RevPAR × keys × 365
    // would miss the hotel's F&B + other revenue, so we use the PDF's
    // stated total revenue per year directly.
    totalRevenueOverride: [16_705, 19_999, 21_367, 21_960, 22_509],

    // GOP / EBITDA / NOI use the PDF's published values directly.
    gop: { absoluteOverride: [7_486, 9_885, 10_734, 11_043, 11_319] },
    ebitda: { absoluteOverride: [6_477, 8_731, 9_517, 9_794, 10_038] },
    noi: { absoluteOverride: [6_898, 9_006, 9_773, 10_054, 10_305] },
  },

  cashflow: {
    // PDF "CAPEX Total" row: (1,386), (474), 0, 0, 0
    capexDrawSchedule: [1_386, 474, 0, 0, 0],
    // PDF "IM Costs" row — constant 225 per year.
    imCosts: [225, 225, 225, 225, 225],
    // PDF "Tax Payable* - Unlevered" row (Paris LXR marked "Tax Analysis Pending").
    taxPayableUnlevered: [253, 805, 1_001, 1_071, 1_132],
    // PDF "Tax Payable* - Levered" row.
    taxPayableLevered: [0, 0, 0, 17, 78],
    // PDF "Promote" row — only Y5 is non-zero.
    promoteY5: 4_306,
  },

  notes: "",
};
