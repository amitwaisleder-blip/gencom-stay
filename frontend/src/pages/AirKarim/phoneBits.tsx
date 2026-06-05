// Small visual pieces used by IPhonePreview: the Gencom G mark, the iOS
// app-icon, a stylized world map with flight paths, and the SF-Symbol style
// icons used on the itinerary's category tab bar.

import type { CSSProperties, ReactNode } from "react";

// ------------------------------------------------------------------
// Gencom "G" mark — used as both the AirKarim app icon and a small brand
// chip on the in-app home screen.
// ------------------------------------------------------------------
export function GencomG({ size = 60, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      style={style}
      aria-label="Gencom"
    >
      <circle cx="60" cy="60" r="60" fill="#456238" />
      {/* Custom-drawn "g" with descender curl, echoing the provided logo */}
      <text
        x="60"
        y="82"
        textAnchor="middle"
        fontFamily="'Didot', 'Playfair Display', 'Bodoni Moda', Georgia, serif"
        fontSize="96"
        fontStyle="italic"
        fontWeight={500}
        fill="#f3ebd8"
      >
        g
      </text>
    </svg>
  );
}

// App icon = rounded-square white tile with the actual Gencom G mark image
// centered inside. iOS home-screen geometry (~22.5% corner radius).
export function AppIcon({ size = 60, label }: { size?: number; label?: string }) {
  const r = size * 0.225;
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: r,
          background: "#ffffff",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {/* Source image is mostly whitespace with a centered green G circle.
            Scaling the img well beyond the tile and clipping with the parent
            overflow zooms in on the G so it fills the icon. */}
        <img
          src="/Gencom Logo G 2017.jpg"
          alt="Gencom"
          draggable={false}
          style={{
            width: size * 2.6,
            height: size * 2.6,
            objectFit: "contain",
            flexShrink: 0,
          }}
        />
      </div>
      {label && (
        <div className="text-[11px] mt-1 text-white font-medium text-center leading-tight">{label}</div>
      )}
    </div>
  );
}

// Generic colored-square iOS app icon for the fake springboard.
export function StubAppIcon({
  size = 60, label, color, emoji,
}: { size?: number; label: string; color: string; emoji: string }) {
  const r = size * 0.225;
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: r,
          background: color,
          boxShadow: "0 4px 10px rgba(0,0,0,0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.5,
          color: "#fff",
        }}
      >
        <span style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.2))" }}>{emoji}</span>
      </div>
      <div className="text-[11px] mt-1 text-white font-medium text-center leading-tight">{label}</div>
    </div>
  );
}

// ------------------------------------------------------------------
// Trip map — renders actual country shapes (from Natural Earth 110m via
// world-atlas, pre-projected to a 720×360 equirectangular canvas) and
// crops the viewBox to a tight bounding box around just the cities visited
// on this trip. Longitudes: -180..180 → 0..720, latitudes: 90..-90 → 0..360.
// ------------------------------------------------------------------
import { WORLD_LAND_PATH } from "./worldLand";

const MAP_W = 720;
const MAP_H = 360;

const AIRPORTS: Record<string, { lon: number; lat: number; name: string }> = {
  // A handful of common ones; everything else falls back to the city-name search.
  MIA: { lon: -80.29, lat: 25.79, name: "Miami" },
  MCO: { lon: -81.31, lat: 28.43, name: "Orlando" },
  MSY: { lon: -90.26, lat: 29.99, name: "New Orleans" },
  LGA: { lon: -73.87, lat: 40.77, name: "New York" },
  JFK: { lon: -73.78, lat: 40.64, name: "New York" },
  EWR: { lon: -74.17, lat: 40.69, name: "Newark" },
  LAX: { lon: -118.41, lat: 33.94, name: "Los Angeles" },
  SFO: { lon: -122.38, lat: 37.62, name: "San Francisco" },
  ORD: { lon: -87.90, lat: 41.98, name: "Chicago" },
  DFW: { lon: -97.04, lat: 32.90, name: "Dallas" },
  LHR: { lon: -0.45, lat: 51.47, name: "London" },
  CDG: { lon: 2.55, lat: 49.01, name: "Paris" },
  FCO: { lon: 12.24, lat: 41.80, name: "Rome" },
  MAD: { lon: -3.57, lat: 40.49, name: "Madrid" },
  DXB: { lon: 55.36, lat: 25.25, name: "Dubai" },
  DOH: { lon: 51.53, lat: 25.27, name: "Doha" },
  HND: { lon: 139.78, lat: 35.55, name: "Tokyo" },
  NRT: { lon: 140.39, lat: 35.77, name: "Tokyo" },
  HKG: { lon: 113.91, lat: 22.31, name: "Hong Kong" },
  SIN: { lon: 103.99, lat: 1.36, name: "Singapore" },
  GRU: { lon: -46.47, lat: -23.43, name: "São Paulo" },
  GIG: { lon: -43.25, lat: -22.81, name: "Rio" },
  CUN: { lon: -86.87, lat: 21.04, name: "Cancun" },
  LAS: { lon: -115.15, lat: 36.08, name: "Las Vegas" },
  ATL: { lon: -84.43, lat: 33.64, name: "Atlanta" },
  BOS: { lon: -71.01, lat: 42.36, name: "Boston" },
  IAD: { lon: -77.46, lat: 38.94, name: "Washington" },
  DCA: { lon: -77.04, lat: 38.85, name: "Washington" },
  SEA: { lon: -122.31, lat: 47.45, name: "Seattle" },
  DEN: { lon: -104.67, lat: 39.86, name: "Denver" },
  AMS: { lon: 4.76, lat: 52.31, name: "Amsterdam" },
  FRA: { lon: 8.57, lat: 50.04, name: "Frankfurt" },
  ZRH: { lon: 8.55, lat: 47.46, name: "Zurich" },
  IST: { lon: 28.72, lat: 41.28, name: "Istanbul" },
  SVO: { lon: 37.41, lat: 55.97, name: "Moscow" },
};

export type FlightLeg = { from: string; to: string };

function project(lon: number, lat: number): [number, number] {
  const x = ((lon + 180) / 360) * MAP_W;
  const y = ((90 - lat) / 180) * MAP_H;
  return [x, y];
}

function airportFor(code: string): { lon: number; lat: number; name: string } | null {
  const c = code.trim().toUpperCase();
  return AIRPORTS[c] ?? null;
}

export function FlightMap({
  legs,
  cities = [],
  width = 360,
  height = 160,
  accent = "#0a84ff",
}: {
  legs: FlightLeg[];
  /** Extra city names to plot when flights don't cover everything. */
  cities?: string[];
  width?: number;
  height?: number;
  accent?: string;
}) {
  // Collect every point we need to show so we can crop tightly.
  type Pt = { x: number; y: number; label: string; key: string };
  const ptMap = new Map<string, Pt>();
  const lines: { from: [number, number]; to: [number, number] }[] = [];

  for (const leg of legs) {
    const a = airportFor(leg.from);
    const b = airportFor(leg.to);
    if (!a || !b) continue;
    const pa = project(a.lon, a.lat);
    const pb = project(b.lon, b.lat);
    ptMap.set(leg.from.toUpperCase(), { x: pa[0], y: pa[1], label: a.name, key: leg.from.toUpperCase() });
    ptMap.set(leg.to.toUpperCase(), { x: pb[0], y: pb[1], label: b.name, key: leg.to.toUpperCase() });
    lines.push({ from: pa, to: pb });
  }

  // City names → find any airport whose name matches (best-effort) so we can
  // plot destinations that didn't appear on a flight leg.
  for (const city of cities) {
    const match = Object.entries(AIRPORTS).find(([, a]) =>
      city.toLowerCase().includes(a.name.toLowerCase()),
    );
    if (match) {
      const [code, a] = match;
      if (!ptMap.has(code)) {
        const [x, y] = project(a.lon, a.lat);
        ptMap.set(code, { x, y, label: a.name, key: code });
      }
    }
  }

  const pts = [...ptMap.values()];

  // Compute bounding box in map coordinates and add generous padding so pins
  // aren't glued to the edge and there's room for labels.
  let vx = 0, vy = 0, vw = MAP_W, vh = MAP_H;
  if (pts.length > 0) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const targetAspect = width / height;
    const rawW = Math.max(maxX - minX, 1);
    const rawH = Math.max(maxY - minY, 1);

    // Pad by 30% of the larger dimension (min 30 map-units) so pins breathe.
    const pad = Math.max(30, Math.max(rawW, rawH) * 0.45);
    let bx = minX - pad;
    let by = minY - pad;
    let bw = rawW + pad * 2;
    let bh = rawH + pad * 2;

    // Expand to match the target aspect ratio (keeps centered).
    if (bw / bh < targetAspect) {
      const needed = bh * targetAspect;
      bx -= (needed - bw) / 2;
      bw = needed;
    } else {
      const needed = bw / targetAspect;
      by -= (needed - bh) / 2;
      bh = needed;
    }

    // Clamp to the canvas.
    bx = Math.max(0, Math.min(bx, MAP_W - bw));
    by = Math.max(0, Math.min(by, MAP_H - bh));
    bw = Math.min(bw, MAP_W);
    bh = Math.min(bh, MAP_H);

    vx = bx; vy = by; vw = bw; vh = bh;
  }

  // Scale-invariant sizing so dots/lines don't look huge when zoomed in.
  const zoom = Math.max(vw / MAP_W, vh / MAP_H);
  const dotR = Math.max(3, 6 * zoom);
  const dotRing = dotR * 2.5;
  const dotInner = dotR * 0.45;
  const stroke = Math.max(1.2, 2.2 * zoom);
  const labelSize = Math.max(8, 11 * zoom);
  const labelOffset = dotR + labelSize * 0.3;

  return (
    <svg
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid slice"
      style={{ display: "block" }}
    >
      {/* Ocean */}
      <rect x={vx} y={vy} width={vw} height={vh} fill="#e9eef5" />
      {/* Land */}
      <path d={WORLD_LAND_PATH} fill="#c7d2dd" stroke="#a7b4c3" strokeWidth={0.4} />
      {/* Flight arcs */}
      {lines.map((ln, i) => {
        const midX = (ln.from[0] + ln.to[0]) / 2;
        const midY = (ln.from[1] + ln.to[1]) / 2;
        const dist = Math.hypot(ln.to[0] - ln.from[0], ln.to[1] - ln.from[1]);
        // Curve upward by a fraction of the leg length.
        const curve = midY - Math.min(Math.max(vh * 0.15, 20), dist * 0.25);
        return (
          <path
            key={i}
            d={`M ${ln.from[0]} ${ln.from[1]} Q ${midX} ${curve} ${ln.to[0]} ${ln.to[1]}`}
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${stroke * 2} ${stroke * 2}`}
            opacity={0.95}
          />
        );
      })}
      {/* City pins with labels */}
      {pts.map((p) => {
        // Keep label inside the crop by flipping below-pin when near the top.
        const nearTop = (p.y - vy) < vh * 0.22;
        return (
          <g key={p.key}>
            <circle cx={p.x} cy={p.y} r={dotRing} fill={accent} opacity={0.15} />
            <circle cx={p.x} cy={p.y} r={dotR} fill={accent} />
            <circle cx={p.x} cy={p.y} r={dotInner} fill="#ffffff" />
            <text
              x={p.x}
              y={nearTop ? p.y + labelOffset + labelSize : p.y - labelOffset}
              textAnchor="middle"
              fontSize={labelSize}
              fontWeight={700}
              fill="#0b1220"
              stroke="#ffffff"
              strokeWidth={labelSize * 0.35}
              paintOrder="stroke"
              strokeLinejoin="round"
            >
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------
// Icon system for the itinerary's category tab bar.  Each one is a small
// line-drawing that matches the weight of iOS SF Symbols.
// ------------------------------------------------------------------
export type IconName =
  | "airplane" | "martini" | "food" | "document" | "car" | "hotel" | "phone" | "calendar" | "concierge" | "question";

export function TabIcon({ name, size = 22, color = "currentColor" }: { name: IconName; size?: number; color?: string }) {
  const s = { width: size, height: size, stroke: color, fill: "none", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "airplane":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M3 12l8-1 3-7 2 0 -2 7 5 1 2-1 1 1-3 3 1 5-1 1-3-3-4 2 0 2-2 1-1-4-4-1 1-2 4 0" />
        </svg>
      );
    case "martini":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M4 5 h16 L12 15 Z M12 15 v6 M8 21 h8" />
          <circle cx="16" cy="7.2" r="1.2" fill={color} stroke="none" />
        </svg>
      );
    case "food":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M6 3 v8 a2 2 0 0 0 2 2 v8 M10 3 v8 a2 2 0 0 1 -2 2 M8 3 v8" />
          <path d="M16 3 c-2 0 -3 3 -3 6 c0 2 1 3 3 3 v9" />
        </svg>
      );
    case "document":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M6 3 h9 l4 4 v14 a0 0 0 0 1 0 0 H6 Z M15 3 v4 h4 M8 11 h8 M8 14 h8 M8 17 h5" />
        </svg>
      );
    case "car":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M4 14 l2 -5 a2 2 0 0 1 2 -1 h8 a2 2 0 0 1 2 1 l2 5 M3 14 h18 v4 h-2 v-1 H5 v1 H3 z" />
          <circle cx="7" cy="17" r="1.3" fill={color} stroke="none" />
          <circle cx="17" cy="17" r="1.3" fill={color} stroke="none" />
        </svg>
      );
    case "hotel":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M3 20 v-10 h18 v10 M3 20 h18 M5 14 h3 v2 h-3 z M11 14 h3 v2 h-3 z M16 14 h3 v2 h-3 z M5 10 l7 -6 l9 6" />
        </svg>
      );
    case "phone":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M5 4 h3 l2 5 l-2 1 a11 11 0 0 0 6 6 l1 -2 l5 2 v3 a2 2 0 0 1 -2 2 a17 17 0 0 1 -17 -17 a2 2 0 0 1 2 -2 z" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10 h18 M8 3 v4 M16 3 v4" />
          <circle cx="8" cy="14" r="0.9" fill={color} stroke="none" />
          <circle cx="12" cy="14" r="0.9" fill={color} stroke="none" />
          <circle cx="16" cy="14" r="0.9" fill={color} stroke="none" />
        </svg>
      );
    case "concierge":
      // Chat-bubble with a sparkle to signal "AI concierge".
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M4 5 h13 a2 2 0 0 1 2 2 v7 a2 2 0 0 1 -2 2 h-6 l-5 4 v-4 h-2 a2 2 0 0 1 -2 -2 v-7 a2 2 0 0 1 2 -2 z" />
          <path d="M13 9 l0.6 1.4 l1.4 0.6 l-1.4 0.6 l-0.6 1.4 l-0.6 -1.4 l-1.4 -0.6 l1.4 -0.6 z" fill={color} stroke="none" />
        </svg>
      );
    case "question":
      // Circle + "?" — placeholder slot for future categories.
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9.5 a3 3 0 0 1 6 0 c0 1.6 -1.6 2.2 -2.4 2.9 c-0.5 0.4 -0.6 0.9 -0.6 1.6 M12 17 v0.2" />
        </svg>
      );
  }
}

// Pill-button used for the horizontal category tab bar at the top of the
// itinerary screen.
export function IconTab({
  name, label, active, onClick,
}: { name: IconName; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center shrink-0 rounded-2xl transition"
      style={{
        width: 58, height: 58,
        background: active ? "#0a84ff" : "#ffffff",
        color: active ? "#ffffff" : "#0a84ff",
        border: `1px solid ${active ? "#0a84ff" : "#d8d8de"}`,
      }}
      aria-label={label}
      title={label}
    >
      <TabIcon name={name} size={22} color={active ? "#ffffff" : "#0a84ff"} />
      <div className="text-[9px] mt-0.5 font-semibold uppercase tracking-[0.05em]">{label}</div>
    </button>
  );
}

export function Chip({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: "rgba(255,255,255,0.15)", color: "#fff", ...style }}
    >
      {children}
    </span>
  );
}
