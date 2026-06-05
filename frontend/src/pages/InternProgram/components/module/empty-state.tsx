import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";

export function EmptyState({
  icon: Icon, title, description, action, className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center px-6 py-10 rounded-lg card-border bg-card/40", className)}>
      {Icon && (
        <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div className="text-[14px] font-medium text-foreground">{title}</div>
      {description && (
        <p className="mt-1 max-w-md text-[13px] text-muted-foreground leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Small inline placeholder used for unbuilt features. Communicates
 *  "coming in a later phase" honestly without crashing the layout. */
export function ComingSoonCard({
  feature, phase, className,
}: { feature: string; phase: 2 | 3 | 4; className?: string }) {
  return (
    <div className={cn("rounded-lg card-border bg-card/40 p-5", className)}>
      <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
        Phase {phase}
      </div>
      <div className="mt-1 text-[14px] font-medium">{feature}</div>
      <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed">
        Will land after Phase 1 review. Data is already seeded — flip the switch when the UI ships.
      </p>
    </div>
  );
}
