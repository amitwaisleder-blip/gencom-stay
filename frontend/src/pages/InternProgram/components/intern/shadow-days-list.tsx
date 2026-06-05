"use client";

import { useMemo, useState } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { format, parseISO } from "date-fns";
import { CalendarPlus, CheckCircle2, Clock, Pencil, Trash2, XCircle } from "lucide-react";
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

import type { Department, DayHalf, FullTimer, ShadowDayRequest } from "@/data";
import { DEPARTMENTS, departmentLabel, deptBgClass } from "@/data/vocabularies";
import { upsertShadowDayAction, deleteShadowDayAction } from "@/app/actions";
import { useRole } from "@/lib/role";
import { can } from "@/lib/visibility";
import { cn } from "@/lib/cn";

const STATUS_META: Record<ShadowDayRequest["status"], {
  label: string; badge: "warning" | "success" | "destructive" | "muted";
}> = {
  pending:  { label: "Pending",  badge: "warning" },
  approved: { label: "Approved", badge: "success" },
  declined: { label: "Declined", badge: "destructive" },
};

export function ShadowDaysList({
  internId, initial, fullTimers,
}: {
  internId: string;
  initial: ShadowDayRequest[];
  fullTimers: FullTimer[];
}) {
  const { role } = useRole();
  const canCreate = can(role, "shadowDayRequests", "request");
  const canApprove = can(role, "shadowDayRequests", "approve");
  const [items, setItems] = useState<ShadowDayRequest[]>(initial);
  const [editing, setEditing] = useState<ShadowDayRequest | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useAsyncPending();

  // For approval — we need a "current actor" similar to feedback. The
  // first manager whose department matches the request's targetDepartment
  // is the natural approver. Without auth, we let manager-role users
  // act on any request whose dept matches a manager they "are."
  const managers = useMemo(
    () => fullTimers.filter((f) => f.isManager),
    [fullTimers],
  );
  const [actorId, setActorId] = useState<string | null>(managers[0]?.id ?? null);
  const actor = managers.find((m) => m.id === actorId) ?? null;

  function commitUpsert(next: ShadowDayRequest) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === next.id);
      if (idx === -1) return [next, ...prev];
      const out = [...prev]; out[idx] = next; return out;
    });
    startTransition(async () => { await upsertShadowDayAction(next); });
  }
  function commitDelete(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => { await deleteShadowDayAction(internId, id); });
  }
  function decide(req: ShadowDayRequest, status: "approved" | "declined", note?: string) {
    commitUpsert({ ...req, status, approvedBy: actor?.id, decisionNote: note });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Shadow days</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground max-w-xl">
            Half-day requests to sit with a different department. Manager of that department approves.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <span className="text-[11px] text-muted-foreground">Saving…</span>}
          {canApprove && (
            <Select value={actorId ?? undefined} onValueChange={setActorId}>
              <SelectTrigger className="h-8 w-[200px] text-[12px]">
                <span className="text-muted-foreground mr-1">Acting as</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} — {departmentLabel(m.department)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canCreate && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <CalendarPlus className="h-3.5 w-3.5" />
              Request shadow day
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No requests yet"
          description={canCreate
            ? "Want to spend a half-day with another team? Send a request — the department manager decides."
            : "This intern hasn't requested any shadow days."}
          action={canCreate ? <Button size="sm" onClick={() => setAdding(true)}><CalendarPlus className="h-3.5 w-3.5" />First request</Button> : undefined}
          className="py-14"
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((r) => {
            const ownsApproval = canApprove && actor?.department === r.targetDepartment;
            const isOwner = canCreate && r.status === "pending";
            return (
              <li key={r.id}>
                <RequestCard
                  req={r}
                  decisionByName={
                    r.approvedBy ? fullTimers.find((f) => f.id === r.approvedBy)?.name ?? null : null
                  }
                  canApprove={ownsApproval && r.status === "pending"}
                  canEditOwn={isOwner}
                  onEdit={() => setEditing(r)}
                  onDelete={() => commitDelete(r.id)}
                  onDecide={(status, note) => decide(r, status, note)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {(editing || adding) && (
        <ShadowDayDialog
          internId={internId}
          initial={editing ?? undefined}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSave={(rec) => { commitUpsert(rec); setEditing(null); setAdding(false); }}
        />
      )}
    </div>
  );
}

function RequestCard({
  req, decisionByName, canApprove, canEditOwn, onEdit, onDelete, onDecide,
}: {
  req: ShadowDayRequest;
  decisionByName: string | null;
  canApprove: boolean;
  canEditOwn: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDecide: (status: "approved" | "declined", note?: string) => void;
}) {
  const meta = STATUS_META[req.status];
  return (
    <Card className="group">
      <CardContent className="pt-4 pb-4 flex items-start gap-3">
        <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", deptBgClass(req.targetDepartment))} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div className="font-medium">
              {departmentLabel(req.targetDepartment)} · {format(parseISO(req.requestedDate), "EEE, MMM d")}
              <span className="ml-1.5 text-[12px] uppercase tracking-wider text-muted-foreground">{req.half}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={meta.badge}>{meta.label}</Badge>
              {canEditOwn && (
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" onClick={onDelete} className="hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </div>
          </div>
          <p className="mt-1 text-[13px] text-foreground/85 leading-relaxed">{req.reason}</p>
          {req.decisionNote && (
            <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-[12.5px] text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">{decisionByName ?? "Manager"}:</span> {req.decisionNote}
            </div>
          )}
          {canApprove && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onDecide("approved")}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => onDecide("declined")} className="hover:text-destructive">
                <XCircle className="h-3.5 w-3.5" />
                Decline
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ShadowDayDialog({
  internId, initial, onClose, onSave,
}: {
  internId: string;
  initial?: ShadowDayRequest;
  onClose: () => void;
  onSave: (r: ShadowDayRequest) => void;
}) {
  const [department, setDepartment] = useState<Department>(initial?.targetDepartment ?? "design");
  const [requestedDate, setRequestedDate] = useState(initial?.requestedDate ?? new Date().toISOString().slice(0, 10));
  const [half, setHalf] = useState<DayHalf>(initial?.half ?? "AM");
  const [reason, setReason] = useState(initial?.reason ?? "");

  function submit() {
    onSave({
      id: initial?.id ?? nanoid(8),
      internId,
      targetDepartment: department,
      requestedDate, half, reason: reason.trim(),
      status: initial?.status ?? "pending",
      approvedBy: initial?.approvedBy,
      decisionNote: initial?.decisionNote,
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit request" : "Request a shadow day"}</DialogTitle>
          <DialogDescription>Half a day with another team. Their manager approves.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Department</Label>
            <Select value={department} onValueChange={(v) => setDepartment(v as Department)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEPARTMENTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Date</Label>
              <Input type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Half</Label>
              <Select value={half} onValueChange={(v) => setHalf(v as DayHalf)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AM">Morning</SelectItem>
                  <SelectItem value="PM">Afternoon</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Why this team?</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What you want to learn or sit in on." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!reason.trim()} onClick={submit}>Send request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
