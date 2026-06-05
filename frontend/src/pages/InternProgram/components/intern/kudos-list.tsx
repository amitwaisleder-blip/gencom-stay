"use client";

import { useState } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { format, parseISO } from "date-fns";
import { Heart, Pencil, Sparkles, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/module/empty-state";
import { initialsOf } from "@/lib/initials";
import { useRole } from "@/lib/role";
import { can } from "@/lib/visibility";
import { ROLE_LABEL } from "@/lib/visibility";
import { postKudosAction, deleteKudosAction } from "@/app/actions";

import type { Kudos, Role } from "@/data";

export function KudosList({
  internId, internName, initial,
}: { internId: string; internName: string; initial: Kudos[] }) {
  const { role } = useRole();
  const canPost = can(role, "kudos", "post");
  const [items, setItems] = useState<Kudos[]>(initial);
  const [editing, setEditing] = useState<Kudos | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useAsyncPending();

  function commitUpsert(next: Kudos) {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === next.id);
      if (idx === -1) return [next, ...prev];
      const out = [...prev]; out[idx] = next; return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    startTransition(async () => { await postKudosAction(next); });
  }
  function commitDelete(id: string) {
    setItems((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => { await deleteKudosAction(internId, id); });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight inline-flex items-center gap-2">
            <Heart className="h-3.5 w-3.5 text-primary" />
            Kudos
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground max-w-xl">
            Public recognition. Anyone can post. Lands on {internName.split(" ")[0]}'s portfolio at the end of the program.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <span className="text-[11px] text-muted-foreground">Saving…</span>}
          {canPost && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Sparkles className="h-3.5 w-3.5" />
              Post kudos
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No kudos yet"
          description={canPost
            ? "Be the first to call out something good. One sentence is plenty — specifics travel."
            : "When teammates start posting recognition, it shows up here."}
          action={canPost ? <Button size="sm" onClick={() => setAdding(true)}><Sparkles className="h-3.5 w-3.5" />Post first kudos</Button> : undefined}
          className="py-14"
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {items.map((k) => (
            <li key={k.id}>
              <KudosCard
                kudos={k}
                canModify={canPost}
                onEdit={() => setEditing(k)}
                onDelete={() => commitDelete(k.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {(editing || adding) && (
        <KudosDialog
          internId={internId}
          internName={internName}
          role={role}
          initial={editing ?? undefined}
          onClose={() => { setEditing(null); setAdding(false); }}
          onSave={(rec) => { commitUpsert(rec); setEditing(null); setAdding(false); }}
        />
      )}
    </div>
  );
}

function KudosCard({
  kudos, canModify, onEdit, onDelete,
}: { kudos: Kudos; canModify: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <Card className="group">
      <CardContent className="pt-5 flex gap-3">
        <Avatar className="h-9 w-9"><AvatarFallback>{initialsOf(kudos.fromName)}</AvatarFallback></Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[13.5px] font-medium truncate">{kudos.fromName}</span>
              <span className="ml-2 text-[12px] text-muted-foreground">{kudos.fromRole}</span>
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
              {format(parseISO(kudos.createdAt), "MMM d")}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/90 italic">"{kudos.message}"</p>
          {canModify && (
            <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="sm" onClick={onEdit} className="h-7"><Pencil className="h-3.5 w-3.5" />Edit</Button>
              <Button variant="ghost" size="sm" onClick={onDelete} className="h-7 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" />Remove</Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function KudosDialog({
  internId, internName, role, initial, onClose, onSave,
}: {
  internId: string;
  internName: string;
  role: Role;
  initial?: Kudos;
  onClose: () => void;
  onSave: (k: Kudos) => void;
}) {
  const [fromName, setFromName] = useState(initial?.fromName ?? "");
  const [fromRole, setFromRole] = useState(initial?.fromRole ?? ROLE_LABEL[role]);
  const [message, setMessage] = useState(initial?.message ?? "");
  function submit() {
    onSave({
      id: initial?.id ?? nanoid(8),
      internId,
      fromName: fromName.trim(),
      fromRole: fromRole.trim(),
      message: message.trim(),
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit kudos" : `Post kudos to ${internName.split(" ")[0]}`}</DialogTitle>
          <DialogDescription>Specifics travel. "Saved us X" beats "great job."</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Your name</Label>
              <Input value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Your role</Label>
              <Input value={fromRole} onChange={(e) => setFromRole(e.target.value)} placeholder="Frontend engineer" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Message</Label>
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What did they do that was great?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!fromName.trim() || !message.trim()}>
            {initial ? "Save" : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
