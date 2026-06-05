"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useAsyncPending } from "@/lib/use-async-pending";
import { CheckCircle2, X } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { initialsOf } from "@/lib/initials";
import { departmentLabel } from "@/data/vocabularies";
import { setMentorAction } from "@/app/actions";
import { cn } from "@/lib/cn";

import type { FullTimer } from "@/data";

export function AssignMentorDialog({
  internId, currentId, candidates, children,
}: {
  internId: string;
  currentId: string | null;
  candidates: FullTimer[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useAsyncPending();

  // Eligible mentors: non-managers who've opted in via isMentorAvailable.
  // Spec: "assign one non-manager mentor". Managers are excluded.
  const eligible = useMemo(
    () => candidates.filter((c) => !c.isManager && c.isMentorAvailable),
    [candidates],
  );
  const visible = filter
    ? eligible.filter((c) =>
        (c.name + " " + c.role + " " + c.department).toLowerCase().includes(filter.toLowerCase()),
      )
    : eligible;

  function pick(id: string | null) {
    startTransition(async () => {
      await setMentorAction(internId, id);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign mentor</DialogTitle>
          <DialogDescription>
            One non-manager mentor per intern. Pulled from full-timers who opted into mentoring.
          </DialogDescription>
        </DialogHeader>

        <Input placeholder="Filter by name, role, or department…" value={filter} onChange={(e) => setFilter(e.target.value)} />

        <ul className="flex flex-col gap-1 max-h-[360px] overflow-y-auto pr-1">
          {visible.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12.5px] italic text-muted-foreground">
              No matching mentors.
            </li>
          ) : visible.map((c) => {
            const isCurrent = c.id === currentId;
            return (
              <li
                key={c.id}
                className={cn(
                  "flex items-center gap-3 rounded-md p-2.5 hover:bg-muted/60 cursor-pointer",
                  isCurrent && "bg-primary/[0.05] ring-1 ring-primary/40",
                )}
                onClick={() => pick(c.id)}
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage src={c.photoUrl} alt="" />
                  <AvatarFallback>{initialsOf(c.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{c.name}</div>
                  <div className="text-[12px] text-muted-foreground truncate">
                    {c.role} · {departmentLabel(c.department)}
                  </div>
                </div>
                {isCurrent && <Badge variant="accent"><CheckCircle2 className="h-3 w-3" />Current</Badge>}
              </li>
            );
          })}
        </ul>

        <DialogFooter className="!justify-between">
          <Button variant="ghost" onClick={() => pick(null)} disabled={pending || !currentId} className="text-muted-foreground">
            <X className="h-3.5 w-3.5" />
            Unassign
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
