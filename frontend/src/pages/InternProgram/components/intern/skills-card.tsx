"use client";

import { useMemo, useState } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { Pencil, Plus, Sparkles } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/module/empty-state";

import type { Proficiency, SkillEntry, SkillGroup, SkillTag } from "@/data";
import {
  PROFICIENCY_LABEL, SKILL_GROUPS, skillGroupLabel,
} from "@/data/vocabularies";
import { ProficiencyDots } from "./proficiency-dots";
import { useRole } from "@/lib/role";
import { canEdit } from "@/lib/visibility";
import { saveSkillsAction, requestNewSkillTagAction } from "@/app/actions";

export function SkillsCard({
  internId, initialSkills, allTags,
}: {
  internId: string;
  initialSkills: SkillEntry[];
  allTags: SkillTag[];
}) {
  const { role } = useRole();
  const editable = canEdit(role, "skills");
  const [skills, setSkills] = useState<SkillEntry[]>(initialSkills);
  const [tags, setTags] = useState<SkillTag[]>(allTags);
  const [pending, startTransition] = useAsyncPending();

  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const current = skills.filter((s) => s.category === "current");
  const developing = skills.filter((s) => s.category === "developing");

  function commit(next: SkillEntry[]) {
    setSkills(next);
    startTransition(async () => {
      await saveSkillsAction(internId, next);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Skills</CardTitle>
        <div className="flex items-center gap-2">
          {pending && <span className="text-[11px] text-muted-foreground">Saving…</span>}
          {editable && (
            <SkillsEditor
              skills={skills}
              tags={tags}
              onSave={(next) => commit(next)}
              onTagsChange={(next) => setTags(next)}
            />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="current">
          <TabsList>
            <TabsTrigger value="current">
              Current
              <span className="ml-1.5 text-muted-foreground tabular-nums">{current.length}</span>
            </TabsTrigger>
            <TabsTrigger value="developing">
              Developing
              <span className="ml-1.5 text-muted-foreground tabular-nums">{developing.length}</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="current">
            <SkillList list={current} tagsById={tagsById} emptyHint="What you come in with — your strongest, most reachable skills." />
          </TabsContent>
          <TabsContent value="developing">
            <SkillList list={developing} tagsById={tagsById} emptyHint="2–3 skills you want to grow over the internship. Managers see these when assigning work." />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function SkillList({
  list, tagsById, emptyHint,
}: { list: SkillEntry[]; tagsById: Map<string, SkillTag>; emptyHint: string }) {
  if (list.length === 0) {
    return <EmptyState title="Nothing here yet" description={emptyHint} className="py-8" />;
  }
  // Group by SkillGroup so the surface stays scannable.
  const byGroup = new Map<SkillGroup, SkillEntry[]>();
  for (const s of list) {
    const tag = tagsById.get(s.skillTagId);
    if (!tag) continue;
    const arr = byGroup.get(tag.group) ?? [];
    arr.push(s);
    byGroup.set(tag.group, arr);
  }
  return (
    <div className="flex flex-col gap-4">
      {SKILL_GROUPS.filter((g) => byGroup.has(g.key)).map((g) => (
        <div key={g.key} className="flex flex-col gap-2">
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
            {g.label}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {byGroup.get(g.key)!.map((s) => {
              const tag = tagsById.get(s.skillTagId)!;
              return (
                <li
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-md card-border bg-card px-2 py-1 text-[12.5px]"
                  title={tag.approved ? PROFICIENCY_LABEL[s.proficiency] : "Pending tag approval"}
                >
                  <span className="font-medium">{tag.label}</span>
                  {!tag.approved && <Badge variant="warning" className="text-[10px] px-1 py-0">Pending</Badge>}
                  <ProficiencyDots value={s.proficiency} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------- Editor dialog ----------
function SkillsEditor({
  skills, tags, onSave, onTagsChange,
}: {
  skills: SkillEntry[];
  tags: SkillTag[];
  onSave: (next: SkillEntry[]) => void;
  onTagsChange: (next: SkillTag[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SkillEntry[]>(skills);
  const [filter, setFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState<SkillGroup | "all">("all");
  const [requesting, setRequesting] = useState(false);
  const [reqLabel, setReqLabel] = useState("");
  const [reqGroup, setReqGroup] = useState<SkillGroup>("engineering");
  const [reqPending, startReqTransition] = useAsyncPending();

  const draftIds = useMemo(() => new Set(draft.map((d) => d.skillTagId)), [draft]);

  const visibleTags = tags
    .filter((t) => groupFilter === "all" ? true : t.group === groupFilter)
    .filter((t) => filter ? t.label.toLowerCase().includes(filter.toLowerCase()) : true);

  function addTag(tagId: string, category: "current" | "developing") {
    const id = `${tagId}-${category}`;
    setDraft((d) => [...d, { id, skillTagId: tagId, category, proficiency: "beginner" }]);
  }
  function removeEntry(entryId: string) {
    setDraft((d) => d.filter((e) => e.id !== entryId));
  }
  function setProficiency(entryId: string, p: Proficiency) {
    setDraft((d) => d.map((e) => e.id === entryId ? { ...e, proficiency: p } : e));
  }

  async function requestNew() {
    if (!reqLabel.trim()) return;
    startReqTransition(async () => {
      const tag = await requestNewSkillTagAction(reqLabel.trim(), reqGroup);
      onTagsChange([...tags, tag]);
      // Auto-add to draft as developing/beginner — common case.
      setDraft((d) => [...d, { id: `${tag.id}-developing`, skillTagId: tag.id, category: "developing", proficiency: "beginner" }]);
      setReqLabel("");
      setRequesting(false);
    });
  }

  function commit() {
    onSave(draft);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(skills); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-3.5 w-3.5" />
          Edit skills
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit skills</DialogTitle>
          <DialogDescription>
            Pick from the controlled vocabulary. Missing one? Request a new tag — HR reviews and approves.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
          {/* LEFT — picker */}
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Catalog</h4>
              {!requesting && (
                <Button variant="link" size="sm" onClick={() => setRequesting(true)} className="h-6 px-0">
                  + Request new tag
                </Button>
              )}
            </div>
            {requesting ? (
              <div className="flex flex-col gap-2 rounded-md card-border bg-card p-3">
                <Label htmlFor="new-label">New tag</Label>
                <Input id="new-label" placeholder="Rust, Vercel, GraphQL…" value={reqLabel} onChange={(e) => setReqLabel(e.target.value)} />
                <Label>Group</Label>
                <Select value={reqGroup} onValueChange={(v) => setReqGroup(v as SkillGroup)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SKILL_GROUPS.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button variant="ghost" size="sm" onClick={() => setRequesting(false)} disabled={reqPending}>Cancel</Button>
                  <Button size="sm" onClick={requestNew} disabled={reqPending || !reqLabel.trim()}>
                    {reqPending ? "Requesting…" : "Request"}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  <Select value={groupFilter} onValueChange={(v) => setGroupFilter(v as SkillGroup | "all")}>
                    <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All groups</SelectItem>
                      {SKILL_GROUPS.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <ul className="flex flex-col gap-1 max-h-[320px] overflow-y-auto pr-1">
                  {visibleTags.map((t) => {
                    const inDraft = draftIds.has(t.id);
                    return (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-muted/60"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium truncate">{t.label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {skillGroupLabel(t.group)}
                            {!t.approved && <span className="ml-1.5 text-[hsl(36_95%_30%)]">· pending</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button variant="outline" size="sm" disabled={inDraft} onClick={() => addTag(t.id, "current")}>
                            <Plus className="h-3 w-3" />Current
                          </Button>
                          <Button variant="outline" size="sm" disabled={inDraft} onClick={() => addTag(t.id, "developing")}>
                            <Plus className="h-3 w-3" />Develop
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                  {visibleTags.length === 0 && (
                    <li className="px-2 py-6 text-center text-[12px] text-muted-foreground">No tags match your filter.</li>
                  )}
                </ul>
              </>
            )}
          </div>

          {/* RIGHT — current draft */}
          <div className="flex flex-col gap-3">
            <h4 className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">Your selection</h4>
            <DraftList
              entries={draft.filter((d) => d.category === "current")}
              tagsById={new Map(tags.map((t) => [t.id, t]))}
              header="Current"
              onRemove={removeEntry}
              onProf={setProficiency}
            />
            <DraftList
              entries={draft.filter((d) => d.category === "developing")}
              tagsById={new Map(tags.map((t) => [t.id, t]))}
              header="Developing"
              onRemove={removeEntry}
              onProf={setProficiency}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={commit}>
            <Sparkles className="h-3.5 w-3.5" />
            Save skills
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraftList({
  entries, tagsById, header, onRemove, onProf,
}: {
  entries: SkillEntry[];
  tagsById: Map<string, SkillTag>;
  header: string;
  onRemove: (id: string) => void;
  onProf: (id: string, p: Proficiency) => void;
}) {
  return (
    <div className="rounded-md card-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground mb-2">{header}</div>
      {entries.length === 0 ? (
        <div className="text-[12px] italic text-muted-foreground">No selections yet.</div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => {
            const tag = tagsById.get(e.skillTagId);
            if (!tag) return null;
            return (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium truncate">{tag.label}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <Select value={e.proficiency} onValueChange={(v) => onProf(e.id, v as Proficiency)}>
                    <SelectTrigger className="h-7 px-2 text-[11px] min-w-[110px] w-auto"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner</SelectItem>
                      <SelectItem value="working">Working</SelectItem>
                      <SelectItem value="strong">Strong</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => onRemove(e.id)} className="text-muted-foreground hover:text-destructive h-7">
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
