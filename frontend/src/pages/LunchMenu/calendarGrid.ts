// Month-grid helpers — shared by Predict and History views so both
// render the same 7-column Sunday-to-Saturday calendar.

/** Parse "YYYY-MM" to { year, month } (month is 1-12).
 *  Falls back to the current month if the input is malformed. */
export function parseYearMonth(ym: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  return { year: Number(m[1]), month: Number(m[2]) };
}


export function formatYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}


/** Step a {year, month} by +/- N months, wrapping year boundaries. */
export function shiftMonth(
  year: number, month: number, delta: number,
): { year: number; month: number } {
  let idx = (year * 12 + (month - 1)) + delta;
  const newYear = Math.floor(idx / 12);
  const newMonth = (idx % 12 + 12) % 12;
  return { year: newYear, month: newMonth + 1 };
}


/** The calendar label for a month, e.g. "May 2026". */
export function monthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}


/**
 * Build a 6-row × 7-col matrix covering a calendar month, padded with
 * the trailing days of the previous month on the left and the leading
 * days of the next month on the right so every row has exactly 7 days.
 * Column 0 is Sunday.
 *
 * Each cell: { date, ymd, inMonth, isWeekend }
 */
export type CalendarCell = {
  date: Date;
  ymd: string;
  inMonth: boolean;
  isWeekend: boolean;
};

export function buildMonthGrid(year: number, month: number): CalendarCell[][] {
  const first = new Date(year, month - 1, 1);
  // Start from the Sunday on/before the 1st.
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());  // 0 = Sunday

  const weeks: CalendarCell[][] = [];
  const cur = new Date(start);
  for (let w = 0; w < 6; w++) {
    const row: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(cur);
      const ymd = toYmd(cellDate);
      row.push({
        date: cellDate,
        ymd,
        inMonth: cellDate.getMonth() === month - 1,
        isWeekend: cellDate.getDay() === 0 || cellDate.getDay() === 6,
      });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(row);
  }
  return weeks;
}


export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


export const WEEKDAY_HEADINGS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
