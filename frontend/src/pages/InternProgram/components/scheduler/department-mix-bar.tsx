import type { Department, ScheduleBlock } from "@/data";
import { DEPARTMENTS, departmentLabel, deptBgClass } from "@/data/vocabularies";
import { cn } from "@/lib/cn";

/** Stacked horizontal bar showing % of half-day blocks across
 *  departments. The "so far" variant filters to past + today; the
 *  "planned" variant uses every confirmed block in the program. */
export function DepartmentMixBar({
  blocks, label, mode = "all",
  // optional cutoff for "so far"; if omitted in "to-date" mode, uses today.
  cutoffDate,
}: {
  blocks: ScheduleBlock[];
  label: string;
  mode?: "all" | "to-date";
  cutoffDate?: string;
}) {
  const today = cutoffDate ?? new Date().toISOString().slice(0, 10);
  const considered = blocks.filter(
    (b) => b.status === "confirmed" && (mode === "all" || b.date <= today),
  );
  const total = considered.length;
  const counts = new Map<Department, number>();
  for (const b of considered) {
    counts.set(b.department, (counts.get(b.department) ?? 0) + 1);
  }
  const entries = DEPARTMENTS
    .map(({ key, label }) => ({ key, label, count: counts.get(key) ?? 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[12px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{label}</h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {total} half-day{total === 1 ? "" : "s"}
        </span>
      </div>
      {total === 0 ? (
        <div className="rounded-md card-border bg-card/50 p-4 text-center text-[12px] italic text-muted-foreground">
          Nothing scheduled in this range yet.
        </div>
      ) : (
        <>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full card-border bg-muted"
            role="img"
            aria-label={`Department mix: ${entries.map((e) => `${Math.round((e.count / total) * 100)}% ${e.label}`).join(", ")}`}
          >
            {entries.map((e) => (
              <div
                key={e.key}
                className={cn("h-full transition-[width] duration-300", deptBgClass(e.key))}
                style={{ width: `${(e.count / total) * 100}%` }}
                title={`${e.label}: ${e.count} half-days (${Math.round((e.count / total) * 100)}%)`}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
            {entries.map((e) => (
              <li key={e.key} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", deptBgClass(e.key))} />
                <span className="text-foreground">{e.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round((e.count / total) * 100)}%
                  <span className="mx-1 text-border">·</span>
                  {e.count} half-day{e.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
