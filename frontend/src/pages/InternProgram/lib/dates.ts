// Date helpers. We use ISO YYYY-MM-DD strings as the canonical
// schedule-day representation everywhere — converting to Date only at
// render time. Avoids timezone weirdness (the schedule says "April 27,
// AM" regardless of where the viewer is sitting).

import {
  addDays, addWeeks, differenceInCalendarDays, eachDayOfInterval, endOfMonth,
  endOfWeek, format, isWithinInterval, parseISO, startOfMonth, startOfWeek,
} from "date-fns";

export const ISO = (d: Date): string => format(d, "yyyy-MM-dd");
export const fromISO = (s: string): Date => parseISO(s);

export const weekdayShort = (d: Date): string => format(d, "EEE");
export const weekdayLong  = (d: Date): string => format(d, "EEEE");
export const monthDayLong = (d: Date): string => format(d, "MMM d");

export function mondayOf(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 });
}
export function fridayOf(d: Date): Date {
  // Mon..Fri, so Friday = endOfWeek - 2 days when locale starts on Monday.
  const e = endOfWeek(d, { weekStartsOn: 1 });
  return addDays(e, -2);
}

export function weekdaysOf(monday: Date): Date[] {
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

/** Mon-only days in a [from, to] inclusive interval, used for the
 *  full-timeline view. We want one tick per program week. */
export function weekStartsBetween(fromISOStr: string, toISOStr: string): Date[] {
  const start = mondayOf(fromISO(fromISOStr));
  const end = fromISO(toISOStr);
  const out: Date[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addWeeks(cur, 1);
  }
  return out;
}

/** Inclusive day list (mon..fri only) covering a calendar month grid.
 *  Used by the month view; weekend cells are rendered greyed out. */
export function calendarMonthDays(d: Date): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(d), { weekStartsOn: 1 }),
    end:   endOfWeek(endOfMonth(d),     { weekStartsOn: 1 }),
  });
}

export function isWeekday(d: Date): boolean {
  const w = d.getDay();
  return w >= 1 && w <= 5;
}

export function inProgram(d: Date, intern: { programStart: string; programEnd: string }): boolean {
  return isWithinInterval(d, {
    start: fromISO(intern.programStart),
    end:   fromISO(intern.programEnd),
  });
}

export function programWeekIndex(d: Date, intern: { programStart: string }): number {
  // 1-indexed program week; week 1 contains programStart's Monday.
  const startMon = mondayOf(fromISO(intern.programStart));
  return Math.floor(differenceInCalendarDays(d, startMon) / 7) + 1;
}

export function programWeekCount(intern: { programStart: string; programEnd: string }): number {
  const startMon = mondayOf(fromISO(intern.programStart));
  const endMon = mondayOf(fromISO(intern.programEnd));
  return Math.floor(differenceInCalendarDays(endMon, startMon) / 7) + 1;
}

export { addDays, addWeeks, format };
