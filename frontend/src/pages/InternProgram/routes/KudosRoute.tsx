import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { KudosList } from "@/components/intern/kudos-list";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function KudosRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const loader = useMemo(() => async () => {
    const store = getStore();
    const [intern, kudos] = await Promise.all([
      store.getIntern(id),
      store.listKudos(id),
    ]);
    return { intern, kudos };
  }, [id]);
  const { data, loading } = useStoreData(loader);
  if (loading || !data?.intern) return <Skeleton className="h-[300px] w-full" />;
  return <KudosList internId={data.intern.id} internName={data.intern.name} initial={data.kudos} />;
}
