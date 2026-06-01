import { cn } from "@/lib/cn";
import type { Proficiency } from "@/data";
import { PROFICIENCY_DOTS, PROFICIENCY_LABEL } from "@/data/vocabularies";

export function ProficiencyDots({ value, className }: { value: Proficiency; className?: string }) {
  const filled = PROFICIENCY_DOTS[value];
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      title={PROFICIENCY_LABEL[value]}
      aria-label={PROFICIENCY_LABEL[value]}
    >
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            "block h-1.5 w-1.5 rounded-full",
            n <= filled ? "bg-foreground" : "bg-border",
          )}
        />
      ))}
    </span>
  );
}
