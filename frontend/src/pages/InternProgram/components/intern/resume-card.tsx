"use client";

import { useState } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { nanoid } from "nanoid";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/module/empty-state";
import type { Education, Experience, Intern, Project, Resume, ResumeLink } from "@/data";
import { useRole } from "@/lib/role";
import { canEdit } from "@/lib/visibility";
import { saveResumeAction } from "@/app/actions";

type SectionKey = "education" | "experience" | "projects" | "links";

export function ResumeCard({ intern }: { intern: Intern }) {
  const { role } = useRole();
  const editable = canEdit(role, "bio");          // bio + resume share an editor entitlement
  const [resume, setResume] = useState<Resume>(intern.resume);
  const [pending, startTransition] = useAsyncPending();
  const [editor, setEditor] = useState<{ section: SectionKey; index: number | null } | null>(null);

  function commit(next: Resume) {
    setResume(next);
    startTransition(async () => {
      await saveResumeAction(intern.id, next);
    });
  }

  function remove(section: SectionKey, id: string) {
    const next = { ...resume, [section]: (resume[section] as { id: string }[]).filter((x) => x.id !== id) } as Resume;
    commit(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Resume</span>
          {pending && <span className="text-[11px] text-muted-foreground font-normal">Saving…</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-7">
        <Section
          label="Education"
          editable={editable}
          isEmpty={resume.education.length === 0}
          onAdd={() => setEditor({ section: "education", index: null })}
          empty="Add a school, degree, and graduation year — this carries straight to the portfolio."
        >
          {resume.education.map((e, i) => (
            <Row
              key={e.id}
              editable={editable}
              onEdit={() => setEditor({ section: "education", index: i })}
              onDelete={() => remove("education", e.id)}
              title={`${e.school}`}
              meta={
                <span>
                  {e.degree}{e.field ? `, ${e.field}` : ""}
                  <span className="mx-1.5 text-border">·</span>
                  {e.startYear}–{e.endYear ?? "present"}
                  {e.gpa ? <><span className="mx-1.5 text-border">·</span>GPA {e.gpa}</> : null}
                </span>
              }
              note={e.honors}
            />
          ))}
        </Section>

        <Section
          label="Experience"
          editable={editable}
          isEmpty={resume.experience.length === 0}
          onAdd={() => setEditor({ section: "experience", index: null })}
          empty="Past roles, internships, TA gigs. Keep descriptions outcome-focused."
        >
          {resume.experience.map((x, i) => (
            <Row
              key={x.id}
              editable={editable}
              onEdit={() => setEditor({ section: "experience", index: i })}
              onDelete={() => remove("experience", x.id)}
              title={x.role}
              meta={
                <span>
                  {x.company}
                  <span className="mx-1.5 text-border">·</span>
                  {formatYM(x.startDate)} → {x.endDate ? formatYM(x.endDate) : "Present"}
                </span>
              }
              note={x.description}
            />
          ))}
        </Section>

        <Section
          label="Projects"
          editable={editable}
          isEmpty={resume.projects.length === 0}
          onAdd={() => setEditor({ section: "projects", index: null })}
          empty="Side projects and class projects you're proud of."
        >
          {resume.projects.map((p, i) => (
            <Row
              key={p.id}
              editable={editable}
              onEdit={() => setEditor({ section: "projects", index: i })}
              onDelete={() => remove("projects", p.id)}
              title={p.link ? <a href={p.link} target="_blank" rel="noreferrer" className="hover:underline">{p.name}</a> : p.name}
              meta={p.technologies.length ? (
                <div className="flex gap-1 flex-wrap">
                  {p.technologies.map((t) => <Badge key={t} variant="muted">{t}</Badge>)}
                </div>
              ) : null}
              note={p.description}
            />
          ))}
        </Section>

        <Section
          label="Links"
          editable={editable}
          isEmpty={resume.links.length === 0}
          onAdd={() => setEditor({ section: "links", index: null })}
          empty="GitHub, LinkedIn, portfolio."
        >
          <div className="flex flex-wrap gap-2">
            {resume.links.map((l, i) => (
              <div key={l.id} className="group relative">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md card-border bg-card px-2.5 py-1.5 text-[12.5px] hover:bg-muted transition-colors"
                >
                  <ExternalLink className="h-3 w-3 opacity-60" />
                  {l.label}
                </a>
                {editable && (
                  <div className="absolute -top-2 -right-2 hidden group-hover:flex gap-0.5">
                    <button
                      onClick={(e) => { e.preventDefault(); setEditor({ section: "links", index: i }); }}
                      className="grid h-5 w-5 place-items-center rounded-full bg-card card-border text-muted-foreground hover:text-foreground"
                      aria-label="Edit link"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); remove("links", l.id); }}
                      className="grid h-5 w-5 place-items-center rounded-full bg-card card-border text-muted-foreground hover:text-destructive"
                      aria-label="Delete link"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      </CardContent>

      {editor && (
        <ResumeEditorDialog
          editor={editor}
          resume={resume}
          onClose={() => setEditor(null)}
          onSave={(next) => { commit(next); setEditor(null); }}
        />
      )}
    </Card>
  );
}

function Section({
  label, editable, onAdd, empty, isEmpty, children,
}: {
  label: string;
  editable: boolean;
  onAdd: () => void;
  empty: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{label}</h3>
        {editable && (
          <Button variant="ghost" size="sm" onClick={onAdd} className="-mr-2 h-7">
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>
      {isEmpty ? (
        <EmptyState
          title={`No ${label.toLowerCase()} yet`}
          description={empty}
          className="py-6"
          action={editable ? <Button size="sm" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add {label.toLowerCase()}</Button> : null}
        />
      ) : (
        <div className="flex flex-col gap-3">{children}</div>
      )}
    </div>
  );
}

function Row({
  title, meta, note, editable, onEdit, onDelete,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  note?: React.ReactNode;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-start justify-between gap-3 rounded-md p-3 -mx-3 hover:bg-muted/40 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium text-foreground leading-snug">{title}</div>
        {meta && <div className="mt-1 text-[12.5px] text-muted-foreground">{meta}</div>}
        {note && <div className="mt-1.5 text-[13px] text-foreground/80 leading-relaxed">{note}</div>}
      </div>
      {editable && (
        <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete" className="hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      )}
    </div>
  );
}

function formatYM(s: string): string {
  // Accepts YYYY-MM
  try {
    const [y, m] = s.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return format(d, "MMM yyyy");
  } catch { return s; }
}

// ---------- Editor dialog ----------
function ResumeEditorDialog({
  editor, resume, onClose, onSave,
}: {
  editor: { section: SectionKey; index: number | null };
  resume: Resume;
  onClose: () => void;
  onSave: (next: Resume) => void;
}) {
  const open = !!editor;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editor.index === null ? "Add" : "Edit"} {LABEL_FOR[editor.section]}</DialogTitle>
          <DialogDescription>Structured fields keep your portfolio tidy.</DialogDescription>
        </DialogHeader>

        {editor.section === "education" && (
          <EducationForm
            initial={editor.index !== null ? resume.education[editor.index] : undefined}
            onCancel={onClose}
            onSave={(rec) => onSave(replaceOrAppend(resume, "education", rec, editor.index))}
          />
        )}
        {editor.section === "experience" && (
          <ExperienceForm
            initial={editor.index !== null ? resume.experience[editor.index] : undefined}
            onCancel={onClose}
            onSave={(rec) => onSave(replaceOrAppend(resume, "experience", rec, editor.index))}
          />
        )}
        {editor.section === "projects" && (
          <ProjectForm
            initial={editor.index !== null ? resume.projects[editor.index] : undefined}
            onCancel={onClose}
            onSave={(rec) => onSave(replaceOrAppend(resume, "projects", rec, editor.index))}
          />
        )}
        {editor.section === "links" && (
          <LinkForm
            initial={editor.index !== null ? resume.links[editor.index] : undefined}
            onCancel={onClose}
            onSave={(rec) => onSave(replaceOrAppend(resume, "links", rec, editor.index))}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const LABEL_FOR: Record<SectionKey, string> = {
  education: "education", experience: "experience", projects: "project", links: "link",
};

function replaceOrAppend<T extends { id: string }>(
  resume: Resume, section: SectionKey, rec: T, index: number | null,
): Resume {
  const arr = resume[section] as unknown as T[];
  const next = index === null ? [...arr, rec] : arr.map((x, i) => (i === index ? rec : x));
  return { ...resume, [section]: next };
}

function EducationForm({
  initial, onCancel, onSave,
}: { initial?: Education; onCancel: () => void; onSave: (e: Education) => void }) {
  const [school, setSchool] = useState(initial?.school ?? "");
  const [degree, setDegree] = useState(initial?.degree ?? "");
  const [field, setField] = useState(initial?.field ?? "");
  const [startYear, setStartYear] = useState(initial?.startYear ?? new Date().getFullYear() - 4);
  const [endYear, setEndYear] = useState<number | "">(initial?.endYear ?? new Date().getFullYear());
  const [gpa, setGpa] = useState(initial?.gpa ?? "");
  const [honors, setHonors] = useState(initial?.honors ?? "");
  return (
    <>
      <div className="grid gap-3">
        <Field label="School"><Input value={school} onChange={(e) => setSchool(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Degree"><Input value={degree} onChange={(e) => setDegree(e.target.value)} placeholder="B.S., M.S., …" /></Field>
          <Field label="Field"><Input value={field} onChange={(e) => setField(e.target.value)} placeholder="Computer Science" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start year">
            <Input type="number" value={startYear} onChange={(e) => setStartYear(Number(e.target.value))} />
          </Field>
          <Field label="End year (or empty if in progress)">
            <Input type="number" value={endYear} onChange={(e) => setEndYear(e.target.value ? Number(e.target.value) : "")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GPA (optional)"><Input value={gpa} onChange={(e) => setGpa(e.target.value)} /></Field>
          <Field label="Honors (optional)"><Input value={honors} onChange={(e) => setHonors(e.target.value)} placeholder="Dean's list, …" /></Field>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={!school.trim() || !degree.trim()}
          onClick={() => onSave({
            id: initial?.id ?? nanoid(8),
            school: school.trim(), degree: degree.trim(),
            field: field.trim() || undefined,
            startYear, endYear: endYear === "" ? undefined : endYear,
            gpa: gpa.trim() || undefined, honors: honors.trim() || undefined,
          })}
        >Save</Button>
      </DialogFooter>
    </>
  );
}

function ExperienceForm({
  initial, onCancel, onSave,
}: { initial?: Experience; onCancel: () => void; onSave: (e: Experience) => void }) {
  const [company, setCompany] = useState(initial?.company ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  return (
    <>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company"><Input value={company} onChange={(e) => setCompany(e.target.value)} /></Field>
          <Field label="Role"><Input value={role} onChange={(e) => setRole(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start (YYYY-MM)"><Input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="2025-05" /></Field>
          <Field label="End (YYYY-MM, blank for current)"><Input value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="2025-08" /></Field>
        </div>
        <Field label="Description">
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What you owned. What shipped. What you learned." />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={!company.trim() || !role.trim() || !startDate.trim()}
          onClick={() => onSave({
            id: initial?.id ?? nanoid(8),
            company: company.trim(), role: role.trim(),
            startDate: startDate.trim(), endDate: endDate.trim() || undefined,
            description: description.trim(),
          })}
        >Save</Button>
      </DialogFooter>
    </>
  );
}

function ProjectForm({
  initial, onCancel, onSave,
}: { initial?: Project; onCancel: () => void; onSave: (p: Project) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [techs, setTechs] = useState(initial?.technologies.join(", ") ?? "");
  return (
    <>
      <div className="grid gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Link (optional)"><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Technologies, comma-separated"><Input value={techs} onChange={(e) => setTechs(e.target.value)} placeholder="TypeScript, Next.js, D3" /></Field>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={!name.trim()}
          onClick={() => onSave({
            id: initial?.id ?? nanoid(8),
            name: name.trim(),
            description: description.trim(),
            link: link.trim() || undefined,
            technologies: techs.split(",").map((s) => s.trim()).filter(Boolean),
          })}
        >Save</Button>
      </DialogFooter>
    </>
  );
}

function LinkForm({
  initial, onCancel, onSave,
}: { initial?: ResumeLink; onCancel: () => void; onSave: (l: ResumeLink) => void }) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  return (
    <>
      <div className="grid gap-3">
        <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="GitHub, LinkedIn, …" /></Field>
        <Field label="URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={!label.trim() || !url.trim()}
          onClick={() => onSave({ id: initial?.id ?? nanoid(8), label: label.trim(), url: url.trim() })}
        >Save</Button>
      </DialogFooter>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
