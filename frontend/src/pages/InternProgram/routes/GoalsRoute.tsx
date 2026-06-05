import { useParams } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { LearningGoalsList } from "@/components/intern/learning-goals-list";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function GoalsRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const { data, loading } = useStoreData(() => getStore().listLearningGoals(id));
  if (loading || !data) return <Skeleton className="h-[300px] w-full" />;
  return <LearningGoalsList internId={id} initial={data} />;
}
