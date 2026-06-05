"use client";

import { useMemo, useState } from "react";
import { format, addWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";

import type { DayHalf, FullTimer, Intern, ScheduleBlock } from "@/data";
import { departmentLabel, deptBgClass } from "@/data/vocabularies";
import { ISO, mondayOf, weekdaysOf } from "@/lib/dates";
import { useRole } from "@/lib/role";
import { canEdit, can } from "@/lib/visibility";
import { cn } from "@/lib/cn";

import { BlockEditor } from "./block-editor";

export function WeekView({
  intern, blocks, managers,
}: {
  intern: Intern;
  blocks: ScheduleBlock[];
  managers: FullTimer[];
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = useMemo(
    () => addWeeks(mondayOf(new Date()), weekOffset),
    [weekOffset],
  );
  const days = weekdaysOf(monday);
  const weekStart = ISO(days[0]!);
  const weekEnd = ISO(days[4]!);
  const weekBlocks = blocks.filter((b) => b.date >= weekStart && b.date <= weekEnd);
  const byKey = new Map<string, ScheduleBlock>();
  for (const b of weekBlocks) {
    if (b.status === "confirmed") byKey.set(`${b.date}#${b.half}`, b);
  }
  const proposedByKey = new Map<string, ScheduleBlock>();
  for (const b of weekBlocks) {
    if (b.status === "proposed") proposedByKey.set(`${b.date}#${b.half}`, b);
  }

  const { role } = useRole();
  const editable = canEdit(role, "scheduler");
  const canPropose = can(role, "scheduler", "request");

  const weekLabel = `${format(days[0]!, "MMM d")} – ${format(days[4]!, "MMM d, yyyy")}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-semibold tracking-tight">{weekLabel}</div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setWeekOffset((o) => o - 1)} aria-label="Previous week">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>
            This week
          </Button>
          <Button variant="outline" size="icon" onClick={() => setWeekOffset((o) => o + 1)} aria-label="Next week">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="rounded-lg card-border overflow-hidden bg-card">
        {/* Header row */}
        <div className="grid grid-cols-[64px_repeat(5,1fr)] bg-muted/40 text-[12px]">
          <div className="px-2 py-2 text-muted-foreground">Half</div>
          {days.map((d) => (
            <div key={d.toISOString()} className="px-3 py-2 border-l">
              <div className="font-semibold tracking-tight">{format(d, "EEEE")}</div>
              <div className="text-[11px] text-muted-foreground">{format(d, "MMM d")}</div>
            </div>
          ))}
        </div>
        {/* Body — AM and PM rows */}
        {(["AM", "PM"] as const).map((h) => (
          <div key={h} className="grid grid-cols-[64px_repeat(5,1fr)] border-t">
            <div className="px-2 py-3 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{h}</div>
            {days.map((d) => {
              const date = ISO(d);
              const key = `${date}#${h}`;
              const block = byKey.get(key);
              const proposed = proposedByKey.get(key);
              const ctx = { internId: intern.id, date, half: h as DayHalf, block };
              const cell = (
                <Cell
                  block={block}
                  proposed={proposed}
                  managers={managers}
                  showAddCue={editable && !block}
                />
              );
              const wrappedInteractive = (editable || (block && canPropose));
              return (
                <div
                  key={key}
                  className={cn(
                    "border-l p-1.5 min-h-[88px] transition-colors",
                    wrappedInteractive && "hover:bg-muted/30",
                  )}
                >
                  {wrappedInteractive ? (
                    <BlockEditor ctx={ctx} managers={managers}>
                      <button className="block w-full h-full text-left rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {cell}
                      </button>
                    </BlockEditor>
                  ) : cell}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <Legend />
    </div>
  );
}

function Cell({
  block, proposed, managers, showAddCue,
}: {
  block?: ScheduleBlock;
  proposed?: ScheduleBlock;
  managers: FullTimer[];
  showAddCue: boolean;
}) {
  if (!block) {
    return (
      <div className="h-full w-full grid place-items-center rounded-md text-muted-foreground/50 text-[11px]">
        {showAddCue ? <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" />Add</span> : "—"}
      </div>
    );
  }
  const mgr = managers.find((m) => m.id === block.managerId);
  return (
    <div className="h-full rounded-md card-border bg-card p-2 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-1.5">
        <span className={cn("h-2 w-2 rounded-full shrink-0", deptBgClass(block.department))} />
        <span className="text-[11.5px] uppercase tracking-wider text-muted-foreground truncate">
          {departmentLabel(block.department)}
        </span>
      </div>
      <div className="mt-1 text-[13px] font-medium leading-snug line-clamp-2">{block.projectName}</div>
      {mgr && (
        <div className="mt-1 text-[11px] text-muted-foreground truncate">{mgr.name}</div>
      )}
      {proposed && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="mt-1.5 inline-flex items-center gap-1 rounded text-[10px] px-1.5 py-0.5 bg-warning/15 text-[hsl(36_95%_30%)] font-medium">
              proposed swap
            </div>
          </TooltipTrigger>
          <TooltipContent>{proposed.notes ?? `Swap to ${proposed.projectName}`}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-[0.12em]">Departments</span>
      {(["engineering", "product", "design", "data", "operations", "marketing", "finance"] as const).map((d) => (
        <span key={d} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", deptBgClass(d))} />
          {departmentLabel(d)}
        </span>
      ))}
    </div>
  );
}
