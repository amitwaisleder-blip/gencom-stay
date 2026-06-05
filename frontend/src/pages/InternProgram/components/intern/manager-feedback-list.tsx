"use client";

import { useMemo, useState } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { format, parseISO } from "date-fns";
import { Pencil, Plus, Star, Trash2, Lock } from "lucide-react";
import { nanoid } from "nanoid";

import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

import type { FullTimer, ManagerFeedback } from "@/data";
import { departmentLabel } from "@/data/vocabularies";
import { mondayOf, ISO } from "@/lib/dates";
import { useRole } from "@/lib/role";
import { can } from "@/lib/visibility";
import { initialsOf } from "@/lib/initials";
import { upsertManagerFeedbackAction, deleteManagerFeedbackAction } from "@/app/actions";
import { cn } from "@/lib/cn";

// Demo proxy — without real auth we let anyone in the manager role
// "act as" a specific manager to demo the edit-own constraint.
// First manager in the list is the default actor.
function useDemoManager(managers: FullTimer[]): [string | null, (id: string) => void] {
  const [actorId, setActorId] = useState<string | null>(managers[0]?.id ?? null);
  return [actorId, setActorId];
}

export function ManagerFeedbackList({
  internId, internName, initial, managers,
}: {
  internId: string;
  internName: string;
  initial: ManagerFeedback[];
  managers: FullTimer[];
}) {
  const { role } = useRole();
  const canPost = can(role, "managerFeedback", "edit-own");
  const canViewAll = can(role, "managerFeedback", "view");
  const [items, setItems] = useState<ManagerFeedback[]>(initial);
  const [editing, setEditing] = useState<ManagerFeedback | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useAsyncPending();
  const [actorId, setActorId] = useDemoManager(managers);

  const managerById = useMemo(() => new Map(managers.map((m) => [m.id, m])), [managers]);
  const summary = useMemo(() => {
    if (items.length === 0) return null;
    const avg = items.reduce((s, f) => s + f.rating, 0) / items.length;
    const lowest = Math.min(...items.map((f) => f.rating));
    return { avg, lowest, count: items.length };
  }, [items]);

  function commitUpsert(next: ManagerFeedback) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === next.id);
      if (idx === -1) return [next, ...prev].sort((a, b) => b.weekOf.localeCompare(a.weekOf));
      const out = [...prev]; out[idx] = next; return out.sort((a, b) => b.weekOf.localeCompare(a.weekOf));
    });
    startTransition(async () => { await upsertManagerFeedbackAction(next); });
  }
  function commitDelete(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => { await deleteManagerFeedbackAction(internId, id); });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight inline-flex items-center gap-2">
            Manager feedback
            <Badge variant="muted" className="font-normal">
              <Lock className="h-3 w-3" />
              HR &amp; execs only
            </Badge>
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground max-w-xl">
            Quick weekly pulse — 1–5 plus a sentence. Surfaces issues early without blowing up
            into formal review cycles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <span className="text-[11px] text-muted-foreground">Saving…</span>}
          {canPost && (
            <>
              <Select value={actorId ?? undefined} onValueChange={setActorId}>
                <SelectTrigger className="h-8 w-[200px] text-[12px]">
                  <span className="text-muted-foreground mr-1">Posting as</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {managers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => setAdding(true)} disabled={!actorId}>
                <Plus className="h-3.5 w-3.5" />
                Pulse this week
              </Button>
            </>
          )}
        </div>
      </div>

      {summary && canViewAll && (
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryStat label="Average rating" value={summary.avg.toFixed(1)} suffix="/ 5" tone="neutral" />
          <SummaryStat label="Lowest rating" value={String(summary.lowest)} suffix="/ 5" tone={summary.lowest <= 2 ? "warning" : "neutral"} />
          <SummaryStat label="Pulses on file" value={String(summary.count)} suffix={`for ${internName.split(" ")[0]}`} tone="neutral" />
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No pulses yet"
          description={canPost
            ? "Drop a quick rating + one sentence. Takes ~30 seconds."
            : "No manager has filed a pulse yet for this intern."}
          action={canPost ? <Button size="sm" onClick={() => setAdding(true)} disabled={!actorId}><Plus className="h-3.5 w-3.5" />Add first pulse</Button> : undefined}
          className="py-14"
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((f) => {
            const mgr = managerById.get(f.managerId);
            const ownsRow = canPost && f.managerId === actorId;
            return (
              <li key={f.id}>
                <FeedbackCard
                  feedback={f}
                  manager={mgr}
                  editable={ownsRow}
                  onEdit={() => setEditing(f)}
                  onDelete={() => commitDelete(f.id)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {(editing || adding) && actorId && (
        <FeedbackDialog
          internId={internId}
          actorId={actorId}
          initial={editing ?? undefined}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSave={(rec) => { commitUpsert(rec); setEditing(null); setAdding(false); }}
        />
      )}
    </div>
  );
}

function SummaryStat({
  label, value, suffix, tone,
}: { label: string; value: string; suffix?: string; tone: "neutral" | "warning" }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">{label}</div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className={cn(
            "text-[24px] font-semibold tabular-nums tracking-tight",
            tone === "warning" && "text-[hsl(36_95%_30%)]",
          )}>{value}</span>
          {suffix && <span className="text-[12px] text-muted-foreground">{suffix}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackCard({
  feedback, manager, editable, onEdit, onDelete,
}: {
  feedback: ManagerFeedback;
  manager: FullTimer | undefined;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="group">
      <CardContent className="pt-4 pb-4 flex items-start gap-4">
        <Avatar className="h-9 w-9">
          <AvatarImage src={manager?.photoUrl} alt="" />
          <AvatarFallback>{manager ? initialsOf(manager.name) : "??"}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <span className="font-medium truncate">{manager?.name ?? "Unknown manager"}</span>
              <span className="ml-2 text-[12px] text-muted-foreground">
                {manager ? `${manager.role} · ${departmentLabel(manager.department)}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                Week of {format(parseISO(feedback.weekOf), "MMM d")}
              </span>
              <RatingPips value={feedback.rating} />
              {editable && (
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete" className="hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </div>
          </div>
          <p className="text-[13px] text-foreground/85 leading-relaxed">{feedback.note}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RatingPips({ value }: { value: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-md card-border bg-card px-1.5 py-0.5"
      title={`${value} / 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "h-3 w-3",
            n <= value ? "text-warning fill-current" : "text-border",
          )}
        />
      ))}
    </span>
  );
}

function FeedbackDialog({
  internId, actorId, initial, onClose, onSave,
}: {
  internId: string;
  actorId: string;
  initial?: ManagerFeedback;
  onClose: () => void;
  onSave: (f: ManagerFeedback) => void;
}) {
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5>(initial?.rating ?? 4);
  const [note, setNote] = useState(initial?.note ?? "");
  const [weekOf, setWeekOf] = useState(initial?.weekOf ?? ISO(mondayOf(new Date())));

  function submit() {
    onSave({
      id: initial?.id ?? nanoid(8),
      internId,
      managerId: initial?.managerId ?? actorId,
      weekOf,
      rating,
      note: note.trim(),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit pulse" : "Weekly pulse"}</DialogTitle>
          <DialogDescription>One number, one sentence. Faster pulses = more honest pulses.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Week of</Label>
            <Input type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Rating</Label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n as 1 | 2 | 3 | 4 | 5)}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  aria-label={`Rate ${n}`}
                >
                  <Star className={cn("h-5 w-5", n <= rating ? "text-warning fill-current" : "text-border")} />
                </button>
              ))}
              <span className="ml-2 text-[12px] text-muted-foreground tabular-nums">{rating} / 5</span>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>One sentence</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's the headline this week?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!note.trim()}>Save pulse</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
