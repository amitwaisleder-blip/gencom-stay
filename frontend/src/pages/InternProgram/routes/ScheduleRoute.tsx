import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { WeekView } from "@/components/scheduler/week-view";
import { MonthView } from "@/components/scheduler/month-view";
import { TimelineView } from "@/components/scheduler/timeline-view";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function ScheduleRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const loader = useMemo(() => async () => {
    const store = getStore();
    const [intern, blocks, fullTimers] = await Promise.all([
      store.getIntern(id),
      store.listScheduleBlocks(id),
      store.listFullTimers(),
    ]);
    return { intern, blocks, fullTimers };
  }, [id]);
  const { data, loading } = useStoreData(loader);

  if (loading || !data?.intern) return <Skeleton className="h-[400px] w-full" />;
  const { intern, blocks, fullTimers } = data;
  const managers = fullTimers.filter((f) => f.isManager);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold tracking-tight">Schedule</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Half-day allocations across departments. Click a cell to add, edit, or propose a swap.
        </p>
      </div>
      <Tabs defaultValue="week">
        <TabsList>
          <TabsTrigger value="week">This week</TabsTrigger>
          <TabsTrigger value="month">This month</TabsTrigger>
          <TabsTrigger value="timeline">Full internship</TabsTrigger>
        </TabsList>
        <TabsContent value="week">
          <WeekView intern={intern} blocks={blocks} managers={managers} />
        </TabsContent>
        <TabsContent value="month">
          <MonthView intern={intern} blocks={blocks} />
        </TabsContent>
        <TabsContent value="timeline">
          <TimelineView intern={intern} blocks={blocks} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
