"use client";

import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { useRole } from "@/lib/role";
import { canView } from "@/lib/visibility";
import { EmptyState } from "@/components/module/empty-state";

import type { Feature } from "@/lib/visibility";

/** Client-side route gate. Renders children only if the active role
 *  has `view` access to the feature; otherwise an "access denied"
 *  empty state. The role is URL-driven (`?as=…`) so we can't gate at
 *  the server layout cleanly without parsing search params there too —
 *  this client gate is the simpler, equivalent guard for demo mode. */
export function FeatureRoleGate({
  feature, children,
}: { feature: Feature; children: ReactNode }) {
  const { role } = useRole();
  if (canView(role, feature)) return <>{children}</>;
  return (
    <EmptyState
      icon={Lock}
      title="Not visible to interns"
      description="This pulse is private to managers, HR, and execs by design — it's how we keep weekly feedback honest. Switch viewpoints in the top-right to see it."
      className="py-14"
    />
  );
}
