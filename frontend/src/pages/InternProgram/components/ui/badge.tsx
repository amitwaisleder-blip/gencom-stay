import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
  {
    variants: {
      variant: {
        default:    "bg-secondary text-secondary-foreground",
        outline:    "card-border text-foreground",
        muted:      "bg-muted text-muted-foreground",
        accent:     "bg-primary/10 text-primary",
        success:    "bg-success/10 text-success",
        warning:    "bg-warning/15 text-[hsl(36_95%_30%)]",
        destructive:"bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
