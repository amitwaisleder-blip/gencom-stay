import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { ShadowDaysList } from "@/components/intern/shadow-days-list";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function ShadowDaysRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const loader = useMemo(() => async () => {
    const store = getStore();
    const [requests, fullTimers] = await Promise.all([
      store.listShadowDayRequests(id),
      store.listFullTimers(),
    ]);
    return { requests, fullTimers };
  }, [id]);
  const { data, loading } = useStoreData(loader);
  if (loading || !data) return <Skeleton className="h-[300px] w-full" />;
  return <ShadowDaysList internId={id} initial={data.requests} fullTimers={data.fullTimers} />;
}
