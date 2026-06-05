import { Link, Outlet, useParams } from "react-router-dom";
import { UserSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/module/empty-state";
import { ProfileHeaderShell } from "@/components/intern/profile-header-shell";
import { InternTabNav } from "@/components/intern/intern-tab-nav";
import { getStore } from "@/data";

import { useStoreData } from "./loader-helpers";

/** Shared shell for every per-intern route. Loads the intern record
 *  once, renders the page header + tab nav, then mounts <Outlet /> for
 *  the active sub-route. */
export default function InternLayout() {
  const { id } = useParams<{ id: string }>();
  const { data: intern, loading } = useStoreData(
    () => id ? getStore().getIntern(id) : Promise.resolve(null),
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="flex-1 flex flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  if (!intern) {
    return (
      <EmptyState
        icon={UserSearch}
        title="Intern not found"
        description="The link may be stale, or this intern was removed."
        action={
          <Button asChild>
            <Link to="/intern-program">Back to interns</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ProfileHeaderShell intern={intern} />
      <InternTabNav internId={intern.id} />
      <div className="pt-1">
        <Outlet />
      </div>
    </div>
  );
}
