import { Link } from "react-router-dom";
import { ArrowRight, Calendar } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import type { Department, Intern, ScheduleBlock } from "@/data";
import { departmentLabel, deptBgClass } from "@/data/vocabularies";
import { fromISO, mondayOf, weekdaysOf } from "@/lib/dates";
import { format } from "date-fns";

export function ScheduleSnapshot({
  intern, blocks,
}: { intern: Intern; blocks: ScheduleBlock[] }) {
  const monday = mondayOf(new Date());
  const days = weekdaysOf(monday);
  const byKey = new Map<string, ScheduleBlock>();
  for (const b of blocks) {
    if (b.status !== "confirmed") continue;
    byKey.set(`${b.date}#${b.half}`, b);
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-primary" />
          This week
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/intern-program/${intern.id}/schedule`}>
            Full schedule
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-md card-border overflow-hidden">
          <div className="grid grid-cols-[60px_repeat(5,1fr)] text-[11px] bg-muted/50">
            <div className="px-2 py-1.5 text-muted-foreground">Half</div>
            {days.map((d) => (
              <div key={d.toISOString()} className="px-2 py-1.5 text-muted-foreground border-l">
                <div className="font-medium">{format(d, "EEE")}</div>
                <div className="text-[10px]">{format(d, "MMM d")}</div>
              </div>
            ))}
          </div>
          {(["AM", "PM"] as const).map((h) => (
            <div key={h} className="grid grid-cols-[60px_repeat(5,1fr)] border-t">
              <div className="px-2 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">{h}</div>
              {days.map((d) => {
                const key = `${format(d, "yyyy-MM-dd")}#${h}`;
                const b = byKey.get(key);
                return (
                  <div key={key} className="border-l px-1.5 py-1.5 min-h-[44px]">
                    {b && <BlockChip dept={b.department} project={b.projectName} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BlockChip({ dept, project }: { dept: Department; project: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0" title={`${departmentLabel(dept)} — ${project}`}>
      <span className={`block h-2 w-2 shrink-0 rounded-full ${deptBgClass(dept)}`} />
      <span className="truncate text-[11.5px] font-medium">{project}</span>
    </div>
  );
}
