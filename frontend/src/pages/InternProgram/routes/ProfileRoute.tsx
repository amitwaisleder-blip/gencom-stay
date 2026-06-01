import { useParams } from "react-router-dom";
import { useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { BioCard } from "@/components/intern/bio-card";
import { ResumeCard } from "@/components/intern/resume-card";
import { SkillsCard } from "@/components/intern/skills-card";
import { ScheduleSnapshot } from "@/components/intern/schedule-snapshot";
import { ProfileSidebarRoleGate } from "@/components/intern/profile-sidebar-gate";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

export default function ProfileRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const loader = useMemo(() => async () => {
    const store = getStore();
    const [intern, skills, tags, blocks, fullTimers] = await Promise.all([
      store.getIntern(id),
      store.getInternSkills(id),
      store.listSkillTags(),
      store.listScheduleBlocks(id),
      store.listFullTimers(),
    ]);
    return { intern, skills, tags, blocks, fullTimers };
  }, [id]);
  const { data, loading } = useStoreData(loader);

  if (loading || !data?.intern) {
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg card-border bg-card p-6">
              <Skeleton className="h-4 w-24" />
              <div className="mt-4 flex flex-col gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-[80%]" />
              </div>
            </div>
          ))}
        </div>
        <aside className="flex flex-col gap-6">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg card-border bg-card p-6">
              <Skeleton className="h-4 w-32" />
              <div className="mt-4">
                <Skeleton className="h-3 w-[70%]" />
              </div>
            </div>
          ))}
        </aside>
      </div>
    );
  }
  const { intern, skills, tags, blocks, fullTimers } = data;
  const mentor = intern.mentorId ? fullTimers.find((f) => f.id === intern.mentorId) ?? null : null;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 flex flex-col gap-6">
        <BioCard bio={intern.bio} />
        <ResumeCard intern={intern} />
        <SkillsCard internId={intern.id} initialSkills={skills} allTags={tags} />
      </div>
      <aside className="flex flex-col gap-6">
        <ScheduleSnapshot intern={intern} blocks={blocks} />
        <ProfileSidebarRoleGate
          intern={intern}
          skills={skills}
          tags={tags}
          mentor={mentor}
          fullTimers={fullTimers}
        />
      </aside>
    </div>
  );
}
