import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { ManagerFeedbackList } from "@/components/intern/manager-feedback-list";
import { FeatureRoleGate } from "@/components/intern/role-gate";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function FeedbackRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const loader = useMemo(() => async () => {
    const store = getStore();
    const [intern, feedback, fullTimers] = await Promise.all([
      store.getIntern(id),
      store.listManagerFeedback(id),
      store.listFullTimers(),
    ]);
    return { intern, feedback, fullTimers };
  }, [id]);
  const { data, loading } = useStoreData(loader);
  if (loading || !data?.intern) return <Skeleton className="h-[300px] w-full" />;
  const { intern, feedback, fullTimers } = data;
  const managers = fullTimers.filter((f) => f.isManager);
  return (
    <FeatureRoleGate feature="managerFeedback">
      <ManagerFeedbackList
        internId={intern.id}
        internName={intern.name}
        initial={feedback}
        managers={managers}
      />
    </FeatureRoleGate>
  );
}
