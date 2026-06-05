"use client";

import { Pencil, UserCircle2, UserPlus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { initialsOf } from "@/lib/initials";
import { useRole } from "@/lib/role";
import { canEdit } from "@/lib/visibility";
import { AssignMentorDialog } from "./assign-mentor-dialog";

import type { FullTimer } from "@/data";

export function MentorCard({
  internId, mentor, candidates,
}: {
  internId: string;
  mentor: FullTimer | null;
  candidates: FullTimer[];
}) {
  const { role } = useRole();
  // Demo: every role can assign mentors so the button is reachable
  // without flipping the role switcher first. The earlier `canEdit`
  // gate was hiding the affordance entirely from the default
  // "intern" viewpoint.
  void role;
  const hrCanAssign = true;
  void canEdit;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <UserCircle2 className="h-3.5 w-3.5 text-primary" />
          Mentor
        </CardTitle>
        {hrCanAssign && (
          <AssignMentorDialog internId={internId} currentId={mentor?.id ?? null} candidates={candidates}>
            <Button variant="ghost" size="sm" className="h-7">
              {mentor ? <><Pencil className="h-3 w-3" />Reassign</> : <><UserPlus className="h-3 w-3" />Assign</>}
            </Button>
          </AssignMentorDialog>
        )}
      </CardHeader>
      <CardContent>
        {mentor ? (
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={mentor.photoUrl} alt="" />
              <AvatarFallback>{initialsOf(mentor.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="font-medium truncate">{mentor.name}</div>
              <div className="text-[12.5px] text-muted-foreground truncate">{mentor.role}</div>
              <div className="text-[12px] text-muted-foreground capitalize">{mentor.department}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-md card-border bg-card/50 p-3 text-center">
            <p className="text-[12.5px] text-muted-foreground">
              No mentor assigned yet.
              {hrCanAssign && " Pick someone from the directory above."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
