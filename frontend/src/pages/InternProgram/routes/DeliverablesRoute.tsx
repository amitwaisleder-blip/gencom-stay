import { useParams } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { DeliverablesList } from "@/components/intern/deliverables-list";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function DeliverablesRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const { data, loading } = useStoreData(() => getStore().listDeliverables(id));
  if (loading || !data) return <Skeleton className="h-[300px] w-full" />;
  return <DeliverablesList internId={id} initial={data} />;
}
