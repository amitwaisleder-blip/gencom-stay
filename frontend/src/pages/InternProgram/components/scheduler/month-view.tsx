"use client";

import { useMemo, useState } from "react";
import { addMonths, format, isSameMonth, isToday } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { Intern, ScheduleBlock } from "@/data";
import { departmentLabel, deptBgClass } from "@/data/vocabularies";
import { ISO, calendarMonthDays, isWeekday } from "@/lib/dates";
import { cn } from "@/lib/cn";

export function MonthView({
  intern, blocks,
}: { intern: Intern; blocks: ScheduleBlock[] }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const anchor = useMemo(() => addMonths(new Date(), monthOffset), [monthOffset]);
  const days = calendarMonthDays(anchor);

  const byDate = useMemo(() => {
    const m = new Map<string, ScheduleBlock[]>();
    for (const b of blocks) {
      if (b.status !== "confirmed") continue;
      const arr = m.get(b.date) ?? [];
      arr.push(b);
      m.set(b.date, arr);
    }
    return m;
  }, [blocks]);

  const monthLabel = format(anchor, "MMMM yyyy");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-semibold tracking-tight">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setMonthOffset((o) => o - 1)} aria-label="Previous month">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMonthOffset(0)} disabled={monthOffset === 0}>
            This month
          </Button>
          <Button variant="outline" size="icon" onClick={() => setMonthOffset((o) => o + 1)} aria-label="Next month">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="rounded-lg card-border overflow-hidden bg-card">
        <div className="grid grid-cols-7 bg-muted/40 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="px-2 py-1.5 border-l first:border-l-0">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const inMonth = isSameMonth(d, anchor);
            const weekday = isWeekday(d);
            const date = ISO(d);
            const dayBlocks = byDate.get(date) ?? [];
            return (
              <div
                key={i}
                className={cn(
                  "border-l border-t first:border-l-0 -mt-px first-of-row:-ml-px min-h-[96px] p-2 flex flex-col gap-1",
                  !inMonth && "bg-muted/20 text-muted-foreground/60",
                  !weekday && "opacity-70",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-[11px] tabular-nums",
                      isToday(d) && "inline-grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground font-semibold",
                    )}
                  >
                    {format(d, "d")}
                  </span>
                  {dayBlocks.length > 0 && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {dayBlocks.length}/2
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayBlocks.slice(0, 2).map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center gap-1.5 truncate text-[11px]"
                      title={`${departmentLabel(b.department)} — ${b.projectName} (${b.half})`}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", deptBgClass(b.department))} />
                      <span className="truncate">
                        <span className="text-muted-foreground tabular-nums">{b.half}</span>{" "}
                        <span className="font-medium">{b.projectName}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
