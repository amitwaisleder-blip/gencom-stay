import { useMemo } from "react";
import { useParams } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";
import { Portfolio } from "@/components/intern/portfolio";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function PortfolioRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const loader = useMemo(() => async () => {
    const store = getStore();
    const [intern, skills, tags, deliverables, kudos, feedback, goals, fullTimers] = await Promise.all([
      store.getIntern(id),
      store.getInternSkills(id),
      store.listSkillTags(),
      store.listDeliverables(id),
      store.listKudos(id),
      store.listManagerFeedback(id),
      store.listLearningGoals(id),
      store.listFullTimers(),
    ]);
    return { intern, skills, tags, deliverables, kudos, feedback, goals, fullTimers };
  }, [id]);
  const { data, loading } = useStoreData(loader);
  if (loading || !data?.intern) return <Skeleton className="h-[600px] w-full" />;
  const mentor = data.intern.mentorId ? data.fullTimers.find((f) => f.id === data.intern!.mentorId) ?? null : null;
  return (
    <Portfolio
      intern={data.intern}
      skills={data.skills}
      tags={data.tags}
      deliverables={data.deliverables}
      kudos={data.kudos}
      feedback={data.feedback}
      goals={data.goals}
      mentor={mentor}
    />
  );
}
