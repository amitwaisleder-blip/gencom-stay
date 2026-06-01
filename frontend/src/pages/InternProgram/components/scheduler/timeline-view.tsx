"use client";

import { useMemo } from "react";
import { format, isWithinInterval } from "date-fns";

import { Card, CardContent } from "@/components/ui/card";

import type { Department, Intern, ScheduleBlock } from "@/data";
import {
  DEPARTMENTS, departmentLabel, deptBgClass,
} from "@/data/vocabularies";
import {
  ISO, addDays, addWeeks, fromISO, mondayOf, programWeekCount,
} from "@/lib/dates";
import { cn } from "@/lib/cn";

import { DepartmentMixBar } from "./department-mix-bar";

/** Full-program horizontal strip — one column per program week, two
 *  rows (AM/PM). Each cell tints the department colour. Below the
 *  strip, two department-mix bars: "to date" and "planned overall". */
export function TimelineView({
  intern, blocks,
}: { intern: Intern; blocks: ScheduleBlock[] }) {
  const startMon = mondayOf(fromISO(intern.programStart));
  const total = programWeekCount(intern);
  const weeks = useMemo(
    () => Array.from({ length: total }, (_, i) => addWeeks(startMon, i)),
    [startMon, total],
  );

  // Index blocks by (week-index, weekday-index, half).
  type Idx = { w: number; d: number; half: "AM" | "PM" };
  const cellMap = new Map<string, ScheduleBlock>();
  const inProgram = (d: Date) => isWithinInterval(d, {
    start: fromISO(intern.programStart), end: fromISO(intern.programEnd),
  });
  for (const b of blocks) {
    if (b.status !== "confirmed") continue;
    const d = fromISO(b.date);
    if (!inProgram(d)) continue;
    const wkMonday = mondayOf(d);
    const w = Math.round((wkMonday.getTime() - startMon.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const dayIdx = ((d.getDay() + 6) % 7);  // 0..4 Mon..Fri
    cellMap.set(keyOf({ w, d: dayIdx, half: b.half }), b);
  }
  const keyOfFn = keyOf;

  // Today marker — vertical line if today falls within the program.
  const today = new Date();
  const todayMon = mondayOf(today);
  const todayWeekIdx = Math.round((todayMon.getTime() - startMon.getTime()) / (7 * 24 * 60 * 60 * 1000));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-[15px] font-semibold tracking-tight">
              Full internship — {total} weeks
            </h3>
            <div className="text-[11px] text-muted-foreground">
              {format(startMon, "MMM d, yyyy")} → {format(addDays(addWeeks(startMon, total - 1), 4), "MMM d, yyyy")}
            </div>
          </div>

          <div className="overflow-x-auto -mx-2 px-2 pb-2">
            <div className="relative inline-grid min-w-full" style={{ gridTemplateColumns: `60px repeat(${total}, minmax(56px, 1fr))` }}>
              {/* Header row */}
              <div />
              {weeks.map((m, i) => (
                <div key={i} className={cn(
                  "px-1.5 py-1.5 text-center text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground border-l first:border-l-0",
                  i === todayWeekIdx && "text-primary font-semibold",
                )}>
                  W{i + 1}
                  <div className="text-[9.5px] normal-case tracking-normal">{format(m, "MMM d")}</div>
                </div>
              ))}

              {/* Two rows per program: AM and PM */}
              {(["AM", "PM"] as const).map((half) => (
                <div key={half} className="contents">
                  {/* Row label */}
                  <div className="px-2 py-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground border-t flex items-center">
                    {half}
                  </div>
                  {/* Week × 5 weekday columns flattened — render 5 thin sub-cells per week */}
                  {weeks.map((_m, w) => (
                    <div
                      key={`${half}-${w}`}
                      className={cn(
                        "border-t border-l first:border-l-0 p-0.5 grid grid-cols-5 gap-px",
                        w === todayWeekIdx && "bg-primary/[0.04]",
                      )}
                    >
                      {[0, 1, 2, 3, 4].map((d) => {
                        const b = cellMap.get(keyOfFn({ w, d, half }));
                        return (
                          <div
                            key={d}
                            className={cn(
                              "h-3.5 rounded-sm",
                              b ? deptBgClass(b.department) : "bg-muted/40",
                            )}
                            title={b ? `Week ${w + 1} ${["Mon","Tue","Wed","Thu","Fri"][d]} ${half} — ${departmentLabel(b.department)}: ${b.projectName}` : ""}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardContent className="pt-6">
          <DepartmentMixBar blocks={blocks} label="Department mix — so far" mode="to-date" />
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <DepartmentMixBar blocks={blocks} label="Department mix — full program" mode="all" />
        </CardContent></Card>
      </div>
    </div>
  );
}

function keyOf({ w, d, half }: { w: number; d: number; half: "AM" | "PM" }): string {
  return `${w}|${d}|${half}`;
}
