import * as React from "react";

import { cn } from "@/lib/cn";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // Floating-card silhouette lifted from ROM CAPEX: white surface
        // on warm cream, single hairline in gencom.sand, a calm shadow
        // that gives just enough lift. Hover deepens the shadow without
        // moving the card — Gencom prefers stillness over kinetics.
        "rounded-lg bg-card text-card-foreground card-border",
        "shadow-[0_1px_2px_rgba(26,29,36,0.04),0_4px_12px_rgba(26,29,36,0.04)]",
        "transition-shadow duration-200 ease-out",
        "hover:shadow-[0_1px_2px_rgba(26,29,36,0.05),0_8px_24px_rgba(26,29,36,0.06)]",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1 px-6 pt-6 pb-4", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-[15px] font-semibold leading-tight tracking-tight", className)} {...p} />
);
export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-[13px] text-muted-foreground leading-relaxed", className)} {...p} />
);
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("px-6 pb-6", className)} {...p} />
);
export const CardFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-center gap-2 px-6 pb-6 pt-2", className)} {...p} />
);
