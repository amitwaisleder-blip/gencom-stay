// Cash Flow Returns — client-side export builders (Phase 9).
//
// All four formats are built in-browser from the live Assumptions +
// EngineOutputs, so the exported file always reflects exactly what's
// on screen — no round-trip, no stale snapshot.
//
//   · JSON  — the full { assumptions, engineOutputs } pair, useful for
//              version control, diffs, and re-importing.
//   · CSV   — stacked tables (P&L, Cash Flow, Returns, Waterfall) in a
//              single file, suitable for paste-into-Excel workflows.
//   · XLSX  — multi-sheet IC workbook via SheetJS.
//   · PDF   — delegated to window.print() on a dedicated print route.

import * as XLSX from "xlsx";
import type { Assumptions, EngineOutputs } from "./types";


// ---------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after the browser has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dateStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}.${dd}.${yy}`;
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9 \-_]/g, "").trim() || "Deal";
}


// ---------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------
export function exportJson(
  dealName: string, a: Assumptions, out: EngineOutputs,
): void {
  const payload = {
    dealName,
    exportedAt: new Date().toISOString(),
    assumptions: a,
    engineOutputs: out,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  triggerDownload(blob, `${safeFilename(dealName)} ${dateStamp()}.json`);
}


// ---------------------------------------------------------------------
// CSV — stacked tables with blank separator rows
// ---------------------------------------------------------------------
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Quote if the value contains comma, quote, newline, or leading/trailing whitespace
  if (/[",\n\r]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}


export function exportCsv(
  dealName: string, a: Assumptions, out: EngineOutputs,
): void {
  const n = a.exit.holdPeriod;
  const yearLabels = Array.from({ length: n }, (_, i) => `Y${i + 1}`);
  const cfLabels = ["Dec-25", ...yearLabels, "Total"];

  const rows: unknown[][] = [];
  rows.push([`${dealName} · Cash Flow Returns Export · ${new Date().toLocaleDateString()}`]);
  rows.push([]);

  // Costs
  rows.push(["COSTS / USES (EUR 000s)"]);
  rows.push(["Line", "Amount", "Per Key"]);
  const c = a.costs;
  const pk = out.costs.perKey;
  rows.push(["Acquisition Price", c.acquisitionPrice, pk.acquisitionPrice]);
  rows.push(["CAPEX Budget", c.capexBudget, pk.capexBudget]);
  rows.push(["Due Diligence", c.dueDiligence, pk.dueDiligence]);
  rows.push(["Acquisition/Transition Fees", c.acquisitionTransitionFees, pk.acquisitionTransitionFees]);
  rows.push(["Transfer Tax", c.transferTax, pk.transferTax]);
  rows.push(["Legal Fees", c.legalFees, pk.legalFees]);
  rows.push(["Total Unlevered", out.costs.totalUnlevered, pk.totalUnlevered]);
  rows.push(["Financing Costs", out.costs.financingCostsAmount, pk.financingCosts]);
  rows.push(["Total Levered", out.costs.totalLevered, pk.totalLevered]);
  rows.push([]);

  // Sources
  rows.push(["SOURCES"]);
  rows.push(["Line", "Amount", "Per Key"]);
  rows.push(["Debt", out.sources.debt, out.sources.perKey.debt]);
  rows.push(["Equity", out.sources.equity, out.sources.perKey.equity]);
  rows.push(["Total", out.sources.total, out.sources.perKey.total]);
  rows.push([]);

  // P&L
  rows.push(["PROFIT & LOSS (EUR 000s)"]);
  rows.push(["Line", ...out.pnl.years.map((y) => `Dec-${String(y).slice(-2)}`)]);
  rows.push(["Keys", ...out.pnl.keys]);
  rows.push(["Occupancy", ...out.pnl.occupancy.map((v) => (v * 100).toFixed(1) + "%")]);
  rows.push(["ADR", ...out.pnl.adr.map((v) => v.toFixed(2))]);
  rows.push(["RevPAR", ...out.pnl.revpar.map((v) => v.toFixed(2))]);
  rows.push(["Total Revenue", ...out.pnl.totalRevenue]);
  rows.push(["GOP", ...out.pnl.gop]);
  rows.push(["EBITDA", ...out.pnl.ebitda]);
  rows.push(["NOI", ...out.pnl.noi]);
  rows.push([]);

  // Cash Flow
  rows.push(["CASH FLOW (EUR 000s)"]);
  rows.push(["Line", ...cfLabels]);
  const cf = out.cashflow;
  const addCfRow = (label: string, arr: readonly number[], total?: number) =>
    rows.push([label, ...arr, typeof total === "number" ? total : arr.reduce((s, v) => s + v, 0)]);
  addCfRow("Total Acquisition Cost", cf.totalAcquisitionCost);
  addCfRow("NOI", [0, ...out.pnl.noi]);
  addCfRow("Net proceeds", cf.netProceedsAtExit);
  addCfRow("CAPEX Total", cf.capexTotal);
  addCfRow("IM Costs", cf.imCosts);
  addCfRow("Unlevered Pre-tax CF", cf.unleveredPretaxCF, cf.unleveredPretaxTotal);
  addCfRow("Tax Payable - Unlevered", cf.taxPayableUnlevered);
  addCfRow("Unlevered Post-tax CF", cf.unleveredPosttaxCF, cf.unleveredPosttaxTotal);
  addCfRow("Financing Proceeds", cf.financingProceeds);
  addCfRow("CAPEX Facility", cf.capexFacility);
  addCfRow("Amortization Acq Loan", cf.amortizationAcqLoan);
  addCfRow("Amortization CAPEX Facility", cf.amortizationCapexFacility);
  addCfRow("Financing Costs", cf.financingCosts);
  addCfRow("Commitment Fees", cf.commitmentFees);
  addCfRow("Interest", cf.interest);
  addCfRow("Levered Pre-tax CF", cf.leveredPretaxCF, cf.leveredPretaxTotal);
  addCfRow("Tax Payable - Levered", cf.taxPayableLevered);
  addCfRow("Levered Post-tax CF", cf.leveredPosttaxCF, cf.leveredPosttaxTotal);
  addCfRow("Promote", cf.promote);
  addCfRow("Levered Post-tax Post-Promote CF", cf.leveredPosttaxPostPromoteCF, cf.leveredPosttaxPostPromoteTotal);
  rows.push([]);

  // Returns
  rows.push(["RETURNS"]);
  rows.push(["Metric", "IRR", "EM", "Profit", "Investment"]);
  const r = out.returns;
  const addRet = (label: string, rs: typeof r.unleveredPretax) =>
    rows.push([label, (rs.irr * 100).toFixed(1) + "%", rs.em.toFixed(2) + "x", Math.round(rs.profit), Math.round(rs.investment)]);
  addRet("Unlevered Pre-tax", r.unleveredPretax);
  addRet("Unlevered Post-tax", r.unleveredPosttax);
  addRet("Levered Pre-tax", r.leveredPretax);
  addRet("Levered Post-tax", r.leveredPosttax);
  addRet("Post-Promote", r.postPromote);
  rows.push([]);

  // Debt Sizing
  rows.push(["DEBT SIZING"]);
  const ds = out.debtSizing;
  rows.push(["Constraint", "Max Debt (EUR 000s)"]);
  rows.push(["LTV + LTC", Math.round(ds.maxBySize)]);
  rows.push(["DSCR cap", Math.round(ds.maxByDscr)]);
  rows.push(["Debt Yield cap", Math.round(ds.maxByDebtYield)]);
  rows.push(["Binding", ds.binding.toUpperCase()]);
  rows.push(["Max Total", Math.round(ds.maxTotal)]);
  rows.push(["Current", Math.round(ds.currentTotalDebt)]);
  rows.push(["Y1 DSCR", ds.dscrY1.toFixed(2) + "x"]);
  rows.push(["Y1 Debt Yield", (ds.debtYieldY1 * 100).toFixed(2) + "%"]);
  rows.push([]);

  // Waterfall
  if (out.waterfall) {
    const w = out.waterfall;
    rows.push(["WATERFALL"]);
    rows.push(["Tier", "LP Share", "Pool", "LP Take", "GP Carry"]);
    w.tiers.forEach((t) =>
      rows.push([t.label, (t.lpShare * 100).toFixed(0) + "%", Math.round(t.poolSize), Math.round(t.lpTake), Math.round(t.gpCarry)]),
    );
    rows.push(["Total GP Carry", "", "", "", Math.round(w.totalGpCarry)]);
    rows.push(["LP IRR pre-promote", (w.lpIrrPrePromote * 100).toFixed(1) + "%"]);
    rows.push(["LP IRR post-promote", (w.lpIrrPostPromote * 100).toFixed(1) + "%"]);
    rows.push([]);
  }

  // Sensitivity
  const addSens = (label: string, grid: EngineOutputs["sensitivity"]["unleveredPretax"]) => {
    rows.push([`SENSITIVITY — ${label}`]);
    rows.push(["Price \\ Cap", ...grid.capCols.map((c) => (c * 100).toFixed(2) + "%")]);
    grid.priceRows.forEach((p, i) => {
      rows.push([Math.round(p), ...grid.matrix[i].map((v) => (v * 100).toFixed(1) + "%")]);
    });
    rows.push([]);
  };
  addSens("Unlevered Pre-tax IRR", out.sensitivity.unleveredPretax);
  addSens("Levered Pre-tax IRR", out.sensitivity.leveredPretax);
  addSens("Unlevered Post-tax IRR", out.sensitivity.unleveredPosttax);
  addSens("Levered Post-tax IRR", out.sensitivity.leveredPosttax);

  const csv = rowsToCsv(rows);
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, `${safeFilename(dealName)} ${dateStamp()}.csv`);
}


// ---------------------------------------------------------------------
// XLSX — multi-sheet IC workbook via SheetJS
// ---------------------------------------------------------------------
export function exportXlsx(
  dealName: string, a: Assumptions, out: EngineOutputs,
): void {
  const wb = XLSX.utils.book_new();
  const n = a.exit.holdPeriod;
  const yearLabels = Array.from({ length: n }, (_, i) => `Y${i + 1}`);

  // ─── Summary ────────────────────────────────────────────────────────
  const summaryAOA: unknown[][] = [
    [dealName],
    [`Cash Flow Returns · Acquisition Year ${a.acquisitionYear} · EUR 000s`],
    [`Exported ${new Date().toLocaleString()}`],
    [],
    ["Headline Returns"],
    ["Unlevered Pre-tax IRR", (out.returns.unleveredPretax.irr * 100).toFixed(1) + "%"],
    ["Unlevered Pre-tax EM", out.returns.unleveredPretax.em.toFixed(2) + "x"],
    ["Levered Pre-tax IRR", (out.returns.leveredPretax.irr * 100).toFixed(1) + "%"],
    ["Levered Pre-tax EM", out.returns.leveredPretax.em.toFixed(2) + "x"],
    ["Post-Promote IRR", (out.returns.postPromote.irr * 100).toFixed(1) + "%"],
    [],
    ["Costs / Uses (EUR 000s)"],
    ["Acquisition Price", a.costs.acquisitionPrice],
    ["CAPEX Budget", a.costs.capexBudget],
    ["Due Diligence", a.costs.dueDiligence],
    ["Acquisition/Transition Fees", a.costs.acquisitionTransitionFees],
    ["Transfer Tax", a.costs.transferTax],
    ["Legal Fees", a.costs.legalFees],
    ["Total Unlevered", out.costs.totalUnlevered],
    ["Financing Costs", out.costs.financingCostsAmount],
    ["Total Levered", out.costs.totalLevered],
    [],
    ["Sources"],
    ["Debt", out.sources.debt],
    ["Equity", out.sources.equity],
    ["Total", out.sources.total],
    [],
    ["Financing"],
    ["LTV", (a.financing.ltv * 100).toFixed(1) + "%"],
    ["LTC", (a.financing.ltc * 100).toFixed(1) + "%"],
    ["Base rate", `${a.financing.baseRateLabel}: ${(a.financing.baseRate * 100).toFixed(2)}%`],
    ["Spread", `${a.financing.spreadBps} bps`],
    ["Applicable rate", (out.financing.applicableRate * 100).toFixed(2) + "%"],
    [],
    ["Exit"],
    ["Exit cap rate", (a.exit.exitCapRate * 100).toFixed(2) + "%"],
    ["Gross sales price", out.exit.grossSalesPrice],
    ["Net proceeds", out.exit.netProceeds],
    ["EBITDA multiple", out.exit.ebitdaMultiple.toFixed(1) + "x"],
  ];
  const summary = XLSX.utils.aoa_to_sheet(summaryAOA);
  summary["!cols"] = [{ wch: 34 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, summary, "Summary");

  // ─── P&L ────────────────────────────────────────────────────────────
  const pnlRows: unknown[][] = [];
  const yearHeaders = out.pnl.years.map((y) => `Dec-${String(y).slice(-2)}`);
  pnlRows.push(["Line", ...yearHeaders]);
  pnlRows.push(["Keys", ...out.pnl.keys]);
  pnlRows.push(["Occupancy", ...out.pnl.occupancy]);
  pnlRows.push(["ADR", ...out.pnl.adr]);
  pnlRows.push(["RevPAR", ...out.pnl.revpar]);
  pnlRows.push(["Total Revenue", ...out.pnl.totalRevenue]);
  pnlRows.push(["GOP", ...out.pnl.gop]);
  pnlRows.push(["GOP Margin", ...out.pnl.gopMargin]);
  pnlRows.push(["EBITDA", ...out.pnl.ebitda]);
  pnlRows.push(["EBITDA Margin", ...out.pnl.ebitdaMargin]);
  pnlRows.push(["NOI", ...out.pnl.noi]);
  pnlRows.push(["NOI Margin", ...out.pnl.noiMargin]);
  const pnl = XLSX.utils.aoa_to_sheet(pnlRows);
  pnl["!cols"] = [{ wch: 22 }, ...yearHeaders.map(() => ({ wch: 14 }))];
  XLSX.utils.book_append_sheet(wb, pnl, "P&L");

  // ─── Cash Flow ─────────────────────────────────────────────────────
  const cfRows: unknown[][] = [];
  const cfHeaders = ["Dec-25", ...yearLabels, "Total"];
  cfRows.push(["Line", ...cfHeaders]);
  const cf = out.cashflow;
  const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);
  const pushCf = (label: string, arr: readonly number[], total?: number) =>
    cfRows.push([label, ...arr, typeof total === "number" ? total : sum(arr)]);
  pushCf("Total Acquisition Cost", cf.totalAcquisitionCost);
  pushCf("NOI", [0, ...out.pnl.noi]);
  pushCf("Net proceeds", cf.netProceedsAtExit);
  pushCf("CAPEX Total", cf.capexTotal);
  pushCf("IM Costs", cf.imCosts);
  pushCf("Unlevered Pre-tax CF", cf.unleveredPretaxCF, cf.unleveredPretaxTotal);
  pushCf("Tax Payable - Unlevered", cf.taxPayableUnlevered);
  pushCf("Unlevered Post-tax CF", cf.unleveredPosttaxCF, cf.unleveredPosttaxTotal);
  pushCf("Financing Proceeds", cf.financingProceeds);
  pushCf("CAPEX Facility", cf.capexFacility);
  pushCf("Amortization Acq Loan", cf.amortizationAcqLoan);
  pushCf("Amortization CAPEX Facility", cf.amortizationCapexFacility);
  pushCf("Financing Costs", cf.financingCosts);
  pushCf("Commitment Fees", cf.commitmentFees);
  pushCf("Interest", cf.interest);
  pushCf("Levered Pre-tax CF", cf.leveredPretaxCF, cf.leveredPretaxTotal);
  pushCf("Tax Payable - Levered", cf.taxPayableLevered);
  pushCf("Levered Post-tax CF", cf.leveredPosttaxCF, cf.leveredPosttaxTotal);
  pushCf("Promote", cf.promote);
  pushCf("Levered Post-tax Post-Promote CF", cf.leveredPosttaxPostPromoteCF, cf.leveredPosttaxPostPromoteTotal);
  const cfSheet = XLSX.utils.aoa_to_sheet(cfRows);
  cfSheet["!cols"] = [{ wch: 34 }, ...cfHeaders.map(() => ({ wch: 12 }))];
  XLSX.utils.book_append_sheet(wb, cfSheet, "Cash Flow");

  // ─── Returns + Debt Sizing + Waterfall ─────────────────────────────
  const returnsRows: unknown[][] = [];
  returnsRows.push(["Returns"]);
  returnsRows.push(["Metric", "IRR", "EM", "Profit", "Investment"]);
  const addRet = (label: string, rs: typeof out.returns.unleveredPretax) =>
    returnsRows.push([label, rs.irr, rs.em, rs.profit, rs.investment]);
  addRet("Unlevered Pre-tax", out.returns.unleveredPretax);
  addRet("Unlevered Post-tax", out.returns.unleveredPosttax);
  addRet("Levered Pre-tax", out.returns.leveredPretax);
  addRet("Levered Post-tax", out.returns.leveredPosttax);
  addRet("Post-Promote", out.returns.postPromote);
  returnsRows.push([]);

  returnsRows.push(["Debt Sizing"]);
  const ds = out.debtSizing;
  returnsRows.push(["Max by LTV + LTC", ds.maxBySize]);
  returnsRows.push(["Max by DSCR", ds.maxByDscr]);
  returnsRows.push(["Max by Debt Yield", ds.maxByDebtYield]);
  returnsRows.push(["Binding constraint", ds.binding.toUpperCase()]);
  returnsRows.push(["Max Total Debt", ds.maxTotal]);
  returnsRows.push(["Current Debt", ds.currentTotalDebt]);
  returnsRows.push(["Headroom", ds.headroom]);
  returnsRows.push(["Y1 DSCR", isFinite(ds.dscrY1) ? ds.dscrY1 : "n/a"]);
  returnsRows.push(["Y1 Debt Yield", isFinite(ds.debtYieldY1) ? ds.debtYieldY1 : "n/a"]);
  returnsRows.push([]);

  if (out.waterfall) {
    const w = out.waterfall;
    returnsRows.push(["IRR Waterfall"]);
    returnsRows.push(["Tier", "LP Share", "Pool", "LP Take", "GP Carry"]);
    w.tiers.forEach((t) =>
      returnsRows.push([t.label, t.lpShare, t.poolSize, t.lpTake, t.gpCarry]),
    );
    returnsRows.push(["Total GP Carry", "", "", "", w.totalGpCarry]);
    returnsRows.push(["LP IRR pre-promote", w.lpIrrPrePromote]);
    returnsRows.push(["LP IRR post-promote", w.lpIrrPostPromote]);
  }
  const retSheet = XLSX.utils.aoa_to_sheet(returnsRows);
  retSheet["!cols"] = [{ wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, retSheet, "Returns");

  // ─── Sensitivity ────────────────────────────────────────────────────
  const sensRows: unknown[][] = [];
  const addSens = (label: string, grid: EngineOutputs["sensitivity"]["unleveredPretax"]) => {
    sensRows.push([label]);
    sensRows.push(["Price \\ Cap", ...grid.capCols.map((c) => (c * 100).toFixed(2) + "%")]);
    grid.priceRows.forEach((p, i) => {
      sensRows.push([p, ...grid.matrix[i]]);
    });
    sensRows.push([]);
  };
  addSens("Unlevered Pre-tax IRR", out.sensitivity.unleveredPretax);
  addSens("Levered Pre-tax IRR", out.sensitivity.leveredPretax);
  addSens("Unlevered Post-tax IRR", out.sensitivity.unleveredPosttax);
  addSens("Levered Post-tax IRR", out.sensitivity.leveredPosttax);
  const sensSheet = XLSX.utils.aoa_to_sheet(sensRows);
  sensSheet["!cols"] = [{ wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, sensSheet, "Sensitivity");

  // ─── Write ─────────────────────────────────────────────────────────
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, `${safeFilename(dealName)} ${dateStamp()}.xlsx`);
}


// ---------------------------------------------------------------------
// PDF — use the browser's print dialog on a dedicated print route
// ---------------------------------------------------------------------
export function exportPdf(dealId: string): void {
  // Open the print-friendly route in a new tab; the user hits Ctrl+P / ⌘-P
  // and "Save as PDF". The print route auto-invokes window.print() on load.
  const url = `${window.location.origin}/cash-flow-returns/${dealId}/print`;
  window.open(url, "_blank", "noopener,noreferrer");
}
