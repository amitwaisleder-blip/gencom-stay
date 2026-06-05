// Cash Flow Returns — number formatters. These match the Hamilton PDF's
// display conventions (EUR 000s, 1-decimal percentages, etc.) so the
// on-screen numbers read the same as the reference document.

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString("en-US");
}

/** Formats negative values with parentheses Excel-style. */
export function fmtMoneyParen(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const rounded = Math.round(n);
  if (rounded < 0) return `(${Math.abs(rounded).toLocaleString("en-US")})`;
  if (rounded === 0) return "-";
  return rounded.toLocaleString("en-US");
}

export function fmtDecimal(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return (n * 100).toFixed(digits) + "%";
}

/** Basis-point change — rendered e.g. "944 bps". */
export function fmtBps(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return `${Math.round(n).toLocaleString("en-US")} bps`;
}

/** Multiplier — "1.6x", "2.1x". */
export function fmtMultiplier(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return `${n.toFixed(digits)}x`;
}

/** Per-key EUR 000s — "1,250" or "1,083k" depending on context. */
export function fmtPerKey(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
