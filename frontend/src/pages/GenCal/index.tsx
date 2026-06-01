// GenCal — company-wide calendar (Phase 1: view-only with seed data).
//
// Layered styling: react-big-calendar provides the grid + navigation;
// we layer Gencom-luxury overrides on top via ./styles.css. Categories
// are color-coded from categories.ts, and a filter strip at the top of
// the page lets employees toggle categories on/off.

import { useEffect, useMemo, useState } from "react";
import {
  Calendar, dateFnsLocalizer, type View,
} from "react-big-calendar";
import { addDays, endOfMonth, format, getDay, parse, startOfMonth, startOfWeek } from "date-fns";
import { enUS } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "./styles.css";

import {
  CATEGORY_ORDER, CATEGORY_STYLES, type GenCalCategory,
} from "./categories";
import { deleteEvent, listEvents, runSeed, type GenCalEvent } from "./api";
import EventDetail from "./EventDetail";
import EventEditor, { type EventEditorInitial } from "./EventEditor";


const locales = { "en-US": enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });


// What react-big-calendar wants as an event shape.
type RbcEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: GenCalEvent;
};


export default function GenCal() {
  const [view, setView] = useState<View>("month");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<GenCalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategories, setActiveCategories] = useState<Set<GenCalCategory>>(
    () => new Set(CATEGORY_ORDER),
  );
  const [selected, setSelected] = useState<GenCalEvent | null>(null);
  const [editor, setEditor] = useState<EventEditorInitial | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { type: "event"; event: GenCalEvent; x: number; y: number }
    | { type: "day"; date: Date; x: number; y: number }
    | null
  >(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // On first mount, kick an idempotent seed so a fresh install has data.
  useEffect(() => {
    runSeed();
  }, []);

  // Fetch a generous window around the visible month so view-switching
  // doesn't trigger a refetch storm. refreshTick forces a refetch after
  // any edit, delete, or import flow saves.
  useEffect(() => {
    const start = addDays(startOfMonth(currentDate), -45);
    const end = addDays(endOfMonth(currentDate), 45);
    setLoading(true);
    listEvents(start.toISOString(), end.toISOString())
      .then(setEvents)
      .finally(() => setLoading(false));
  }, [currentDate, refreshTick]);

  // Global click closes any open context menu.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  function onSavedOrDeleted() {
    setEditor(null);
    setRefreshTick((n) => n + 1);
  }

  async function onDelete(e: GenCalEvent) {
    if (e.locked) { alert("Locked events can't be deleted from here."); return; }
    if (!confirm(`Delete "${e.title}"?`)) return;
    try {
      await deleteEvent(e.id);
      onSavedOrDeleted();
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
    }
  }

  const filtered: RbcEvent[] = useMemo(() => {
    return events
      .filter((e) => activeCategories.has(e.category))
      .map((e) => ({
        id: e.id,
        title: e.title,
        start: new Date(e.start_at),
        end: new Date(e.end_at),
        allDay: e.all_day,
        resource: e,
      }));
  }, [events, activeCategories]);

  function toggleCategory(c: GenCalCategory) {
    setActiveCategories((cur) => {
      const next = new Set(cur);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  }

  return (
    <div className="-mx-6 -my-8 min-h-[calc(100vh-100px)] bg-[#faf7f1] text-[#1a1d24]">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <Header
          view={view} onView={setView} loading={loading}
          onEditData={() => setEditor({})}
        />

        <CategoryFilter active={activeCategories} onToggle={toggleCategory} />

        <div className="mt-6 bg-white rounded-lg border border-[#ece6d7] p-2 md:p-4 gencal-shell">
          <Calendar
            localizer={localizer}
            events={filtered}
            view={view}
            onView={setView}
            date={currentDate}
            onNavigate={setCurrentDate}
            views={["month", "week", "agenda"]}
            popup
            style={{ height: 720 }}
            eventPropGetter={(event) => {
              const cat = (event as RbcEvent).resource.category;
              const style = CATEGORY_STYLES[cat];
              return {
                style: {
                  backgroundColor: style.bg,
                  color: style.fg,
                  borderRadius: 4,
                  border: "none",
                  padding: "2px 6px",
                  fontSize: 12,
                },
              };
            }}
            onSelectEvent={(event) => setSelected((event as RbcEvent).resource)}
            selectable
            onSelectSlot={({ start, action }) => {
              // Click on empty slot → open editor for a new event starting
              // on that day. react-big-calendar's `action` field is "click"
              // when selecting a single cell in month view.
              if (action === "click" || action === "select" || action === "doubleClick") {
                const d = new Date(start);
                d.setHours(9, 0, 0, 0);
                const end = new Date(d); end.setHours(10, 0, 0, 0);
                setEditor({
                  start_at: d.toISOString(),
                  end_at: end.toISOString(),
                  all_day: false,
                });
              }
            }}
            components={{
              // Wrap the event chip so right-click opens the context menu.
              event: ({ event, title }) => {
                const resource = (event as RbcEvent).resource;
                return (
                  <div
                    onContextMenu={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      setContextMenu({ type: "event", event: resource, x: e.clientX, y: e.clientY });
                    }}
                  >
                    {title}
                  </div>
                );
              },
              // Wrap empty date cells so right-click on a day opens a menu.
              dateCellWrapper: ({ value, children }: { value: Date; children: React.ReactNode }) => (
                <div
                  className="rbc-day-bg"
                  style={{ display: "contents" }}
                  onContextMenu={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setContextMenu({ type: "day", date: value, x: e.clientX, y: e.clientY });
                  }}
                >
                  {children}
                </div>
              ),
            }}
            formats={{
              monthHeaderFormat: (d: Date) => format(d, "LLLL yyyy"),
              dayHeaderFormat: (d: Date) => format(d, "EEEE, MMMM d"),
              dayRangeHeaderFormat: ({ start, end }) =>
                `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`,
            }}
            messages={{
              today: "Today",
              previous: "‹",
              next: "›",
              month: "Month",
              week: "Week",
              agenda: "Agenda",
              noEventsInRange: "No events in this window.",
            }}
          />
        </div>

        {selected && <EventDetail event={selected} onClose={() => setSelected(null)} />}

        {editor && (
          <EventEditor
            initialEvent={editor}
            lockedNote={editor.id && events.find((e) => e.id === editor.id)?.locked
              ? "This event is locked (preloaded holiday or auto-generated). It can be viewed but not edited from the calendar."
              : undefined}
            onClose={() => setEditor(null)}
            onSaved={onSavedOrDeleted}
          />
        )}

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x} y={contextMenu.y}
            items={
              contextMenu.type === "event"
                ? [
                    {
                      label: "Edit event",
                      disabled: contextMenu.event.locked,
                      onClick: () => setEditor({
                        id: contextMenu.event.id,
                        title: contextMenu.event.title,
                        category: contextMenu.event.category,
                        start_at: contextMenu.event.start_at,
                        end_at: contextMenu.event.end_at,
                        all_day: contextMenu.event.all_day,
                        location: contextMenu.event.location,
                        description: contextMenu.event.description,
                        extras: contextMenu.event.extras,
                      }),
                    },
                    { label: "Open details", onClick: () => setSelected(contextMenu.event) },
                    { label: "Delete", destructive: true, disabled: contextMenu.event.locked, onClick: () => onDelete(contextMenu.event) },
                  ]
                : [
                    {
                      label: "Add event manually",
                      onClick: () => {
                        const d = new Date(contextMenu.date); d.setHours(9, 0, 0, 0);
                        const end = new Date(d); end.setHours(10, 0, 0, 0);
                        setEditor({ start_at: d.toISOString(), end_at: end.toISOString(), all_day: false });
                      },
                    },
                    {
                      label: "Add from Excel or PDF…",
                      onClick: () => setEditor({}),
                    },
                  ]
            }
          />
        )}

        <Footer />
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Lightweight context menu positioned at cursor. Closes on outside click
// or Escape via the useEffect in GenCal.
// ------------------------------------------------------------
type CtxItem = { label: string; onClick: () => void; destructive?: boolean; disabled?: boolean };

function ContextMenu({ x, y, items }: { x: number; y: number; items: CtxItem[] }) {
  return (
    <div
      className="fixed z-50 min-w-[180px] rounded-md border border-[#ece6d7] bg-white shadow-xl py-1"
      style={{ left: x + 2, top: y + 2 }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          onClick={() => { if (!it.disabled) { it.onClick(); } }}
          disabled={it.disabled}
          className="block w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#faf7f1] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ color: it.destructive ? "#9b2226" : "#1a1d24" }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}


// ------------------------------------------------------------
// Header — luxury title block + Edit Data button + view switcher.
// ------------------------------------------------------------
function Header({
  view, onView, loading, onEditData,
}: { view: View; onView: (v: View) => void; loading: boolean; onEditData: () => void }) {
  return (
    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">
          GenCal
        </div>
        <h1 className="font-serif-display text-4xl md:text-5xl leading-tight mt-2 text-[#1a1d24]">
          Company Calendar
        </h1>
        <p className="text-[14px] leading-relaxed text-[#6b6f78] max-w-xl mt-2">
          Gencom's single source of truth for company-wide dates, events, and milestones.
          {loading && <span className="ml-2 italic text-[#a09c93]">loading…</span>}
        </p>
        <div className="mt-4 h-px w-16 bg-[#b89555]" />
      </div>

      <div className="flex items-center gap-3 shrink-0 self-start md:self-end">
        <button
          onClick={onEditData}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-semibold text-white transition"
          style={{ background: "#1a1d24" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2e38")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#1a1d24")}
          title="Add an event manually or import from Excel / PDF"
        >
          <span className="text-base leading-none">＋</span>
          <span>Edit Data</span>
        </button>

        <div className="inline-flex rounded-md overflow-hidden border border-[#d9d4c8] bg-white">
          {(["month", "week", "agenda"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onView(v)}
              className="px-4 py-2 text-[12px] uppercase tracking-[0.14em] font-semibold transition"
              style={
                view === v
                  ? { background: "#1a1d24", color: "#ffffff" }
                  : { background: "#ffffff", color: "#6b6f78" }
              }
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}


// ------------------------------------------------------------
// Category filter — toggle chips colored by category style.
// ------------------------------------------------------------
function CategoryFilter({
  active, onToggle,
}: { active: Set<GenCalCategory>; onToggle: (c: GenCalCategory) => void }) {
  return (
    <div className="mt-8 flex flex-wrap gap-2">
      {CATEGORY_ORDER.map((c) => {
        const s = CATEGORY_STYLES[c];
        const on = active.has(c);
        return (
          <button
            key={c}
            onClick={() => onToggle(c)}
            className="px-3 py-1.5 rounded-full text-[12px] font-semibold transition"
            style={
              on
                ? { background: s.bg, color: s.fg, border: `1px solid ${s.accent}` }
                : { background: "transparent", color: s.accent, border: `1px solid ${s.accent}`, opacity: 0.55 }
            }
            title={s.blurb}
          >
            <span className="mr-1.5 inline-block w-2 h-2 rounded-full align-middle" style={{ background: on ? s.fg : s.accent }} />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}


// ------------------------------------------------------------
// Footer — small explainer + next-phase copy.
// ------------------------------------------------------------
function Footer() {
  return (
    <div className="mt-8 text-[12px] text-[#6b6f78] leading-relaxed max-w-2xl">
      <div className="font-semibold text-[#1a1d24] mb-1">Phase 1 · View-only</div>
      The HSHR 2026 holiday schedule is preloaded and locked. Sample parties, board meetings, and property milestones
      are included so the full flow renders end-to-end. Event creation for admins, RSVP tracking, Microsoft Entra SSO,
      and .ics / webcal integration come in subsequent phases.
    </div>
  );
}
