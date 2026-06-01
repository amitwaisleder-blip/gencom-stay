"use client";

import type { FullTimer, Intern, SkillEntry, SkillTag } from "@/data";
import { useRole } from "@/lib/role";
import { HelpfulHereCard } from "./helpful-here-card";
import { MentorCard } from "./mentor-card";

/** The intern looking at their own profile already sees their full
 *  skills card just above — duplicating "where can I help" for them is
 *  noise. Show it for the other three roles only.
 *  Mentor card stays visible to everyone (it's their dashboard too). */
export function ProfileSidebarRoleGate({
  intern, skills, tags, mentor, fullTimers,
}: {
  intern: Intern;
  skills: SkillEntry[];
  tags: SkillTag[];
  mentor: FullTimer | null;
  fullTimers: FullTimer[];
}) {
  const { role } = useRole();
  return (
    <>
      {role !== "intern" && (
        <HelpfulHereCard internName={intern.name} skills={skills} allTags={tags} />
      )}
      <MentorCard internId={intern.id} mentor={mentor} candidates={fullTimers} />
    </>
  );
}
