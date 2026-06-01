"use client";

import { useMemo, useState } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { format, parseISO } from "date-fns";
import { CheckCircle2, Clock4, Lock, Pencil, Plus, ThumbsUp, Trash2, XCircle } from "lucide-react";
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
import { initialsOf } from "@/lib/initials";
import { departmentLabel } from "@/data/vocabularies";
import { useRole } from "@/lib/role";
import { can } from "@/lib/visibility";
import { upsertReturnOfferAction, deleteReturnOfferAction } from "@/app/actions";

import type { FullTimer, ReturnOfferEntry } from "@/data";

const REC_META: Record<ReturnOfferEntry["recommendation"], {
  label: string; badge: "success" | "destructive" | "warning"; icon: typeof ThumbsUp;
}> = {
  "would-hire":      { label: "Would hire",      badge: "success",     icon: ThumbsUp },
  "would-not":       { label: "Would not hire",  badge: "destructive", icon: XCircle },
  "needs-more-time": { label: "Needs more time", badge: "warning",     icon: Clock4 },
};

export function ReturnOfferList({
  internId, internName, initial, managers,
}: {
  internId: string;
  internName: string;
  initial: ReturnOfferEntry[];
  managers: FullTimer[];
}) {
  const { role } = useRole();
  const canPost = can(role, "returnOfferTracker", "edit-own");
  const canViewAll = can(role, "returnOfferTracker", "view");
  const [items, setItems] = useState<ReturnOfferEntry[]>(initial);
  const [editing, setEditing] = useState<ReturnOfferEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useAsyncPending();
  const [actorId, setActorId] = useState<string | null>(managers[0]?.id ?? null);

  const summary = useMemo(() => {
    if (items.length === 0) return null;
    const counts = items.reduce<Record<string, number>>((acc, r) => {
      acc[r.recommendation] = (acc[r.recommendation] ?? 0) + 1;
      return acc;
    }, {});
    return counts;
  }, [items]);

  const managerById = useMemo(() => new Map(managers.map((m) => [m.id, m])), [managers]);

  function commitUpsert(next: ReturnOfferEntry) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === next.id);
      if (idx === -1) return [next, ...prev];
      const out = [...prev]; out[idx] = next; return out;
    });
    startTransition(async () => { await upsertReturnOfferAction(next); });
  }
  function commitDelete(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => { await deleteReturnOfferAction(internId, id); });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight inline-flex items-center gap-2">
            Return offer tracker
            <Badge variant="muted" className="font-normal"><Lock className="h-3 w-3" />HR &amp; execs</Badge>
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground max-w-xl">
            Managers privately log their post-project recommendation. HR and execs use this to make the return-offer call.
            {internName.split(" ")[0]} never sees this surface.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <span className="text-[11px] text-muted-foreground">Saving…</span>}
          {canPost && (
            <>
              <Select value={actorId ?? undefined} onValueChange={setActorId}>
                <SelectTrigger className="h-8 w-[200px] text-[12px]">
                  <span className="text-muted-foreground mr-1">Logging as</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => setAdding(true)} disabled={!actorId}>
                <Plus className="h-3.5 w-3.5" />
                Log decision
              </Button>
            </>
          )}
        </div>
      </div>

      {summary && canViewAll && (
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Would hire" count={summary["would-hire"] ?? 0} icon={ThumbsUp} tone="success" />
          <SummaryCard label="Needs more time" count={summary["needs-more-time"] ?? 0} icon={Clock4} tone="warning" />
          <SummaryCard label="Would not hire" count={summary["would-not"] ?? 0} icon={XCircle} tone="danger" />
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No decisions logged yet"
          description={canPost
            ? "After each project rotation, drop a quick recommendation. Helps HR build the picture over the program."
            : "When managers wrap a project rotation they'll log their recommendation here."}
          action={canPost ? <Button size="sm" onClick={() => setAdding(true)} disabled={!actorId}><Plus className="h-3.5 w-3.5" />First decision</Button> : undefined}
          className="py-14"
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((r) => {
            const m = managerById.get(r.managerId);
            const ownsRow = canPost && r.managerId === actorId;
            const meta = REC_META[r.recommendation];
            const Icon = meta.icon;
            return (
              <li key={r.id}>
                <Card className="group">
                  <CardContent className="pt-4 pb-4 flex items-start gap-3">
                    <Avatar className="h-9 w-9"><AvatarImage src={m?.photoUrl} alt="" /><AvatarFallback>{m ? initialsOf(m.name) : "??"}</AvatarFallback></Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <span className="font-medium">{m?.name ?? "Unknown manager"}</span>
                          <span className="ml-2 text-[12px] text-muted-foreground">
                            {m ? departmentLabel(m.department) : ""}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={meta.badge}><Icon className="h-3 w-3" />{meta.label}</Badge>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {format(parseISO(r.createdAt), "MMM d")}
                          </span>
                          {ownsRow && (
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => commitDelete(r.id)} className="hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-1 text-[12px] text-muted-foreground">Project: {r.projectName}</div>
                      <p className="mt-1.5 text-[13px] text-foreground/85 leading-relaxed">{r.note}</p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {(editing || adding) && actorId && (
        <ReturnOfferDialog
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

function SummaryCard({
  label, count, icon: Icon, tone,
}: { label: string; count: number; icon: typeof ThumbsUp; tone: "success" | "warning" | "danger" }) {
  const tint = tone === "success" ? "text-success" : tone === "warning" ? "text-[hsl(36_95%_30%)]" : "text-destructive";
  return (
    <Card>
      <CardContent className="pt-5 flex items-start gap-3">
        <div className={`grid h-9 w-9 place-items-center rounded-md bg-muted ${tint}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{label}</div>
          <div className="text-[22px] font-semibold tabular-nums tracking-tight mt-0.5">{count}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ReturnOfferDialog({
  internId, actorId, initial, onClose, onSave,
}: {
  internId: string;
  actorId: string;
  initial?: ReturnOfferEntry;
  onClose: () => void;
  onSave: (r: ReturnOfferEntry) => void;
}) {
  const [recommendation, setRecommendation] = useState<ReturnOfferEntry["recommendation"]>(initial?.recommendation ?? "would-hire");
  const [projectName, setProjectName] = useState(initial?.projectName ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  function submit() {
    onSave({
      id: initial?.id ?? nanoid(8),
      internId,
      managerId: initial?.managerId ?? actorId,
      projectName: projectName.trim(),
      recommendation,
      note: note.trim(),
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit decision" : "Log return-offer decision"}</DialogTitle>
          <DialogDescription>Private to HR &amp; execs. The intern doesn't see this.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Project / rotation</Label>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Pricing PRD draft" />
          </div>
          <div className="grid gap-1.5">
            <Label>Recommendation</Label>
            <Select value={recommendation} onValueChange={(v) => setRecommendation(v as ReturnOfferEntry["recommendation"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="would-hire">Would hire</SelectItem>
                <SelectItem value="needs-more-time">Needs more time</SelectItem>
                <SelectItem value="would-not">Would not hire</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Why</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="One paragraph max. Specifics, not vibes." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!projectName.trim() || !note.trim()} onClick={submit}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
