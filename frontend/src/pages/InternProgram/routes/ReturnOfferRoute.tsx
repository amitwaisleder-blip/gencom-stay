import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { ReturnOfferList } from "@/components/intern/return-offer-list";
import { FeatureRoleGate } from "@/components/intern/role-gate";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function ReturnOfferRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const loader = useMemo(() => async () => {
    const store = getStore();
    const [intern, offers, fullTimers] = await Promise.all([
      store.getIntern(id),
      store.listReturnOffers(id),
      store.listFullTimers(),
    ]);
    return { intern, offers, fullTimers };
  }, [id]);
  const { data, loading } = useStoreData(loader);
  if (loading || !data?.intern) return <Skeleton className="h-[300px] w-full" />;
  const managers = data.fullTimers.filter((f) => f.isManager);
  return (
    <FeatureRoleGate feature="returnOfferTracker">
      <ReturnOfferList
        internId={data.intern.id}
        internName={data.intern.name}
        initial={data.offers}
        managers={managers}
      />
    </FeatureRoleGate>
  );
}
