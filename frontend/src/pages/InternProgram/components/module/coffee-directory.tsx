"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { format, parseISO } from "date-fns";
import { Coffee, Mail, MessageSquare, Pencil, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/module/empty-state";
import { initialsOf } from "@/lib/initials";
import { departmentLabel } from "@/data/vocabularies";
import { useRole } from "@/lib/role";
import { can, canEdit } from "@/lib/visibility";
import {
  updateFullTimerAction, upsertCoffeeChatAction, deleteCoffeeChatAction,
} from "@/app/actions";
import { cn } from "@/lib/cn";

import type { CoffeeChatRequest, FullTimer, Intern } from "@/data";

type Props = {
  fullTimers: FullTimer[];
  requests: CoffeeChatRequest[];
  interns: Intern[];                // active interns who can request
};

const STATUS_META: Record<CoffeeChatRequest["status"], {
  label: string; badge: "warning" | "success" | "destructive" | "muted";
}> = {
  pending:   { label: "Pending",   badge: "warning" },
  scheduled: { label: "Scheduled", badge: "success" },
  declined:  { label: "Declined",  badge: "destructive" },
  completed: { label: "Completed", badge: "muted" },
};

export function CoffeeDirectory({ fullTimers, requests, interns }: Props) {
  const { role } = useRole();
  const canRequest = can(role, "coffeeChatDirectory", "request");
  const canEditAll = canEdit(role, "coffeeChatDirectory") && role === "hr";
  const canEditOwn = canEdit(role, "coffeeChatDirectory") && (role === "manager" || role === "exec");

  const [list, setList] = useState<FullTimer[]>(fullTimers);
  const [chats, setChats] = useState<CoffeeChatRequest[]>(requests);
  const [pending, startTransition] = useAsyncPending();

  // Without auth, the "current actor" for edit-own is the first
  // matching role from the directory. HR can edit all; manager/exec
  // can edit their own listing — pick one to demo.
  const editableRoleSet = useMemo(() => {
    if (canEditAll) return new Set(list.map((f) => f.id));
    if (!canEditOwn) return new Set<string>();
    // Edit-own: surface a dropdown for which full-timer the user is acting as.
    return null; // sentinel; we derive from actorId
  }, [canEditAll, canEditOwn, list]);
  const candidateOwnSelf = list.filter(
    (f) => (role === "manager" && f.isManager) || (role === "exec" && f.role.toLowerCase().includes("head")),
  );
  const [actingId, setActingId] = useState<string | null>(candidateOwnSelf[0]?.id ?? null);

  function canEditId(id: string): boolean {
    if (canEditAll) return true;
    if (canEditOwn) return id === actingId;
    return false;
  }

  function commitToggle(f: FullTimer) {
    const next = { ...f, coffeeChatOptIn: !f.coffeeChatOptIn };
    setList((prev) => prev.map((p) => p.id === f.id ? next : p));
    startTransition(async () => { await updateFullTimerAction(f.id, { coffeeChatOptIn: next.coffeeChatOptIn }); });
  }
  function commitBlurb(f: FullTimer, blurb: string) {
    const next = { ...f, coffeeChatBlurb: blurb };
    setList((prev) => prev.map((p) => p.id === f.id ? next : p));
    startTransition(async () => { await updateFullTimerAction(f.id, { coffeeChatBlurb: blurb }); });
  }

  function commitRequest(r: CoffeeChatRequest) {
    setChats((prev) => {
      const idx = prev.findIndex((x) => x.id === r.id);
      if (idx === -1) return [r, ...prev];
      const out = [...prev]; out[idx] = r; return out;
    });
    startTransition(async () => { await upsertCoffeeChatAction(r); });
  }
  function commitDeleteRequest(id: string) {
    setChats((prev) => prev.filter((x) => x.id !== id));
    startTransition(async () => { await deleteCoffeeChatAction(id); });
  }

  const optedIn = list.filter((f) => f.coffeeChatOptIn).sort((a, b) => a.name.localeCompare(b.name));
  const myInternId = interns[0]?.id ?? null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight inline-flex items-center gap-2">
            <Coffee className="h-5 w-5 text-primary" />
            Coffee chats
          </h1>
          <p className="mt-1 text-[13.5px] text-muted-foreground max-w-2xl leading-relaxed">
            Full-timers who've opted in to 20-minute chats with the interns. Send a request, get
            scheduled, learn something. Listings are owned by each full-timer; HR can edit any.
          </p>
        </div>
        {canEditOwn && candidateOwnSelf.length > 0 && (
          <Select value={actingId ?? undefined} onValueChange={setActingId}>
            <SelectTrigger className="h-8 w-[220px] text-[12px]">
              <span className="text-muted-foreground mr-1">Acting as</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {candidateOwnSelf.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {pending && <span className="text-[11px] text-muted-foreground">Saving…</span>}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
          Available
          <span className="ml-1.5 normal-case tracking-normal text-[11px] tabular-nums">{optedIn.length}</span>
        </h2>
        {optedIn.length === 0 ? (
          <EmptyState
            icon={Coffee}
            title="No one's opted in yet"
            description={canEditAll
              ? "Bring people in via the off-list directory."
              : "When full-timers opt in, they'll show up here."}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {optedIn.map((f) => (
              <DirectoryCard
                key={f.id}
                ft={f}
                editable={canEditId(f.id)}
                canRequest={canRequest && !!myInternId}
                internId={myInternId}
                onToggle={() => commitToggle(f)}
                onBlurb={(blurb) => commitBlurb(f, blurb)}
                onRequest={(r) => commitRequest(r)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Off-list — full-timers who haven't opted in. HR can flip them on. */}
      {canEditAll && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
            Off-list ({list.length - optedIn.length})
          </h2>
          <ul className="rounded-lg card-border bg-card divide-y">
            {list.filter((f) => !f.coffeeChatOptIn).map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar className="h-8 w-8"><AvatarImage src={f.photoUrl} alt="" /><AvatarFallback>{initialsOf(f.name)}</AvatarFallback></Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{f.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{f.role} · {departmentLabel(f.department)}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => commitToggle(f)}>
                  <ToggleLeft className="h-3.5 w-3.5" />
                  Opt in
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">
          {canRequest ? "Your requests" : "Requests"}
        </h2>
        {chats.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No requests yet"
            description={canRequest
              ? "Pick someone above and click Request."
              : "When interns request chats they'll show here."}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {chats.map((c) => {
              const ft = list.find((x) => x.id === c.fullTimerId);
              const intern = interns.find((i) => i.id === c.internId);
              const meta = STATUS_META[c.status];
              const ownsRow = canEditId(c.fullTimerId) || (canRequest && intern?.id === myInternId);
              return (
                <li key={c.id}>
                  <Card>
                    <CardContent className="pt-4 pb-4 flex items-start gap-3">
                      <Avatar className="h-9 w-9"><AvatarImage src={ft?.photoUrl} alt="" /><AvatarFallback>{ft ? initialsOf(ft.name) : "??"}</AvatarFallback></Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-3 flex-wrap">
                          <div className="text-[13.5px]">
                            <span className="font-medium">{intern?.name ?? "Intern"}</span>
                            <span className="text-muted-foreground"> wants to chat with </span>
                            <span className="font-medium">{ft?.name ?? "?"}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={meta.badge}>{meta.label}</Badge>
                            {c.scheduledFor && (
                              <span className="text-[11px] tabular-nums text-muted-foreground">
                                {format(parseISO(c.scheduledFor), "MMM d, h:mm a")}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="mt-1 text-[13px] text-foreground/85 leading-relaxed">{c.topic}</p>
                        {ownsRow && (
                          <div className="mt-2 flex gap-2">
                            {c.status !== "scheduled" && (
                              <Button size="sm" variant="outline" onClick={() => commitRequest({ ...c, status: "scheduled" })}>
                                Mark scheduled
                              </Button>
                            )}
                            {c.status !== "completed" && (
                              <Button size="sm" variant="outline" onClick={() => commitRequest({ ...c, status: "completed" })}>
                                Mark done
                              </Button>
                            )}
                            {c.status !== "declined" && (
                              <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => commitRequest({ ...c, status: "declined" })}>
                                Decline
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="hover:text-destructive ml-auto" onClick={() => commitDeleteRequest(c.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function DirectoryCard({
  ft, editable, canRequest, internId, onToggle, onBlurb, onRequest,
}: {
  ft: FullTimer;
  editable: boolean;
  canRequest: boolean;
  internId: string | null;
  onToggle: () => void;
  onBlurb: (b: string) => void;
  onRequest: (r: CoffeeChatRequest) => void;
}) {
  return (
    <Card className="group">
      <CardContent className="pt-5 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10"><AvatarImage src={ft.photoUrl} alt="" /><AvatarFallback>{initialsOf(ft.name)}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{ft.name}</div>
            <div className="text-[12.5px] text-muted-foreground truncate">{ft.role}</div>
            <div className="text-[12px] text-muted-foreground capitalize">{departmentLabel(ft.department)}</div>
          </div>
          {editable && (
            <Button variant="ghost" size="icon" onClick={onToggle} aria-label="Opt out">
              <ToggleRight className="h-4 w-4 text-success" />
            </Button>
          )}
        </div>
        {ft.coffeeChatBlurb ? (
          <p className="text-[12.5px] text-foreground/85 leading-relaxed">{ft.coffeeChatBlurb}</p>
        ) : (
          <p className="text-[12.5px] italic text-muted-foreground">No blurb yet.</p>
        )}
        <div className="flex items-center gap-2">
          {canRequest && internId && (
            <RequestDialog
              ft={ft}
              internId={internId}
              onRequest={onRequest}
            />
          )}
          {editable && (
            <BlurbDialog blurb={ft.coffeeChatBlurb ?? ""} onSave={onBlurb} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RequestDialog({
  ft, internId, onRequest,
}: { ft: FullTimer; internId: string; onRequest: (r: CoffeeChatRequest) => void }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="primary" className="flex-1">
          <Coffee className="h-3.5 w-3.5" />
          Request chat
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Chat with {ft.name}</DialogTitle>
          <DialogDescription>20 minutes. They'll get back to you with timing.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>What would you like to chat about?</Label>
            <Textarea rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="One sentence is plenty." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!topic.trim()}
            onClick={() => {
              onRequest({
                id: nanoid(8),
                internId,
                fullTimerId: ft.id,
                topic: topic.trim(),
                status: "pending",
                createdAt: new Date().toISOString(),
              });
              setOpen(false);
              setTopic("");
            }}
          >Send request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlurbDialog({ blurb, onSave }: { blurb: string; onSave: (b: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(blurb);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(blurb); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="h-3.5 w-3.5" />
          Blurb
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit your listing</DialogTitle>
          <DialogDescription>One sentence about what an intern might want to chat about.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => { onSave(draft.trim()); setOpen(false); }}>Save blurb</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
