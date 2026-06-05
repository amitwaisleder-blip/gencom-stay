"use client";

import { useMemo, useState } from "react";
import { HelpCircle, Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import type { SkillEntry, SkillGroup, SkillTag, Proficiency } from "@/data";
import { PROFICIENCY_DOTS, PROFICIENCY_LABEL, SKILL_GROUPS, skillGroupLabel } from "@/data/vocabularies";
import { ProficiencyDots } from "./proficiency-dots";

const MIN_OPTIONS: { value: Proficiency; label: string }[] = [
  { value: "beginner", label: "All proficiencies" },
  { value: "working",  label: "Working & up" },
  { value: "strong",   label: "Strong only" },
];

/** Shown to managers/HR/exec on the intern profile. The whole point is
 *  "where can this person actually help today?" — so it's filterable
 *  by skill group + minimum proficiency, with strong skills surfaced
 *  first. Pending tags are hidden by default since they aren't real
 *  capabilities yet. */
export function HelpfulHereCard({
  internName, skills, allTags,
}: {
  internName: string;
  skills: SkillEntry[];
  allTags: SkillTag[];
}) {
  const [groupFilter, setGroupFilter] = useState<SkillGroup | "all">("all");
  const [minProf, setMinProf] = useState<Proficiency>("working");
  const tagsById = useMemo(() => new Map(allTags.map((t) => [t.id, t])), [allTags]);

  const minLevel = PROFICIENCY_DOTS[minProf];
  const ranked = skills
    .filter((s) => s.category === "current")
    .map((s) => ({ s, tag: tagsById.get(s.skillTagId) }))
    .filter((x) => x.tag && x.tag.approved)
    .filter((x) => PROFICIENCY_DOTS[x.s.proficiency] >= minLevel)
    .filter((x) => groupFilter === "all" ? true : x.tag!.group === groupFilter)
    .sort((a, b) => PROFICIENCY_DOTS[b.s.proficiency] - PROFICIENCY_DOTS[a.s.proficiency]);

  const firstName = internName.split(" ")[0] ?? internName;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Where can {firstName} help?
        </CardTitle>
        <CardDescription>Filter by area and proficiency to see what to staff.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Select value={groupFilter} onValueChange={(v) => setGroupFilter(v as SkillGroup | "all")}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {SKILL_GROUPS.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={minProf} onValueChange={(v) => setMinProf(v as Proficiency)}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MIN_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {ranked.length === 0 ? (
          <div className="rounded-md card-border bg-card/50 p-4 text-center">
            <HelpCircle className="mx-auto h-4 w-4 text-muted-foreground" />
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              Nothing matches at this proficiency. Try lowering the threshold.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {ranked.map(({ s, tag }) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40 transition-colors">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate">{tag!.label}</div>
                  <div className="text-[11px] text-muted-foreground">{skillGroupLabel(tag!.group)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">{PROFICIENCY_LABEL[s.proficiency]}</span>
                  <ProficiencyDots value={s.proficiency} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {skills.some((s) => s.category === "developing") && (
          <div className="mt-1 pt-3 border-t">
            <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-1.5">
              Wants to develop
            </div>
            <div className="flex flex-wrap gap-1">
              {skills.filter((s) => s.category === "developing").map((s) => {
                const tag = tagsById.get(s.skillTagId);
                if (!tag) return null;
                return <Badge key={s.id} variant="muted">{tag.label}</Badge>;
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
