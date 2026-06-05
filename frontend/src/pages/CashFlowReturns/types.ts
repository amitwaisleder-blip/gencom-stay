// Cash Flow Returns — data model.
//
// Phase 1 scope: types + calculation engine only. UI layout ships in
// Phase 2. Every field here maps directly to a cell or block in the
// Hamilton Hotel Partners Paris LXR investment package that drives the
// app's visual fidelity target.
//
// Units:
//   * Currency values in EUR thousands ("EUR 000s") unless otherwise noted.
//   * Rates stored as decimals (0.06 = 6%, not 6).
//   * Per-year arrays align Y1 = first operating year (typically the
//     calendar year after acquisition). Engine layers on Dec-25 columns
//     for the acquisition/close period separately.

// ---------------------------------------------------------------------
// Costs / Uses block — editable
// ---------------------------------------------------------------------
export type CostsAssumptions = {
  acquisitionPrice: number;          // EUR 000s
  capexBudget: number;
  dueDiligence: number;
  acquisitionTransitionFees: number;
  transferTax: number;
  legalFees: number;
};


// ---------------------------------------------------------------------
// Financing block — editable
// ---------------------------------------------------------------------
export type FinancingAssumptions = {
  ltv: number;                       // decimal, e.g. 0.60
  ltc: number;                       // decimal
  financingCostsPct: number;         // decimal on (debt + capex facility)
  baseRateLabel: string;             // display label, e.g. "3m EURIBOR"
  baseRate: number;                  // decimal
  spreadBps: number;                 // basis points, e.g. 250
  commitmentFeePct: number;          // decimal on undrawn CAPEX facility
  annualAmortAcqLoan: number;        // decimal per year
  annualAmortCapexFacility: number;  // decimal per year
  // Debt-sizing constraints (Phase 8). Informational — the sizer shows
  // max debt per constraint; it does not auto-adjust LTV/LTC.
  minDscr?: number;                  // default 1.30
  minDebtYield?: number;             // default 0.09 (9% on cost)
};


// ---------------------------------------------------------------------
// Exit block — editable
// ---------------------------------------------------------------------
export type ExitAssumptions = {
  firstYear: number;                 // first operating / first-year-NOI year (e.g. 2026)
  exitYear: number;                  // e.g. 2030
  holdPeriod: number;                // years
  exitCapRate: number;               // decimal
  transactionCosts: number;          // decimal on gross sale price
};


// ---------------------------------------------------------------------
// Property operating drivers — partial editable
// ---------------------------------------------------------------------
export type PnlAssumptions = {
  keys: number[];                    // per operating year (len = holdPeriod)
  occupancy: number[];               // decimal per year
  adrY1: number;                     // Y1 ADR in EUR
  // Index i = growth applied from year i to year i+1. Index 0 unused /
  // null for Y1 (Y1 is absolute). Length = holdPeriod.
  adrGrowth: (number | null)[];
  // OPTIONAL: override total revenue directly per year. If the override
  // is null/undefined, the engine falls back to rooms-only revenue
  // (RevPAR × keys × 365). The Paris LXR PDF shows total revenue that is
  // clearly rooms + F&B + other, so we accept direct overrides.
  totalRevenueOverride?: (number | null)[];
  // Direct-input margins or absolute values per year. If absoluteOverride
  // is set, that wins. If marginOverride is set, value = revenue × margin.
  // If both null, value falls back to revenue × some default margin (only
  // used so the engine produces something for an unconfigured scenario).
  gop: LineItemByYear;
  ebitda: LineItemByYear;
  noi: LineItemByYear;
};

/** A P&L line that can be driven either by an absolute value or a margin
 *  against total revenue. `absoluteOverride` always wins. */
export type LineItemByYear = {
  absoluteOverride?: (number | null)[];
  marginOverride?: (number | null)[];
  fallbackMargin?: number;           // used only if neither override set
};


// ---------------------------------------------------------------------
// Cashflow + Exit block inputs — editable
// ---------------------------------------------------------------------
export type CashflowAssumptions = {
  /** CAPEX draw schedule. Length = holdPeriod; sum should match
   *  costs.capexBudget. Used to compute interest / commitment fees
   *  based on cumulative debt outstanding. */
  capexDrawSchedule: number[];
  /** Investor / asset-management costs by year (EUR 000s). Default 225
   *  per year for Paris LXR. */
  imCosts: number[];
  /** Tax payable by year (length = holdPeriod). Tax analysis is
   *  typically scoped later in the underwriting process, so these are
   *  flat editable inputs rather than derived. Paris LXR carries a
   *  "Tax Analysis Pending" footnote. */
  taxPayableUnlevered: number[];
  taxPayableLevered: number[];
  /** Cash paid to sponsor / promote at exit, applied in the final year. */
  promoteY5: number;
};


// ---------------------------------------------------------------------
// IRR waterfall — optional (Phase 8)
// ---------------------------------------------------------------------
/** One tier above the pref. Tier k applies to LP/GP split for the slice
 *  of exit cash between the (k-1)th and kth hurdle IRR. A tier with
 *  upperIrr=null is the catchall (applies to everything above the prior
 *  hurdle). Tiers are expected in ascending upperIrr order. */
export type WaterfallTier = {
  upperIrr: number | null;           // decimal IRR, or null for catchall
  lpShare: number;                   // decimal 0..1; gpShare = 1 - lpShare
};

export type WaterfallAssumptions = {
  /** Pref return — LP earns this IRR on contributed equity before any
   *  promote is paid. E.g. 0.08 for 8% pref. */
  prefIrr: number;
  tiers: WaterfallTier[];
};


// ---------------------------------------------------------------------
// Root assumptions bundle
// ---------------------------------------------------------------------
export type Assumptions = {
  acquisitionYear: number;           // 2025 for Paris LXR
  costs: CostsAssumptions;
  financing: FinancingAssumptions;
  exit: ExitAssumptions;
  pnl: PnlAssumptions;
  cashflow: CashflowAssumptions;
  /** Optional IRR waterfall. When present, the engine computes a
   *  parallel waterfall breakdown. The cashflow block still uses the
   *  manual `cashflow.promoteY5` as the source-of-truth for the
   *  levered post-promote CF — the waterfall is a parallel derivation
   *  shown in its own block for the user to validate against. */
  waterfall?: WaterfallAssumptions;
  /** Freeform notes shown in Block 5. */
  notes?: string;
};


// ---------------------------------------------------------------------
// Engine outputs
// ---------------------------------------------------------------------
export type Range = { priceRows: number[]; capCols: number[]; matrix: number[][] };

export type EngineOutputs = {
  costs: {
    totalUnlevered: number;
    totalLevered: number;
    financingCostsAmount: number;
    perKey: {
      acquisitionPrice: number;
      capexBudget: number;
      dueDiligence: number;
      acquisitionTransitionFees: number;
      transferTax: number;
      legalFees: number;
      totalUnlevered: number;
      financingCosts: number;
      totalLevered: number;
    };
  };

  sources: {
    debt: number;
    equity: number;
    total: number;
    perKey: { debt: number; equity: number; total: number };
    acqLoanProceeds: number;
    maxCapexFacility: number;
  };

  financing: {
    applicableRate: number;
  };

  exit: {
    grossSalesPrice: number;
    netProceeds: number;
    grossSalesPricePerKey: number;
    ebitdaMultiple: number;
    ttmEbitda: number;
    ttmNoi: number;
  };

  // Per-year arrays, length = holdPeriod
  pnl: {
    years: number[];                 // [2026..2030]
    keys: number[];
    occupancy: number[];
    occupancyChangeBps: (number | null)[];   // Y1 has no prior year → null
    adr: number[];
    adrGrowth: (number | null)[];
    revpar: number[];
    revparGrowth: (number | null)[];
    totalRevenue: number[];
    revenueGrowth: (number | null)[];
    gop: number[];
    gopGrowth: (number | null)[];
    gopMargin: number[];
    gopFlowthrough: (number | null)[];
    ebitda: number[];
    ebitdaGrowth: (number | null)[];
    ebitdaMargin: number[];
    ebitdaFlowthrough: (number | null)[];
    noi: number[];
    noiGrowth: (number | null)[];
    noiMargin: number[];
    noiFlowthrough: (number | null)[];
  };

  // Cash flow is length holdPeriod + 1: index 0 = Dec-25 acquisition,
  // indices 1..holdPeriod = Y1..Yn. The final year includes exit proceeds.
  cashflow: {
    totalAcquisitionCost: number[];
    netProceedsAtExit: number[];
    capexTotal: number[];
    imCosts: number[];
    unleveredPretaxCF: number[];
    unleveredPretaxTotal: number;
    taxPayableUnlevered: number[];
    unleveredPosttaxCF: number[];
    unleveredPosttaxTotal: number;
    financingProceeds: number[];
    capexFacility: number[];
    amortizationAcqLoan: number[];
    amortizationCapexFacility: number[];
    financingCosts: number[];
    commitmentFees: number[];
    interest: number[];
    leveredPretaxCF: number[];
    leveredPretaxTotal: number;
    taxPayableLevered: number[];
    leveredPosttaxCF: number[];
    leveredPosttaxTotal: number;
    promote: number[];
    leveredPosttaxPostPromoteCF: number[];
    leveredPosttaxPostPromoteTotal: number;
  };

  returns: {
    unleveredPretax: ReturnSet;
    unleveredPosttax: ReturnSet;
    leveredPretax: ReturnSet;
    leveredPosttax: ReturnSet;
    postPromote: ReturnSet;
  };

  sensitivity: {
    unleveredPretax: Range;
    leveredPretax: Range;
    unleveredPosttax: Range;
    leveredPosttax: Range;
  };

  // Phase 8 — Debt sizing sidebar
  debtSizing: {
    currentTotalDebt: number;
    maxByLtv: number;              // acq loan max
    maxByLtc: number;              // capex facility max
    maxBySize: number;             // LTV+LTC aggregate
    maxByDscr: number;             // NOI / (DSCR × rate)
    maxByDebtYield: number;        // NOI / DY
    maxTotal: number;              // min of maxBySize / maxByDscr / maxByDY
    binding: "size" | "dscr" | "dy";
    headroom: number;              // maxTotal − currentTotalDebt
    dscrY1: number;
    debtYieldY1: number;
    minDscr: number;
    minDebtYield: number;
    rate: number;
  };

  // Phase 8 — IRR waterfall (optional — present only when a.waterfall is set)
  waterfall?: {
    lpEquity: number;
    /** LP's post-tax leveraged cash flow, pre-promote — the input to
     *  the waterfall. */
    lpCashflowPrePromote: number[];
    lpIrrPrePromote: number;
    /** Breakeven exit CF at each hurdle rate (pref then each tier
     *  upperIrr). A higher hurdle requires more exit cash to hit. */
    breakevens: Array<{ irr: number; breakeven: number }>;
    /** Per-tier split. The first tier represents pref-to-tier-1-upper,
     *  subsequent tiers are between consecutive upperIrrs. */
    tiers: Array<{
      label: string;
      fromIrr: number;
      toIrr: number | null;
      lpShare: number;
      poolSize: number;            // dollar size of this tier
      lpTake: number;
      gpCarry: number;
    }>;
    totalGpCarry: number;          // sum of gpCarry across tiers
    totalLpPostPromote: number;    // lpDistributions − totalGpCarry
    lpIrrPostPromote: number;
  };
};

export type ReturnSet = {
  irr: number;                       // decimal
  em: number;                        // equity multiple
  profit: number;                    // EUR 000s
  investment: number;                // EUR 000s
};
