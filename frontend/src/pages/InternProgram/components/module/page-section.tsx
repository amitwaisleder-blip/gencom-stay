import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function PageSection({
  title, description, action, children, className, eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Tracked-out small caps above the title. Rendered in gold to match
   *  the ROM CAPEX section-eyebrow treatment. */
  eyebrow?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-5", className)}>
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {eyebrow && (
            <div className="text-[10.5px] uppercase tracking-[0.2em] font-semibold text-accent mb-2">
              {eyebrow}
            </div>
          )}
          <h2 className="text-[22px] font-bold tracking-tight leading-tight">{title}</h2>
          {description && (
            <p className="mt-2 text-[13.5px] text-muted-foreground leading-relaxed max-w-2xl">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}
