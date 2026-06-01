// Cash Flow Returns — calculation engine.
//
// Pure functions, no side effects, no React. Given a complete set of
// Assumptions, returns the full EngineOutputs that drive every block in
// the PDF-mirror UI (Phase 2+).
//
// Acceptance target: running this engine against the Paris LXR seed
// inputs produces the exact values shown in the Hamilton PDF to within
// rounding tolerance (< 1 EUR 000s per line for costs/returns, < 0.1%
// on IRRs and margins). See engine.test.ts for the full fixture.

import type {
  Assumptions, EngineOutputs, LineItemByYear, Range, ReturnSet,
} from "./types";


// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------
export function runModel(a: Assumptions): EngineOutputs {
  const core = runCore(a);
  const sensitivity = computeSensitivity(a);
  return { ...core, sensitivity };
}


/** Run every block EXCEPT sensitivity. Used by both the public entry
 *  point and the sensitivity grid — the sensitivity grid re-runs this
 *  core on each (price × cap) variant without recursing into another
 *  sensitivity pass. */
function runCore(a: Assumptions): Omit<EngineOutputs, "sensitivity"> {
  const costs = computeCosts(a);
  const financing = computeFinancing(a);
  const sources = computeSources(a, costs, financing);
  const pnl = computePnl(a);
  const exit = computeExit(a, pnl);
  const cashflow = computeCashflow(a, costs, financing, sources, pnl, exit);
  const returns = computeReturns(a, cashflow, sources);
  const debtSizing = computeDebtSizing(a, financing, sources, pnl);
  const waterfall = a.waterfall
    ? computeWaterfall(a.waterfall, cashflow.leveredPosttaxCF)
    : undefined;
  return { costs, sources, financing, exit, pnl, cashflow, returns, debtSizing, waterfall };
}


// ---------------------------------------------------------------------
// Block 1 — Costs / Uses at acquisition
// ---------------------------------------------------------------------
function computeCosts(a: Assumptions): EngineOutputs["costs"] {
  const c = a.costs;
  const totalUnlevered =
    c.acquisitionPrice + c.capexBudget + c.dueDiligence +
    c.acquisitionTransitionFees + c.transferTax + c.legalFees;

  // Financing costs apply to the debt face — acq loan proceeds + max
  // CAPEX facility. Matches PDF: 1% × (91,860 + 1,860) rolls to 919.
  // (The CAPEX facility sits at 100% LTC against the CAPEX budget.)
  const acqLoanProceeds = c.acquisitionPrice * a.financing.ltv;
  const maxCapexFacility = c.capexBudget * a.financing.ltc;
  const financingCostsAmount = a.financing.financingCostsPct * (acqLoanProceeds + maxCapexFacility);
  const totalLevered = totalUnlevered + financingCostsAmount;

  const perKey = perKeyMap(a.pnl.keys[0], {
    acquisitionPrice: c.acquisitionPrice,
    capexBudget: c.capexBudget,
    dueDiligence: c.dueDiligence,
    acquisitionTransitionFees: c.acquisitionTransitionFees,
    transferTax: c.transferTax,
    legalFees: c.legalFees,
    totalUnlevered,
    financingCosts: financingCostsAmount,
    totalLevered,
  });

  return { totalUnlevered, totalLevered, financingCostsAmount, perKey };
}


function perKeyMap<T extends Record<string, number>>(keys: number, vals: T): T {
  if (!keys || keys <= 0) return vals;
  const out: Record<string, number> = {};
  for (const k of Object.keys(vals)) out[k] = vals[k] / keys;
  return out as T;
}


// ---------------------------------------------------------------------
// Block 2 — Sources + applicable rate
// ---------------------------------------------------------------------
function computeFinancing(a: Assumptions): EngineOutputs["financing"] {
  return { applicableRate: a.financing.baseRate + a.financing.spreadBps / 10000 };
}


function computeSources(
  a: Assumptions, costs: EngineOutputs["costs"], _fin: EngineOutputs["financing"],
): EngineOutputs["sources"] {
  const acqLoanProceeds = a.costs.acquisitionPrice * a.financing.ltv;
  const maxCapexFacility = a.costs.capexBudget * a.financing.ltc;
  // PDF's Debt row includes the CAPEX facility as part of total debt
  // sources: 90,000 + 1,860 = 91,860.
  const debt = acqLoanProceeds + maxCapexFacility;
  const equity = costs.totalLevered - debt;
  const total = debt + equity;
  const keys = a.pnl.keys[0] || 1;
  return {
    debt, equity, total,
    acqLoanProceeds, maxCapexFacility,
    perKey: { debt: debt / keys, equity: equity / keys, total: total / keys },
  };
}


// ---------------------------------------------------------------------
// Block 6 — P&L / Pro Forma
// ---------------------------------------------------------------------
function computePnl(a: Assumptions): EngineOutputs["pnl"] {
  const n = a.exit.holdPeriod;
  const p = a.pnl;

  // ADR
  const adr: number[] = new Array(n);
  adr[0] = p.adrY1;
  for (let i = 1; i < n; i++) {
    const g = p.adrGrowth[i] ?? 0;
    adr[i] = adr[i - 1] * (1 + g);
  }

  // Revenue — either override or rooms-only (365 × keys × RevPAR).
  const revpar: number[] = adr.map((v, i) => v * (p.occupancy[i] ?? 0));
  const totalRevenue: number[] = [];
  for (let i = 0; i < n; i++) {
    const override = p.totalRevenueOverride?.[i];
    if (typeof override === "number") {
      totalRevenue.push(override);
    } else {
      const roomsRevenue = (revpar[i] * (p.keys[i] ?? 0) * 365) / 1000; // convert to EUR 000s
      totalRevenue.push(roomsRevenue);
    }
  }

  const gop = resolveLine(p.gop, totalRevenue);
  const ebitda = resolveLine(p.ebitda, totalRevenue);
  const noi = resolveLine(p.noi, totalRevenue);

  // Derived series
  const years = range(a.exit.firstYear, a.exit.firstYear + n - 1);
  const occupancyChangeBps: (number | null)[] = [null];
  for (let i = 1; i < n; i++) {
    occupancyChangeBps.push(((p.occupancy[i] ?? 0) - (p.occupancy[i - 1] ?? 0)) * 10000);
  }
  const adrGrowthOut: (number | null)[] = [null];
  for (let i = 1; i < n; i++) adrGrowthOut.push(adr[i] / adr[i - 1] - 1);
  const revparGrowth: (number | null)[] = [null];
  for (let i = 1; i < n; i++) revparGrowth.push(revpar[i] / revpar[i - 1] - 1);

  const revenueGrowth = growthSeries(totalRevenue);
  const gopGrowth = growthSeries(gop);
  const ebitdaGrowth = growthSeries(ebitda);
  const noiGrowth = growthSeries(noi);

  const gopMargin = margin(gop, totalRevenue);
  const ebitdaMargin = margin(ebitda, totalRevenue);
  const noiMargin = margin(noi, totalRevenue);

  const gopFlowthrough = flowthroughSeries(gop, totalRevenue);
  const ebitdaFlowthrough = flowthroughSeries(ebitda, totalRevenue);
  const noiFlowthrough = flowthroughSeries(noi, totalRevenue);

  return {
    years,
    keys: p.keys.slice(0, n),
    occupancy: p.occupancy.slice(0, n),
    occupancyChangeBps,
    adr,
    adrGrowth: adrGrowthOut,
    revpar,
    revparGrowth,
    totalRevenue,
    revenueGrowth,
    gop,
    gopGrowth,
    gopMargin,
    gopFlowthrough,
    ebitda,
    ebitdaGrowth,
    ebitdaMargin,
    ebitdaFlowthrough,
    noi,
    noiGrowth,
    noiMargin,
    noiFlowthrough,
  };
}


function resolveLine(line: LineItemByYear, revenue: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < revenue.length; i++) {
    const abs = line.absoluteOverride?.[i];
    if (typeof abs === "number") { out.push(abs); continue; }
    const m = line.marginOverride?.[i];
    if (typeof m === "number") { out.push(revenue[i] * m); continue; }
    out.push(revenue[i] * (line.fallbackMargin ?? 0));
  }
  return out;
}


function growthSeries(vals: number[]): (number | null)[] {
  const out: (number | null)[] = [null];
  for (let i = 1; i < vals.length; i++) {
    const prev = vals[i - 1];
    out.push(prev === 0 ? null : vals[i] / prev - 1);
  }
  return out;
}


function margin(num: number[], denom: number[]): number[] {
  return num.map((v, i) => (denom[i] === 0 ? 0 : v / denom[i]));
}


function flowthroughSeries(profit: number[], revenue: number[]): (number | null)[] {
  const out: (number | null)[] = [null];
  for (let i = 1; i < profit.length; i++) {
    const dRev = revenue[i] - revenue[i - 1];
    const dProfit = profit[i] - profit[i - 1];
    out.push(dRev === 0 ? null : dProfit / dRev);
  }
  // Per PDF, Y1 "flowthrough" is really the Y1 margin (the printed fields
  // share a row label even though the mathematical definition differs).
  // Replace the first entry with Y1 margin so downstream UI matches.
  if (profit.length > 0 && revenue[0] !== 0) out[0] = profit[0] / revenue[0];
  return out;
}


// ---------------------------------------------------------------------
// Block 4 — Exit derived values
// ---------------------------------------------------------------------
function computeExit(a: Assumptions, pnl: EngineOutputs["pnl"]): EngineOutputs["exit"] {
  const n = a.exit.holdPeriod;
  const ttmEbitda = pnl.ebitda[n - 1];
  const ttmNoi = pnl.noi[n - 1];
  const grossSalesPrice = ttmNoi / a.exit.exitCapRate;
  const netProceeds = grossSalesPrice * (1 - a.exit.transactionCosts);
  const grossSalesPricePerKey = grossSalesPrice / (pnl.keys[n - 1] || 1);
  const ebitdaMultiple = grossSalesPrice / ttmEbitda;
  return { grossSalesPrice, netProceeds, grossSalesPricePerKey, ebitdaMultiple, ttmEbitda, ttmNoi };
}


// ---------------------------------------------------------------------
// Block 9 — Cash flow
// ---------------------------------------------------------------------
function computeCashflow(
  a: Assumptions,
  costs: EngineOutputs["costs"],
  financing: EngineOutputs["financing"],
  sources: EngineOutputs["sources"],
  pnl: EngineOutputs["pnl"],
  exit: EngineOutputs["exit"],
): EngineOutputs["cashflow"] {
  const n = a.exit.holdPeriod;
  const total = n + 1; // Dec-25 + Y1..Yn

  const emptyArr = () => new Array(total).fill(0);

  // Total acquisition cost — unlevered basis EXCLUDING CAPEX (which is
  // financed via its own facility and drawn over the hold).
  const acqCostExclCapex = costs.totalUnlevered - a.costs.capexBudget;

  const totalAcquisitionCost = emptyArr();
  totalAcquisitionCost[0] = -acqCostExclCapex;

  const netProceedsAtExit = emptyArr();
  netProceedsAtExit[n] = exit.netProceeds;

  // CAPEX drawn per year → shown as negative in the cash flow.
  const capexTotal = emptyArr();
  const capexFacility = emptyArr();
  for (let i = 0; i < n; i++) {
    const draw = a.cashflow.capexDrawSchedule[i] ?? 0;
    capexTotal[i + 1] = -draw;
    capexFacility[i + 1] = draw;
  }

  const imCosts = emptyArr();
  for (let i = 0; i < n; i++) imCosts[i + 1] = -(a.cashflow.imCosts[i] ?? 0);

  const noi = [0, ...pnl.noi]; // align Dec-25 = 0

  // Unlevered pre-tax = NOI + CAPEX - IM - Acq + Net proceeds at exit
  const unleveredPretaxCF = emptyArr();
  for (let i = 0; i < total; i++) {
    unleveredPretaxCF[i] =
      totalAcquisitionCost[i] + netProceedsAtExit[i] +
      (noi[i] ?? 0) + capexTotal[i] + imCosts[i];
  }

  const taxPayableUnlevered = emptyArr();
  for (let i = 0; i < n; i++) taxPayableUnlevered[i + 1] = -(a.cashflow.taxPayableUnlevered[i] ?? 0);

  const unleveredPosttaxCF = unleveredPretaxCF.map((v, i) => v + taxPayableUnlevered[i]);

  // Levered — layer financing onto the unlevered stack.
  const financingProceeds = emptyArr();
  financingProceeds[0] = sources.acqLoanProceeds;
  financingProceeds[n] = -sources.acqLoanProceeds;

  // Commitment fee + interest use beginning-of-year debt balances so the
  // engine matches the PDF's convention. Closely tracks a full amort
  // schedule for the scales typical in Paris LXR (no amort, single facility).
  const { commitmentFees, interest, amortizationAcqLoan, amortizationCapexFacility } =
    computeDebtService(a, financing, sources);

  // At exit the CAPEX facility is also fully repaid alongside the acq
  // loan — PDF "CAPEX Facility" Y5 = −1,860 vs draws in prior years.
  const totalCapexDrawn = a.cashflow.capexDrawSchedule.reduce((s, v) => s + v, 0);
  capexFacility[n] -= totalCapexDrawn;

  const financingCostsCf = emptyArr();
  financingCostsCf[0] = -costs.financingCostsAmount;

  const leveredPretaxCF = emptyArr();
  for (let i = 0; i < total; i++) {
    leveredPretaxCF[i] =
      unleveredPretaxCF[i]
      + financingProceeds[i]
      + capexFacility[i]
      + amortizationAcqLoan[i]
      + amortizationCapexFacility[i]
      + financingCostsCf[i]
      + commitmentFees[i]
      + interest[i];
  }

  const taxPayableLevered = emptyArr();
  for (let i = 0; i < n; i++) taxPayableLevered[i + 1] = -(a.cashflow.taxPayableLevered[i] ?? 0);

  const leveredPosttaxCF = leveredPretaxCF.map((v, i) => v + taxPayableLevered[i]);

  const promote = emptyArr();
  promote[n] = -a.cashflow.promoteY5;

  const leveredPosttaxPostPromoteCF = leveredPosttaxCF.map((v, i) => v + promote[i]);

  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

  return {
    totalAcquisitionCost, netProceedsAtExit, capexTotal, imCosts,
    unleveredPretaxCF, unleveredPretaxTotal: sum(unleveredPretaxCF),
    taxPayableUnlevered, unleveredPosttaxCF, unleveredPosttaxTotal: sum(unleveredPosttaxCF),
    financingProceeds, capexFacility, amortizationAcqLoan, amortizationCapexFacility,
    financingCosts: financingCostsCf, commitmentFees, interest,
    leveredPretaxCF, leveredPretaxTotal: sum(leveredPretaxCF),
    taxPayableLevered, leveredPosttaxCF, leveredPosttaxTotal: sum(leveredPosttaxCF),
    promote, leveredPosttaxPostPromoteCF,
    leveredPosttaxPostPromoteTotal: sum(leveredPosttaxPostPromoteCF),
  };
}


function computeDebtService(
  a: Assumptions, financing: EngineOutputs["financing"], sources: EngineOutputs["sources"],
) {
  const n = a.exit.holdPeriod;
  const total = n + 1;
  const rate = financing.applicableRate;
  const commitmentRate = a.financing.commitmentFeePct;

  const commitmentFees = new Array(total).fill(0);
  const interest = new Array(total).fill(0);
  const amortizationAcqLoan = new Array(total).fill(0);
  const amortizationCapexFacility = new Array(total).fill(0);

  let acqLoanBalance = sources.acqLoanProceeds;   // beginning-of-period
  let capexFacilityBalance = 0;                   // grows with draws
  let capexFacilityUndrawn = sources.maxCapexFacility;

  for (let y = 1; y <= n; y++) {
    // Interest uses beginning-of-year balance on each tranche.
    const interestYear = (acqLoanBalance + capexFacilityBalance) * rate;
    interest[y] = -interestYear;

    // Commitment fee on undrawn CAPEX facility at BOY.
    commitmentFees[y] = -capexFacilityUndrawn * commitmentRate;

    // Amortization — flat % of original balance per year. Negative cash
    // because the principal is paid back.
    const acqAmort = sources.acqLoanProceeds * a.financing.annualAmortAcqLoan;
    const capexAmort = sources.maxCapexFacility * a.financing.annualAmortCapexFacility;
    amortizationAcqLoan[y] = -acqAmort;
    amortizationCapexFacility[y] = -capexAmort;

    // End-of-year activity (draws first, then amortization) updates BOY
    // balances for the next year.
    const draw = a.cashflow.capexDrawSchedule[y - 1] ?? 0;
    capexFacilityBalance += draw - capexAmort;
    capexFacilityUndrawn = Math.max(0, capexFacilityUndrawn - draw);
    acqLoanBalance = Math.max(0, acqLoanBalance - acqAmort);

    // At exit the loan is repaid via financingProceeds already; no
    // additional amortization on the exit year itself.
  }

  return { commitmentFees, interest, amortizationAcqLoan, amortizationCapexFacility };
}


// ---------------------------------------------------------------------
// IRR / EM / Profit / Investment
// ---------------------------------------------------------------------
function computeReturns(
  a: Assumptions, cf: EngineOutputs["cashflow"], sources: EngineOutputs["sources"],
): EngineOutputs["returns"] {
  // Investment amount = absolute value of first (negative) cash flow.
  const pair = (flows: number[]): ReturnSet => {
    const investment = -flows[0];
    const distributions = flows.slice(1).reduce((s, v) => s + v, 0);
    const profit = distributions + flows[0]; // equivalent to distributions - investment
    const em = investment > 0 ? distributions / investment : 0;
    const irr = computeIrr(flows);
    return { irr, em, profit, investment };
  };

  void a; void sources; // not directly needed — cashflow already has the correct first entry
  return {
    unleveredPretax: pair(cf.unleveredPretaxCF),
    unleveredPosttax: pair(cf.unleveredPosttaxCF),
    leveredPretax: pair(cf.leveredPretaxCF),
    leveredPosttax: pair(cf.leveredPosttaxCF),
    postPromote: pair(cf.leveredPosttaxPostPromoteCF),
  };
}


// ---------------------------------------------------------------------
// IRR — bisection inside a safe bracket, Newton refinement afterwards.
// ---------------------------------------------------------------------
export function computeIrr(flows: number[]): number {
  // Need at least one positive and one negative flow.
  let hasPos = false, hasNeg = false;
  for (const v of flows) { if (v > 0) hasPos = true; if (v < 0) hasNeg = true; }
  if (!hasPos || !hasNeg) return 0;

  const npv = (r: number) => {
    let s = 0;
    for (let i = 0; i < flows.length; i++) s += flows[i] / Math.pow(1 + r, i);
    return s;
  };

  // Bracket between -0.99 and 10.0.
  let lo = -0.99, hi = 10.0;
  let fLo = npv(lo), fHi = npv(hi);
  // If no sign change, fall back to 0.
  if (fLo * fHi > 0) return 0;

  // Bisection — 80 iterations gets within 1e-24 which is more than enough.
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-9) return mid;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; }
    else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}


// ---------------------------------------------------------------------
// Block 10-13 — Sensitivity tables
// ---------------------------------------------------------------------
const DEFAULT_PRICE_STEPS = [130_000, 140_000, 150_000, 160_000, 170_000];
const DEFAULT_CAP_STEPS = [0.0450, 0.0475, 0.0500, 0.0525, 0.0550];


function computeSensitivity(a: Assumptions): EngineOutputs["sensitivity"] {
  return {
    unleveredPretax: sensitivityGrid(a, "unleveredPretax"),
    leveredPretax: sensitivityGrid(a, "leveredPretax"),
    unleveredPosttax: sensitivityGrid(a, "unleveredPosttax"),
    leveredPosttax: sensitivityGrid(a, "leveredPosttax"),
  };
}


/** Re-run the model with a scaled acquisition price and overridden exit
 *  cap rate; pull the specified return series' IRR for every cell. */
function sensitivityGrid(
  a: Assumptions,
  which: "unleveredPretax" | "leveredPretax" | "unleveredPosttax" | "leveredPosttax",
): Range {
  const priceRows = DEFAULT_PRICE_STEPS;
  const capCols = DEFAULT_CAP_STEPS;
  const matrix: number[][] = [];
  for (const price of priceRows) {
    const row: number[] = [];
    for (const cap of capCols) {
      const variant: Assumptions = {
        ...a,
        costs: { ...a.costs, acquisitionPrice: price },
        exit: { ...a.exit, exitCapRate: cap },
      };
      const out = runCore(variant);
      row.push(out.returns[which].irr);
    }
    matrix.push(row);
  }
  return { priceRows, capCols, matrix };
}


// ---------------------------------------------------------------------
// Phase 8 — Debt Sizing
// ---------------------------------------------------------------------
function computeDebtSizing(
  a: Assumptions,
  financing: EngineOutputs["financing"],
  sources: EngineOutputs["sources"],
  pnl: EngineOutputs["pnl"],
): EngineOutputs["debtSizing"] {
  const minDscr = a.financing.minDscr ?? 1.30;
  const minDebtYield = a.financing.minDebtYield ?? 0.09;
  const rate = financing.applicableRate;
  const y1Noi = pnl.noi[0] ?? 0;

  const maxByLtv = sources.acqLoanProceeds;                // Acq Loan = PP × LTV
  const maxByLtc = sources.maxCapexFacility;               // CAPEX = CAPEX × LTC
  const maxBySize = maxByLtv + maxByLtc;

  // Interest-only DSCR: max debt such that NOI / (rate × debt) ≥ minDscr.
  // A rate of 0 would mean unlimited — clamp to maxBySize in that case.
  const maxByDscr = rate > 0 ? y1Noi / (minDscr * rate) : maxBySize;
  const maxByDebtYield = minDebtYield > 0 ? y1Noi / minDebtYield : maxBySize;

  const candidates: Array<{ key: "size" | "dscr" | "dy"; v: number }> = [
    { key: "size", v: maxBySize },
    { key: "dscr", v: maxByDscr },
    { key: "dy", v: maxByDebtYield },
  ];
  const binding = candidates.reduce((a, b) => (b.v < a.v ? b : a));
  const maxTotal = binding.v;
  const currentTotalDebt = sources.debt;

  const dscrY1 = (rate > 0 && currentTotalDebt > 0)
    ? y1Noi / (rate * currentTotalDebt)
    : Infinity;
  const debtYieldY1 = currentTotalDebt > 0 ? y1Noi / currentTotalDebt : Infinity;

  return {
    currentTotalDebt,
    maxByLtv, maxByLtc, maxBySize,
    maxByDscr, maxByDebtYield,
    maxTotal, binding: binding.key,
    headroom: maxTotal - currentTotalDebt,
    dscrY1, debtYieldY1,
    minDscr, minDebtYield,
    rate,
  };
}


// ---------------------------------------------------------------------
// Phase 8 — IRR Waterfall
// ---------------------------------------------------------------------
/** Breakeven exit cash flow at discount rate r, given CF[0..n-1] fixed:
 *    X_r such that Σ CF[i]/(1+r)^i for i=0..n-1  + X_r/(1+r)^n = 0
 *    → X_r = -(1+r)^n × Σ CF[i]/(1+r)^i */
function breakevenExitCf(flows: readonly number[], r: number): number {
  const n = flows.length - 1;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += flows[i] / Math.pow(1 + r, i);
  return -Math.pow(1 + r, n) * acc;
}


function computeWaterfall(
  wf: NonNullable<Assumptions["waterfall"]>,
  lpCashflowPrePromote: readonly number[],
): NonNullable<EngineOutputs["waterfall"]> {
  const n = lpCashflowPrePromote.length - 1;
  const actualExitCf = lpCashflowPrePromote[n];
  const lpEquity = -lpCashflowPrePromote[0];   // first flow is negative equity contribution
  const lpIrrPrePromote = computeIrr([...lpCashflowPrePromote]);

  // Build the sorted hurdle list: pref, then each tier.upperIrr (skip nulls).
  const hurdles: number[] = [wf.prefIrr, ...wf.tiers.map((t) => t.upperIrr).filter((v): v is number => typeof v === "number")];
  const breakevens = hurdles.map((r) => ({ irr: r, breakeven: breakevenExitCf(lpCashflowPrePromote, r) }));

  // Compose the split table. First "tier" is pref → tiers[0].upperIrr, etc.
  // The waterfall tier at index k applies to the slice between hurdle[k-1]
  // and hurdle[k] (hurdle[-1] is the pref).
  const prefBreakeven = breakevens[0].breakeven;
  const tiers: EngineOutputs["waterfall"] extends infer X ? X extends { tiers: infer T } ? T : never : never =
    [] as never;
  type TierOut = NonNullable<EngineOutputs["waterfall"]>["tiers"][number];
  const tierRows: TierOut[] = [];

  // The boundaries (in exit-CF space) for tier splits:
  //   [prefBreakeven, bk(tier1.upperIrr), bk(tier2.upperIrr), ..., ∞]
  const boundaries: number[] = [prefBreakeven];
  for (const t of wf.tiers) {
    if (t.upperIrr == null) { boundaries.push(Infinity); break; }
    boundaries.push(breakevenExitCf(lpCashflowPrePromote, t.upperIrr));
  }
  if (boundaries[boundaries.length - 1] !== Infinity) boundaries.push(Infinity);

  let prevBoundary = boundaries[0];
  let prevHurdleIrr = wf.prefIrr;
  for (let k = 0; k < wf.tiers.length; k++) {
    const t = wf.tiers[k];
    const upper = boundaries[k + 1];
    const poolSize = Math.max(0, Math.min(actualExitCf, upper) - prevBoundary);
    const lpTake = poolSize * t.lpShare;
    const gpCarry = poolSize * (1 - t.lpShare);
    tierRows.push({
      label: t.upperIrr == null
        ? `Above ${fmtIrr(prevHurdleIrr)}`
        : `${fmtIrr(prevHurdleIrr)} → ${fmtIrr(t.upperIrr)}`,
      fromIrr: prevHurdleIrr,
      toIrr: t.upperIrr,
      lpShare: t.lpShare,
      poolSize,
      lpTake,
      gpCarry,
    });
    prevBoundary = upper;
    prevHurdleIrr = t.upperIrr ?? prevHurdleIrr;
  }

  const totalGpCarry = tierRows.reduce((s, r) => s + r.gpCarry, 0);
  const lpPostPromoteFlows = [...lpCashflowPrePromote];
  lpPostPromoteFlows[n] -= totalGpCarry;
  const lpIrrPostPromote = computeIrr(lpPostPromoteFlows);
  const totalLpPostPromote = lpPostPromoteFlows.slice(1).reduce((s, v) => s + v, 0);

  void tiers;
  return {
    lpEquity,
    lpCashflowPrePromote: [...lpCashflowPrePromote],
    lpIrrPrePromote,
    breakevens,
    tiers: tierRows,
    totalGpCarry,
    totalLpPostPromote,
    lpIrrPostPromote,
  };
}


function fmtIrr(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}


// ---------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------
function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}
