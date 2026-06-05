"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { Trash2 } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import type { DayHalf, Department, FullTimer, ScheduleBlock } from "@/data";
import { DEPARTMENTS, departmentLabel } from "@/data/vocabularies";
import {
  deleteScheduleBlockAction, proposeScheduleChangeAction, upsertScheduleBlockAction,
} from "@/app/actions";
import { useRole } from "@/lib/role";
import { canEdit, can } from "@/lib/visibility";

export type BlockEditorContext = {
  internId: string;
  date: string;       // YYYY-MM-DD
  half: DayHalf;
  block?: ScheduleBlock;
};

export function BlockEditor({
  ctx, managers, children, onSaved,
}: {
  ctx: BlockEditorContext;
  managers: FullTimer[];
  children: ReactNode;
  onSaved?: () => void;
}) {
  const { role } = useRole();
  const editable = canEdit(role, "scheduler");
  const canPropose = can(role, "scheduler", "request");
  const open = useDialogState();

  const [project, setProject] = useState(ctx.block?.projectName ?? "");
  const [department, setDepartment] = useState<Department>(ctx.block?.department ?? DEPARTMENTS[0].key);
  const [managerId, setManagerId] = useState(ctx.block?.managerId ?? managers[0]?.id ?? "");
  const [notes, setNotes] = useState(ctx.block?.notes ?? "");
  const [pending, startTransition] = useAsyncPending();

  // Reset form when the dialog opens for a different cell.
  useEffect(() => {
    setProject(ctx.block?.projectName ?? "");
    setDepartment(ctx.block?.department ?? DEPARTMENTS[0].key);
    setManagerId(ctx.block?.managerId ?? managers[0]?.id ?? "");
    setNotes(ctx.block?.notes ?? "");
  }, [ctx.block?.id, ctx.date, ctx.half, managers]);

  const isProposed = ctx.block?.status === "proposed";

  async function save(asProposal: boolean) {
    startTransition(async () => {
      if (asProposal && ctx.block) {
        await proposeScheduleChangeAction(ctx.block.id, {
          internId: ctx.internId,
          date: ctx.date, half: ctx.half,
          projectName: project.trim(), department, managerId,
          notes: notes.trim() || undefined,
        });
      } else {
        await upsertScheduleBlockAction({
          id: ctx.block?.id ?? "",
          internId: ctx.internId,
          date: ctx.date, half: ctx.half,
          projectName: project.trim(), department, managerId,
          notes: notes.trim() || undefined,
          status: "confirmed",
        });
      }
      open.set(false);
      onSaved?.();
    });
  }

  async function remove() {
    if (!ctx.block) return;
    startTransition(async () => {
      await deleteScheduleBlockAction(ctx.internId, ctx.block!.id);
      open.set(false);
      onSaved?.();
    });
  }

  return (
    <Dialog open={open.value} onOpenChange={open.set}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {ctx.block ? (editable ? "Edit block" : "Proposed change") : (editable ? "Add block" : "Propose block")}
          </DialogTitle>
          <DialogDescription>
            {prettyDate(ctx.date)} · {ctx.half === "AM" ? "Morning" : "Afternoon"}
            {isProposed && <span className="ml-1.5 text-[hsl(36_95%_30%)]">· proposed by intern</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Project</Label>
            <Input value={project} onChange={(e) => setProject(e.target.value)} disabled={!(editable || canPropose)} placeholder="Internal tooling sprint" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Department</Label>
              <Select value={department} onValueChange={(v) => setDepartment(v as Department)} disabled={!(editable || canPropose)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Supervising manager</Label>
              <Select value={managerId} onValueChange={setManagerId} disabled={!(editable || canPropose)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} — {departmentLabel(m.department)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes (optional)</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!(editable || canPropose)} />
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between !justify-between gap-2">
          <div>
            {ctx.block && editable && (
              <Button variant="ghost" size="sm" onClick={remove} disabled={pending} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => open.set(false)} disabled={pending}>Cancel</Button>
            {editable && (
              <Button onClick={() => save(false)} disabled={pending || !project.trim()}>
                {pending ? "Saving…" : ctx.block ? "Save block" : "Add block"}
              </Button>
            )}
            {!editable && canPropose && ctx.block && (
              <Button onClick={() => save(true)} disabled={pending || !project.trim()}>
                {pending ? "Sending…" : "Propose change"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useDialogState() {
  const [v, set] = useState(false);
  return { value: v, set };
}

function prettyDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
