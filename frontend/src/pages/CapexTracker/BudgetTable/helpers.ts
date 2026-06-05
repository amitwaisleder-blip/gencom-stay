import type { CapexLine, CapexLineStatus } from "../lib/types";


/** Tailwind class triple for a status pill: bg + border + text. Returned as a
 *  single string so it can be dropped into className directly. Falls back to
 *  a neutral stone palette for null/unknown values. */
export function statusPillClasses(status: CapexLineStatus | null | undefined): string {
  switch (status) {
    case "approved":
      return "bg-gencom-greensoft border-gencom-green/20 text-gencom-green";
    case "in-progress":
      return "bg-blue-50 border-blue-200 text-blue-700";
    case "completed":
      return "bg-sky-50 border-sky-200 text-sky-700";
    case "pending":
      return "bg-amber-50 border-amber-200 text-amber-700";
    case "bidding":
      return "bg-violet-50 border-violet-200 text-violet-700";
    case "deferred":
      return "bg-stone-50 border-stone-200 text-stone-600";
    default:
      return "bg-white border-gencom-sand text-gencom-stone/70";
  }
}


export function statusLabel(status: CapexLineStatus | null | undefined): string {
  if (!status) return "—";
  if (status === "in-progress") return "In-Progress";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** True when the line has any monthly cashflow recorded; if so the cashflow
 *  matrix is the source of truth for spend rather than year_data.spend. */
export function lineHasCashflow(line: CapexLine): boolean {
  const cf = line.cashflow ?? {};
  for (const months of Object.values(cf)) {
    for (const v of Object.values(months ?? {})) {
      if (Number(v) !== 0) return true;
    }
  }
  return false;
}

export function lineYearSpend(line: CapexLine, year: number): number {
  const cf = line.cashflow?.[String(year)];
  if (cf) {
    let total = 0;
    for (const v of Object.values(cf)) total += Number(v) || 0;
    if (total !== 0) return total;
  }
  const yd = (line.year_data ?? {})[String(year)];
  return Number(yd?.spend ?? 0) || 0;
}

export function lineMonthSpend(line: CapexLine, year: number, month: number): number {
  const cf = line.cashflow?.[String(year)];
  if (!cf) return 0;
  return Number(cf[String(month)] ?? 0) || 0;
}

export function lineYearForecast(line: CapexLine, year: number): number {
  const yd = (line.year_data ?? {})[String(year)];
  return Number(yd?.forecast ?? 0) || 0;
}

/** Sum of every year's recorded spend on this line. Prefer the cashflow
 *  matrix when present; fall back to year_data.spend. */
export function lineSpendToDate(line: CapexLine): number {
  if (lineHasCashflow(line)) {
    let total = 0;
    for (const months of Object.values(line.cashflow ?? {})) {
      for (const v of Object.values(months ?? {})) total += Number(v) || 0;
    }
    return total;
  }
  let total = 0;
  for (const info of Object.values(line.year_data ?? {})) {
    total += Number(info?.spend ?? 0) || 0;
  }
  return total;
}

/** Forecast minus spend-to-date. */
export function lineBalance(line: CapexLine): number {
  return (line.forecast_total_budget ?? 0) - lineSpendToDate(line);
}

/** Projected = forecast for the line minus spend-to-date for the line.
 *  Per-year cell only — used in the year column "spend / projected" split. */
export function lineYearProjected(line: CapexLine): number {
  return Math.max(0, (line.forecast_total_budget ?? 0) - lineSpendToDate(line));
}


export type GroupBucket = {
  groupName: string; // null/empty rendered as "(ungrouped)"
  categories: CategoryBucket[];
  forecast: number;
  spendToDate: number;
  originalBudget: number;
};

export type CategoryBucket = {
  categoryName: string;
  lines: CapexLine[];
  forecast: number;
  spendToDate: number;
  originalBudget: number;
};


/** Group lines into a Group → Category → lines tree, with subtotals at every
 *  level. Ordering follows first-seen order in `lines`. */
export function groupLines(lines: CapexLine[]): GroupBucket[] {
  const groups = new Map<string, GroupBucket>();
  for (const line of lines) {
    const groupKey = (line.group ?? "").trim() || "(ungrouped)";
    const categoryKey = (line.category ?? "").trim() || "(uncategorized)";
    let g = groups.get(groupKey);
    if (!g) {
      g = { groupName: groupKey, categories: [], forecast: 0, spendToDate: 0, originalBudget: 0 };
      groups.set(groupKey, g);
    }
    let c = g.categories.find((x) => x.categoryName === categoryKey);
    if (!c) {
      c = { categoryName: categoryKey, lines: [], forecast: 0, spendToDate: 0, originalBudget: 0 };
      g.categories.push(c);
    }
    c.lines.push(line);
    const f = line.forecast_total_budget ?? 0;
    const o = line.original_total_budget ?? 0;
    const s = lineSpendToDate(line);
    c.forecast += f;
    c.spendToDate += s;
    c.originalBudget += o;
    g.forecast += f;
    g.spendToDate += s;
    g.originalBudget += o;
  }
  return Array.from(groups.values());
}


/** Numeric-aware comparator used by default for the Code column. */
export function codeCompare(a: string | null | undefined, b: string | null | undefined): number {
  const ax = (a ?? "").trim();
  const bx = (b ?? "").trim();
  return ax.localeCompare(bx, undefined, { numeric: true, sensitivity: "base" });
}
