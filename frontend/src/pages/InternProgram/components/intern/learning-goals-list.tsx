"use client";

import { useState } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { format, parseISO } from "date-fns";
import { Pencil, Plus, Trash2, MessageCircle, Target, AlertTriangle, CheckCircle2 } from "lucide-react";
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/module/empty-state";

import type { LearningGoal, Role } from "@/data";
import { ROLE_LABEL } from "@/lib/visibility";
import { useRole } from "@/lib/role";
import { canEdit, can } from "@/lib/visibility";
import {
  upsertLearningGoalAction, deleteLearningGoalAction, addGoalCheckInAction,
} from "@/app/actions";
import { cn } from "@/lib/cn";

const STATUS_META: Record<LearningGoal["status"], {
  label: string;
  icon: typeof Target;
  badge: "success" | "warning" | "muted" | "accent";
  accentClass: string;
}> = {
  "on-track": { label: "On track",  icon: Target,         badge: "accent",  accentClass: "text-primary" },
  "at-risk":  { label: "At risk",   icon: AlertTriangle,  badge: "warning", accentClass: "text-[hsl(36_95%_30%)]" },
  "achieved": { label: "Achieved",  icon: CheckCircle2,   badge: "success", accentClass: "text-success" },
};

export function LearningGoalsList({
  internId, initial,
}: { internId: string; initial: LearningGoal[] }) {
  const { role } = useRole();
  const editable = canEdit(role, "learningGoals");
  const canComment = can(role, "learningGoals", "comment");
  const [goals, setGoals] = useState<LearningGoal[]>(initial);
  const [editing, setEditing] = useState<LearningGoal | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useAsyncPending();

  function commitUpsert(next: LearningGoal) {
    setGoals((prev) => {
      const idx = prev.findIndex((g) => g.id === next.id);
      if (idx === -1) return [...prev, next];
      const out = [...prev]; out[idx] = next; return out;
    });
    startTransition(async () => { await upsertLearningGoalAction(next); });
  }
  function commitDelete(id: string) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    startTransition(async () => { await deleteLearningGoalAction(internId, id); });
  }
  function commitCheckIn(goalId: string, ci: { date: string; note: string; author: string }) {
    setGoals((prev) => prev.map((g) => g.id === goalId
      ? { ...g, checkIns: [{ id: nanoid(8), ...ci }, ...g.checkIns] }
      : g));
    startTransition(async () => { await addGoalCheckInAction(internId, goalId, ci); });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Learning goals</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground max-w-xl">
            2–3 goals set at program start, with check-ins as you go.
            {canComment && " As a manager you can drop a comment on any goal — surfaces the right conversation early."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <span className="text-[11px] text-muted-foreground">Saving…</span>}
          {editable && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add goal
            </Button>
          )}
        </div>
      </div>

      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description={editable
            ? "Pick 2–3 things you want to grow this internship. Specific is better than ambitious."
            : "This intern hasn't set learning goals yet."}
          action={editable ? <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" />Set first goal</Button> : undefined}
          className="py-14"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {goals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              role={role}
              editable={editable}
              canComment={canComment}
              onEdit={() => setEditing(g)}
              onDelete={() => commitDelete(g.id)}
              onCheckIn={(ci) => commitCheckIn(g.id, ci)}
            />
          ))}
        </div>
      )}

      {(editing || adding) && (
        <GoalDialog
          internId={internId}
          initial={editing ?? undefined}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSave={(g) => { commitUpsert(g); setEditing(null); setAdding(false); }}
        />
      )}
    </div>
  );
}

function GoalCard({
  goal, role, editable, canComment, onEdit, onDelete, onCheckIn,
}: {
  goal: LearningGoal;
  role: Role;
  editable: boolean;
  canComment: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCheckIn: (ci: { date: string; note: string; author: string }) => void;
}) {
  const meta = STATUS_META[goal.status];
  const Icon = meta.icon;
  return (
    <Card className="group flex flex-col">
      <CardContent className="pt-5 flex flex-col gap-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", meta.accentClass)} />
            <h4 className="text-[14px] font-semibold leading-snug min-w-0">{goal.title}</h4>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant={meta.badge}>{meta.label}</Badge>
            {editable && (
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete" className="hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            )}
          </div>
        </div>
        <p className="text-[13px] text-foreground/85 leading-relaxed">{goal.description}</p>

        <div className="mt-2 pt-3 border-t flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <h5 className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground inline-flex items-center gap-1.5">
              <MessageCircle className="h-3 w-3" />
              Check-ins
              <span className="tabular-nums normal-case tracking-normal">({goal.checkIns.length})</span>
            </h5>
            {(editable || canComment) && (
              <CheckInDialog role={role} onSave={onCheckIn} />
            )}
          </div>
          {goal.checkIns.length === 0 ? (
            <p className="text-[12px] italic text-muted-foreground">No check-ins yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {goal.checkIns.map((ci) => (
                <li key={ci.id} className="text-[12.5px] leading-relaxed">
                  <div className="flex items-baseline gap-2 text-muted-foreground">
                    <span className="font-medium text-foreground">{ci.author}</span>
                    <span className="text-[11px] tabular-nums">{format(parseISO(ci.date), "MMM d")}</span>
                  </div>
                  <p className="text-foreground/85">{ci.note}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CheckInDialog({
  role, onSave,
}: { role: Role; onSave: (ci: { date: string; note: string; author: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [author, setAuthor] = useState(`Viewer (${ROLE_LABEL[role]})`);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="h-7 -mr-2">
        <Plus className="h-3.5 w-3.5" />
        Add check-in
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add check-in</DialogTitle>
            <DialogDescription>
              {role === "manager" ? "Drop a manager comment on this goal." : "Quick progress note."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Author</Label>
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Note</Label>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's the latest?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!note.trim() || !author.trim()}
              onClick={() => {
                onSave({ note: note.trim(), author: author.trim(), date });
                setOpen(false);
                setNote("");
              }}
            >Save check-in</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GoalDialog({
  internId, initial, onClose, onSave,
}: {
  internId: string;
  initial?: LearningGoal;
  onClose: () => void;
  onSave: (g: LearningGoal) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState<LearningGoal["status"]>(initial?.status ?? "on-track");

  function submit() {
    onSave({
      id: initial?.id ?? nanoid(8),
      internId,
      title: title.trim(),
      description: description.trim(),
      status,
      checkIns: initial?.checkIns ?? [],
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit goal" : "Add goal"}</DialogTitle>
          <DialogDescription>Specific is better than ambitious. Pick something you can credibly check on weekly.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Goal</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Write a real PRD end-to-end" />
          </div>
          <div className="grid gap-1.5">
            <Label>Why / how you'll know</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What success looks like in concrete terms." />
          </div>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as LearningGoal["status"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="on-track">On track</SelectItem>
                <SelectItem value="at-risk">At risk</SelectItem>
                <SelectItem value="achieved">Achieved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
