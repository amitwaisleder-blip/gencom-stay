// Lunch Menu — v1 page. Four views stacked in tabs:
//   History   — past menus, one card per day, newest first.
//   Metrics   — top items, by-day-of-week breakout, totals.
//   Favorites — every unique dish ever served; tap to favorite.
//   Predict   — next five weekdays' most-likely menu by weekday rotation.
//
// An Edit Data button in the header opens a modal with Manual / Excel /
// PDF import flows that share the same preview → save pattern used
// elsewhere in the Gencom internal apps.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  bulkUpsert, companyFavorites, deleteMenu, explainPrediction, FAVORITES_LIMIT,
  getForecast, getMetrics, getPrediction, importEmail, listFavorites, listItems, listMenus,
  reorderFavorite, setFavoriteRanks, toggleFavorite, upsertMenu,
  type CompanyFavorite, type FavoriteEntry, type Forecast, type ForecastDay,
  type ForecastFactor, type LunchItem, type LunchMenuRow, type LunchMetrics,
  type LunchPrediction,
} from "./api";
import {
  ROLE_CATEGORIES, buildRoleByName, classifyMenu, specialDayKind,
  type StructuralRole,
} from "./classifyMenu";
import {
  WEEKDAY_HEADINGS, buildMonthGrid, formatYearMonth, monthLabel,
  parseYearMonth, shiftMonth,
} from "./calendarGrid";


type Tab = "history" | "metrics" | "favorites" | "predict";


export default function LunchMenu() {
  const [tab, setTab] = useState<Tab>("history");
  const [menus, setMenus] = useState<LunchMenuRow[]>([]);
  const [metrics, setMetrics] = useState<LunchMetrics | null>(null);
  const [items, setItems] = useState<LunchItem[]>([]);
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [favoriteToast, setFavoriteToast] = useState<string | null>(null);

  // Set of favorited keys derived from the rank list — used by Predict
  // and any other view that just needs "is this dish favorited?".
  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => f.item_key)),
    [favorites],
  );

  useEffect(() => {
    setLoading(true);
    // Prediction loads inside PredictView per selected month — we only
    // fetch the shared history + metadata here.
    Promise.all([
      listMenus(),
      getMetrics(),
      listItems(),
      listFavorites(),
    ]).then(([m, mx, it, fav]) => {
      setMenus(m); setMetrics(mx); setItems(it);
      setFavorites(fav);
    }).finally(() => setLoading(false));
  }, [refreshTick]);

  async function refreshFavorites() {
    setFavorites(await listFavorites());
  }

  async function onFavoriteToggle(key: string) {
    const res = await toggleFavorite(key);
    if (res === "full") {
      setFavoriteToast(`Top ${FAVORITES_LIMIT} is full — remove one before adding another.`);
      setTimeout(() => setFavoriteToast(null), 3500);
      return;
    }
    await refreshFavorites();
  }

  async function onFavoriteReorder(key: string, dir: "up" | "down") {
    await reorderFavorite(key, dir);
    await refreshFavorites();
  }

  async function onFavoriteSetRanks(orderedKeys: string[]) {
    await setFavoriteRanks(orderedKeys);
    await refreshFavorites();
  }

  return (
    <div className="-mx-6 -my-8 min-h-[calc(100vh-100px)] bg-[#faf7f1] text-[#1a1d24]">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <Header onEditData={() => setEditorOpen(true)} />

        <TabBar tab={tab} onChange={setTab} />

        <div className="mt-6">
          {loading && <div className="text-[13px] text-[#6b6f78]">Loading…</div>}
          {!loading && tab === "history" && (
            <HistoryView menus={menus} onChanged={() => setRefreshTick((n) => n + 1)} />
          )}
          {!loading && tab === "metrics" && <MetricsView metrics={metrics} menus={menus} />}
          {!loading && tab === "favorites" && (
            <FavoritesView
              items={items}
              menus={menus}
              favorites={favorites}
              onToggle={onFavoriteToggle}
              onReorder={onFavoriteReorder}
              onSetRanks={onFavoriteSetRanks}
            />
          )}
          {!loading && tab === "predict" && (
            <PredictView favorites={favoriteKeys} items={items} menus={menus} refreshTick={refreshTick} />
          )}
        </div>

        {favoriteToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-md bg-[#1a1d24] text-white text-[12px] shadow-lg">
            {favoriteToast}
          </div>
        )}
      </div>

      {editorOpen && (
        <EditDataModal
          onClose={() => setEditorOpen(false)}
          onSaved={() => { setEditorOpen(false); setRefreshTick((n) => n + 1); }}
        />
      )}
    </div>
  );
}


// ------------------------------------------------------------
// Header + tabs
// ------------------------------------------------------------
function Header({ onEditData }: { onEditData: () => void }) {
  return (
    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">Gencom</div>
        <h1 className="font-serif-display text-4xl md:text-5xl leading-tight mt-2">Lunch Menu</h1>
        <p className="text-[14px] leading-relaxed text-[#6b6f78] max-w-xl mt-2">
          Track what the office serves, spot rotation patterns, mark favorites,
          and see a best-guess of next week's menu before the kitchen tells you.
        </p>
        <div className="mt-4 h-px w-16 bg-[#b89555]" />
      </div>
      <button
        onClick={onEditData}
        className="shrink-0 self-start md:self-end inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-semibold text-white transition"
        style={{ background: "#1a1d24" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2e38")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#1a1d24")}
        title="Enter today's menu, upload an Excel roster, or import a PDF"
      >
        <span className="text-base leading-none">＋</span>
        <span>Edit Data</span>
      </button>
    </header>
  );
}


function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "history", label: "History" },
    { id: "metrics", label: "Metrics" },
    { id: "favorites", label: "Favorites" },
    { id: "predict", label: "Predict" },
  ];
  return (
    <div className="mt-8 flex gap-1 border-b border-[#ece6d7]">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="px-4 py-2 text-[12px] uppercase tracking-[0.15em] font-semibold -mb-px border-b-2 transition"
          style={{
            color: tab === t.id ? "#1a1d24" : "#6b6f78",
            borderColor: tab === t.id ? "#b89555" : "transparent",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}


// ------------------------------------------------------------
// History view — month-by-month calendar (Sun–Sat rows). Defaults to
// the most-recent month that has data; navigate with prev/next
// arrows or the month/year picker.
// ------------------------------------------------------------
function HistoryView({ menus, onChanged }: { menus: LunchMenuRow[]; onChanged: () => void }) {
  // Default month = most recent menu's month, falling back to today.
  const defaultMonth = useMemo(() => {
    if (menus.length === 0) {
      const d = new Date();
      return formatYearMonth(d.getFullYear(), d.getMonth() + 1);
    }
    const latest = menus.reduce((acc, m) => (m.date > acc ? m.date : acc), menus[0].date);
    return latest.slice(0, 7);
  }, [menus]);

  const [ym, setYm] = useState<string>(defaultMonth);
  const { year, month } = parseYearMonth(ym);
  const [selected, setSelected] = useState<string | null>(null);

  // Lookup: date → menu row.
  const menuByDate = useMemo(() => {
    const m = new Map<string, LunchMenuRow>();
    for (const row of menus) m.set(row.date, row);
    return m;
  }, [menus]);

  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const selectedMenu = selected ? menuByDate.get(selected) ?? null : null;

  return (
    <div>
      <MonthPicker
        year={year}
        month={month}
        onChange={(y, m) => { setYm(formatYearMonth(y, m)); setSelected(null); }}
        label="Viewing"
      />

      <CalendarGrid
        weeks={weeks}
        renderCell={(cell) => {
          const menu = menuByDate.get(cell.ymd);
          const isSelected = selected === cell.ymd;
          return (
            <button
              onClick={() => setSelected(isSelected ? null : cell.ymd)}
              disabled={!menu && !cell.inMonth}
              className={`h-full w-full text-left p-1.5 rounded-sm transition-colors ${
                cell.inMonth ? "hover:bg-[#faf7f1]" : "opacity-40"
              } ${isSelected ? "ring-2 ring-[#b89555]" : ""}`}
              style={{ background: menu ? "#ffffff" : "transparent" }}
              title={menu ? `${menu.items.length} dish${menu.items.length === 1 ? "" : "es"}` : undefined}
            >
              <div className="flex items-baseline justify-between">
                <div className="text-[11px] font-mono tabular-nums text-[#1a1d24]">{cell.date.getDate()}</div>
                {menu && (
                  <div className="text-[9px] text-[#b89555] font-semibold uppercase tracking-wider">
                    {menu.items.length}
                  </div>
                )}
              </div>
              {menu && (
                <ul className="mt-0.5 space-y-0 text-[10px] leading-[1.25] text-[#4a4d54]">
                  {menu.items.slice(0, 4).map((it, i) => (
                    <li key={i} className="truncate">· {it}</li>
                  ))}
                  {menu.items.length > 4 && (
                    <li className="italic text-[#b89555]">+{menu.items.length - 4} more</li>
                  )}
                </ul>
              )}
            </button>
          );
        }}
      />

      {selectedMenu && (
        <div className="mt-5 bg-white border border-[#ece6d7] rounded-lg p-4">
          <MenuCard menu={selectedMenu} onChanged={() => { setSelected(null); onChanged(); }} />
        </div>
      )}
      {!selectedMenu && menus.filter((m) => m.date.startsWith(ym)).length === 0 && (
        <div className="mt-5 text-[13px] italic text-[#6b6f78]">
          No menus recorded in {monthLabel(year, month)}. Tap <b>Edit Data</b> to add one, or
          switch to a different month.
        </div>
      )}
    </div>
  );
}


// Reusable month header + calendar grid primitives. Used by History
// and Predict so the two views share the same Sun–Sat layout.
function MonthPicker({
  year, month, onChange, label,
}: {
  year: number;
  month: number;
  onChange: (year: number, month: number) => void;
  label?: string;
}) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 3 + i);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {label && (
        <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[#6b6f78] mr-1">
          {label}
        </span>
      )}
      <button
        onClick={() => { const s = shiftMonth(year, month, -1); onChange(s.year, s.month); }}
        className="px-2 py-1 rounded-md border border-[#ece6d7] bg-white text-[#6b6f78] hover:text-[#1a1d24] hover:border-[#d9d4c8]"
        title="Previous month"
      >←</button>
      <select
        value={month}
        onChange={(e) => onChange(year, Number(e.target.value))}
        className="px-2 py-1 rounded-md border border-[#ece6d7] bg-white text-[12px] focus:outline-none focus:ring-1 focus:ring-[#b89555]/40"
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {new Date(2000, m - 1, 1).toLocaleDateString("en-US", { month: "long" })}
          </option>
        ))}
      </select>
      <select
        value={year}
        onChange={(e) => onChange(Number(e.target.value), month)}
        className="px-2 py-1 rounded-md border border-[#ece6d7] bg-white text-[12px] focus:outline-none focus:ring-1 focus:ring-[#b89555]/40"
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button
        onClick={() => { const s = shiftMonth(year, month, 1); onChange(s.year, s.month); }}
        className="px-2 py-1 rounded-md border border-[#ece6d7] bg-white text-[#6b6f78] hover:text-[#1a1d24] hover:border-[#d9d4c8]"
        title="Next month"
      >→</button>
      <div className="font-serif-display text-[22px] leading-none ml-1">
        {monthLabel(year, month)}
      </div>
    </div>
  );
}


function CalendarGrid({
  weeks, renderCell,
}: {
  weeks: ReturnType<typeof buildMonthGrid>;
  renderCell: (cell: ReturnType<typeof buildMonthGrid>[number][number]) => React.ReactNode;
}) {
  return (
    <div className="mt-4 bg-white border border-[#ece6d7] rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 bg-[#faf7f1] border-b border-[#ece6d7]">
        {WEEKDAY_HEADINGS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-[10px] uppercase tracking-[0.18em] font-semibold text-[#6b6f78] text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 divide-x divide-[#ece6d7]">
        {weeks.flat().map((cell, i) => (
          <div
            key={cell.ymd + i}
            className={`border-b border-[#ece6d7] min-h-[92px] ${cell.isWeekend ? "bg-[#faf7f1]/40" : ""}`}
          >
            {renderCell(cell)}
          </div>
        ))}
      </div>
    </div>
  );
}


function MenuCard({ menu, onChanged }: { menu: LunchMenuRow; onChanged: () => void }) {
  const d = parseYMD(menu.date);
  const heading = d
    ? d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
    : menu.date;

  async function onDelete() {
    if (!confirm(`Delete the menu for ${heading}?`)) return;
    await deleteMenu(menu.date);
    onChanged();
  }

  return (
    <div className="rounded-lg bg-white border border-[#ece6d7] p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">
            {d ? d.toLocaleDateString("en-US", { weekday: "long" }) : ""}
          </div>
          <div className="font-serif-display text-[20px] leading-tight mt-0.5">{heading}</div>
        </div>
        <button
          onClick={onDelete}
          className="text-[11px] text-[#9b2226] hover:underline"
        >
          Remove
        </button>
      </div>
      <ul className="mt-3 space-y-1 text-[14px] text-[#1a1d24]">
        {menu.items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-[#b89555] mt-1.5 shrink-0 h-1 w-1 rounded-full bg-[#b89555]" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
      {menu.notes && (
        <div className="mt-3 text-[12px] text-[#6b6f78] italic border-l-2 border-[#ece6d7] pl-2">
          {menu.notes}
        </div>
      )}
      <div className="mt-3 text-[10px] uppercase tracking-[0.18em] text-[#6b6f78]">
        Source: {menu.source}
      </div>
    </div>
  );
}


// ------------------------------------------------------------
// Metrics view — totals, top items, and by-day-of-week breakout.
// Top dishes are filtered by a period selector so the user can ask
// "what's been served most in the last 30 days" vs "all time".
// ------------------------------------------------------------
type PeriodKey = "all" | "last_7" | "last_30" | "last_90" | "this_month" | "last_month" | "this_year";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "last_7",     label: "Last 7 days" },
  { key: "last_30",    label: "Last 30 days" },
  { key: "last_90",    label: "Last 90 days" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_year",  label: "This year" },
  { key: "all",        label: "All time" },
];


function periodBounds(key: PeriodKey, menus: LunchMenuRow[]): { start: string; end: string } {
  const today = new Date();
  const endYmd = ymdOf(today);
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const offset = (days: number) => {
    const d = startOfDay(today);
    d.setDate(d.getDate() - days);
    return ymdOf(d);
  };
  switch (key) {
    case "last_7":     return { start: offset(6),  end: endYmd };
    case "last_30":    return { start: offset(29), end: endYmd };
    case "last_90":    return { start: offset(89), end: endYmd };
    case "this_month": {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: ymdOf(d), end: endYmd };
    }
    case "last_month": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: ymdOf(first), end: ymdOf(last) };
    }
    case "this_year": {
      const d = new Date(today.getFullYear(), 0, 1);
      return { start: ymdOf(d), end: endYmd };
    }
    case "all":
    default: {
      if (menus.length === 0) return { start: endYmd, end: endYmd };
      const sorted = [...menus].sort((a, b) => (a.date < b.date ? -1 : 1));
      return { start: sorted[0].date, end: sorted[sorted.length - 1].date };
    }
  }
}


function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


function normalizeKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}


type CountedItem = { name: string; count: number; role: StructuralRole };


/** Roll the filtered menus up into role-tagged top-dishes + a
 *  by-weekday breakout. Line-1 Deli Day / Chef's Choice days are
 *  special-cased so the other lines are disregarded per the kitchen's
 *  layout rules. */
function computeMetrics(menus: LunchMenuRow[]) {
  /** keyed by `${role}::${normalizedName}` so the same string appearing
   *  as a main one day and a side another day stays separately counted
   *  (which is what the user wants when asking "top mains"). */
  const itemCounts = new Map<string, CountedItem>();
  const dowCounters: Map<string, CountedItem>[] = [
    new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Map(),
  ];
  const dowMenuCount = [0, 0, 0, 0, 0, 0, 0];
  const roleTotals: Record<StructuralRole, number> = {
    main: 0, side: 0, soup: 0, deli: 0, chef_choice: 0, other: 0,
  };
  let totalOccurrences = 0;

  const bump = (
    bucket: Map<string, CountedItem>,
    name: string, role: StructuralRole,
  ) => {
    const k = `${role}::${normalizeKey(name)}`;
    const prev = bucket.get(k);
    if (prev) prev.count += 1; else bucket.set(k, { name, role, count: 1 });
  };

  for (const m of menus) {
    const d = parseYMD(m.date);
    if (!d) continue;
    // We want Sun=0..Sat=6 to match the calendar; new Date().getDay() is
    // already in that convention.
    const dow = d.getDay();
    dowMenuCount[dow] += 1;

    const structure = classifyMenu(m.items ?? []);
    for (const dish of structure.dishes) {
      bump(itemCounts, dish.name, dish.role);
      bump(dowCounters[dow], dish.name, dish.role);
      roleTotals[dish.role] += 1;
      totalOccurrences += 1;
    }
  }

  const topItems = Array.from(itemCounts.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const byDayOfWeek = (["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const).map((day, idx) => ({
    day,
    day_index: idx,
    menus_served: dowMenuCount[idx],
    top_items: Array.from(dowCounters[idx].values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 5),
  }));

  return {
    topItems,
    byDayOfWeek,
    totalOccurrences,
    uniqueItems: itemCounts.size,
    roleTotals,
  };
}


function MetricsView({ metrics, menus }: { metrics: LunchMetrics | null; menus: LunchMenuRow[] }) {
  const [role, setRole] = useState<StructuralRole | "all">("all");
  // Default to All time so users see their real historical counts up-
  // front. A "Last 30 days" default was hiding old imports and making
  // the top-dish counts look artificially low.
  const [period, setPeriod] = useState<PeriodKey>("all");

  if (!metrics || metrics.menu_count === 0) {
    return <div className="text-[13px] italic text-[#6b6f78]">No data yet — add a menu to unlock metrics.</div>;
  }

  const range = metrics.date_range;

  // Filter the raw menu list by the active period, then compute the
  // top-dishes + by-weekday stats client-side so the period selector
  // feels instant.
  const bounds = useMemo(() => periodBounds(period, menus), [period, menus]);
  const filteredMenus = useMemo(
    () => menus.filter((m) => m.date >= bounds.start && m.date <= bounds.end),
    [menus, bounds.start, bounds.end],
  );
  const {
    topItems: periodTopItems,
    byDayOfWeek: periodByDow,
    totalOccurrences: periodTotalOcc,
    uniqueItems: periodUnique,
    roleTotals,
  } = useMemo(() => computeMetrics(filteredMenus), [filteredMenus]);

  // Split the flat ranked list into per-role slices so the category
  // chips show the exact menu-position breakdown (mains served, sides
  // served, soups served, deli days, chef's choices).
  const byRole = useMemo(() => {
    const m: Record<StructuralRole, CountedItem[]> = {
      main: [], side: [], soup: [], deli: [], chef_choice: [], other: [],
    };
    for (const it of periodTopItems) m[it.role].push(it);
    return m;
  }, [periodTopItems]);

  const availableRoles = ROLE_CATEGORIES.filter((c) => byRole[c.key].length > 0);
  const activeItems = role === "all" ? periodTopItems : byRole[role];
  const maxCount = activeItems[0]?.count ?? 1;
  const roleLabel = role === "all"
    ? "Top dishes"
    : `Top ${ROLE_CATEGORIES.find((c) => c.key === role)?.plural ?? role}`;
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "All time";
  const menuCountInPeriod = filteredMenus.length;
  const rangeLabel = bounds.start === bounds.end
    ? bounds.start
    : `${bounds.start} → ${bounds.end}`;

  const subtitle = menuCountInPeriod === 0
    ? `No menus in ${periodLabel.toLowerCase()}`
    : `${periodUnique} unique ${periodUnique === 1 ? "entry" : "entries"} across ${periodTotalOcc} servings in ${menuCountInPeriod} menu${menuCountInPeriod === 1 ? "" : "s"} · ${rangeLabel}`;

  // Compact "14 mains · 28 sides · 14 soups · 3 Deli Days · 2 Chef's
  // Choices" summary line so the structural breakdown is visible even
  // before the user clicks a chip.
  const roleSummary = ROLE_CATEGORIES
    .filter((c) => roleTotals[c.key] > 0)
    .map((c) => `${roleTotals[c.key]} ${c.plural.toLowerCase()}`)
    .join("  ·  ");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">
      <div>
        <SummaryGrid metrics={metrics} range={range} />
        <div className="mt-6">
          <SectionHeader title={roleLabel} subtitle={subtitle} />

          {roleSummary && (
            <div className="mb-2 text-[11px] text-[#6b6f78]">
              Breakdown by menu position: <span className="text-[#1a1d24]">{roleSummary}</span>
            </div>
          )}

          {/* Period selector — constrains the Top Dishes + weekday
              panels to a specific window. */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78] mr-1">
              Period
            </span>
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                style={period === p.key
                  ? { background: "#1e3a5f", color: "#ffffff", borderColor: "#1e3a5f" }
                  : { background: "#ffffff", color: "#6b6f78", borderColor: "#ece6d7" }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Role chip bar — click to filter to just mains, sides,
              soups, or the two special day types. Counts reflect how
              many distinct dishes sit in each bucket. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <CategoryChip
              label="All"
              count={periodTopItems.length}
              active={role === "all"}
              onClick={() => setRole("all")}
            />
            {availableRoles.map((c) => (
              <CategoryChip
                key={c.key}
                label={c.plural}
                count={byRole[c.key].length}
                active={role === c.key}
                onClick={() => setRole(c.key)}
              />
            ))}
          </div>

          <div className="rounded-lg bg-white border border-[#ece6d7] overflow-hidden">
            {activeItems.length === 0 ? (
              <div className="px-4 py-6 text-[12px] italic text-[#6b6f78]">
                No {role === "all" ? "dishes" : (ROLE_CATEGORIES.find((c) => c.key === role)?.plural.toLowerCase() ?? "dishes")} in {periodLabel.toLowerCase()}.
              </div>
            ) : (
              activeItems.slice(0, 20).map((it, i) => (
                <div key={`${it.role}-${it.name}-${i}`} className="px-4 py-2 flex items-center justify-between border-t border-[#ece6d7] first:border-t-0">
                  <div className="flex-1 min-w-0 pr-3 flex items-center gap-2">
                    <RoleBadge role={it.role} />
                    <div className="text-[14px] truncate">{it.name}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <BarInline value={it.count} max={maxCount} />
                    <div className="text-[11px] text-[#6b6f78] w-24 text-right whitespace-nowrap">
                      served <span className="font-mono tabular-nums font-semibold text-[#1a1d24]">{it.count}</span> time{it.count === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div>
        <SectionHeader
          title="By day of the week"
          subtitle={`Rotation within ${periodLabel.toLowerCase()} — most common dish per weekday (served-count in gold).`}
        />
        <div className="rounded-lg bg-white border border-[#ece6d7] overflow-hidden">
          {periodByDow.map((d) => {
            const filtered = role === "all"
              ? d.top_items
              : d.top_items.filter((it) => it.role === role);
            return (
              <div key={d.day_index} className="px-4 py-3 border-t border-[#ece6d7] first:border-t-0">
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-[#b89555]">{d.day}</div>
                  <div className="text-[11px] text-[#6b6f78]">{d.menus_served} menu{d.menus_served === 1 ? "" : "s"}</div>
                </div>
                {filtered.length === 0 ? (
                  <div className="mt-1 text-[12px] italic text-[#6b6f78]">
                    {role === "all"
                      ? "No data for this weekday."
                      : `No ${ROLE_CATEGORIES.find((c) => c.key === role)?.plural.toLowerCase() ?? ""} on this weekday.`}
                  </div>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {filtered.map((it, i) => (
                      <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border border-[#ece6d7] bg-[#faf7f1]">
                        {it.name} <span className="text-[#b89555] font-semibold ml-1">×{it.count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


function RoleBadge({ role }: { role: StructuralRole }) {
  const meta: Record<StructuralRole, { label: string; bg: string; fg: string }> = {
    main:        { label: "Main",  bg: "#1a1d24", fg: "#ffffff" },
    side:        { label: "Side",  bg: "#ece6d7", fg: "#1a1d24" },
    soup:        { label: "Soup",  bg: "#1e3a5f", fg: "#ffffff" },
    deli:        { label: "Deli",  bg: "#b89555", fg: "#ffffff" },
    chef_choice: { label: "Chef",  bg: "#6b4a2c", fg: "#ffffff" },
    other:       { label: "Other", bg: "#f5f1e5", fg: "#6b6f78" },
  };
  const m = meta[role];
  return (
    <span
      className="text-[9px] uppercase tracking-[0.12em] font-semibold px-1.5 py-0.5 rounded shrink-0"
      style={{ background: m.bg, color: m.fg }}
    >
      {m.label}
    </span>
  );
}


function CategoryChip({
  label, count, active, onClick,
}: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
      style={active
        ? { background: "#1a1d24", color: "#ffffff", borderColor: "#1a1d24" }
        : { background: "#ffffff", color: "#6b6f78", borderColor: "#ece6d7" }}
    >
      {label}
      <span className={`ml-1.5 font-semibold ${active ? "text-[#b89555]" : "text-[#b89555]"}`}>
        {count}
      </span>
    </button>
  );
}


function SummaryGrid({ metrics, range }: { metrics: LunchMetrics; range: LunchMetrics["date_range"] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatTile label="Menus" value={String(metrics.menu_count)} />
      <StatTile label="Unique dishes" value={String(metrics.unique_items)} />
      <StatTile label="Dish-days" value={String(metrics.item_count)} />
      <StatTile label="From" value={range?.start ?? "—"} className="col-span-1" />
      <StatTile label="Through" value={range?.end ?? "—"} className="col-span-2" />
    </div>
  );
}


function StatTile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-lg bg-white border border-[#ece6d7] p-3 ${className ?? ""}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#6b6f78] font-semibold">{label}</div>
      <div className="font-serif-display text-[22px] leading-tight mt-0.5">{value}</div>
    </div>
  );
}


function BarInline({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="w-32 h-1 rounded-full bg-[#ece6d7] overflow-hidden">
      <div className="h-full" style={{ width: `${pct}%`, background: "#b89555" }} />
    </div>
  );
}


// ------------------------------------------------------------
// Favorites view
// ------------------------------------------------------------
function FavoritesView({
  items, menus, favorites, onToggle, onReorder, onSetRanks,
}: {
  items: LunchItem[];
  menus: LunchMenuRow[];
  favorites: FavoriteEntry[];
  onToggle: (key: string) => void;
  onReorder: (key: string, direction: "up" | "down") => void;
  onSetRanks: (orderedKeys: string[]) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [tournamentOpen, setTournamentOpen] = useState(false);
  const [company, setCompany] = useState<{ items: CompanyFavorite[]; user_count: number } | null>(null);

  // Refresh the company-wide ranking whenever the user's own favorites
  // change — their pick affects everyone's view.
  useEffect(() => {
    companyFavorites().then(setCompany);
  }, [favorites]);

  // Only mains (line 1 of the menu structure) are eligible.
  const mainNames = useMemo(() => {
    const set = new Set<string>();
    for (const m of menus) {
      const s = classifyMenu(m.items ?? []);
      if (s.main) set.add(s.main.trim().toLowerCase());
    }
    return set;
  }, [menus]);

  const mains = useMemo(
    () => items.filter((i) => mainNames.has(i.name.trim().toLowerCase())),
    [items, mainNames],
  );

  const itemByKey = useMemo(() => {
    const m = new Map<string, LunchItem>();
    for (const it of items) m.set(it.key, it);
    return m;
  }, [items]);

  const ranked = useMemo(
    () => [...favorites].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)),
    [favorites],
  );

  // Typeahead — only show results when the user is actively searching.
  // Replaces the old wall-of-chips that listed every main at once.
  const searchHits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return mains.filter((i) => i.name.toLowerCase().includes(needle)).slice(0, 12);
  }, [mains, q]);

  const atCap = ranked.length >= FAVORITES_LIMIT;

  if (items.length === 0) {
    return <div className="text-[13px] italic text-[#6b6f78]">No dishes catalogued yet. Upload some menus first.</div>;
  }

  if (tournamentOpen) {
    return (
      <TournamentScreen
        mains={mains}
        favorites={favorites}
        company={company?.items ?? []}
        onCancel={() => setTournamentOpen(false)}
        onFinish={async (orderedKeys) => {
          await onSetRanks(orderedKeys);
          setTournamentOpen(false);
        }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6">
      {/* LEFT — your top 10 + tournament + search picker */}
      <div>
        <SectionHeader
          title="Your top 10"
          subtitle={`Rank the mains you want to see again. ${ranked.length}/${FAVORITES_LIMIT} picked.`}
        />

        {/* Ranked list */}
        <ol className="space-y-1.5">
          {Array.from({ length: FAVORITES_LIMIT }).map((_, idx) => {
            const fav = ranked[idx];
            const rank = idx + 1;
            if (!fav) {
              return (
                <li
                  key={`empty-${rank}`}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-dashed border-[#ece6d7] bg-[#faf7f1]/50 text-[#b8b3a4]"
                >
                  <span className="w-6 text-center text-[11px] font-mono tabular-nums">{rank}</span>
                  <span className="text-[12px] italic">empty slot</span>
                </li>
              );
            }
            const it = itemByKey.get(fav.item_key);
            const name = it?.name ?? fav.item_key;
            const count = it?.count ?? 0;
            return (
              <li
                key={fav.item_key}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[#ece6d7] bg-white"
              >
                <span className="w-6 text-center text-[12px] font-mono tabular-nums font-semibold text-[#b89555]">
                  {rank}
                </span>
                <span className="flex-1 truncate text-[13px]">{name}</span>
                <span className="text-[10px] text-[#6b6f78] tabular-nums shrink-0">served {count}×</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => onReorder(fav.item_key, "up")}
                    disabled={idx === 0}
                    className="w-6 h-6 inline-flex items-center justify-center rounded text-[#6b6f78] hover:text-[#1a1d24] hover:bg-[#faf7f1] disabled:opacity-25 disabled:hover:bg-transparent"
                    title="Move up"
                  >▲</button>
                  <button
                    onClick={() => onReorder(fav.item_key, "down")}
                    disabled={idx === ranked.length - 1}
                    className="w-6 h-6 inline-flex items-center justify-center rounded text-[#6b6f78] hover:text-[#1a1d24] hover:bg-[#faf7f1] disabled:opacity-25 disabled:hover:bg-transparent"
                    title="Move down"
                  >▼</button>
                  <button
                    onClick={() => onToggle(fav.item_key)}
                    className="w-6 h-6 inline-flex items-center justify-center rounded text-[#9b2226] hover:bg-[#faf0f0]"
                    title="Remove"
                  >×</button>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Tournament CTA — replaces the old chip wall as the primary
            way to build a top-10. Picking a top-10 from a 50-item grid
            is paralyzing; head-to-head pairs are one click each. */}
        <div className="mt-6 rounded-lg border border-[#ece6d7] bg-white p-4">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-[220px]">
              <div className="font-serif-display text-[18px] leading-tight">
                {ranked.length === 0 ? "Pick your top 10 in 60 seconds" : "Refine your ranking"}
              </div>
              <div className="text-[12px] text-[#6b6f78] mt-1 leading-relaxed">
                Run a head-to-head tournament — would you rather have <i>this</i> or <i>that</i> for lunch?
                Each pick takes one click. We'll rank the winners and replace your top 10.
              </div>
            </div>
            <button
              onClick={() => setTournamentOpen(true)}
              className="shrink-0 px-4 py-2 rounded-md text-[13px] font-semibold text-white"
              style={{ background: "#1a1d24" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2e38")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#1a1d24")}
            >
              {ranked.length === 0 ? "Start tournament" : "Re-run tournament"} →
            </button>
          </div>
        </div>

        {/* Search picker — typeahead only, never a wall of chips. */}
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78] mb-2">
            Or add a specific main by name
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type to search mains…"
            className="w-full px-3 py-2 text-[13px] border border-[#d9d4c8] rounded-md bg-white focus:outline-none focus:border-[#b89555]"
          />
          {q.trim() && (
            <div className="mt-2 rounded-md border border-[#ece6d7] bg-white overflow-hidden">
              {searchHits.length === 0 ? (
                <div className="px-3 py-2 text-[12px] italic text-[#6b6f78]">No mains match.</div>
              ) : searchHits.map((it) => {
                const on = favorites.some((f) => f.item_key === it.key);
                const disabled = !on && atCap;
                return (
                  <button
                    key={it.key}
                    onClick={() => { if (!disabled) { onToggle(it.key); setQ(""); } }}
                    disabled={disabled}
                    className="w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between border-t border-[#ece6d7] first:border-t-0 hover:bg-[#faf7f1] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {on && <span className="text-[#b89555]">★</span>}
                      <span className="truncate">{it.name}</span>
                    </span>
                    <span className="text-[10px] text-[#6b6f78] tabular-nums shrink-0">
                      {on ? "remove" : disabled ? "list full" : "add"} · {it.count}×
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — company-wide ranking */}
      <div>
        <SectionHeader
          title="Company favorites"
          subtitle={
            company === null
              ? "Loading…"
              : company.user_count === 0
                ? "No one has picked favorites yet."
                : `Aggregated across ${company.user_count} ${company.user_count === 1 ? "person" : "people"}. F1 points: 25/18/15/12/10/8/6/4/2/1 by rank.`
          }
        />
        <div className="rounded-lg bg-white border border-[#ece6d7] overflow-hidden">
          {company && company.items.length === 0 && (
            <div className="px-3 py-3 text-[12px] italic text-[#6b6f78]">
              Pick something on the left to seed the ranking.
            </div>
          )}
          {company?.items.slice(0, 25).map((c, i) => {
            const yours = favorites.find((f) => f.item_key === c.item_key);
            return (
              <div
                key={c.item_key}
                className="px-3 py-1.5 flex items-center gap-2 border-t border-[#ece6d7] first:border-t-0"
              >
                <span className="w-6 text-center text-[11px] font-mono tabular-nums font-semibold text-[#b89555]">
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-[12px]">{c.name}</span>
                {yours && (
                  <span
                    className="text-[9px] uppercase tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded shrink-0"
                    style={{ background: "#b89555", color: "#fff" }}
                    title={`You ranked this #${yours.rank ?? "?"}`}
                  >
                    Yours #{yours.rank ?? "?"}
                  </span>
                )}
                <span className="text-[10px] text-[#6b6f78] tabular-nums shrink-0">
                  {c.marks} pick{c.marks === 1 ? "" : "s"} · {c.score}pt
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ------------------------------------------------------------
// Tournament picker — head-to-head pairs for building a top-10 without
// staring at a wall of every main ever served.
//
// Each candidate has an Elo-style rating (start 1000, K = 64 because we
// only run ~15 rounds and need fast convergence). After every match the
// winner gains rating proportional to how unexpected the win was;
// matchups between similarly-rated dishes carry the most information
// and are preferred by the pair sampler.
//
// Pool selection prioritizes the user's existing top-10, the strongest
// company favorites, and a sample of frequently-served mains they
// haven't picked. Cap the pool at ~24 so the tournament feels
// finishable; once everyone in the pool has been seen at least once the
// sampler switches to "match closely-rated dishes" to refine the head
// of the table where the top-10 actually lives.
// ------------------------------------------------------------
const TOURNAMENT_POOL_SIZE = 24;
const TOURNAMENT_DEFAULT_ROUNDS = 15;
const ELO_START = 1000;
const ELO_K = 64;


function eloUpdate(rA: number, rB: number, scoreA: number): [number, number] {
  // scoreA: 1 if A wins, 0 if B wins, 0.5 for a draw (we don't expose draws).
  const expectedA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
  const delta = ELO_K * (scoreA - expectedA);
  return [rA + delta, rB - delta];
}


function buildTournamentPool(
  mains: LunchItem[],
  favorites: FavoriteEntry[],
  company: CompanyFavorite[],
): LunchItem[] {
  const byKey = new Map(mains.map((m) => [m.key, m]));
  const picked: LunchItem[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (seen.has(key)) return;
    const it = byKey.get(key);
    if (!it) return;
    picked.push(it);
    seen.add(key);
  };

  // 1. Existing top-10 first — refining the user's current ranking is
  //    almost always more valuable than starting from scratch.
  for (const f of [...favorites].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))) {
    add(f.item_key);
  }
  // 2. Company favorites — popular dishes the user might not have picked yet.
  for (const c of company) add(c.item_key);
  // 3. Fill the rest with most-served mains.
  for (const m of [...mains].sort((a, b) => b.count - a.count)) add(m.key);

  return picked.slice(0, TOURNAMENT_POOL_SIZE);
}


function pickPair(
  pool: LunchItem[],
  ratings: Map<string, number>,
  seen: Map<string, number>,
  lastPair: [string, string] | null,
): [LunchItem, LunchItem] | null {
  if (pool.length < 2) return null;

  // Phase 1 — every dish should be evaluated at least once before we
  // start refining ratings. Sample from the never-seen subset.
  const unseen = pool.filter((p) => (seen.get(p.key) ?? 0) === 0);
  if (unseen.length >= 2) {
    const a = unseen[Math.floor(Math.random() * unseen.length)];
    const others = unseen.filter((p) => p.key !== a.key);
    const b = others[Math.floor(Math.random() * others.length)];
    return [a, b];
  }
  if (unseen.length === 1) {
    const a = unseen[0];
    const opponents = pool.filter((p) => p.key !== a.key);
    // Pair the unseen dish with someone of middle rating so it gets a
    // fair first matchup.
    opponents.sort((x, y) => Math.abs((ratings.get(x.key) ?? ELO_START) - ELO_START)
      - Math.abs((ratings.get(y.key) ?? ELO_START) - ELO_START));
    return [a, opponents[0]];
  }

  // Phase 2 — pick from candidate pairs the one that minimizes rating
  // distance (close fights = more information) while penalizing pairs
  // that include the most recently-shown dishes (avoid feeling
  // repetitive).
  const recent = new Set(lastPair ?? []);
  let best: { pair: [LunchItem, LunchItem]; cost: number } | null = null;
  const samples = 40;
  for (let i = 0; i < samples; i++) {
    const a = pool[Math.floor(Math.random() * pool.length)];
    const b = pool[Math.floor(Math.random() * pool.length)];
    if (a.key === b.key) continue;
    const distance = Math.abs((ratings.get(a.key) ?? ELO_START) - (ratings.get(b.key) ?? ELO_START));
    const repeatPenalty = (recent.has(a.key) ? 80 : 0) + (recent.has(b.key) ? 80 : 0);
    const cost = distance + repeatPenalty;
    if (!best || cost < best.cost) best = { pair: [a, b], cost };
  }
  return best?.pair ?? null;
}


function TournamentScreen({
  mains, favorites, company, onCancel, onFinish,
}: {
  mains: LunchItem[];
  favorites: FavoriteEntry[];
  company: CompanyFavorite[];
  onCancel: () => void;
  onFinish: (orderedKeys: string[]) => Promise<void>;
}) {
  // Frozen pool for the duration of the tournament — pulling new
  // candidates mid-bracket would invalidate the ratings.
  const pool = useMemo(
    () => buildTournamentPool(mains, favorites, company),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const targetRounds = Math.min(TOURNAMENT_DEFAULT_ROUNDS, Math.max(8, pool.length));

  const [ratings, setRatings] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    // Seed ratings from existing rank so the user's prior top-1 starts
    // ahead of their #10. Other dishes start neutral.
    const ranked = [...favorites].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    for (const p of pool) m.set(p.key, ELO_START);
    ranked.forEach((f, idx) => {
      if (m.has(f.item_key)) {
        m.set(f.item_key, ELO_START + 200 - idx * 20);
      }
    });
    return m;
  });
  const [seen, setSeen] = useState<Map<string, number>>(() => new Map());
  const [round, setRound] = useState(1);
  const [busy, setBusy] = useState(false);
  const [lastPair, setLastPair] = useState<[string, string] | null>(null);
  const [pair, setPair] = useState<[LunchItem, LunchItem] | null>(() =>
    pickPair(pool, new Map(pool.map((p) => [p.key, ELO_START])), new Map(), null),
  );

  function nextPair(updatedRatings: Map<string, number>, updatedSeen: Map<string, number>) {
    const next = pickPair(pool, updatedRatings, updatedSeen, pair ? [pair[0].key, pair[1].key] : null);
    setPair(next);
    setLastPair(pair ? [pair[0].key, pair[1].key] : null);
  }

  function chooseWinner(winnerKey: string) {
    if (!pair) return;
    const [a, b] = pair;
    const winnerIsA = winnerKey === a.key;
    const rA = ratings.get(a.key) ?? ELO_START;
    const rB = ratings.get(b.key) ?? ELO_START;
    const [newA, newB] = eloUpdate(rA, rB, winnerIsA ? 1 : 0);
    const newRatings = new Map(ratings);
    newRatings.set(a.key, newA);
    newRatings.set(b.key, newB);
    const newSeen = new Map(seen);
    newSeen.set(a.key, (newSeen.get(a.key) ?? 0) + 1);
    newSeen.set(b.key, (newSeen.get(b.key) ?? 0) + 1);
    setRatings(newRatings);
    setSeen(newSeen);
    setRound(round + 1);
    nextPair(newRatings, newSeen);
  }

  function skipPair() {
    // Don't update ratings — just resample. Counts as a round so the
    // tournament still ends in finite time even if the user skips a lot.
    if (!pair) return;
    setRound(round + 1);
    nextPair(ratings, seen);
  }

  async function finish() {
    setBusy(true);
    const sorted = [...pool].sort((x, y) => (ratings.get(y.key) ?? 0) - (ratings.get(x.key) ?? 0));
    const top = sorted.slice(0, FAVORITES_LIMIT).map((it) => it.key);
    try {
      await onFinish(top);
    } finally {
      setBusy(false);
    }
  }

  const standings = useMemo(
    () => [...pool]
      .map((p) => ({ ...p, rating: ratings.get(p.key) ?? ELO_START, seen: seen.get(p.key) ?? 0 }))
      .sort((a, b) => b.rating - a.rating),
    [pool, ratings, seen],
  );

  const tournamentDone = round > targetRounds || !pair;
  const progressPct = Math.min(100, ((round - 1) / targetRounds) * 100);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <div>
          <SectionHeader
            title="Head-to-head tournament"
            subtitle="Pick the dish you'd rather have for lunch. Skip if you can't decide. Top 10 by rating overwrites your favorites when you finish."
          />
        </div>
        <button
          onClick={onCancel}
          className="text-[12px] text-[#6b6f78] hover:text-[#1a1d24] underline"
        >
          ← back to favorites
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6">
        {/* LEFT — the matchup */}
        <div>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78] mb-2">
            <span>Round {Math.min(round, targetRounds)} of {targetRounds}</span>
            <span>{seen.size} / {pool.length} mains seen</span>
          </div>
          <div className="h-1 rounded-full bg-[#ece6d7] overflow-hidden mb-5">
            <div className="h-full" style={{ width: `${progressPct}%`, background: "#b89555" }} />
          </div>

          {tournamentDone || !pair ? (
            <div className="rounded-lg bg-white border border-[#ece6d7] p-6 text-center">
              <div className="font-serif-display text-[20px] mb-2">Tournament complete</div>
              <div className="text-[13px] text-[#6b6f78] mb-4">
                Top 10 from this run is shown on the right. Click below to overwrite
                your favorites with the new ranking.
              </div>
              <button
                onClick={finish}
                disabled={busy}
                className="px-5 py-2 rounded-md text-[13px] font-semibold text-white"
                style={{ background: "#1a1d24", opacity: busy ? 0.6 : 1 }}
              >
                {busy ? "Saving…" : `Save top ${Math.min(FAVORITES_LIMIT, pool.length)} →`}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                {pair.map((it) => (
                  <button
                    key={it.key}
                    onClick={() => chooseWinner(it.key)}
                    className="group flex flex-col bg-white border border-[#ece6d7] rounded-xl p-5 hover:border-[#b89555] hover:bg-[#faf7f1] transition-all min-h-[160px] text-left"
                  >
                    <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[#b89555]">
                      Pick this
                    </div>
                    <div className="font-serif-display text-[22px] leading-tight mt-2 flex-1">
                      {it.name}
                    </div>
                    <div className="text-[11px] text-[#6b6f78] mt-2">
                      Served {it.count}× historically
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button
                  onClick={skipPair}
                  className="text-[12px] text-[#6b6f78] hover:text-[#1a1d24] underline"
                >
                  Skip — I can't decide
                </button>
                <button
                  onClick={finish}
                  disabled={busy}
                  className="text-[12px] px-3 py-1 rounded-md border border-[#d9d4c8] bg-white text-[#1a1d24] hover:bg-[#faf7f1]"
                >
                  Stop early & save current ranking
                </button>
              </div>
            </>
          )}
        </div>

        {/* RIGHT — live standings */}
        <div>
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78] mb-2">
            Live standings
          </div>
          <div className="rounded-lg bg-white border border-[#ece6d7] overflow-hidden">
            {standings.slice(0, 12).map((s, i) => {
              const isTop10 = i < FAVORITES_LIMIT;
              return (
                <div
                  key={s.key}
                  className="px-3 py-1.5 flex items-center gap-2 border-t border-[#ece6d7] first:border-t-0"
                  style={{ background: isTop10 ? "#ffffff" : "#faf7f1/60" }}
                >
                  <span
                    className={`w-6 text-center text-[11px] font-mono tabular-nums font-semibold ${
                      isTop10 ? "text-[#b89555]" : "text-[#6b6f78]"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-[12px]">{s.name}</span>
                  <span className="text-[10px] text-[#6b6f78] tabular-nums shrink-0">
                    {Math.round(s.rating)} · {s.seen}×
                  </span>
                </div>
              );
            })}
          </div>
          <div className="text-[10px] text-[#6b6f78] mt-2 italic">
            Rating · matches played. Top {FAVORITES_LIMIT} (above the line) becomes your favorites.
          </div>
        </div>
      </div>
    </div>
  );
}


// ------------------------------------------------------------
// Predict view — a full calendar month of projected menus. Defaults to
// NEXT month (so in April you see May). The user can switch months via
// the picker; each weekday cell shows the top predicted dishes; clicking
// opens a detail modal with predictability scores and a Claude-generated
// narrative of WHY those items are likely.
// ------------------------------------------------------------
/** Render the per-candidate footer line in the predict modal. Combines
 *  weekday frequency, last-seen recency, and rotation cadence into a
 *  one-line summary so the user can see WHY a dish surfaced for a given
 *  date — not just that it has high frequency. */
function formatPredictionStats(
  it: {
    served_on_weekday: number;
    weekday_total: number;
    days_since_any?: number;
    weeks_since_same_dow?: number | null;
    typical_gap_weeks?: number | null;
  },
  dayOfWeek: string,
): string {
  const parts: string[] = [
    `Served ${it.served_on_weekday} of ${it.weekday_total} historical ${dayOfWeek}s`,
  ];
  if (typeof it.days_since_any === "number" && it.days_since_any < 9_000) {
    parts.push(`last seen ${it.days_since_any}d ago`);
  }
  if (it.typical_gap_weeks != null && it.weeks_since_same_dow != null) {
    parts.push(
      `typical gap ${it.typical_gap_weeks.toFixed(1)}w · ${it.weeks_since_same_dow.toFixed(1)}w since last ${dayOfWeek}`,
    );
  }
  return parts.join(" · ");
}


/** Re-order a flat list of prediction candidates by structural role —
 *  main on top, up to three sides, soup on the bottom. If a forecast
 *  resolves to Deli Day or Chef's Choice (top-scoring item is the
 *  special-day name), the rest of the list is dropped per the kitchen's
 *  rules: those days never share the menu with sides or soup. */
function orderPredictedItems<T extends { name: string; score: number }>(
  predicted: T[],
  roleByName: Map<string, StructuralRole>,
): (T & { role: StructuralRole })[] {
  if (predicted.length === 0) return [];

  // Special-day short-circuit: if the highest-scoring candidate is
  // "Deli Day" or "Chef's Choice", that day is forecast as that
  // special day — show ONLY that single item.
  const top = predicted[0];
  const topSpecial = specialDayKind(top.name);
  if (topSpecial) return [{ ...top, role: topSpecial }];

  // Tag every candidate with its typical role. Drop other special-day
  // names so a regular day's forecast doesn't show "Chef's Choice"
  // sandwiched between sides.
  const tagged = predicted
    .filter((p) => specialDayKind(p.name) === null)
    .map((p) => ({
      ...p,
      role: roleByName.get(p.name.trim().toLowerCase()) ?? "other" as StructuralRole,
    }));

  const main = tagged.find((t) => t.role === "main");
  const sides = tagged.filter((t) => t.role === "side").slice(0, 3);
  const soup = tagged.find((t) => t.role === "soup");

  const out: (T & { role: StructuralRole })[] = [];
  if (main) out.push(main);
  out.push(...sides);
  if (soup) out.push(soup);

  // Fallback: if no main was tagged, lead with the highest-scoring
  // candidate so the cell isn't empty.
  if (out.length === 0 && tagged.length > 0) {
    out.push(tagged[0]);
  }
  return out;
}


// ------------------------------------------------------------
// WeekForecastPanel — spec'd seven-factor forecast for the next
// five business days. Sits above the month grid in PredictView and
// gives a punchier "what's lunch this week" surface with reasons +
// score breakdown for whichever day the user clicks.
// ------------------------------------------------------------
const FACTOR_LABELS: Record<string, string> = {
  recency: "Recency",
  rating: "Rating",
  season: "Season fit",
  dow: "Day-of-week",
  rotation: "Rotation",
  complexity: "Complexity",
  novelty: "Novelty",
};


function WeekForecastPanel({ refreshTick }: { refreshTick: number }) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number>(0);

  useEffect(() => {
    setLoading(true); setError(null);
    getForecast({ daysAhead: 5 })
      .then((f) => {
        setForecast(f);
        setSelectedIdx(0);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [refreshTick]);

  if (loading) {
    return <div className="text-[12px] italic text-[#6b6f78] mb-4">Loading next-week forecast…</div>;
  }
  if (error) {
    return <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded p-2 mb-4">{error}</div>;
  }
  if (!forecast || forecast.predictions.length === 0) {
    return null;
  }

  const selected = forecast.predictions[selectedIdx] ?? forecast.predictions[0];

  return (
    <div className="mb-6 rounded-lg border border-[#ece6d7] bg-[#faf7f1]">
      <div className="px-4 py-3 border-b border-[#ece6d7] flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">
            Next-week forecast
          </div>
          <div className="font-serif-display text-[18px] leading-tight mt-0.5">
            Most likely lunches over the next {forecast.predictions.length} business days
          </div>
        </div>
        <div className="text-[11px] text-[#6b6f78]">
          {forecast.catalog_size} dishes in the catalog · seven-factor scoring
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 p-3">
        {forecast.predictions.map((p, i) => (
          <ForecastCard
            key={p.date}
            day={p}
            selected={i === selectedIdx}
            onClick={() => setSelectedIdx(i)}
          />
        ))}
      </div>

      <ForecastDetailPanel day={selected} />
    </div>
  );
}


function ForecastCard({
  day, selected, onClick,
}: { day: ForecastDay; selected: boolean; onClick: () => void }) {
  const dishName = day.predicted_dish?.name ?? "—";
  const niceDate = (() => {
    const d = parseYMD(day.date);
    return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : day.date;
  })();
  const confColor = day.confidence >= 70 ? "#248A3D" : day.confidence >= 55 ? "#b89555" : "#6b6f78";
  return (
    <button
      onClick={onClick}
      className={`text-left p-2.5 rounded-md transition-colors border bg-white ${
        selected ? "border-[#b89555] ring-2 ring-[#b89555]/40" : "border-[#ece6d7] hover:border-[#d9d4c8]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78]">
          {day.day_of_week.slice(0, 3)} · {niceDate}
        </div>
        {day.scheduled && (
          <span className="text-[8px] uppercase tracking-[0.1em] font-bold px-1 py-[1px] rounded bg-[#1a1d24] text-white">
            Booked
          </span>
        )}
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-[#1a1d24] leading-tight line-clamp-2 min-h-[2.5em]">
        {dishName}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[18px] font-mono tabular-nums font-semibold" style={{ color: confColor }}>
          {Math.round(day.confidence)}
        </span>
        <span className="text-[10px] uppercase tracking-[0.1em] text-[#6b6f78]">conf.</span>
      </div>
    </button>
  );
}


function ForecastDetailPanel({ day }: { day: ForecastDay }) {
  const dish = day.predicted_dish;

  if (!dish) {
    return (
      <div className="border-t border-[#ece6d7] p-4 text-[12px] italic text-[#6b6f78]">
        {day.reasons[0] ?? "No prediction available for this day."}
      </div>
    );
  }

  const niceDate = (() => {
    const d = parseYMD(day.date);
    return d ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : day.date;
  })();

  return (
    <div className="border-t border-[#ece6d7] p-4 grid md:grid-cols-2 gap-5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78]">
          {niceDate}
        </div>
        <div className="font-serif-display text-[20px] leading-tight mt-0.5 mb-2">{dish.name}</div>
        <div className="flex flex-wrap gap-1 mb-3">
          {dish.protein && <Tag>{dish.protein}</Tag>}
          {dish.cuisine && <Tag>{dish.cuisine}</Tag>}
          {dish.last_served_date && (
            <Tag muted>last seen {dish.last_served_date}</Tag>
          )}
        </div>
        <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78] mb-1">
          Why this dish
        </div>
        <ul className="text-[12px] leading-relaxed text-[#1a1d24] space-y-1 list-disc pl-5">
          {day.reasons.map((r, i) => (<li key={i}>{r}</li>))}
        </ul>

        {day.runners_up.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78] mb-1">
              If not this, then
            </div>
            <ul className="text-[12px] text-[#1a1d24] space-y-0.5">
              {day.runners_up.map((r) => (
                <li key={r.dish.id} className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{r.dish.name}</span>
                  <span className="text-[11px] font-mono tabular-nums text-[#6b6f78]">{Math.round(r.confidence)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78] mb-1">
          Score breakdown
        </div>
        {day.factor_breakdown.length === 0 ? (
          <div className="text-[12px] italic text-[#6b6f78]">
            No breakdown — this day is taken from the saved menu, not predicted.
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <tbody>
              {day.factor_breakdown.map((f) => (
                <FactorRow key={f.factor} factor={f} />
              ))}
              <tr className="border-t border-[#ece6d7]">
                <td className="pt-1.5 text-[11px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78]">Total</td>
                <td></td>
                <td className="pt-1.5 text-right font-mono tabular-nums font-semibold text-[#1a1d24]">
                  {day.factor_breakdown.reduce((s, f) => s + f.contribution_pts, 0).toFixed(1)} pts
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


function FactorRow({ factor }: { factor: ForecastFactor }) {
  // Each factor has a different max contribution (weight × 100). Bars
  // scale to that max so a 5-pt novelty fill looks just as "full" as a
  // 30-pt recency fill when both are at their ceiling.
  const max = factor.weight * 100;
  const fillPct = max > 0 ? Math.max(0, Math.min(100, (factor.contribution_pts / max) * 100)) : 0;
  const label = FACTOR_LABELS[factor.factor] ?? factor.factor;
  return (
    <tr>
      <td className="py-0.5 pr-2 w-[110px] text-[#1a1d24]">{label}</td>
      <td className="py-0.5 pr-2">
        <div className="h-2 bg-[#ece6d7] rounded-sm overflow-hidden">
          <div
            className="h-full bg-[#b89555]"
            style={{ width: `${fillPct}%` }}
          />
        </div>
      </td>
      <td className="py-0.5 text-right font-mono tabular-nums text-[#1a1d24] w-[60px]">
        {factor.contribution_pts > 0 ? "+" : ""}{factor.contribution_pts.toFixed(1)}
      </td>
    </tr>
  );
}


function Tag({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-[0.1em] font-semibold px-1.5 py-[2px] rounded ${
        muted ? "bg-[#ece6d7] text-[#6b6f78]" : "bg-[#1a1d24] text-white"
      }`}
    >
      {children}
    </span>
  );
}


function PredictView({
  favorites, items, menus, refreshTick,
}: { favorites: Set<string>; items: LunchItem[]; menus: LunchMenuRow[]; refreshTick: number }) {
  const roleByName = useMemo(() => buildRoleByName(menus), [menus]);
  // Default month = next calendar month (so in April the view opens on
  // May), letting the user plan ahead instead of looking at the current
  // in-progress month. Using Date arithmetic handles Dec → Jan rollover.
  const defaultMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);                    // avoid month-end overflow
    d.setMonth(d.getMonth() + 1);
    return formatYearMonth(d.getFullYear(), d.getMonth() + 1);
  }, []);

  const [ym, setYm] = useState<string>(defaultMonth);
  const { year, month } = parseYearMonth(ym);

  const [prediction, setPrediction] = useState<LunchPrediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    getPrediction(ym)
      .then((p) => setPrediction(p))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [ym, refreshTick]);

  const nameToKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) m.set(it.name.toLowerCase(), it.key);
    return m;
  }, [items]);

  const byDate = useMemo(() => {
    const m = new Map<string, LunchPrediction["projections"][number]>();
    if (prediction) for (const p of prediction.projections) m.set(p.date, p);
    return m;
  }, [prediction]);

  const weeks = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const selectedProj = selectedDate ? byDate.get(selectedDate) ?? null : null;

  return (
    <div>
      <WeekForecastPanel refreshTick={refreshTick} />

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <MonthPicker
          year={year}
          month={month}
          onChange={(y, m) => { setYm(formatYearMonth(y, m)); setSelectedDate(null); }}
          label="Predicting"
        />
        {prediction && (
          <div className="text-[11px] text-[#6b6f78]">
            Based on {prediction.history_menus} historical menu{prediction.history_menus === 1 ? "" : "s"} ·
            click any weekday for scores + AI reasoning
          </div>
        )}
      </div>

      {loading && <div className="mt-4 text-[13px] italic text-[#6b6f78]">Loading prediction…</div>}
      {error && <div className="mt-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      {prediction && prediction.history_menus === 0 && (
        <div className="mt-4 text-[13px] italic text-[#6b6f78]">
          Need some menu history before predictions can kick in.
          Add a few menus on the History tab.
        </div>
      )}

      {prediction && prediction.history_menus > 0 && (
        <CalendarGrid
          weeks={weeks}
          renderCell={(cell) => {
            const proj = byDate.get(cell.ymd);
            const clickable = !!proj && cell.inMonth;
            const isSelected = selectedDate === cell.ymd;
            return (
              <button
                onClick={() => clickable ? setSelectedDate(isSelected ? null : cell.ymd) : null}
                disabled={!clickable}
                className={`h-full w-full text-left p-1.5 rounded-sm transition-colors ${
                  cell.inMonth ? (proj ? "hover:bg-[#faf7f1] cursor-pointer" : "") : "opacity-40"
                } ${isSelected ? "ring-2 ring-[#b89555]" : ""}`}
                title={proj ? `${proj.weekday_menu_count} historical ${proj.day_of_week}s on record` : undefined}
              >
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] font-mono tabular-nums text-[#1a1d24]">{cell.date.getDate()}</div>
                  {proj && <ConfidenceChip c={proj.confidence} compact />}
                </div>
                {proj && (() => {
                  const ordered = orderPredictedItems(proj.predicted_items, roleByName);
                  return (
                    <ul className="mt-0.5 space-y-0 text-[10px] leading-[1.25] text-[#4a4d54]">
                      {ordered.map((it, i) => {
                        const key = nameToKey.get(it.name.toLowerCase());
                        const fav = key && favorites.has(key);
                        return (
                          <li key={i} className="truncate flex items-start gap-1">
                            {fav
                              ? <span className="text-[#b89555] shrink-0">★</span>
                              : <span className="text-[#d9d4c8] shrink-0">·</span>}
                            <span className="truncate">{it.name}</span>
                          </li>
                        );
                      })}
                      {ordered.length === 0 && (
                        <li className="italic text-[#6b6f78]">No pattern yet</li>
                      )}
                    </ul>
                  );
                })()}
              </button>
            );
          }}
        />
      )}

      {selectedProj && (
        <PredictDetailModal
          proj={selectedProj}
          orderedItems={orderPredictedItems(selectedProj.predicted_items, roleByName)}
          favorites={favorites}
          nameToKey={nameToKey}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}


function PredictDetailModal({
  proj, orderedItems, favorites, nameToKey, onClose,
}: {
  proj: LunchPrediction["projections"][number];
  orderedItems: (LunchPrediction["projections"][number]["predicted_items"][number] & { role: StructuralRole })[];
  favorites: Set<string>;
  nameToKey: Map<string, string>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [loadingReason, setLoadingReason] = useState(false);
  const [reasonError, setReasonError] = useState<string | null>(null);

  async function fetchReason() {
    setLoadingReason(true); setReasonError(null);
    try {
      const r = await explainPrediction({
        date: proj.date,
        items: orderedItems.slice(0, 6).map((it) => it.name),
      });
      setReason(r.reason);
    } catch (e) {
      setReasonError((e as Error).message);
    } finally {
      setLoadingReason(false);
    }
  }

  const niceDate = (() => {
    const d = parseYMD(proj.date);
    return d ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : proj.date;
  })();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[640px] max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-[#ece6d7] flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">
              Prediction detail
            </div>
            <div className="font-serif-display text-[22px] leading-tight mt-0.5">{niceDate}</div>
            <div className="text-[11px] text-[#6b6f78] mt-1">
              Confidence <ConfidenceChip c={proj.confidence} /> · {proj.weekday_menu_count} historical
              {" "}{proj.day_of_week} menu{proj.weekday_menu_count === 1 ? "" : "s"} on record
            </div>
          </div>
          <button onClick={onClose} className="text-[#6b6f78] hover:text-[#1a1d24] text-lg leading-none">✕</button>
        </div>

        <div className="p-6 overflow-auto flex-1">
          {/* Predictability scores — main on top, sides, soup at the
              bottom. Special days (Deli / Chef) collapse to a single row. */}
          <div className="mb-5">
            <div
              className="text-[11px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78] mb-2"
              title="Score combines weekday frequency × recency penalty (recently-served dishes are suppressed) × rotation match (boost when 'weeks since last seen' matches the dish's typical interval on this weekday)."
            >
              Predictability — likelihood of appearing this day
            </div>
            {orderedItems.length === 0 ? (
              <div className="text-[12px] italic text-[#6b6f78]">
                No historical data for this weekday.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {orderedItems.map((it, i) => {
                  const key = nameToKey.get(it.name.toLowerCase());
                  const fav = key && favorites.has(key);
                  const pct = Math.round(it.score * 100);
                  const stats = formatPredictionStats(it, proj.day_of_week);
                  return (
                    <li key={i} className="flex items-center gap-3">
                      <div className="w-4 text-center shrink-0">
                        {fav
                          ? <span className="text-[#b89555]">★</span>
                          : <span className="text-[#d9d4c8]">·</span>}
                      </div>
                      <RoleBadge role={it.role} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[#1a1d24]">{it.name}</div>
                        <div className="text-[10px] text-[#6b6f78]">{stats}</div>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-[#ece6d7] rounded-full overflow-hidden">
                          <div className="h-full" style={{ width: `${pct}%`, background: "#b89555" }} />
                        </div>
                        <div className="w-10 text-right text-[11px] font-mono tabular-nums text-[#1a1d24] font-semibold">
                          {pct}%
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Claude reasoning */}
          <div className="border border-[#ece6d7] rounded-md p-3 bg-[#faf7f1]/60">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78]">
                Why these items
              </div>
              {!reason && !loadingReason && (
                <button
                  onClick={fetchReason}
                  className="text-[11px] px-2.5 py-1 rounded-md font-semibold text-white"
                  style={{ background: "#1a1d24" }}
                >
                  Ask Claude →
                </button>
              )}
              {reason && !loadingReason && (
                <button
                  onClick={fetchReason}
                  className="text-[10px] px-2 py-0.5 rounded-md text-[#6b6f78] border border-[#ece6d7] hover:text-[#1a1d24]"
                >
                  Regenerate
                </button>
              )}
            </div>
            {loadingReason && (
              <div className="text-[12px] italic text-[#6b6f78]">Claude is analyzing the rotation…</div>
            )}
            {reasonError && (
              <div className="text-[12px] text-red-700">{reasonError}</div>
            )}
            {reason && (
              <div className="text-[12px] text-[#1a1d24] leading-relaxed whitespace-pre-wrap">
                {reason}
              </div>
            )}
            {!reason && !loadingReason && !reasonError && (
              <div className="text-[11px] italic text-[#6b6f78]">
                Click <b>Ask Claude</b> to generate a 2-3 sentence explanation rooted
                in the weekday frequency stats above.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function ConfidenceChip({ c, compact = false }: { c: "low" | "medium" | "high"; compact?: boolean }) {
  const color = c === "high" ? "#248A3D" : c === "medium" ? "#b89555" : "#6b6f78";
  if (compact) {
    // Single-letter dot for calendar cells — no room for "medium conf."
    const letter = c === "high" ? "H" : c === "medium" ? "M" : "L";
    return (
      <span
        title={`${c} confidence`}
        className="text-[8px] w-3.5 h-3.5 inline-flex items-center justify-center rounded-full font-bold"
        style={{ background: color, color: "#ffffff" }}
      >
        {letter}
      </span>
    );
  }
  return (
    <span className="text-[9px] uppercase tracking-[0.15em] font-semibold" style={{ color }}>
      {c} conf.
    </span>
  );
}


// ------------------------------------------------------------
// Edit Data modal — Manual / Excel / PDF
// ------------------------------------------------------------
function EditDataModal({
  onClose, onSaved,
}: { onClose: () => void; onSaved: () => void }) {
  // Two surfaces — drag-drop handles every supported file type
  // (.eml / .msg / .pdf / .xlsx / .xls / .csv / .txt / images), and
  // Manual is a quick form for the rare ad-hoc entry. The dedicated
  // Email / Excel / PDF tabs were redundant with Drop Files and have
  // been retired.
  const [mode, setMode] = useState<"drop" | "manual">("drop");
  const MODE_LABEL: Record<typeof mode, string> = {
    drop:   "Drop Files",
    manual: "Manual",
  };
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[720px] max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-[#ece6d7] flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">Lunch Menu</div>
            <div className="font-serif-display text-[26px] leading-tight mt-0.5">Edit data</div>
          </div>
          <button onClick={onClose} className="text-[#6b6f78] hover:text-[#1a1d24] text-lg leading-none">✕</button>
        </div>

        <div className="px-6 pt-4 flex gap-1 border-b border-[#ece6d7] flex-wrap">
          {(["drop", "manual"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="px-4 py-2 text-[12px] uppercase tracking-[0.15em] font-semibold -mb-px border-b-2"
              style={{ color: mode === m ? "#1a1d24" : "#6b6f78", borderColor: mode === m ? "#b89555" : "transparent" }}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-auto flex-1">
          {mode === "drop"   && <DropFilesImport onSaved={onSaved} />}
          {mode === "manual" && <ManualForm onSaved={onSaved} />}
        </div>
      </div>
    </div>
  );
}


// ------------------------------------------------------------
// Drop-files import — a single drag-and-drop zone that auto-routes
// every dropped file by extension. Emails (.eml / .msg) get parsed
// for their body + embedded attachments; loose PDFs / XLSX / CSV /
// images get attached alongside, and Claude reads the whole bundle
// in one extraction pass.
// ------------------------------------------------------------
const SUPPORTED_DROP_EXTS =
  ".eml,.msg,.pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp";

function isEmailFile(f: File): boolean {
  const n = f.name.toLowerCase();
  return n.endsWith(".eml") || n.endsWith(".msg");
}

function isSupportedDrop(f: File): boolean {
  const n = f.name.toLowerCase();
  return SUPPORTED_DROP_EXTS.split(",")
    .some((ext) => n.endsWith(ext.trim()));
}

function fileKindLabel(f: File): string {
  const n = f.name.toLowerCase();
  if (n.endsWith(".eml") || n.endsWith(".msg")) return "Email";
  if (n.endsWith(".pdf")) return "PDF";
  if (n.endsWith(".docx") || n.endsWith(".doc")) return "Word";
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return "Excel";
  if (n.endsWith(".csv")) return "CSV";
  if (n.endsWith(".txt")) return "Text";
  if (/\.(png|jpe?g|gif|webp)$/i.test(n)) return "Image";
  return "Other";
}


function DropFilesImport({ onSaved }: { onSaved: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [drafts, setDrafts] = useState<{ date: string; items: string[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function addFiles(picked: File[]) {
    const supported: File[] = [];
    const skipped: string[] = [];
    for (const f of picked) {
      if (isSupportedDrop(f)) supported.push(f);
      else skipped.push(f.name);
    }
    if (skipped.length) {
      setError(`Skipped unsupported file${skipped.length === 1 ? "" : "s"}: ${skipped.join(", ")}`);
    } else {
      setError(null);
    }
    if (supported.length) setFiles((prev) => [...prev, ...supported]);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setHover(false);
    const picked = Array.from(e.dataTransfer.files ?? []);
    if (picked.length) addFiles(picked);
  }

  async function extract() {
    if (files.length === 0) return;
    setLoading(true); setError(null);
    try {
      // Emails go through the email_files slot (so the backend parses
      // body + walks embedded attachments); everything else rides
      // along as loose attachments. Backend stitches them into one
      // Claude call so a week of mixed forwards is one extraction.
      const emailFiles = files.filter(isEmailFile);
      const attachments = files.filter((f) => !isEmailFile(f));
      const menus = await importEmail({ emailFiles, attachments });
      setDrafts(menus);
      if (menus.length === 0) {
        setError("No menus extracted. Add more context or try a different file.");
      }
    } catch (e) {
      setError((e as Error).message);
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }

  async function saveAll() {
    if (drafts.length === 0) return;
    setBusy(true); setError(null);
    try {
      await bulkUpsert(drafts.map((d) => ({ ...d, source: "drop" })));
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <p className="text-[12px] text-[#4a4d54] leading-relaxed">
        Drag and drop any combination of files — Outlook emails (<b>.eml</b> /
        <b> .msg</b>), <b>Word</b> docs (<b>.docx</b>), <b>PDFs</b>,
        <b> Excel</b> sheets (<b>.xlsx</b>), <b>CSVs</b>, text, or images.
        Emails are parsed for their body and embedded attachments; everything
        else is read alongside in a single extraction pass. Legacy
        <b> .doc</b> / <b>.xls</b> aren't readable — save as
        <b> .docx</b> / <b>.xlsx</b> first.
      </p>

      {/* Drop zone */}
      <div
        onDragEnter={(e) => { e.preventDefault(); setHover(true); }}
        onDragOver={(e) => { e.preventDefault(); setHover(true); }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className="mt-4 rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
        style={{
          padding: "32px 16px",
          background: hover ? "#faf7f1" : "#ffffff",
          borderColor: hover ? "#b89555" : "#d9d4c8",
        }}
      >
        <div className="text-[42px] leading-none text-[#b89555]">⬇</div>
        <div className="mt-2 font-serif-display text-[18px]">
          {hover ? "Drop to add" : "Drag files here"}
        </div>
        <div className="text-[11px] text-[#6b6f78] mt-1">
          or click to browse — <span className="font-mono">.eml .msg .pdf .docx .xlsx .csv .txt .png .jpg</span>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={SUPPORTED_DROP_EXTS}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length) addFiles(picked);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-3 border border-[#ece6d7] rounded-md overflow-hidden">
          <div className="px-3 py-1.5 bg-[#faf7f1] text-[10px] uppercase tracking-[0.15em] font-semibold text-[#6b6f78] flex items-center justify-between">
            <span>{files.length} file{files.length === 1 ? "" : "s"} queued</span>
            <button
              onClick={() => setFiles([])}
              className="text-[10px] text-[#6b6f78] hover:text-red-700"
            >
              Clear all
            </button>
          </div>
          <ul className="divide-y divide-[#ece6d7] max-h-[160px] overflow-y-auto">
            {files.map((f, i) => (
              <li key={i} className="px-3 py-1.5 flex items-center gap-2 text-[12px]">
                <span
                  className="text-[9px] uppercase tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: isEmailFile(f) ? "#1a1d24" : "#ece6d7", color: isEmailFile(f) ? "#fff" : "#1a1d24" }}
                >
                  {fileKindLabel(f)}
                </span>
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-[10px] text-[#6b6f78] tabular-nums shrink-0">
                  {Math.max(1, Math.round(f.size / 1024))} KB
                </span>
                <button
                  onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))}
                  className="text-[#6b6f78] hover:text-red-700"
                  title="Remove"
                >×</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="mt-3 text-[12px] text-red-700">{error}</div>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={extract}
          disabled={loading || files.length === 0}
          className="px-4 py-2 rounded-md text-[13px] font-semibold text-white"
          style={{ background: "#1a1d24", opacity: (loading || files.length === 0) ? 0.5 : 1 }}
        >
          {loading ? "Reading…" : `Extract menus from ${files.length || "0"} file${files.length === 1 ? "" : "s"} →`}
        </button>
        {drafts.length > 0 && (
          <span className="text-[12px] text-[#6b6f78]">{drafts.length} menu{drafts.length === 1 ? "" : "s"} ready</span>
        )}
      </div>

      {/* Drafts preview */}
      {drafts.length > 0 && (
        <div className="mt-4 border border-[#ece6d7] rounded-md overflow-hidden max-h-[260px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0" style={{ background: "#faf7f1" }}>
              <tr className="text-left">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Items</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={i} className="border-t border-[#ece6d7]">
                  <td className="px-2 py-1 font-mono">{d.date}</td>
                  <td className="px-2 py-1">{d.items.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          disabled={busy || drafts.length === 0}
          onClick={saveAll}
          className="px-5 py-2 rounded-md text-[13px] font-semibold text-white"
          style={{ background: "#1a1d24", opacity: busy || drafts.length === 0 ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : `Save ${drafts.length} menu${drafts.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}



function ManualForm({ onSaved }: { onSaved: () => void }) {
  const today = new Date();
  const [date, setDate] = useState(today.toISOString().slice(0, 10));
  const [itemsText, setItemsText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const items = itemsText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    if (!date) { setError("Pick a date."); return; }
    if (items.length === 0) { setError("Add at least one dish."); return; }
    setBusy(true);
    try {
      await upsertMenu(date, items, notes || undefined, "manual");
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <p className="text-[12px] text-[#4a4d54] leading-relaxed mb-3">
        One dish per line. Saves (or overwrites) the menu for that date.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FormRow label="Date *">
          <LuxInput type="date" value={date} onChange={setDate} />
        </FormRow>
        <FormRow label="Source tag">
          <LuxInput value="manual" onChange={() => {}} />
        </FormRow>
      </div>
      <FormRow label="Dishes * (one per line)" className="mt-3">
        <textarea
          value={itemsText}
          onChange={(e) => setItemsText(e.target.value)}
          rows={7}
          placeholder={"Grilled chicken\nSaffron rice\nCaesar salad\nBrownie"}
          className="w-full px-3 py-2 text-[13px] border border-[#d9d4c8] rounded-md bg-white focus:outline-none focus:border-[#b89555]"
        />
      </FormRow>
      <FormRow label="Notes (optional)" className="mt-3">
        <LuxInput value={notes} onChange={setNotes} placeholder="Pop-up caterer · special theme night" />
      </FormRow>
      {error && <div className="mt-3 text-[12px] text-red-700">{error}</div>}
      <div className="mt-5 flex justify-end">
        <button
          disabled={busy}
          onClick={save}
          className="px-5 py-2 rounded-md text-[13px] font-semibold text-white"
          style={{ background: "#1a1d24", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Saving…" : "Save menu"}
        </button>
      </div>
    </div>
  );
}




// ------------------------------------------------------------
// Shared atoms
// ------------------------------------------------------------
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <div className="font-serif-display text-[22px] leading-tight">{title}</div>
      {subtitle && <div className="text-[12px] text-[#6b6f78] mt-0.5">{subtitle}</div>}
    </div>
  );
}


function FormRow({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <div className="text-[11px] uppercase tracking-[0.12em] text-[#6b6f78] font-semibold mb-1">{label}</div>
      {children}
    </label>
  );
}


function LuxInput({
  value, onChange, placeholder, type,
}: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type ?? "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-[13px] border border-[#d9d4c8] rounded-md bg-white focus:outline-none focus:border-[#b89555]"
    />
  );
}


// ------------------------------------------------------------
// Date helpers — operate on local Y/M/D so no off-by-one drift on DST.
// ------------------------------------------------------------
function parseYMD(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function prettyDate(s: string): string {
  const d = parseYMD(s);
  if (!d) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
