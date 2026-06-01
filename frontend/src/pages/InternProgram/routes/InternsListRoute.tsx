import { useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ArrowUpRight, ChevronDown, UserPlus, Users } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/module/empty-state";
import { PageSection } from "@/components/module/page-section";
import { getStore, type Intern } from "@/data";
import { initialsOf } from "@/lib/initials";
import { fromISO } from "@/lib/dates";
import { cn } from "@/lib/cn";

import { AddInternDialog } from "../components/intern/add-intern-dialog";
import { InternCardActions } from "../components/intern/intern-card-actions";
import { useStoreData } from "./loader-helpers";

export default function InternsListRoute() {
  const { data: interns, loading, reload } = useStoreData(() => getStore().listInterns());
  const [archiveOpen, setArchiveOpen] = useState(false);

  if (loading) return <InternsListSkeleton />;
  const list: Intern[] = interns ?? [];
  const active = list.filter((i) => i.status === "active");
  const past = list.filter((i) => i.status === "completed");

  return (
    <div className="flex flex-col gap-5 pb-12">
      {/* Compact header — matches the ROM Capex Budget chrome: small
          eyebrow, ~22px title, no hero block, primary action pinned
          right. The earlier 38px display + gold-rule were taking up
          too much vertical space without earning it. */}
      <header className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b border-gencom-sand">
        <div className="flex items-baseline gap-3 flex-wrap min-w-0">
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gencom-gold">
            Intern Program
          </span>
          <h1 className="text-[18px] font-bold tracking-tight text-gencom-ink truncate">
            {active.length > 0
              ? `${active.length} active intern${active.length === 1 ? "" : "s"}`
              : "No active interns"}
            {past.length > 0 && (
              <span className="text-gencom-stone font-normal text-[13px]"> · {past.length} past</span>
            )}
          </h1>
        </div>
        <AddInternDialog onAdded={reload} />
      </header>

      {/* Active grid — direct, no sub-section header. Tiles already
          carry their own metadata. Empty state lives inline. */}
      {active.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No active interns"
          description="Add the first intern — you can upload a resume to auto-fill their profile."
          action={
            <AddInternDialog onAdded={reload}>
              <Button>
                <UserPlus className="mr-1.5 h-4 w-4" />
                Add intern
              </Button>
            </AddInternDialog>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {active.map((i) => <InternCard key={i.id} intern={i} onChanged={reload} />)}
        </div>
      )}

      {past.length > 0 && (
        <ArchiveSection
          past={past}
          open={archiveOpen}
          onToggle={() => setArchiveOpen((o) => !o)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

/** Past-intern archive — collapsed by default, expands to a grid of
 *  cards on click. The collapsed row reads as a single tappable bar
 *  with the count + a chevron, matching the calm Gencom rhythm. */
function ArchiveSection({
  past, open, onToggle, onChanged,
}: { past: Intern[]; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const empty = past.length === 0;
  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onToggle}
        disabled={empty}
        aria-expanded={open}
        className={cn(
          "group flex items-center justify-between gap-3 w-full",
          "rounded-md border border-gencom-sand bg-white px-3 py-2 text-left",
          "transition-colors",
          empty ? "opacity-60 cursor-default" : "hover:bg-gencom-mist/50",
        )}
      >
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gencom-gold">
            Archive
          </span>
          <span className="text-[13px] font-semibold tracking-tight">
            {`${past.length} past intern${past.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-semibold text-gencom-stone group-hover:text-gencom-ink shrink-0">
          {open ? "Hide" : "Show"}
          <ChevronDown
            className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open && !empty && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 animate-fade-in">
          {past.map((i) => <InternCard key={i.id} intern={i} onChanged={onChanged} />)}
        </div>
      )}
    </section>
  );
}

function InternCard({ intern, onChanged }: { intern: Intern; onChanged: () => void }) {
  const start = format(fromISO(intern.programStart), "MMM yyyy");
  const end = format(fromISO(intern.programEnd), "MMM yyyy");
  return (
    <div className="relative group">
      {/* Card-level actions pinned top-right; layered above the Link
          so clicking them doesn't navigate into the intern's profile. */}
      <div className="absolute top-2 right-2 z-10">
        <InternCardActions
          internId={intern.id}
          internName={intern.name}
          resumeFile={intern.resumeFile}
          onChanged={onChanged}
        />
      </div>
      <Link to={`/intern-program/${intern.id}`} className="block">
        <Card className="p-3 border-gencom-sand group-hover:border-gencom-stone group-hover:shadow-sm transition">
          <div className="flex items-start gap-3">
            <Avatar className="h-10 w-10 ring-1 ring-gencom-sand shrink-0">
              <AvatarImage src={intern.photoUrl} alt="" />
              <AvatarFallback className="text-[12px] font-medium">{initialsOf(intern.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 flex flex-col gap-1 pr-20">
              <div className="flex items-center gap-2">
                <div className="font-semibold tracking-tight truncate text-[13.5px] text-gencom-ink">{intern.name}</div>
                {intern.status === "active" ? (
                  <Badge variant="success">Active</Badge>
                ) : (
                  <Badge variant="muted">Done</Badge>
                )}
              </div>
              <div className="text-[12px] text-gencom-stone truncate">{intern.school}</div>
              {intern.resumeFile && (
                <div className="text-[11px] text-gencom-stone inline-flex items-center gap-1 truncate" title={intern.resumeFile.name}>
                  <span aria-hidden>📄</span>
                  <span className="text-gencom-ink truncate">{intern.resumeFile.name}</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-gencom-sand/70 flex items-center justify-between gap-2">
            <span className="text-[11px] text-gencom-stone tabular-nums">
              {start} — {end}
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 text-gencom-stone/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-gencom-ink" />
          </div>
        </Card>
      </Link>
    </div>
  );
}

function InternsListSkeleton() {
  return (
    <div className="flex flex-col gap-16 pb-16">
      <div className="flex flex-col gap-3 max-w-3xl">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-12 w-full max-w-xl" />
        <Skeleton className="h-4 w-[80%]" />
      </div>
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-56" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl bg-card p-6 flex gap-4 shadow-[0_0_0_1px_rgba(15,23,42,0.04),0_1px_2px_rgba(15,23,42,0.04)]">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="flex-1 flex flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-44" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
