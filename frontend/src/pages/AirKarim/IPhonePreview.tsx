// iPhone 15 Pro preview. Opens on an iOS Springboard (a few fake apps + the
// AirKarim app, branded with the Gencom G). Tapping AirKarim enters the app,
// which has:
//   • A "trips" home screen showing every trip as a bubble with a mini map
//     of its flight routes and a tight summary of cities / highlights.
//   • An itinerary screen that scrolls continuously through every day and has
//     a row of category icons at the top (airplane, martini, food, document,
//     car, hotel, phone, calendar) that jump into dedicated views.
//
// AI features (cocktail-bar and restaurant recommendations) are wired to
// /api/airkarim/recommendations and cached per-trip for the session.

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  Contact, Dining, Flight, Ground, Lodging, Meeting, Trip,
} from "./types";
import { fmtTime, fmtDate } from "./ui";
import {
  AppIcon, Chip, FlightMap, GencomG, IconTab, StubAppIcon, TabIcon,
  type IconName,
} from "./phoneBits";

// ------------------------------------------------------------------
// Types / helpers
// ------------------------------------------------------------------
type Screen =
  | { kind: "springboard" }
  | { kind: "trips" }
  | { kind: "itinerary"; tripId: string; category: CategoryKey | null };

// ------------------------------------------------------------------
// Shared recommendations cache (module-level) + fetcher. Prefetched when
// an itinerary opens so when the user taps a category tab the data is
// already there; also lets us sort/filter without refetching.
// ------------------------------------------------------------------
type Venue = {
  name: string;
  cuisine_or_style: string;
  neighborhood: string;
  source: string;
  accolade: string;
  website: string;
  why: string;
  price_range?: string; // "$" | "$$" | "$$$" | "$$$$"
};

type RecoKey = string;
type RecoState = { status: "loading" | "ok" | "error"; venues?: Venue[]; error?: string };

const recoCache: Map<RecoKey, RecoState> = new Map();
const recoSubs: Map<RecoKey, Set<() => void>> = new Map();

function recoKey(tripId: string, category: "bars" | "food", city: string, hotel: string) {
  return `${tripId}::${category}::${city}::${hotel}`;
}

function notifyReco(key: RecoKey) {
  recoSubs.get(key)?.forEach((cb) => cb());
}

function setReco(key: RecoKey, state: RecoState) {
  recoCache.set(key, state);
  notifyReco(key);
}

async function fetchRecommendations(
  tripId: string, category: "bars" | "food", city: string, hotel: string,
): Promise<void> {
  if (!city) return;
  const key = recoKey(tripId, category, city, hotel);
  const cur = recoCache.get(key);
  if (cur?.status === "ok" || cur?.status === "loading") return;
  setReco(key, { status: "loading" });
  try {
    const r = await fetch("/api/airkarim/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city, hotel, category }),
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    setReco(key, { status: "ok", venues: d.venues ?? [] });
  } catch (e) {
    setReco(key, { status: "error", error: (e as Error).message });
  }
}

function useReco(tripId: string, category: "bars" | "food", city: string, hotel: string): RecoState {
  const key = recoKey(tripId, category, city, hotel);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!city) return;
    if (!recoSubs.has(key)) recoSubs.set(key, new Set());
    const set = recoSubs.get(key)!;
    set.add(force);
    if (!recoCache.has(key)) fetchRecommendations(tripId, category, city, hotel);
    return () => { set.delete(force); };
  }, [key, tripId, category, city, hotel]);
  return recoCache.get(key) ?? { status: "loading" };
}

function pickCity(trip: Trip): string {
  return trip.destinations[0]?.city
    ?? trip.lodging[0]?.city
    ?? trip.meetings[0]?.city
    ?? trip.flights[0]?.arriveCity
    ?? "";
}

type CategoryKey =
  | "concierge" | "flights" | "bars" | "food" | "docs" | "ground" | "hotel" | "contacts" | "calendar" | "more";

const CATEGORY_ICON: Record<CategoryKey, IconName> = {
  concierge: "concierge",
  flights: "airplane",
  bars: "martini",
  food: "food",
  docs: "document",
  ground: "car",
  hotel: "hotel",
  contacts: "phone",
  calendar: "calendar",
  more: "question",
};

const CATEGORY_LABEL: Record<CategoryKey, string> = {
  concierge: "Karim",
  flights: "Flights",
  bars: "Bars",
  food: "Food",
  docs: "Docs",
  ground: "Cars",
  hotel: "Hotel",
  contacts: "SOS",
  calendar: "Cal",
  more: "More",
};

// Fixed 2 × 5 grid — top row, then bottom row.
const CATEGORY_ORDER: CategoryKey[] = [
  "concierge", "flights", "bars", "food", "docs",
  "ground", "hotel", "contacts", "calendar", "more",
];

type TimelineBlock =
  | ({ kind: "flight"; at: string; endAt?: string } & Flight)
  | ({ kind: "lodging-checkin"; at: string; endAt?: string } & Lodging)
  | ({ kind: "lodging-checkout"; at: string; endAt?: string } & Lodging)
  | ({ kind: "meeting"; at: string; endAt?: string } & Meeting)
  | ({ kind: "dining"; at: string; endAt?: string } & Dining)
  | ({ kind: "ground"; at: string; endAt?: string } & Ground);

function blocksForTrip(trip: Trip): TimelineBlock[] {
  const out: TimelineBlock[] = [];
  trip.flights.forEach((f) => out.push({ ...f, kind: "flight", at: f.departAt, endAt: f.arriveAt }));
  trip.lodging.forEach((l) => {
    out.push({ ...l, kind: "lodging-checkin", at: l.checkInAt });
    out.push({ ...l, kind: "lodging-checkout", at: l.checkOutAt });
  });
  trip.meetings.forEach((m) => out.push({ ...m, kind: "meeting", at: m.startAt, endAt: m.endAt }));
  trip.dining.forEach((d) => out.push({ ...d, kind: "dining", at: d.time }));
  trip.ground.forEach((g) => out.push({ ...g, kind: "ground", at: g.time }));
  return out.sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function blocksByDay(blocks: TimelineBlock[]): { key: string; label: string; items: TimelineBlock[] }[] {
  const m = new Map<string, TimelineBlock[]>();
  for (const b of blocks) {
    const k = dayKey(b.at);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(b);
  }
  const keys = [...m.keys()].sort();
  return keys.map((k) => {
    const [y, mm, d] = k.split("-").map((n) => parseInt(n, 10));
    const date = new Date(y, mm - 1, d);
    return {
      key: k,
      label: date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
      items: m.get(k)!,
    };
  });
}

function citySummary(trip: Trip): string[] {
  const set = new Set<string>();
  trip.destinations.forEach((d) => d.city && set.add(d.city));
  trip.flights.forEach((f) => {
    if (f.departCity) set.add(f.departCity);
    if (f.arriveCity) set.add(f.arriveCity);
  });
  return [...set];
}

function tripFlightLegs(trip: Trip) {
  return trip.flights
    .filter((f) => f.departAirport && f.arriveAirport)
    .map((f) => ({ from: f.departAirport, to: f.arriveAirport }));
}

function tripHighlights(trip: Trip): string[] {
  const out: string[] = [];
  if (trip.meetings[0]) out.push(`${trip.meetings.length} meeting${trip.meetings.length === 1 ? "" : "s"} — ${trip.meetings[0].title}`);
  if (trip.dining[0]) out.push(`Dinner at ${trip.dining[0].restaurant}`);
  if (trip.lodging[0]) out.push(trip.lodging[0].hotel);
  return out.slice(0, 3);
}

// ------------------------------------------------------------------
// Root preview modal
// ------------------------------------------------------------------
export default function IPhonePreview({
  trips, initialTripId, onClose,
}: {
  trips: Trip[];
  initialTripId: string | null;
  onClose: () => void;
}) {
  const [screen, setScreen] = useState<Screen>({ kind: "springboard" });

  // When the preview first opens, pre-select the trip the user was editing
  // so tapping the AirKarim icon takes them straight to that itinerary.
  const focusTripId = initialTripId ?? trips[0]?.id ?? null;

  function enterApp() {
    // Entering the app always lands on the trips list — that's the AirKarim
    // home screen per spec. The user taps a bubble to open an itinerary.
    setScreen({ kind: "trips" });
  }

  // Esc closes the preview. Clicking the dimmed backdrop (outside the white
  // card) also closes it — both are easier to discover than the × button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Currently-on trip drives the left-rail "CURRENTLY ON" callout. Computed
  // here so both the rail and TripsHome agree on which trip is "live".
  const currentlyOn = useMemo(() => trips.find((t) => tripStatus(t) === "currently_on") ?? null, [trips]);

  // Upcoming list for the right-rail "NEXT OUT THE DOOR" preview — earliest
  // first, capped at 4 so the rail stays scannable.
  const upcoming = useMemo(
    () => trips
      .filter((t) => tripStatus(t) === "upcoming")
      .sort((a, b) => +new Date(a.startDate) - +new Date(b.startDate))
      .slice(0, 4),
    [trips],
  );

  return (
    <div
      className="fixed inset-0 z-50 overflow-auto"
      style={{
        background: "#0a0a0a",
        color: "rgba(255,255,255,0.85)",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Close button — gold-on-onyx so it reads against the dark page. */}
      <button
        onClick={onClose}
        className="fixed top-4 right-4 z-10 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold shadow-lg"
        style={{
          background: "rgba(255,255,255,0.06)",
          color: "#fff",
          border: "1px solid rgba(184,149,85,0.4)",
        }}
        aria-label="Close preview"
        title="Close preview (Esc)"
      >
        <span className="text-lg leading-none">✕</span>
        <span>Close</span>
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ color: "rgba(255,255,255,0.55)", background: "rgba(255,255,255,0.06)" }}>Esc</span>
      </button>

      {/* Three-column layout: left rail · phone · right rail. Rails fade out
          on narrow screens so the phone stays usable on tablet/mobile. */}
      <div className="min-h-screen flex items-start justify-center pt-10 pb-16 px-6">
        <div className="grid items-start gap-x-10"
             style={{
               gridTemplateColumns: "minmax(0, 230px) auto minmax(0, 260px)",
               maxWidth: 1240,
             }}
        >
          <LeftRail
            currentlyOn={currentlyOn}
            onTrips={() => setScreen({ kind: "trips" })}
            onCurrentlyOn={() => currentlyOn && setScreen({ kind: "itinerary", tripId: currentlyOn.id, category: null })}
            currentScreen={screen}
          />

          <div className="flex justify-center">
            <PhoneFrame>
              {screen.kind === "springboard" && (
                <Springboard onOpenAirKarim={enterApp} />
              )}
              {screen.kind === "trips" && (
                <TripsHome
                  trips={trips}
                  onBack={() => setScreen({ kind: "springboard" })}
                  onOpenTrip={(id) => setScreen({ kind: "itinerary", tripId: id, category: null })}
                />
              )}
              {screen.kind === "itinerary" && (
                <ItineraryScreen
                  trip={trips.find((t) => t.id === screen.tripId) ?? trips[0]}
                  category={screen.category}
                  onBack={() => setScreen({ kind: "trips" })}
                  onCategory={(c) => setScreen({ kind: "itinerary", tripId: screen.tripId, category: c })}
                />
              )}
            </PhoneFrame>
          </div>

          <RightRail
            trips={trips}
            upcoming={upcoming}
            onOpenTrip={(id) => setScreen({ kind: "itinerary", tripId: id, category: null })}
          />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Onyx side rails — content lives here on wide screens so the phone
// reads as a focused device against the editorial chrome.
// ------------------------------------------------------------------

const ONYX_GOLD = "#b89555";
const ONYX_INK_DIM = "rgba(255,255,255,0.55)";
const ONYX_BORDER = "rgba(255,255,255,0.10)";
const ONYX_SURFACE = "rgba(255,255,255,0.04)";
const SERIF_DISPLAY = "'Playfair Display', 'Cormorant Garamond', Georgia, serif";

function tripStatus(trip: Trip): "past" | "currently_on" | "upcoming" {
  const now = Date.now();
  const s = +new Date(trip.startDate);
  const e = +new Date(trip.endDate);
  if (Number.isNaN(s) || Number.isNaN(e)) return "upcoming";
  if (now > e) return "past";
  if (now >= s) return "currently_on";
  return "upcoming";
}

function fmtRangeShort(s?: string, e?: string): string {
  if (!s || !e) return "";
  const ss = new Date(s); const ee = new Date(e);
  if (Number.isNaN(ss.getTime()) || Number.isNaN(ee.getTime())) return "";
  const a = ss.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const b = ee.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${a.toUpperCase()} — ${b.toUpperCase()}`;
}

function tripDayCount(t: Trip): number {
  const s = +new Date(t.startDate), e = +new Date(t.endDate);
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.max(1, Math.round((e - s) / 86400_000) + 1);
}

function tripCityList(t: Trip): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of t.destinations || []) {
    const c = d.city?.trim();
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  for (const f of t.flights || []) {
    const c = f.arriveCity?.trim();
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

function tripCityIatas(t: Trip): string[] {
  const out: string[] = [];
  for (const f of t.flights || []) {
    const code = (f.arriveAirport || "").slice(0, 3).toUpperCase();
    if (code && !out.includes(code)) out.push(code);
  }
  if (out.length === 0 && t.flights?.[0]?.departAirport) out.push(t.flights[0].departAirport.toUpperCase());
  return out.slice(0, 2);
}

function tripTitleShort(t: Trip): string {
  const cities = tripCityList(t);
  if (cities.length >= 2) return cities.slice(0, 3).join(" · ");
  return cities[0] || t.title;
}

function LeftRail({
  currentlyOn, onTrips, onCurrentlyOn, currentScreen,
}: {
  currentlyOn: Trip | null;
  onTrips: () => void;
  onCurrentlyOn: () => void;
  currentScreen: Screen;
}) {
  const onTripsActive = currentScreen.kind === "trips";
  return (
    <aside className="hidden lg:block pt-6" style={{ color: "rgba(255,255,255,0.85)" }}>
      <div className="flex items-center gap-3 mb-7">
        <GencomG size={28} />
        <div>
          <div className="text-[18px] font-bold leading-none" style={{ fontFamily: SERIF_DISPLAY }}>AirKarim</div>
          <div className="text-[10px] uppercase tracking-[0.18em] mt-1" style={{ color: ONYX_INK_DIM }}>Owner Travel</div>
        </div>
      </div>

      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: ONYX_INK_DIM }}>Navigate</div>
      <nav className="space-y-1 mb-7">
        <RailLink active={onTripsActive} onClick={onTrips} icon="◎" label="Trips" />
        <RailLink active={false} onClick={onCurrentlyOn} icon="✈" label="Currently on" disabled={!currentlyOn} />
        <RailLink active={false} onClick={() => alert("Karim AI lives inside an itinerary — open a trip first.")} icon="✦" label="Karim" />
      </nav>

      {currentlyOn && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-2" style={{ color: ONYX_INK_DIM }}>Currently on</div>
          <button
            onClick={onCurrentlyOn}
            className="text-left block w-full"
            style={{ color: "rgba(255,255,255,0.92)" }}
          >
            <div className="text-[15px] font-semibold leading-snug" style={{ fontFamily: SERIF_DISPLAY }}>
              {tripTitleShort(currentlyOn)}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: ONYX_INK_DIM }}>
              {new Date(currentlyOn.startDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              {" → "}
              {new Date(currentlyOn.endDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            </div>
          </button>
        </div>
      )}
    </aside>
  );
}

function RailLink({
  active, onClick, icon, label, disabled,
}: { active: boolean; onClick: () => void; icon: string; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: active ? "rgba(184,149,85,0.12)" : "transparent",
        color: active ? "#fff" : "rgba(255,255,255,0.78)",
        border: active ? "1px solid rgba(184,149,85,0.35)" : "1px solid transparent",
      }}
    >
      <span style={{ color: ONYX_GOLD, width: 14, textAlign: "center" }}>{icon}</span>
      <span className="text-[13px] font-medium">{label}</span>
    </button>
  );
}

function RightRail({
  trips, upcoming, onOpenTrip,
}: { trips: Trip[]; upcoming: Trip[]; onOpenTrip: (id: string) => void }) {
  // The book stat counts — onNow / upcoming / tentative / past. We don't
  // currently model "tentative" in the data, so it always shows 0; left in
  // place for future status field on Trip.
  const counts = useMemo(() => {
    const now: Record<"on" | "up" | "te" | "pa", number> = { on: 0, up: 0, te: 0, pa: 0 };
    for (const t of trips) {
      const s = tripStatus(t);
      if (s === "currently_on") now.on++;
      else if (s === "upcoming") now.up++;
      else if (s === "past") now.pa++;
    }
    return now;
  }, [trips]);

  return (
    <aside className="hidden lg:block pt-6">
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: ONYX_INK_DIM }}>The Book — 2025</div>
      <div className="grid grid-cols-2 gap-2 mb-7">
        <StatTile n={counts.on} label="On Now" />
        <StatTile n={counts.up} label="Upcoming" />
        <StatTile n={counts.te} label="Tentative" />
        <StatTile n={counts.pa} label="Past" />
      </div>

      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mb-3" style={{ color: ONYX_INK_DIM }}>Next out the door</div>
      <div className="space-y-3 mb-6">
        {upcoming.length === 0 && (
          <div className="text-[12px] italic" style={{ color: ONYX_INK_DIM }}>No upcoming trips on the book.</div>
        )}
        {upcoming.map((t, i) => {
          const cityRoute = tripCityIatas(t).join(" · ") || tripCityList(t).slice(0, 2).join(" · ");
          return (
            <button
              key={t.id}
              onClick={() => onOpenTrip(t.id)}
              className="w-full text-left block"
              style={i < upcoming.length - 1 ? { borderBottom: `1px solid ${ONYX_BORDER}`, paddingBottom: 12 } : {}}
            >
              <div className="text-[10px] uppercase tracking-[0.16em] font-semibold mb-0.5" style={{ color: ONYX_GOLD }}>
                {fmtRangeShort(t.startDate, t.endDate)}{cityRoute ? ` · ${cityRoute}` : ""}
              </div>
              <div className="text-[14px] font-semibold" style={{ fontFamily: SERIF_DISPLAY, color: "#fff" }}>
                {tripTitleShort(t)}
              </div>
              {t.purpose && (
                <div className="text-[11px] mt-0.5" style={{ color: ONYX_INK_DIM }}>{t.purpose}</div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function StatTile({ n, label }: { n: number; label: string }) {
  return (
    <div
      className="rounded-md px-3 py-3"
      style={{ background: ONYX_SURFACE, border: `1px solid ${ONYX_BORDER}` }}
    >
      <div className="text-[26px] font-bold leading-none" style={{ fontFamily: SERIF_DISPLAY, color: "#fff" }}>{n}</div>
      <div className="text-[10px] uppercase tracking-[0.16em] mt-1" style={{ color: ONYX_INK_DIM }}>{label}</div>
    </div>
  );
}

// ------------------------------------------------------------------
// Phone frame chrome
// ------------------------------------------------------------------
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative" style={{ width: 390, height: 844 }}>
      <div
        className="absolute inset-0 rounded-[56px] shadow-[0_30px_80px_-10px_rgba(0,0,0,0.5)]"
        style={{ background: "linear-gradient(180deg, #1c1c1e 0%, #0b0b0d 100%)" }}
      >
        <div className="absolute inset-[10px] rounded-[48px] overflow-hidden bg-black">
          <div
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black z-20"
            style={{ top: 11, width: 122, height: 37 }}
          />
          <div
            className="absolute inset-0 bg-black overflow-hidden"
            style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro', Inter, system-ui, sans-serif" }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBar({ light }: { light: boolean }) {
  const now = new Date();
  const t = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/, "");
  const color = light ? "#fff" : "#1c1c1e";
  return (
    <div className="flex items-center justify-between px-8 pt-3 pb-1 text-[13px] font-semibold" style={{ color }}>
      <div>{t}</div>
      <div className="flex items-center gap-1 opacity-90">
        <span>●●●●</span>
        <span className="ml-1">▪▪▪</span>
        <span className="ml-1" style={{ opacity: 0.8 }}>▰</span>
      </div>
    </div>
  );
}

function HomeIndicator({ light }: { light: boolean }) {
  return (
    <div className="flex justify-center py-2 shrink-0">
      <div className="h-[5px] w-[136px] rounded-full" style={{ background: light ? "#fff" : "#1c1c1e", opacity: 0.9 }} />
    </div>
  );
}

// ------------------------------------------------------------------
// Screen 1 — iOS Springboard with a few stub apps + AirKarim (Gencom G)
// ------------------------------------------------------------------
function Springboard({ onOpenAirKarim }: { onOpenAirKarim: () => void }) {
  const bg: CSSProperties = {
    // Soft iOS-ish gradient wallpaper.
    background:
      "radial-gradient(80% 60% at 20% 10%, #3a5a9f 0%, #1e2e55 40%, #0f1a36 80%)",
  };

  const stubs: Array<{ label: string; emoji: string; color: string }> = [
    { label: "Messages", emoji: "💬", color: "#34c759" },
    { label: "Mail", emoji: "✉", color: "#007aff" },
    { label: "Calendar", emoji: "📅", color: "#ffffff" },
    { label: "Photos", emoji: "🌈", color: "#111" },
    { label: "Maps", emoji: "🗺", color: "#e3f2fd" },
    { label: "Camera", emoji: "📷", color: "#3a3a3c" },
    { label: "Weather", emoji: "⛅", color: "#3a6b9f" },
    { label: "Wallet", emoji: "💳", color: "#111" },
    { label: "Safari", emoji: "🧭", color: "#0a84ff" },
    { label: "Notes", emoji: "📝", color: "#fbbf24" },
    { label: "Settings", emoji: "⚙", color: "#8e8e93" },
  ];

  return (
    <div className="h-full flex flex-col text-white" style={bg}>
      <StatusBar light />
      <div className="text-center pt-4 pb-2">
        <div className="text-[54px] font-light leading-none">9:41</div>
        <div className="text-[13px] opacity-90 mt-1">Wednesday, April 22</div>
      </div>

      <div className="flex-1 px-5 pt-4">
        <div className="grid grid-cols-4 gap-x-3 gap-y-5">
          <button onClick={onOpenAirKarim} className="flex flex-col items-center active:scale-95 transition">
            <AppIcon size={60} label="AirKarim" />
          </button>
          {stubs.map((s) => (
            <StubAppIcon key={s.label} size={60} label={s.label} color={s.color} emoji={s.emoji} />
          ))}
        </div>
      </div>

      {/* iOS-style dock */}
      <div className="mx-4 mb-2 rounded-[32px] px-3 py-3" style={{ background: "rgba(255,255,255,0.18)", backdropFilter: "blur(16px)" }}>
        <div className="grid grid-cols-4 gap-3 justify-items-center">
          <StubAppIcon size={56} label="" color="#34c759" emoji="☎" />
          <StubAppIcon size={56} label="" color="#0a84ff" emoji="✉" />
          <StubAppIcon size={56} label="" color="#0a84ff" emoji="🧭" />
          <button onClick={onOpenAirKarim}><AppIcon size={56} /></button>
        </div>
      </div>
      <HomeIndicator light />
    </div>
  );
}

// ------------------------------------------------------------------
// Screen 2 — AirKarim home: trips list as bubbles with mini maps
// ------------------------------------------------------------------
function TripsHome({
  trips, onBack: _onBack, onOpenTrip,
}: { trips: Trip[]; onBack: () => void; onOpenTrip: (id: string) => void }) {
  // Group trips by status. Past sorted newest-first; upcoming earliest-first.
  const groups = useMemo(() => {
    const on: Trip[] = []; const up: Trip[] = []; const past: Trip[] = [];
    for (const t of trips) {
      const s = tripStatus(t);
      if (s === "currently_on") on.push(t);
      else if (s === "upcoming") up.push(t);
      else past.push(t);
    }
    up.sort((a, b) => +new Date(a.startDate) - +new Date(b.startDate));
    past.sort((a, b) => +new Date(b.endDate) - +new Date(a.endDate));
    return { on, up, past };
  }, [trips]);

  // Stat strip: # upcoming, distinct countries, total trips. Countries are
  // pulled from destination city strings as a heuristic (we don't store
  // country codes on destinations, so the count is approximate).
  const stats = useMemo(() => {
    const countries = new Set<string>();
    for (const t of trips) {
      for (const d of t.destinations || []) {
        const country = (d as { country?: string }).country?.trim();
        if (country) countries.add(country);
      }
    }
    return { upcoming: groups.up.length, countries: countries.size || tripCityList(trips[0] ?? ({} as Trip)).length, total: trips.length };
  }, [trips, groups.up.length]);

  const today = new Date();
  const eyebrow = `${today.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase()} · THE BOOK`;

  return (
    <div className="h-full flex flex-col" style={{ background: "#fbf8f0", color: "#1a1a1a", fontFamily: "Inter, system-ui, sans-serif" }}>
      <StatusBar light={false} />

      {/* AirKarim mini header inside the phone */}
      <div className="px-5 pt-3 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <GencomG size={22} />
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: ONYX_GOLD }}>AirKarim</div>
            <div className="text-[13px] font-semibold leading-tight">Karim Alibhai</div>
          </div>
        </div>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "rgba(184,149,85,0.12)", border: `1px solid ${ONYX_GOLD}40` }}
        >
          <span style={{ color: ONYX_GOLD, fontSize: 14 }}>✦</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Headline + stat strip */}
        <div className="px-5 pt-3 pb-4">
          <div className="text-[10px] uppercase tracking-[0.22em] font-semibold mb-2" style={{ color: "rgba(0,0,0,0.55)" }}>{eyebrow}</div>
          <div className="leading-none mb-4" style={{ fontFamily: SERIF_DISPLAY, fontSize: 56, fontWeight: 700, color: "#1a1a1a" }}>
            Trips.
          </div>
          <div className="flex items-end gap-6 pb-1" style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
            <Stat n={stats.upcoming} label="Upcoming" />
            <Stat n={stats.countries} label="Countries" />
            <Stat n={stats.total} label="Trips" />
          </div>
        </div>

        {/* CURRENTLY ON featured card */}
        {groups.on.length > 0 && (
          <div className="px-4 pb-4">
            <SectionEyebrow>Currently on</SectionEyebrow>
            {groups.on.map((t) => <FeaturedTripCard key={t.id} trip={t} onOpen={() => onOpenTrip(t.id)} />)}
          </div>
        )}

        {/* UPCOMING */}
        {groups.up.length > 0 && (
          <div className="px-4 pb-4">
            <div className="flex items-baseline justify-between mb-2.5 px-1">
              <SectionEyebrow inline>Upcoming</SectionEyebrow>
              <span className="text-[11px] font-semibold" style={{ color: "rgba(0,0,0,0.45)" }}>{groups.up.length}</span>
            </div>
            <div className="space-y-2">
              {groups.up.map((t) => <CompactTripCard key={t.id} trip={t} status="upcoming" onOpen={() => onOpenTrip(t.id)} />)}
            </div>
          </div>
        )}

        {/* PAST */}
        {groups.past.length > 0 && (
          <div className="px-4 pb-6">
            <div className="flex items-baseline justify-between mb-2.5 px-1">
              <SectionEyebrow inline>Past</SectionEyebrow>
              <span className="text-[11px] font-semibold" style={{ color: "rgba(0,0,0,0.45)" }}>{groups.past.length}</span>
            </div>
            <div className="space-y-2">
              {groups.past.map((t) => <CompactTripCard key={t.id} trip={t} status="past" onOpen={() => onOpenTrip(t.id)} />)}
            </div>
          </div>
        )}

        {trips.length === 0 && (
          <div className="text-[13px] italic px-5 py-8" style={{ color: "rgba(0,0,0,0.5)" }}>
            No trips on the book yet — author one in the editor.
          </div>
        )}
      </div>

      <HomeIndicator light={false} />
    </div>
  );
}

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <div>
      <div className="leading-none" style={{ fontFamily: SERIF_DISPLAY, fontSize: 32, fontWeight: 700, color: "#1a1a1a" }}>{n}</div>
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold mt-1" style={{ color: "rgba(0,0,0,0.55)" }}>{label}</div>
    </div>
  );
}

function SectionEyebrow({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <div
      className={`text-[10px] uppercase tracking-[0.22em] font-semibold ${inline ? "" : "mb-2.5 px-1"}`}
      style={{ color: "rgba(0,0,0,0.5)" }}
    >
      {children}
    </div>
  );
}

function FeaturedTripCard({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const cities = tripCityList(trip);
  const legs = tripFlightLegs(trip);
  const days = tripDayCount(trip);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-xl overflow-hidden active:scale-[0.995] transition"
      style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
    >
      <div className="relative" style={{ background: "#f3ebd9", height: 130 }}>
        <FlightMap legs={legs} cities={cities} width={360} height={130} />
        <div
          className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] uppercase tracking-[0.18em] font-bold flex items-center gap-1"
          style={{ background: ONYX_GOLD, color: "#fff" }}
        >
          <span>✈</span>
          <span>On Trip</span>
        </div>
      </div>
      <div className="p-4">
        <div className="text-[10px] uppercase tracking-[0.20em] font-semibold mb-1.5" style={{ color: "rgba(0,0,0,0.5)" }}>
          {fmtRangeShort(trip.startDate, trip.endDate)} · {days} {days === 1 ? "day" : "days"}
        </div>
        <div className="leading-tight" style={{ fontFamily: SERIF_DISPLAY, fontSize: 24, fontWeight: 700, color: "#1a1a1a" }}>
          {tripTitleShort(trip)}
        </div>
        {trip.purpose && (
          <div className="text-[12px] italic mt-0.5" style={{ color: "rgba(0,0,0,0.55)" }}>{trip.purpose}</div>
        )}
        {cities.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-2.5">
            {cities.slice(0, 4).map((c) => (
              <span key={c} className="text-[11px] px-2.5 py-0.5 rounded-full"
                    style={{ background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.08)" }}>{c}</span>
            ))}
            {cities.length > 4 && <span className="text-[11px] px-2.5 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.05)" }}>+{cities.length - 4}</span>}
          </div>
        )}
      </div>
    </button>
  );
}

function CompactTripCard({ trip, status, onOpen }: { trip: Trip; status: "upcoming" | "past"; onOpen: () => void }) {
  const codes = tripCityIatas(trip);
  const pillLabel = status === "upcoming" ? "Upcoming" : "Past";
  const pillColor = status === "upcoming" ? ONYX_GOLD : "rgba(0,0,0,0.4)";
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-xl flex items-stretch active:scale-[0.995] transition"
      style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)" }}
    >
      <div
        className="flex flex-col justify-center items-center px-3.5 py-3 gap-0.5"
        style={{ borderRight: "1px solid rgba(0,0,0,0.06)", minWidth: 64 }}
      >
        {codes.length === 0 && <div className="text-[12px] font-bold tracking-[0.06em]" style={{ color: "rgba(0,0,0,0.6)" }}>—</div>}
        {codes.map((c, i) => (
          <div key={i} className="text-[12px] font-bold tracking-[0.06em]" style={{ color: "rgba(0,0,0,0.65)" }}>{c}</div>
        ))}
      </div>
      <div className="flex-1 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: "rgba(0,0,0,0.5)" }}>
            {fmtRangeShort(trip.startDate, trip.endDate)}
          </div>
          <span
            className="text-[9px] uppercase tracking-[0.16em] font-bold px-2 py-0.5 rounded-full"
            style={{
              color: pillColor,
              background: status === "upcoming" ? "rgba(184,149,85,0.10)" : "rgba(0,0,0,0.05)",
              border: status === "upcoming" ? `1px solid ${ONYX_GOLD}40` : "1px solid rgba(0,0,0,0.10)",
            }}
          >
            {pillLabel}
          </span>
        </div>
        <div className="leading-tight truncate" style={{ fontFamily: SERIF_DISPLAY, fontSize: 17, fontWeight: 700, color: "#1a1a1a" }}>
          {tripTitleShort(trip)}
        </div>
        {trip.purpose && (
          <div className="text-[11px] italic truncate mt-0.5" style={{ color: "rgba(0,0,0,0.55)" }}>{trip.purpose}</div>
        )}
      </div>
      <div className="flex items-center pr-3" style={{ color: "rgba(0,0,0,0.3)" }}>›</div>
    </button>
  );
}

// ------------------------------------------------------------------
// Screen 3 — Itinerary with icon-tab header and continuous scrolling
// ------------------------------------------------------------------
function ItineraryScreen({
  trip, category, onBack, onCategory,
}: {
  trip: Trip;
  category: CategoryKey | null;
  onBack: () => void;
  onCategory: (c: CategoryKey | null) => void;
}) {
  const blocks = useMemo(() => blocksForTrip(trip), [trip]);
  const days = useMemo(() => blocksByDay(blocks), [blocks]);

  // Prefetch bar + restaurant recommendations in the background so both
  // categories feel instant when the user taps those tabs.
  const tripCity = useMemo(() => pickCity(trip), [trip]);
  const tripHotel = trip.lodging[0]?.hotel ?? "";
  useEffect(() => {
    if (!tripCity) return;
    fetchRecommendations(trip.id, "bars", tripCity, tripHotel);
    fetchRecommendations(trip.id, "food", tripCity, tripHotel);
  }, [trip.id, tripCity, tripHotel]);

  // Which event (if any) is being drilled into. Opens a detail overlay with
  // full info + a "Get a ride" button. null = normal panel view.
  const [detail, setDetail] = useState<TimelineBlock | null>(null);

  return (
    <div className="h-full flex flex-col" style={{ background: "#F2F2F7", color: "#1c1c1e" }}>
      <StatusBar light={false} />

      <div className="px-4 pt-1 pb-2 flex items-center justify-between text-[15px]" style={{ color: "#0a84ff" }}>
        <button onClick={detail ? () => setDetail(null) : onBack}>
          {detail ? "‹ Back" : "‹ Trips"}
        </button>
        <div style={{ color: "#1c1c1e", fontWeight: 600 }} className="truncate px-2">{trip.title}</div>
        <div className="opacity-0 text-[15px]">‹</div>
      </div>

      {!detail && (
        <div className="px-2 pt-1 pb-2">
          {/* Fixed 2 × 5 grid — all ten slots visible, no scroll. */}
          <div className="grid grid-cols-5 gap-x-1 gap-y-1 place-items-center">
            {CATEGORY_ORDER.map((key) => (
              <IconTab
                key={key}
                name={CATEGORY_ICON[key]}
                label={CATEGORY_LABEL[key]}
                active={category === key}
                onClick={() => {
                  if (key === "more") {
                    // Placeholder category — alert for now, will become its
                    // own panel once the user decides what goes here.
                    alert("Coming Soon!");
                    return;
                  }
                  onCategory(category === key ? null : key);
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {detail ? (
          <EventDetail block={detail} trip={trip} />
        ) : (
          <>
            {category === null && <AllDaysList days={days} onOpenEvent={setDetail} />}
            {category === "concierge" && <ConciergePanel trip={trip} />}
            {category === "flights" && <FlightsPanel trip={trip} onOpenEvent={setDetail} />}
            {category === "bars" && <RecommendationsPanel trip={trip} category="bars" />}
            {category === "food" && <FoodPanel trip={trip} onOpenEvent={setDetail} />}
            {category === "docs" && <DocsPanel trip={trip} onOpenEvent={setDetail} />}
            {category === "ground" && <GroundPanel trip={trip} onOpenEvent={setDetail} />}
            {category === "hotel" && <HotelPanel trip={trip} onOpenEvent={setDetail} />}
            {category === "contacts" && <ContactsPanel trip={trip} />}
            {category === "calendar" && <CalendarPanel trip={trip} onOpenEvent={setDetail} />}
          </>
        )}
      </div>

      <HomeIndicator light={false} />
    </div>
  );
}

// ------------------------------------------------------------------
// Panel: continuous day list (default view, no sub-category)
// ------------------------------------------------------------------
const KIND_STYLE: Record<TimelineBlock["kind"], { label: string; tint: string; icon: string }> = {
  "flight":           { label: "Flight",    tint: "bg-[#5AC8FA]/20 text-[#0a84ff]", icon: "✈︎" },
  "lodging-checkin":  { label: "Check-in",  tint: "bg-[#BF5AF2]/20 text-[#AF52DE]", icon: "⌂" },
  "lodging-checkout": { label: "Check-out", tint: "bg-[#BF5AF2]/20 text-[#AF52DE]", icon: "⌂" },
  "meeting":          { label: "Meeting",   tint: "bg-[#34C759]/20 text-[#248A3D]", icon: "◉" },
  "dining":           { label: "Dining",    tint: "bg-[#FF9500]/20 text-[#C76D00]", icon: "🍽" },
  "ground":           { label: "Ground",    tint: "bg-[#8E8E93]/20 text-[#48484A]", icon: "▸" },
};

function AllDaysList({
  days, onOpenEvent,
}: {
  days: { key: string; label: string; items: TimelineBlock[] }[];
  onOpenEvent?: (b: TimelineBlock) => void;
}) {
  if (days.length === 0) {
    return <div className="px-6 py-10 text-[14px] text-slate-500 italic text-center">Nothing scheduled yet.</div>;
  }
  return (
    <div className="px-4 pt-2 pb-6 space-y-4">
      {days.map((d) => (
        <div key={d.key}>
          <div className="px-1 py-2 sticky top-0 z-10" style={{ background: "#F2F2F7" }}>
            <div className="text-[18px] font-bold leading-tight">{d.label}</div>
          </div>
          <div className="space-y-2">
            {d.items.map((b) => (
              <BlockCard
                key={b.kind + (b as any).id + b.at}
                block={b}
                onClick={onOpenEvent ? () => onOpenEvent(b) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BlockCard({ block, onClick }: { block: TimelineBlock; onClick?: () => void }) {
  const style = KIND_STYLE[block.kind];
  const inner = (
    <div className="p-3 flex items-start gap-3">
      <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-[18px] font-semibold ${style.tint}`}>
        {style.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-70">{style.label}</div>
          <div className="text-[13px] opacity-70 whitespace-nowrap">{fmtTime(block.at)}</div>
        </div>
        <div className="text-[15px] font-semibold leading-tight">{blockHeadline(block)}</div>
        <div className="text-[13px] opacity-70 leading-tight mt-0.5">{blockSubhead(block)}</div>
      </div>
      {onClick && <div className="text-slate-300 text-[18px] shrink-0 self-center">›</div>}
    </div>
  );
  if (onClick) {
    return (
      <button onClick={onClick} className="w-full text-left rounded-2xl overflow-hidden active:bg-slate-50" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
        {inner}
      </button>
    );
  }
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
      {inner}
    </div>
  );
}

function blockHeadline(b: TimelineBlock): string {
  if (b.kind === "flight") return `${b.airline} ${b.flightNumber} · ${b.departAirport} → ${b.arriveAirport}`;
  if (b.kind === "lodging-checkin") return `Check-in · ${b.hotel}`;
  if (b.kind === "lodging-checkout") return `Check-out · ${b.hotel}`;
  if (b.kind === "meeting") return b.title;
  if (b.kind === "dining") return b.restaurant;
  if (b.kind === "ground") return `${b.transportKind}${b.provider ? ` · ${b.provider}` : ""}`;
  return "";
}
function blockSubhead(b: TimelineBlock): string {
  if (b.kind === "flight") return `${b.departCity ?? b.departAirport} → ${b.arriveCity ?? b.arriveAirport}${b.seat ? ` · Seat ${b.seat}` : ""}`;
  if (b.kind === "lodging-checkin" || b.kind === "lodging-checkout") return b.address;
  if (b.kind === "meeting") return b.location;
  if (b.kind === "dining") return b.address;
  if (b.kind === "ground") return `${b.pickup} → ${b.dropoff}`;
  return "";
}

// ------------------------------------------------------------------
// Panel: Flights — full detail of every flight
// ------------------------------------------------------------------
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="text-[20px] font-bold leading-tight">{title}</div>
      {subtitle && <div className="text-[13px] opacity-70">{subtitle}</div>}
    </div>
  );
}

function Row({ label, value, mono, multiline }: { label: string; value: string; mono?: boolean; multiline?: boolean }) {
  if (!value) return null;
  return (
    <div className="px-4 py-3 flex items-start gap-3" style={{ borderTop: "1px solid #e5e5ea" }}>
      <div className="text-[13px] w-[35%] shrink-0" style={{ color: "#636366" }}>{label}</div>
      <div
        className={`text-[15px] flex-1 min-w-0 ${mono ? "font-mono" : ""}`}
        style={{ color: "#1c1c1e", whiteSpace: multiline ? "pre-wrap" : "normal" }}
      >{value}</div>
    </div>
  );
}

function Card({
  children, title, subtitle, icon, onClick,
}: {
  children?: React.ReactNode;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}) {
  const header = (
    <div className="p-3 flex items-start gap-3">
      {icon && <div className="shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold leading-tight truncate">{title}</div>
        {subtitle && <div className="text-[13px] opacity-70 leading-tight mt-0.5">{subtitle}</div>}
      </div>
      {onClick && <div className="text-slate-300 text-[18px] shrink-0 self-center">›</div>}
    </div>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="mx-4 mb-3 w-[calc(100%-2rem)] text-left rounded-2xl overflow-hidden active:bg-slate-50"
        style={{ background: "#fff", border: "1px solid #e5e5ea" }}
      >
        {header}
        {children}
      </button>
    );
  }
  return (
    <div className="mx-4 mb-3 rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
      {header}
      {children}
    </div>
  );
}

function FlightsPanel({ trip, onOpenEvent }: { trip: Trip; onOpenEvent?: (b: TimelineBlock) => void }) {
  if (trip.flights.length === 0) return <EmptyPanel title="No flights" subtitle="Flights you add will appear here with gate, seat, and confirmation info." />;
  return (
    <>
      <SectionHeader title="Flights" subtitle={`${trip.flights.length} flight${trip.flights.length === 1 ? "" : "s"}`} />
      {trip.flights.map((f) => (
        <Card
          key={f.id}
          icon={<div className="w-10 h-10 rounded-full flex items-center justify-center text-[18px] bg-[#5AC8FA]/20 text-[#0a84ff]">✈︎</div>}
          title={`${f.airline} ${f.flightNumber}`}
          subtitle={`${f.departAirport} → ${f.arriveAirport}`}
          onClick={onOpenEvent ? () => onOpenEvent({ ...f, kind: "flight", at: f.departAt, endAt: f.arriveAt }) : undefined}
        >
          <Row label="Aircraft" value={f.aircraftType ?? ""} />
          <Row label="Depart" value={`${f.departAirport}${f.departCity ? ` — ${f.departCity}` : ""}${f.departTerminal ? ` · T${f.departTerminal}` : ""}${f.departGate ? ` · Gate ${f.departGate}` : ""}`} />
          <Row label="Depart time" value={`${fmtDate(f.departAt)} · ${fmtTime(f.departAt)}`} />
          <Row label="Arrive" value={`${f.arriveAirport}${f.arriveCity ? ` — ${f.arriveCity}` : ""}${f.arriveTerminal ? ` · T${f.arriveTerminal}` : ""}${f.arriveGate ? ` · Gate ${f.arriveGate}` : ""}`} />
          <Row label="Arrive time" value={`${fmtDate(f.arriveAt)} · ${fmtTime(f.arriveAt)}`} />
          <Row label="Seat" value={`${f.seat ?? ""}${f.cabin ? ` · ${f.cabin}` : ""}`.trim()} />
          <Row label="Confirmation" value={f.confirmation ?? ""} mono />
          <Row label="Duration" value={f.durationMin ? `${Math.floor(f.durationMin / 60)}h ${f.durationMin % 60}m` : ""} />
          <Row label="Notes" value={f.notes ?? ""} multiline />
        </Card>
      ))}
    </>
  );
}

// ------------------------------------------------------------------
// Panel: Hotel, Ground, Contacts, Docs
// ------------------------------------------------------------------
function HotelPanel({ trip, onOpenEvent }: { trip: Trip; onOpenEvent?: (b: TimelineBlock) => void }) {
  if (trip.lodging.length === 0) return <EmptyPanel title="No lodging" subtitle="Add a hotel on the editor side — check-in, address, room, and confirmation show here." />;
  return (
    <>
      <SectionHeader title="Hotel" subtitle={`${trip.lodging.length} stay${trip.lodging.length === 1 ? "" : "s"}`} />
      {trip.lodging.map((l) => (
        <Card
          key={l.id}
          icon={<div className="w-10 h-10 rounded-full flex items-center justify-center text-[18px] bg-[#BF5AF2]/20 text-[#AF52DE]">⌂</div>}
          title={l.hotel}
          subtitle={l.city ?? l.address}
          onClick={onOpenEvent ? () => onOpenEvent({ ...l, kind: "lodging-checkin", at: l.checkInAt }) : undefined}
        >
          <Row label="Address" value={l.address} />
          <Row label="Phone" value={l.phone ?? ""} />
          <Row label="Check-in" value={`${fmtDate(l.checkInAt)} · ${fmtTime(l.checkInAt)}`} />
          <Row label="Check-out" value={`${fmtDate(l.checkOutAt)} · ${fmtTime(l.checkOutAt)}`} />
          <Row label="Room" value={l.roomType ?? ""} />
          <Row label="Confirmation" value={l.confirmation ?? ""} mono />
          <Row label="Notes" value={l.notes ?? ""} multiline />
        </Card>
      ))}
    </>
  );
}

function GroundPanel({ trip, onOpenEvent }: { trip: Trip; onOpenEvent?: (b: TimelineBlock) => void }) {
  if (trip.ground.length === 0) return <EmptyPanel title="No ground transport" subtitle="Car services and transfers show here." />;
  return (
    <>
      <SectionHeader title="Ground transport" subtitle={`${trip.ground.length} transfer${trip.ground.length === 1 ? "" : "s"}`} />
      {trip.ground.map((g) => (
        <Card
          key={g.id}
          icon={<div className="w-10 h-10 rounded-full flex items-center justify-center text-[18px] bg-[#8E8E93]/20 text-[#48484A]">▸</div>}
          title={`${g.transportKind}${g.provider ? ` · ${g.provider}` : ""}`}
          subtitle={`${fmtDate(g.time)} · ${fmtTime(g.time)}`}
          onClick={onOpenEvent ? () => onOpenEvent({ ...g, kind: "ground", at: g.time }) : undefined}
        >
          <Row label="Pickup" value={g.pickup} />
          <Row label="Drop-off" value={g.dropoff} />
          <Row label="Driver" value={g.driverContact ?? ""} />
          <Row label="Confirmation" value={g.confirmation ?? ""} mono />
          <Row label="Notes" value={g.notes ?? ""} multiline />
        </Card>
      ))}
    </>
  );
}

function ContactsPanel({ trip }: { trip: Trip }) {
  const flightContacts: Contact[] = trip.flights
    .filter((f) => f.airline)
    .map((f) => ({ id: `air_${f.id}`, name: f.airline, role: "Airline" }));
  const ground: Contact[] = trip.ground
    .filter((g) => g.driverContact || g.provider)
    .map((g) => ({ id: `gr_${g.id}`, name: g.provider ?? g.transportKind, role: "Ground", phone: g.driverContact }));
  const hotelContacts: Contact[] = trip.lodging
    .filter((l) => l.phone)
    .map((l) => ({ id: `ho_${l.id}`, name: l.hotel, role: "Hotel", phone: l.phone }));
  const all = [...trip.contacts, ...hotelContacts, ...ground, ...flightContacts];
  if (all.length === 0) return <EmptyPanel title="No contacts" subtitle="Add emergency contacts on the editor side." />;
  return (
    <>
      <SectionHeader title="Emergency contacts" subtitle="Hold to dial" />
      <div className="mx-4 mb-3 rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
        {all.map((c, i) => (
          <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderTop: i === 0 ? "none" : "1px solid #e5e5ea" }}>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold truncate">{c.name}</div>
              <div className="text-[13px] opacity-70 truncate">{c.role ?? "—"}</div>
            </div>
            <div className="text-right shrink-0">
              {c.phone && <a href={`tel:${c.phone}`} className="text-[14px]" style={{ color: "#0a84ff" }}>{c.phone}</a>}
              {!c.phone && c.email && <a href={`mailto:${c.email}`} className="text-[14px]" style={{ color: "#0a84ff" }}>{c.email}</a>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function DocsPanel({ trip, onOpenEvent }: { trip: Trip; onOpenEvent?: (b: TimelineBlock) => void }) {
  const hasDocs = trip.documents.length > 0;
  const hasMeetings = trip.meetings.length > 0;
  if (!hasDocs && !hasMeetings) return <EmptyPanel title="No documents" subtitle="Upload docs on the editor side — they'll appear here along with meeting materials." />;
  return (
    <>
      {hasDocs && (
        <>
          <SectionHeader title="Documents" subtitle={`${trip.documents.length} item${trip.documents.length === 1 ? "" : "s"}`} />
          <div className="mx-4 mb-3 rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
            {trip.documents.map((d, i) => (
              <div key={d.id} className="px-4 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid #e5e5ea" }}>
                <div className="text-[15px] font-semibold leading-tight">{d.label}</div>
                <div className="text-[12px] opacity-70">{d.docType ?? "Document"}{d.note ? ` · ${d.note}` : ""}</div>
              </div>
            ))}
          </div>
        </>
      )}
      {hasMeetings && (
        <>
          <SectionHeader title="Meetings" subtitle={`${trip.meetings.length} meeting${trip.meetings.length === 1 ? "" : "s"}`} />
          {trip.meetings.map((m) => (
            <Card
              key={m.id}
              icon={<div className="w-10 h-10 rounded-full flex items-center justify-center text-[18px] bg-[#34C759]/20 text-[#248A3D]">◉</div>}
              title={m.title}
              subtitle={`${fmtDate(m.startAt)} · ${fmtTime(m.startAt)} — ${fmtTime(m.endAt)}`}
              onClick={onOpenEvent ? () => onOpenEvent({ ...m, kind: "meeting", at: m.startAt, endAt: m.endAt }) : undefined}
            >
              {!onOpenEvent && (
                <>
                  <Row label="Location" value={m.location} />
                  <Row label="Address" value={m.address} />
                  <Row label="Agenda" value={m.agenda ?? ""} multiline />
                  <Row label="Materials" value={m.materials ?? ""} />
                  <Row
                    label="Attendees"
                    value={m.attendees.map((a) => `${a.name}${a.company ? ` (${a.company})` : ""}${a.title ? ` — ${a.title}` : ""}`).join("\n")}
                    multiline
                  />
                  <Row label="Notes" value={m.notes ?? ""} multiline />
                </>
              )}
            </Card>
          ))}
        </>
      )}
    </>
  );
}

function EmptyPanel({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="text-[16px] font-semibold">{title}</div>
      <div className="text-[13px] opacity-70 mt-1">{subtitle}</div>
    </div>
  );
}

// ------------------------------------------------------------------
// Panel: Food — dining plans first, then AI recommendations
// ------------------------------------------------------------------
function FoodPanel({ trip, onOpenEvent }: { trip: Trip; onOpenEvent?: (b: TimelineBlock) => void }) {
  const hasDining = trip.dining.length > 0;
  return (
    <>
      {hasDining && (
        <>
          <SectionHeader title="Dining plans" subtitle={`${trip.dining.length} reservation${trip.dining.length === 1 ? "" : "s"}`} />
          {trip.dining.map((d) => (
            <Card
              key={d.id}
              icon={<div className="w-10 h-10 rounded-full flex items-center justify-center text-[18px] bg-[#FF9500]/20 text-[#C76D00]">🍽</div>}
              title={d.restaurant}
              subtitle={`${fmtDate(d.time)} · ${fmtTime(d.time)}${d.partySize ? ` · party of ${d.partySize}` : ""}`}
              onClick={onOpenEvent ? () => onOpenEvent({ ...d, kind: "dining", at: d.time }) : undefined}
            >
              {!onOpenEvent && (
                <>
                  <Row label="Address" value={d.address} />
                  <Row label="Reservation" value={d.reservation ?? ""} mono />
                  <Row label="Dress code" value={d.dressCode ?? ""} />
                  <Row label="Notes" value={d.notes ?? ""} multiline />
                </>
              )}
            </Card>
          ))}
        </>
      )}
      <RecommendationsPanel
        trip={trip}
        category="food"
        titleOverride={hasDining ? "More nearby" : undefined}
      />
    </>
  );
}

// ------------------------------------------------------------------
// Panel: AI recommendations (bars or food) — auto-loaded when the trip has
// a city, with cuisine + price filters and a sort toggle.
// ------------------------------------------------------------------
function RecommendationsPanel({
  trip, category, titleOverride,
}: { trip: Trip; category: "bars" | "food"; titleOverride?: string }) {
  const city = useMemo(() => pickCity(trip), [trip]);
  const hotel = trip.lodging[0]?.hotel ?? "";
  const reco = useReco(trip.id, category, city, hotel);

  const allVenues: Venue[] = reco.venues ?? [];

  // Filter state
  const [selectedCuisines, setSelectedCuisines] = useState<Set<string>>(new Set());
  const [selectedPrices, setSelectedPrices] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"ranking" | "priceAsc" | "priceDesc">("ranking");

  const cuisineOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of allVenues) {
      const c = normalizeCuisine(v.cuisine_or_style);
      if (c) set.add(c);
    }
    return [...set].sort();
  }, [allVenues]);

  const priceOptions = ["$", "$$", "$$$", "$$$$"];

  const filteredVenues = useMemo(() => {
    let list = allVenues;
    if (selectedCuisines.size > 0) {
      list = list.filter((v) => selectedCuisines.has(normalizeCuisine(v.cuisine_or_style)));
    }
    if (selectedPrices.size > 0) {
      list = list.filter((v) => v.price_range && selectedPrices.has(v.price_range));
    }
    if (sortBy !== "ranking") {
      list = [...list].sort((a, b) => {
        const pa = (a.price_range ?? "").length || 99;
        const pb = (b.price_range ?? "").length || 99;
        return sortBy === "priceAsc" ? pa - pb : pb - pa;
      });
    }
    return list;
  }, [allVenues, selectedCuisines, selectedPrices, sortBy]);

  const title = titleOverride ?? (category === "bars" ? "Cocktail lounges & bars" : "Restaurants");
  const subtitle = city
    ? `AI recommendations near ${hotel || city}`
    : "Add a destination city first";

  if (!city) return <EmptyPanel title={title} subtitle={subtitle} />;
  return (
    <>
      <SectionHeader title={title} subtitle={subtitle} />

      {/* Filter + sort controls */}
      {allVenues.length > 0 && (
        <div className="px-4 pb-2 space-y-2">
          {cuisineOptions.length > 1 && (
            <FilterRow
              label="Cuisine"
              options={cuisineOptions}
              selected={selectedCuisines}
              onToggle={(o) => toggleInSet(selectedCuisines, o, setSelectedCuisines)}
              onClear={() => setSelectedCuisines(new Set())}
            />
          )}
          <FilterRow
            label="Price"
            options={priceOptions}
            selected={selectedPrices}
            onToggle={(o) => toggleInSet(selectedPrices, o, setSelectedPrices)}
            onClear={() => setSelectedPrices(new Set())}
          />
          <div className="flex gap-1.5 items-center">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] opacity-70 w-[56px] shrink-0">Sort</span>
            <div className="flex gap-1">
              {(["ranking", "priceAsc", "priceDesc"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                  style={sortBy === s
                    ? { background: "#0a84ff", color: "#fff" }
                    : { background: "#fff", color: "#1c1c1e", border: "1px solid #d8d8de" }}
                >
                  {s === "ranking" ? "Editors' pick" : s === "priceAsc" ? "$ → $$$$" : "$$$$ → $"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {reco.status === "loading" && (
        <div className="mx-4 mb-3 px-4 py-6 rounded-2xl text-center text-[13px] opacity-70" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
          Asking Claude for {category === "bars" ? "the best lounges" : "the best tables"} in {city}…
        </div>
      )}
      {reco.status === "error" && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-[13px]" style={{ background: "#fff6f6", border: "1px solid #f4c3c3", color: "#a61b1b" }}>
          Couldn't load recommendations: {reco.error}
        </div>
      )}
      {reco.status === "ok" && allVenues.length === 0 && (
        <EmptyPanel title="No results" subtitle={`Claude didn't find strong matches in ${city}.`} />
      )}
      {reco.status === "ok" && filteredVenues.length === 0 && allVenues.length > 0 && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-2xl text-[13px] text-center opacity-70" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
          No venues match those filters.
        </div>
      )}
      {filteredVenues.length > 0 && (
        <div className="mx-4 mb-6 rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
          {filteredVenues.map((v, i) => (
            <a
              key={v.name + i}
              href={v.website || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-4 py-3 active:bg-slate-50"
              style={{ borderTop: i === 0 ? "none" : "1px solid #e5e5ea" }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-[15px] font-semibold leading-tight truncate">{v.name}</div>
                <div className="flex items-center gap-2 shrink-0">
                  {v.price_range && (
                    <span className="text-[11px] font-semibold" style={{ color: "#248A3D" }}>{v.price_range}</span>
                  )}
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: sourceColor(v.source) }}>
                    {v.source}
                  </span>
                </div>
              </div>
              <div className="text-[13px] opacity-80 leading-tight">{v.cuisine_or_style}{v.neighborhood ? ` · ${v.neighborhood}` : ""}</div>
              {v.accolade && <div className="text-[12px] leading-tight opacity-70 mt-0.5">{v.accolade}</div>}
              {v.why && <div className="text-[12px] leading-snug opacity-85 mt-1">{v.why}</div>}
              {v.website && <div className="text-[12px] truncate mt-0.5" style={{ color: "#0a84ff" }}>{v.website.replace(/^https?:\/\//, "")}</div>}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function sourceColor(s: string): string {
  if (/michelin/i.test(s)) return "#c62828";
  if (/infatuation/i.test(s)) return "#0a84ff";
  if (/eater/i.test(s)) return "#f97316";
  return "#636366";
}

// Normalize cuisine strings into one-or-two-word tokens that make decent
// filter chips. Claude might return "Italian fine dining" — we use just
// the headline term ("Italian") so chips aren't a mess of long labels.
function normalizeCuisine(s: string): string {
  if (!s) return "";
  const head = s.split(/[,·/|—-]/)[0] ?? s;
  return head.trim().split(/\s+/).slice(0, 2).join(" ");
}

function toggleInSet(
  current: Set<string>, value: string, setter: (s: Set<string>) => void,
) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value); else next.add(value);
  setter(next);
}

function FilterRow({
  label, options, selected, onToggle, onClear,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (o: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex gap-1.5 items-center">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] opacity-70 w-[56px] shrink-0">{label}</span>
      <div className="flex gap-1 overflow-x-auto no-scrollbar">
        {selected.size > 0 && (
          <button
            onClick={onClear}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0"
            style={{ background: "#fff", color: "#636366", border: "1px solid #d8d8de" }}
          >
            All
          </button>
        )}
        {options.map((o) => {
          const on = selected.has(o);
          return (
            <button
              key={o}
              onClick={() => onToggle(o)}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0"
              style={on
                ? { background: "#0a84ff", color: "#fff" }
                : { background: "#fff", color: "#1c1c1e", border: "1px solid #d8d8de" }}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Panel: Calendar — vertical scroll with month dropdown
// ------------------------------------------------------------------
function CalendarPanel({ trip, onOpenEvent }: { trip: Trip; onOpenEvent?: (b: TimelineBlock) => void }) {
  const blocks = useMemo(() => blocksForTrip(trip), [trip]);
  const byDay = useMemo(() => {
    const m = new Map<string, TimelineBlock[]>();
    for (const b of blocks) {
      const k = dayKey(b.at);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    return m;
  }, [blocks]);

  // Center the month grid on the trip's first day. ‹/› navigate the grid,
  // not the scrolling list — the list is fixed to trip dates so events are
  // always visible without scrolling.
  const baseDate = trip.startDate ? new Date(trip.startDate) : new Date();
  const [monthAnchor, setMonthAnchor] = useState(new Date(baseDate.getFullYear(), baseDate.getMonth(), 1));
  const [monthOpen, setMonthOpen] = useState(false);

  // Scrolling list covers the trip window (±1 day) plus any stray event days
  // outside that window. This is what actually shows the user's itinerary,
  // so it starts where the events are — no empty-day padding to scroll past.
  const listDays = useMemo(() => {
    const start = trip.startDate ? new Date(trip.startDate) : new Date();
    const end = trip.endDate ? new Date(trip.endDate) : new Date(start.getTime() + 6 * 86400000);
    const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
    const to = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);

    const daySet = new Set<string>();
    const push = (d: Date) => daySet.add(dayKey(d.toISOString()));
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) push(new Date(d));
    // Include any event days that fall outside the trip window.
    for (const k of byDay.keys()) daySet.add(k);

    return [...daySet]
      .sort()
      .map((k) => {
        const [y, m, d] = k.split("-").map(Number);
        return new Date(y, m - 1, d);
      });
  }, [trip.startDate, trip.endDate, byDay]);

  const monthLabel = monthAnchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Quick summary the user sees above the list so it's obvious the dates line
  // up with their trip.
  const eventCount = blocks.length;
  const tripRangeLabel = trip.startDate && trip.endDate
    ? `${fmtDate(trip.startDate)} → ${fmtDate(trip.endDate)}`
    : "Set dates to pin the calendar";

  return (
    <div className="pb-6">
      {/* Month header + dropdown toggle (matches reference calendar) */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between" style={{ color: "#1c1c1e" }}>
        <button onClick={() => setMonthOpen((v) => !v)} className="flex items-center gap-1 text-[18px] font-bold">
          {monthLabel}
          <span style={{ fontSize: 16, opacity: 0.7 }}>{monthOpen ? "▴" : "▾"}</span>
        </button>
        <div className="flex gap-2 text-[18px]" style={{ color: "#0a84ff" }}>
          <button onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
          <button onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
        </div>
      </div>

      {/* Full-month grid (collapses when the dropdown arrow is tapped). */}
      {monthOpen && (
        <div className="mx-4 mb-3 rounded-2xl overflow-hidden" style={{ background: "#0a2459", color: "#fff" }}>
          <MonthGrid anchor={monthAnchor} byDay={byDay} />
        </div>
      )}

      {/* Trip-range summary */}
      <div className="px-4 pt-1 pb-2 flex items-baseline justify-between">
        <div className="text-[13px] font-semibold" style={{ color: "#1c1c1e" }}>{tripRangeLabel}</div>
        <div className="text-[11px] opacity-60">{eventCount} event{eventCount === 1 ? "" : "s"}</div>
      </div>

      <div className="px-4 space-y-2">
        {listDays.map((d) => {
          const k = dayKey(d.toISOString());
          const items = byDay.get(k) ?? [];
          const inTrip = isInTripWindow(d, trip);
          return (
            <DayRow
              key={k}
              date={d}
              items={items}
              dim={!inTrip && items.length === 0}
              onOpenEvent={onOpenEvent}
            />
          );
        })}
      </div>
    </div>
  );
}

function isInTripWindow(d: Date, trip: Trip): boolean {
  if (!trip.startDate || !trip.endDate) return true;
  const s = new Date(trip.startDate); s.setHours(0, 0, 0, 0);
  const e = new Date(trip.endDate); e.setHours(23, 59, 59, 999);
  return d >= s && d <= e;
}

function MonthGrid({ anchor, byDay }: { anchor: Date; byDay: Map<string, TimelineBlock[]> }) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const first = new Date(y, m, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: ({ d: Date; inMonth: boolean } | null)[] = [];
  for (let i = 0; i < startOffset; i++) {
    const d = new Date(y, m, 1 - (startOffset - i));
    cells.push({ d, inMonth: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push({ d: new Date(y, m, i), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!.d;
    const nd = new Date(last); nd.setDate(nd.getDate() + 1);
    cells.push({ d: nd, inMonth: false });
  }
  return (
    <div className="p-3">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] opacity-70 mb-2">
        {["S", "M", "T", "W", "T", "F", "S"].map((l, i) => <div key={i}>{l}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const k = dayKey(c.d.toISOString());
          const has = byDay.has(k);
          const today = dayKey(new Date().toISOString()) === k;
          return (
            <div
              key={i}
              className="aspect-square rounded-lg flex items-center justify-center text-[12px] font-medium relative"
              style={{
                background: today ? "#0a84ff" : "transparent",
                color: today ? "#fff" : c.inMonth ? "#fff" : "rgba(255,255,255,0.35)",
              }}
            >
              {c.d.getDate()}
              {has && !today && (
                <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayRow({
  date, items, dim, onOpenEvent,
}: {
  date: Date;
  items: TimelineBlock[];
  dim?: boolean;
  onOpenEvent?: (b: TimelineBlock) => void;
}) {
  const label = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const today = dayKey(date.toISOString()) === dayKey(new Date().toISOString());
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "#fff", border: "1px solid #e5e5ea", opacity: dim ? 0.55 : 1 }}
    >
      <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: items.length > 0 ? "1px solid #f2f2f7" : "none" }}>
        <div className={`text-[13px] font-semibold ${today ? "" : "opacity-80"}`} style={{ color: today ? "#0a84ff" : "#1c1c1e" }}>{label}</div>
        {items.length > 0 && <div className="text-[11px] opacity-60">{items.length} event{items.length === 1 ? "" : "s"}</div>}
      </div>
      {items.length > 0 ? (
        <div>
          {items.map((b, i) => (
            <button
              key={b.kind + b.at + i}
              type="button"
              onClick={onOpenEvent ? () => onOpenEvent(b) : undefined}
              disabled={!onOpenEvent}
              className={`w-full px-3 py-2 flex items-start gap-3 text-left ${onOpenEvent ? "active:bg-slate-50 cursor-pointer" : ""}`}
              style={{ borderTop: i === 0 ? "none" : "1px solid #f2f2f7" }}
            >
              <div className="text-[12px] w-12 shrink-0 opacity-70 tabular-nums">{fmtTime(b.at)}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-tight truncate">{blockHeadline(b)}</div>
                <div className="text-[11px] opacity-60 leading-tight truncate">{blockSubhead(b)}</div>
              </div>
              <TabIcon name={iconForKind(b.kind)} size={16} color="#8e8e93" />
              {onOpenEvent && <div className="text-slate-300 text-[14px]">›</div>}
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2 text-[11px] opacity-50 italic">No events</div>
      )}
    </div>
  );
}

function iconForKind(k: TimelineBlock["kind"]): IconName {
  switch (k) {
    case "flight": return "airplane";
    case "lodging-checkin":
    case "lodging-checkout": return "hotel";
    case "meeting": return "document";
    case "dining": return "food";
    case "ground": return "car";
  }
}

// ------------------------------------------------------------------
// Event detail screen — full info for whatever block the user tapped,
// with a ride-hailing section at the bottom (non-functional in preview).
// ------------------------------------------------------------------
function EventDetail({ block, trip }: { block: TimelineBlock; trip: Trip }) {
  const style = KIND_STYLE[block.kind];
  const address = addressForBlock(block);
  const isPrivateFlight = block.kind === "flight" && block.aviationKind === "private";

  return (
    <div className="pb-6">
      <div className="px-4 pt-3 pb-1">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center text-[22px] mb-2 ${style.tint}`}>
          {style.icon}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-70">{style.label}</div>
          {isPrivateFlight && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">
              Private
            </span>
          )}
        </div>
        <div className="text-[22px] font-bold leading-tight mt-0.5">{blockHeadline(block)}</div>
        <div className="text-[14px] opacity-70 mt-0.5">
          {fmtDate(block.at)} · {fmtTime(block.at)}{block.endAt ? ` — ${fmtTime(block.endAt)}` : ""}
        </div>
      </div>

      <div className="mx-4 mt-3 rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
        <DetailRows block={block} tripContacts={trip.contacts} />
      </div>

      {block.kind === "flight" && isPrivateFlight && (
        <PrivateFlightExtras flight={block} />
      )}

      {address && <RideHailingCard destination={address} />}
    </div>
  );
}

// ------------------------------------------------------------------
// Private flight detail extras — FBOs, crew, catering, alternates, plus
// placeholder tiles for live tracking / weather / customs. The latter three
// are stubs that render mock "service not connected" messaging; wiring
// them to FlightAware / NOAA / customs desks is a separate integration.
// ------------------------------------------------------------------
function PrivateFlightExtras({ flight }: { flight: import("./types").Flight }) {
  const trackingIdent = flight.tailNumber || `${flight.airline}${flight.flightNumber}`.replace(/\s+/g, "");
  const tracking = useFlightStatus(trackingIdent, flight.departAt);
  const wxDep = useAirportWeather(flight.departAirport);
  const wxArr = useAirportWeather(flight.arriveAirport);
  const isInternational = Boolean(flight.departAirport && flight.arriveAirport
    && domesticUS(flight.departAirport) !== domesticUS(flight.arriveAirport));

  return (
    <div className="px-4 mt-4 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <TrackingTile ident={trackingIdent} status={tracking} />
        <WeatherTile
          depAirport={flight.departAirport}
          arrAirport={flight.arriveAirport}
          depWx={wxDep}
          arrWx={wxArr}
        />
        <CustomsTile
          isInternational={isInternational}
          arranged={flight.customsPreclearance}
          depAirport={flight.departAirport}
          arrAirport={flight.arriveAirport}
        />
      </div>

      {(flight.departFbo || flight.arriveFbo) && (
        <div>
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 mb-1.5 px-1">
            FBO
          </div>
          <div className="space-y-2">
            {flight.departFbo && <FboCardPhone label={`${flight.departAirport || "Departure"} — Departure`} fbo={flight.departFbo} />}
            {flight.arriveFbo && <FboCardPhone label={`${flight.arriveAirport || "Arrival"} — Arrival`} fbo={flight.arriveFbo} />}
          </div>
        </div>
      )}

      {flight.crew && flight.crew.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 mb-1.5 px-1">Crew</div>
          <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
            {flight.crew.map((c, i) => (
              <div key={c.id} className="px-3 py-2 flex items-center justify-between gap-2" style={{ borderTop: i === 0 ? "none" : "1px solid #f2f2f7" }}>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold truncate">{c.name || "(unnamed)"}</div>
                  <div className="text-[11px] opacity-70">{crewRoleLabel(c.role)}</div>
                </div>
                <div className="text-right">
                  {c.phone && <a href={`tel:${c.phone}`} className="text-[13px]" style={{ color: "#0a84ff" }}>{c.phone}</a>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {flight.catering && (
        <div className="rounded-2xl p-3" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 mb-1">Catering</div>
          <div className="text-[13px] whitespace-pre-wrap leading-snug">{flight.catering}</div>
        </div>
      )}

      {flight.alternates && flight.alternates.length > 0 && (
        <div className="rounded-2xl p-3" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 mb-1">Alternates</div>
          <div className="flex gap-1.5 flex-wrap">
            {flight.alternates.map((a) => (
              <span key={a} className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: "#e5e5ea", color: "#1c1c1e" }}>{a}</span>
            ))}
          </div>
        </div>
      )}

      {flight.brokerContact && (
        <div className="rounded-2xl p-3" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 mb-1">Broker</div>
          <div className="text-[13px]">{flight.brokerContact}</div>
        </div>
      )}
    </div>
  );
}

function crewRoleLabel(r: import("./types").CrewMember["role"]): string {
  return r === "captain" ? "Captain"
    : r === "first_officer" ? "First officer"
    : r === "flight_attendant" ? "Flight attendant" : "Crew";
}

function PlaceholderTile({
  title, subtitle, status, color, icon,
}: { title: string; subtitle: string; status: string; color: string; icon: string }) {
  return (
    <div className="rounded-2xl p-2.5" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
      <div className="flex items-center gap-1.5 mb-1">
        <div className="text-[16px]">{icon}</div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color }}>{title}</div>
      </div>
      <div className="text-[12px] font-semibold truncate">{subtitle}</div>
      <div className="text-[10px] opacity-65 leading-tight mt-0.5">{status}</div>
    </div>
  );
}

function FboCardPhone({ label, fbo }: { label: string; fbo: import("./types").Fbo }) {
  return (
    <div className="rounded-2xl p-3" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
      <div className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60">{label}</div>
      <div className="text-[15px] font-semibold leading-tight mt-0.5">{fbo.name || "(FBO name missing)"}</div>
      {fbo.address && <div className="text-[12px] opacity-75 leading-tight mt-0.5">{fbo.address}</div>}
      <div className="flex items-center gap-3 text-[12px] mt-1">
        {fbo.phone && <a href={`tel:${fbo.phone}`} style={{ color: "#0a84ff" }}>{fbo.phone}</a>}
        {fbo.handlerContact && <span className="opacity-80">· Handler: {fbo.handlerContact}</span>}
      </div>
      {fbo.notes && <div className="text-[11px] opacity-70 mt-1">{fbo.notes}</div>}
    </div>
  );
}

function addressForBlock(b: TimelineBlock): string | null {
  if (b.kind === "flight") return b.arriveCity || b.arriveAirport || null;
  if (b.kind === "lodging-checkin" || b.kind === "lodging-checkout") return b.address || null;
  if (b.kind === "meeting") return b.address || b.location || null;
  if (b.kind === "dining") return b.address || null;
  if (b.kind === "ground") return b.dropoff || null;
  return null;
}

function DetailRows({ block, tripContacts }: { block: TimelineBlock; tripContacts: Trip["contacts"] }) {
  if (block.kind === "dining") {
    const d = block;
    const tripPhone = tripContacts.find((c) => c.name?.toLowerCase().includes(d.restaurant.toLowerCase()))?.phone;
    return (
      <>
        <Row label="Restaurant" value={d.restaurant} />
        <Row label="Address" value={d.address} />
        {tripPhone && <Row label="Phone" value={tripPhone} />}
        <Row label="Reservation" value={d.reservation ?? ""} mono />
        <Row label="Party size" value={d.partySize ? String(d.partySize) : ""} />
        <Row label="Dress code" value={d.dressCode ?? ""} />
        <Row label="Notes" value={d.notes ?? ""} multiline />
      </>
    );
  }
  if (block.kind === "meeting") {
    const m = block;
    return (
      <>
        <Row label="Location" value={m.location} />
        <Row label="Address" value={m.address} />
        <Row label="Agenda" value={m.agenda ?? ""} multiline />
        <Row label="Materials" value={m.materials ?? ""} />
        <Row
          label="Attendees"
          value={m.attendees.map((a) => `${a.name}${a.company ? ` (${a.company})` : ""}${a.title ? ` — ${a.title}` : ""}`).join("\n")}
          multiline
        />
        <Row label="Notes" value={m.notes ?? ""} multiline />
      </>
    );
  }
  if (block.kind === "flight") {
    const f = block;
    const isPrivate = f.aviationKind === "private";
    return (
      <>
        <Row label={isPrivate ? "Operator" : "Airline"} value={isPrivate ? (f.operator ?? "") : `${f.airline} ${f.flightNumber}`} />
        {isPrivate && <Row label="Tail number" value={f.tailNumber ?? ""} mono />}
        <Row label="Aircraft" value={f.aircraftType ?? ""} />
        <Row label="Depart" value={`${f.departAirport}${f.departCity ? ` — ${f.departCity}` : ""}${f.departTerminal ? ` · T${f.departTerminal}` : ""}${f.departGate ? ` · Gate ${f.departGate}` : ""}`} />
        <Row label="Depart time" value={`${fmtDate(f.departAt)} · ${fmtTime(f.departAt)}`} />
        <Row label="Arrive" value={`${f.arriveAirport}${f.arriveCity ? ` — ${f.arriveCity}` : ""}${f.arriveTerminal ? ` · T${f.arriveTerminal}` : ""}${f.arriveGate ? ` · Gate ${f.arriveGate}` : ""}`} />
        <Row label="Arrive time" value={`${fmtDate(f.arriveAt)} · ${fmtTime(f.arriveAt)}`} />
        {!isPrivate && <Row label="Seat" value={`${f.seat ?? ""}${f.cabin ? ` · ${f.cabin}` : ""}`.trim()} />}
        <Row label="Confirmation" value={f.confirmation ?? ""} mono />
        <Row label="Duration" value={f.durationMin ? `${Math.floor(f.durationMin / 60)}h ${f.durationMin % 60}m` : ""} />
        <Row label="Notes" value={f.notes ?? ""} multiline />
      </>
    );
  }
  if (block.kind === "lodging-checkin" || block.kind === "lodging-checkout") {
    const l = block;
    return (
      <>
        <Row label="Hotel" value={l.hotel} />
        <Row label="Address" value={l.address} />
        <Row label="Phone" value={l.phone ?? ""} />
        <Row label="Check-in" value={`${fmtDate(l.checkInAt)} · ${fmtTime(l.checkInAt)}`} />
        <Row label="Check-out" value={`${fmtDate(l.checkOutAt)} · ${fmtTime(l.checkOutAt)}`} />
        <Row label="Room" value={l.roomType ?? ""} />
        <Row label="Confirmation" value={l.confirmation ?? ""} mono />
        <Row label="Notes" value={l.notes ?? ""} multiline />
      </>
    );
  }
  if (block.kind === "ground") {
    const g = block;
    return (
      <>
        <Row label="Type" value={`${g.transportKind}${g.provider ? ` · ${g.provider}` : ""}`} />
        <Row label="Pickup" value={g.pickup} />
        <Row label="Drop-off" value={g.dropoff} />
        <Row label="Driver" value={g.driverContact ?? ""} />
        <Row label="Confirmation" value={g.confirmation ?? ""} mono />
        <Row label="Notes" value={g.notes ?? ""} multiline />
      </>
    );
  }
  return null;
}

// ------------------------------------------------------------------
// Ride-hailing shortcut card — decorative in this preview. Taps don't
// actually deep-link out; a future pass can wire up Uber/Lyft universal
// links ("uber://?action=setPickup…" / "lyft://ridetype?id=lyft&…").
// ------------------------------------------------------------------
function RideHailingCard({ destination }: { destination: string }) {
  return (
    <div className="mx-4 mt-4">
      <div className="text-[11px] uppercase tracking-[0.15em] font-semibold opacity-60 mb-1.5 px-1">
        Get a ride there
      </div>
      <div className="text-[12px] opacity-70 mb-2 px-1 truncate">To: {destination}</div>
      <div className="grid grid-cols-2 gap-2">
        <RideButton brand="uber" label="Order Uber" />
        <RideButton brand="lyft" label="Order Lyft" />
      </div>
    </div>
  );
}

function RideButton({ brand, label }: { brand: "uber" | "lyft"; label: string }) {
  const isUber = brand === "uber";
  return (
    <button
      // Non-functional in preview — visual only per spec.
      onClick={(e) => e.preventDefault()}
      className="rounded-2xl px-4 py-3 flex items-center gap-3 active:opacity-80"
      style={{
        background: isUber ? "#000000" : "#ea0b8c",
        color: "#ffffff",
      }}
    >
      {isUber ? <UberGlyph size={22} /> : <LyftGlyph size={22} />}
      <span className="text-[14px] font-semibold">{label}</span>
    </button>
  );
}

function UberGlyph({ size }: { size: number }) {
  // A close approximation to Uber's "U" wordmark: thick sans-serif on a
  // rounded square. Real Uber logos are a licensed asset; this is a
  // stylized stand-in for the preview.
  return (
    <div
      className="rounded-[6px] flex items-center justify-center shrink-0"
      style={{ width: size, height: size, background: "#ffffff" }}
    >
      <span style={{ fontSize: size * 0.7, fontWeight: 900, color: "#000", letterSpacing: "-0.05em", lineHeight: 1 }}>
        U
      </span>
    </div>
  );
}

function LyftGlyph({ size }: { size: number }) {
  return (
    <div
      className="rounded-[6px] flex items-center justify-center shrink-0"
      style={{ width: size, height: size, background: "#ffffff" }}
    >
      <span style={{ fontSize: size * 0.7, fontWeight: 900, color: "#ea0b8c", letterSpacing: "-0.05em", lineHeight: 1 }}>
        L
      </span>
    </div>
  );
}

// ------------------------------------------------------------------
// Panel: Concierge chat — streams Claude replies with full trip context
// ------------------------------------------------------------------
type ChatMsg = { role: "user" | "assistant"; content: string };

// Cache per-trip so tabbing away and back preserves the conversation.
const chatCache: Map<string, ChatMsg[]> = new Map();

function ConciergePanel({ trip }: { trip: Trip }) {
  const [messages, setMessages] = useState<ChatMsg[]>(() => chatCache.get(trip.id) ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatCache.set(trip.id, messages);
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, trip.id]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const next: ChatMsg[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
    setMessages(next);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/airkarim/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip,
          messages: next.slice(0, -1), // don't send the empty placeholder
          now: new Date().toISOString(),
        }),
      });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (e) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", content: `⚠ ${(e as Error).message}` };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  const suggestions = buildSuggestions(trip);

  return (
    <div className="h-full flex flex-col" style={{ background: "#F2F2F7" }}>
      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#0a84ff" }}>
          <TabIcon name="concierge" size={20} color="#ffffff" />
        </div>
        <div className="min-w-0">
          <div className="text-[17px] font-bold leading-tight">Karim, your concierge</div>
          <div className="text-[12px] opacity-70 leading-tight">Knows this trip inside out</div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto px-3 pb-2 space-y-2">
        {messages.length === 0 && (
          <div className="mt-2 space-y-2">
            <div className="mx-1 text-[13px] leading-snug opacity-80">
              Ask anything about your trip — next meeting, gate number, who's at dinner, dress code.
            </div>
            <div className="flex flex-wrap gap-1.5 mx-1">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="px-2.5 py-1 rounded-full text-[12px]"
                  style={{ background: "#fff", border: "1px solid #d8d8de", color: "#0a84ff" }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
        {busy && messages[messages.length - 1]?.content === "" && (
          <div className="px-3 py-2 text-[12px] opacity-60">Karim is thinking…</div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="p-2 border-t"
        style={{ borderColor: "#e5e5ea", background: "#ffffff" }}
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            placeholder="Ask Karim..."
            className="flex-1 px-3 py-2 rounded-full text-[14px] bg-[#F2F2F7] border-0 outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="w-9 h-9 rounded-full flex items-center justify-center disabled:opacity-40"
            style={{ background: "#0a84ff", color: "#fff" }}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12 l14 -7 l-4 14 l-4 -6 l-6 -1 z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMsg }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[82%] px-3 py-2 rounded-2xl text-[14px] leading-snug whitespace-pre-wrap"
        style={
          isUser
            ? { background: "#0a84ff", color: "#fff", borderBottomRightRadius: 4 }
            : { background: "#ffffff", color: "#1c1c1e", border: "1px solid #e5e5ea", borderBottomLeftRadius: 4 }
        }
      >
        {message.content}
      </div>
    </div>
  );
}

function buildSuggestions(trip: Trip): string[] {
  const s: string[] = ["What's next on my itinerary?"];
  if (trip.meetings.length > 0) s.push("Brief me on my next meeting");
  if (trip.dining.length > 0) s.push(`What's the dress code at ${trip.dining[0].restaurant}?`);
  if (trip.flights.length > 0) s.push(`What's my flight number home?`);
  if (trip.lodging.length > 0) s.push("Hotel phone number?");
  return s.slice(0, 4);
}

// ------------------------------------------------------------------
// Live flight status + weather — hooks + tile components
// ------------------------------------------------------------------
type FlightStatus = {
  configured?: boolean;
  reason?: string;
  error?: string;
  ident?: string;
  status?: string;
  progress_percent?: number;
  scheduled_out?: string;
  scheduled_in?: string;
  estimated_in?: string;
  origin?: string;
  destination?: string;
  last_position?: { latitude?: number; longitude?: number; altitude?: number; groundspeed?: number } | null;
};

type AirportWeather = {
  configured?: boolean;
  reason?: string;
  error?: string;
  airport?: string;
  city?: string;
  slot_risk?: "low" | "medium" | "high";
  forecast?: Array<{
    time?: string;
    tempF?: number;
    summary?: string;
    description?: string;
    wind_mph?: number;
    gust_mph?: number;
    risk?: "low" | "medium" | "high";
  }>;
};

const flightStatusCache: Map<string, { at: number; data: FlightStatus }> = new Map();
const weatherCache: Map<string, { at: number; data: AirportWeather }> = new Map();

function useFlightStatus(ident: string, departAt?: string): FlightStatus | null {
  const [data, setData] = useState<FlightStatus | null>(null);
  useEffect(() => {
    if (!ident || !ident.trim()) { setData(null); return; }
    const key = `${ident}::${departAt ?? ""}`;
    const hit = flightStatusCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) { setData(hit.data); return; }
    let cancelled = false;
    const date = departAt ? departAt.slice(0, 10) : undefined;
    const qs = new URLSearchParams({ ident });
    if (date) qs.set("date", date);
    fetch(`/api/airkarim/flight-status?${qs.toString()}`)
      .then((r) => r.json())
      .then((j: FlightStatus) => {
        flightStatusCache.set(key, { at: Date.now(), data: j });
        if (!cancelled) setData(j);
      })
      .catch(() => { if (!cancelled) setData({ configured: true, error: "Network error" }); });
    return () => { cancelled = true; };
  }, [ident, departAt]);
  return data;
}

function useAirportWeather(airport: string): AirportWeather | null {
  const [data, setData] = useState<AirportWeather | null>(null);
  useEffect(() => {
    if (!airport || !airport.trim()) { setData(null); return; }
    const code = airport.toUpperCase().trim();
    const hit = weatherCache.get(code);
    if (hit && Date.now() - hit.at < 10 * 60_000) { setData(hit.data); return; }
    let cancelled = false;
    fetch(`/api/airkarim/weather?airport=${encodeURIComponent(code)}&hours=48`)
      .then((r) => r.json())
      .then((j: AirportWeather) => {
        weatherCache.set(code, { at: Date.now(), data: j });
        if (!cancelled) setData(j);
      })
      .catch(() => { if (!cancelled) setData({ configured: true, error: "Network error" }); });
    return () => { cancelled = true; };
  }, [airport]);
  return data;
}

function TrackingTile({ ident, status }: { ident: string; status: FlightStatus | null }) {
  // Not configured → placeholder explaining how to enable.
  if (status && status.configured === false) {
    return (
      <PlaceholderTile
        title="Live tracking"
        subtitle={ident || "No ident"}
        status="FlightAware key not set"
        color="#0a84ff"
        icon="📡"
      />
    );
  }
  if (!status) {
    return <PlaceholderTile title="Live tracking" subtitle={ident || "…"} status="Fetching…" color="#0a84ff" icon="📡" />;
  }
  if (status.error) {
    return <PlaceholderTile title="Live tracking" subtitle={ident || "—"} status={status.error} color="#c62828" icon="📡" />;
  }
  // Humanize status + ETA.
  const liveIdent = status.ident || ident;
  const human = humanFlightStatus(status);
  const eta = status.estimated_in || status.scheduled_in;
  const etaLabel = eta
    ? new Date(eta).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";
  return (
    <div className="rounded-2xl p-2.5" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
      <div className="flex items-center gap-1.5 mb-1">
        <div className="text-[16px]">📡</div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "#0a84ff" }}>Live tracking</div>
      </div>
      <div className="text-[12px] font-semibold truncate">{liveIdent}</div>
      <div className="text-[11px] leading-tight">{human}</div>
      {etaLabel && <div className="text-[10px] opacity-65 mt-0.5">ETA {etaLabel}</div>}
      {status.progress_percent != null && (
        <div className="mt-1 h-[3px] rounded-full bg-slate-200 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, status.progress_percent))}%`, background: "#0a84ff" }} />
        </div>
      )}
    </div>
  );
}

function humanFlightStatus(s: FlightStatus): string {
  const raw = (s.status || "").toLowerCase();
  if (raw.includes("en route") || raw.includes("airborne")) return "In the air";
  if (raw.includes("arrived")) return "Arrived";
  if (raw.includes("scheduled")) return "Scheduled";
  if (raw.includes("cancelled")) return "Cancelled";
  if (raw.includes("taxi") || raw.includes("gate")) return "At gate / taxi";
  if (raw.includes("diverted")) return "Diverted";
  return s.status || "Unknown";
}

function WeatherTile({
  depAirport, arrAirport, depWx, arrWx,
}: {
  depAirport: string;
  arrAirport: string;
  depWx: AirportWeather | null;
  arrWx: AirportWeather | null;
}) {
  const notConfigured = (depWx && depWx.configured === false) || (arrWx && arrWx.configured === false);
  if (notConfigured) {
    return (
      <PlaceholderTile
        title="Weather"
        subtitle={`${depAirport} → ${arrAirport}`}
        status="OpenWeather key not set"
        color="#34c759"
        icon="⛅"
      />
    );
  }
  if (!depWx || !arrWx) {
    return <PlaceholderTile title="Weather" subtitle={`${depAirport} → ${arrAirport}`} status="Fetching…" color="#34c759" icon="⛅" />;
  }
  if (depWx.error || arrWx.error) {
    return <PlaceholderTile title="Weather" subtitle={`${depAirport} → ${arrAirport}`} status={depWx.error ?? arrWx.error ?? ""} color="#c62828" icon="⛅" />;
  }
  // Worst risk across both airports drives the tile color.
  const worst = worstRisk([depWx.slot_risk, arrWx.slot_risk]);
  const riskColor = worst === "high" ? "#c62828" : worst === "medium" ? "#f97316" : "#34c759";
  const depNow = depWx.forecast?.[0];
  const arrSoon = arrWx.forecast?.[0];
  return (
    <div className="rounded-2xl p-2.5" style={{ background: "#fff", border: "1px solid #e5e5ea" }}>
      <div className="flex items-center gap-1.5 mb-1">
        <div className="text-[16px]">⛅</div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: riskColor }}>
          Weather · {worst}
        </div>
      </div>
      <div className="text-[11px] font-semibold truncate">{depAirport}: {weatherShort(depNow)}</div>
      <div className="text-[11px] font-semibold truncate">{arrAirport}: {weatherShort(arrSoon)}</div>
    </div>
  );
}

function worstRisk(r: Array<"low" | "medium" | "high" | undefined>): "low" | "medium" | "high" {
  if (r.includes("high")) return "high";
  if (r.includes("medium")) return "medium";
  return "low";
}

function weatherShort(f?: { tempF?: number; summary?: string; wind_mph?: number } | null): string {
  if (!f) return "—";
  const bits: string[] = [];
  if (f.tempF != null) bits.push(`${Math.round(f.tempF)}°`);
  if (f.summary) bits.push(f.summary);
  if (f.wind_mph) bits.push(`${Math.round(f.wind_mph)} mph wind`);
  return bits.join(" · ") || "—";
}

function CustomsTile({
  isInternational, arranged, depAirport, arrAirport,
}: { isInternational: boolean; arranged?: boolean; depAirport: string; arrAirport: string }) {
  if (!isInternational) {
    return (
      <PlaceholderTile
        title="Customs"
        subtitle="Domestic"
        status="No pre-clearance needed"
        color="#8e8e93"
        icon="🛃"
      />
    );
  }
  if (arranged) {
    return (
      <PlaceholderTile
        title="Customs"
        subtitle="Pre-clear arranged"
        status={`${depAirport} → ${arrAirport}`}
        color="#248A3D"
        icon="🛃"
      />
    );
  }
  return (
    <PlaceholderTile
      title="Customs"
      subtitle="International"
      status="No pre-clearance yet — flip toggle"
      color="#c62828"
      icon="🛃"
    />
  );
}

// Rough proxy: 3-letter US airport codes from a short allowlist. Anything
// outside → treat as international (surfaces the customs warning). Good
// enough for the preview; real GA operators should trust the handler.
const US_AIRPORTS = new Set([
  "MIA", "MCO", "LGA", "JFK", "EWR", "LAX", "SFO", "ORD", "DFW", "ATL",
  "BOS", "IAD", "DCA", "SEA", "DEN", "LAS", "PBI", "TEB", "HPN", "BED",
  "OPF", "APF", "FXE", "APA", "SNA", "VNY", "SMO", "DAL", "HOU",
]);
function domesticUS(code: string): string {
  return US_AIRPORTS.has(code.toUpperCase()) ? "US" : code.toUpperCase();
}
