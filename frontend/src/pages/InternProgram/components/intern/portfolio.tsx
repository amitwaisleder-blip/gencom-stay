"use client";

import { format, parseISO } from "date-fns";
import {
  Award, BookOpenCheck, Briefcase, Download, ExternalLink, GraduationCap, Heart,
  Mail, Sparkles, Star, Target,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { initialsOf } from "@/lib/initials";
import { ProficiencyDots } from "./proficiency-dots";
import { departmentLabel, deptBgClass, PROFICIENCY_LABEL, SKILL_GROUPS } from "@/data/vocabularies";
import { useRole } from "@/lib/role";
import { can } from "@/lib/visibility";
import { cn } from "@/lib/cn";

import type {
  Deliverable, FullTimer, Intern, Kudos, LearningGoal, ManagerFeedback, SkillEntry, SkillTag,
} from "@/data";

export function Portfolio({
  intern, skills, tags, deliverables, kudos, feedback, goals, mentor,
}: {
  intern: Intern;
  skills: SkillEntry[];
  tags: SkillTag[];
  deliverables: Deliverable[];
  kudos: Kudos[];
  feedback: ManagerFeedback[];
  goals: LearningGoal[];
  mentor: FullTimer | null;
}) {
  const { role } = useRole();
  const canExport = can(role, "portfolio", "export");
  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const currentSkills = skills.filter((s) => s.category === "current" && tagsById.get(s.skillTagId)?.approved);
  const highlights = feedback.filter((f) => f.rating >= 4).sort((a, b) => b.rating - a.rating);
  const achievedGoals = goals.filter((g) => g.status === "achieved");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap print:hidden">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight inline-flex items-center gap-2">
            <Award className="h-3.5 w-3.5 text-primary" />
            Portfolio
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground max-w-xl">
            Auto-compiled from bio, resume, skills, deliverables, kudos, and manager highlights.
            Export uses your browser's print → save as PDF.
          </p>
        </div>
        {canExport && (
          <Button onClick={() => window.print()} size="sm">
            <Download className="h-3.5 w-3.5" />
            Export to PDF
          </Button>
        )}
      </div>

      <article id="portfolio" className="rounded-lg card-border bg-card p-8 md:p-10 print:rounded-none print:border-0 print:p-0 print:bg-transparent">
        {/* Header */}
        <header className="flex items-start gap-5 pb-6 border-b">
          <Avatar className="h-20 w-20 ring-1 ring-border print:ring-0">
            <AvatarImage src={intern.photoUrl} alt="" />
            <AvatarFallback className="text-lg">{initialsOf(intern.name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h1 className="text-[28px] font-semibold tracking-tight leading-tight">{intern.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5" />{intern.school}</span>
              <span className="opacity-30">·</span>
              <span>
                {format(parseISO(intern.programStart), "MMM yyyy")} – {format(parseISO(intern.programEnd), "MMM yyyy")} internship
              </span>
              {mentor && (
                <>
                  <span className="opacity-30">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    Mentored by {mentor.name}
                  </span>
                </>
              )}
            </div>
          </div>
        </header>

        {/* About */}
        <Section icon={BookOpenCheck} title="About">
          <p className="text-[14px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
            {intern.bio}
          </p>
        </Section>

        {/* Resume — education + experience + projects */}
        {intern.resume.education.length > 0 && (
          <Section icon={GraduationCap} title="Education">
            <ul className="flex flex-col gap-2.5">
              {intern.resume.education.map((e) => (
                <li key={e.id} className="text-[13.5px]">
                  <div className="font-medium">{e.school}</div>
                  <div className="text-muted-foreground">
                    {e.degree}{e.field ? `, ${e.field}` : ""}
                    <span className="mx-1.5 text-border">·</span>
                    {e.startYear}–{e.endYear ?? "present"}
                    {e.gpa && <><span className="mx-1.5 text-border">·</span>GPA {e.gpa}</>}
                  </div>
                  {e.honors && <div className="text-[12.5px] text-muted-foreground italic">{e.honors}</div>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {intern.resume.experience.length > 0 && (
          <Section icon={Briefcase} title="Experience">
            <ul className="flex flex-col gap-3">
              {intern.resume.experience.map((x) => (
                <li key={x.id} className="text-[13.5px]">
                  <div className="font-medium">{x.role}</div>
                  <div className="text-muted-foreground text-[12.5px]">
                    {x.company} · {fmtYM(x.startDate)} → {x.endDate ? fmtYM(x.endDate) : "Present"}
                  </div>
                  {x.description && <p className="mt-1 leading-relaxed text-foreground/85">{x.description}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Skills */}
        {currentSkills.length > 0 && (
          <Section icon={Sparkles} title="Skills">
            <div className="flex flex-col gap-3">
              {SKILL_GROUPS.filter((g) => currentSkills.some((s) => tagsById.get(s.skillTagId)?.group === g.key)).map((g) => (
                <div key={g.key} className="flex flex-col gap-1.5">
                  <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{g.label}</div>
                  <ul className="flex flex-wrap gap-1.5">
                    {currentSkills
                      .filter((s) => tagsById.get(s.skillTagId)?.group === g.key)
                      .map((s) => {
                        const t = tagsById.get(s.skillTagId)!;
                        return (
                          <li
                            key={s.id}
                            className="inline-flex items-center gap-1.5 rounded-md card-border bg-card px-2 py-1 text-[12.5px]"
                            title={PROFICIENCY_LABEL[s.proficiency]}
                          >
                            <span className="font-medium">{t.label}</span>
                            <ProficiencyDots value={s.proficiency} />
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Deliverables */}
        {deliverables.length > 0 && (
          <Section icon={Briefcase} title="What shipped">
            <ul className="flex flex-col gap-3">
              {deliverables.map((d) => (
                <li key={d.id} className="text-[13.5px]">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-medium">{d.title}</span>
                    {d.department && (
                      <Badge variant="outline" className="gap-1.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full", deptBgClass(d.department))} />
                        {departmentLabel(d.department)}
                      </Badge>
                    )}
                    {d.link && (
                      <a href={d.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[12px] text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" /> link
                      </a>
                    )}
                  </div>
                  <p className="mt-0.5 leading-relaxed text-foreground/85">{d.description}</p>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground tabular-nums">
                    Week of {format(parseISO(d.weekOf), "MMM d, yyyy")}
                    {d.projectName && <> · {d.projectName}</>}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Achieved goals */}
        {achievedGoals.length > 0 && (
          <Section icon={Target} title="Goals achieved">
            <ul className="flex flex-col gap-2">
              {achievedGoals.map((g) => (
                <li key={g.id} className="text-[13.5px]">
                  <div className="font-medium">{g.title}</div>
                  {g.description && <p className="text-muted-foreground leading-relaxed text-[12.5px]">{g.description}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Manager highlights — only ratings >= 4 */}
        {highlights.length > 0 && (
          <Section icon={Star} title="Manager highlights">
            <ul className="flex flex-col gap-3">
              {highlights.map((h) => (
                <li key={h.id} className="text-[13.5px]">
                  <p className="leading-relaxed text-foreground/90 italic">"{h.note}"</p>
                  <div className="mt-1 text-[11.5px] text-muted-foreground">
                    Week of {format(parseISO(h.weekOf), "MMM d, yyyy")} · {h.rating}/5
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Kudos */}
        {kudos.length > 0 && (
          <Section icon={Heart} title="Kudos">
            <ul className="flex flex-col gap-3">
              {kudos.map((k) => (
                <li key={k.id} className="text-[13.5px]">
                  <p className="leading-relaxed text-foreground/90 italic">"{k.message}"</p>
                  <div className="mt-1 text-[11.5px] text-muted-foreground">
                    — {k.fromName}, {k.fromRole}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Links */}
        {intern.resume.links.length > 0 && (
          <Section icon={Mail} title="Links">
            <ul className="flex flex-wrap gap-3 text-[13px]">
              {intern.resume.links.map((l) => (
                <li key={l.id}>
                  <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </article>
    </div>
  );
}

function Section({
  icon: Icon, title, children,
}: { icon: typeof Award; title: string; children: React.ReactNode }) {
  return (
    <section className="py-6 border-b last:border-b-0 last:pb-0">
      <h2 className="flex items-center gap-2 text-[12px] uppercase tracking-[0.14em] font-semibold text-muted-foreground mb-3">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function fmtYM(s: string): string {
  try {
    const [y, m] = s.split("-").map(Number);
    return format(new Date(y!, m! - 1, 1), "MMM yyyy");
  } catch { return s; }
}
