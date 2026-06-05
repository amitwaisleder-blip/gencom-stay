"use client";

import { useMemo, useState } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { format, parseISO } from "date-fns";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/module/empty-state";

import type { Deliverable, Department } from "@/data";
import { DEPARTMENTS, departmentLabel, deptBgClass } from "@/data/vocabularies";
import { mondayOf, ISO } from "@/lib/dates";
import { useRole } from "@/lib/role";
import { canEdit } from "@/lib/visibility";
import { upsertDeliverableAction, deleteDeliverableAction } from "@/app/actions";
import { cn } from "@/lib/cn";

export function DeliverablesList({
  internId, initial,
}: { internId: string; initial: Deliverable[] }) {
  const { role } = useRole();
  const editable = canEdit(role, "deliverables");
  const [items, setItems] = useState<Deliverable[]>(initial);
  const [editing, setEditing] = useState<Deliverable | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useAsyncPending();

  // Group by ISO week-of (Monday). The store sorts week-desc already so
  // we just preserve order and split.
  const byWeek = useMemo(() => {
    const map = new Map<string, Deliverable[]>();
    for (const d of items) {
      const arr = map.get(d.weekOf) ?? [];
      arr.push(d);
      map.set(d.weekOf, arr);
    }
    return Array.from(map.entries());
  }, [items]);

  function commitUpsert(next: Deliverable) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === next.id);
      if (idx === -1) return [next, ...prev];
      const out = [...prev];
      out[idx] = next;
      return out;
    });
    startTransition(async () => {
      await upsertDeliverableAction(next);
    });
  }

  function commitDelete(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => {
      await deleteDeliverableAction(internId, id);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Deliverables</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground max-w-xl">
            Shipped work, week by week. Becomes the raw material for the end-of-program portfolio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <span className="text-[11px] text-muted-foreground">Saving…</span>}
          {editable && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Log a deliverable
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          description={editable
            ? "Each Friday, jot down what shipped: title, description, link. Future-you will thank you when the portfolio compiles itself."
            : "This intern hasn't logged any deliverables yet. Check back next Friday."}
          action={editable
            ? <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" />Log first deliverable</Button>
            : undefined}
          className="py-14"
        />
      ) : (
        <div className="flex flex-col gap-6">
          {byWeek.map(([weekOf, list]) => (
            <section key={weekOf} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                  Week of {format(parseISO(weekOf), "MMM d, yyyy")}
                </h3>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {list.length} item{list.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((d) => (
                  <DeliverableCard
                    key={d.id}
                    deliverable={d}
                    editable={editable}
                    onEdit={() => setEditing(d)}
                    onDelete={() => commitDelete(d.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {(editing || adding) && (
        <DeliverableDialog
          internId={internId}
          initial={editing ?? undefined}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSave={(rec) => { commitUpsert(rec); setEditing(null); setAdding(false); }}
        />
      )}
    </div>
  );
}

function DeliverableCard({
  deliverable, editable, onEdit, onDelete,
}: {
  deliverable: Deliverable;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="group">
      <CardContent className="pt-5 flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-[14px] font-semibold leading-snug min-w-0">{deliverable.title}</h4>
          {editable && (
            <div className="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete" className="hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          )}
        </div>
        <p className="text-[13px] text-foreground/85 leading-relaxed">{deliverable.description}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          {deliverable.department && (
            <Badge variant="outline" className="gap-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full", deptBgClass(deliverable.department))} />
              {departmentLabel(deliverable.department)}
            </Badge>
          )}
          {deliverable.projectName && (
            <Badge variant="muted">{deliverable.projectName}</Badge>
          )}
          {deliverable.link && (
            <a
              href={deliverable.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Link
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DeliverableDialog({
  internId, initial, onClose, onSave,
}: {
  internId: string;
  initial?: Deliverable;
  onClose: () => void;
  onSave: (d: Deliverable) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [link, setLink] = useState(initial?.link ?? "");
  const [project, setProject] = useState(initial?.projectName ?? "");
  const [department, setDepartment] = useState<Department | "">(initial?.department ?? "");
  const [weekOf, setWeekOf] = useState(initial?.weekOf ?? ISO(mondayOf(new Date())));

  function submit() {
    onSave({
      id: initial?.id ?? nanoid(8),
      internId,
      weekOf,
      title: title.trim(),
      description: description.trim(),
      link: link.trim() || undefined,
      projectName: project.trim() || undefined,
      department: department || undefined,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit deliverable" : "Log a deliverable"}</DialogTitle>
          <DialogDescription>
            One short note per shipped piece of work. The portfolio will pull from these directly.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="d-title">Title</Label>
            <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Repo onboarding doc" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-desc">What shipped</Label>
            <Textarea id="d-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="2–3 sentences. What got built, who's using it, any signal of impact." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="d-week">Week of</Label>
              <Input id="d-week" type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} />
              <span className="text-[11px] text-muted-foreground">Pick any day in the week — the store snaps to Monday for grouping.</span>
            </div>
            <div className="grid gap-1.5">
              <Label>Department</Label>
              <Select value={department || "-"} onValueChange={(v) => setDepartment(v === "-" ? "" : (v as Department))}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="-">— none</SelectItem>
                  {DEPARTMENTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="d-project">Project (optional)</Label>
              <Input id="d-project" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Internal tooling sprint" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="d-link">Link (optional)</Label>
              <Input id="d-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim() || !description.trim()}>
            {initial ? "Save" : "Log it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
