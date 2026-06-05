// Nehmer/HVS-style benchmark cost ranges for Fast Budget Generator.
//
// Ranges are Low / Mid / High $/unit at a reference date of 2026 Q1, derived
// from Nehmer Hospitality Cost Guide and HVS Hotel Development Cost Survey
// publicly available methodology. These are ROM figures meant to support
// ±25% accuracy budgets during acquisitions / early planning.
//
// To refresh: update BENCHMARK_LAST_UPDATED, review each area row against the
// latest Nehmer/HVS publication, and bump ranges where applicable.

export const BENCHMARK_LAST_UPDATED = "2026-01-15";
export const BENCHMARK_SOURCE = "Nehmer Hospitality Cost Guide + HVS Hotel Development Cost Survey (2024–2025 editions), adjusted to 2026 Q1 dollars";

export type BrandTier = "Luxury" | "Upper-Upscale" | "Upscale" | "Upper-Midscale" | "Midscale";
export type ScopeLevel = "none" | "minor" | "partial" | "full";
export type CostUnit = "per_key" | "per_sf" | "lump" | "per_elevator" | "per_floor";
export type Range = { low: number; mid: number; high: number };
export type PropertyType = "Urban High-Rise" | "Resort" | "Airport" | "Suburban" | "Conversion";
// Each area has ranges for minor/partial/full at each brand tier, plus
// optional FF&E adder (priced as separate line toggle).
export type AreaBenchmarks = {
  minor: Range;
  partial: Range;
  full: Range;
  ffe?: Range;
};

export type AreaDef = {
  key: string;
  name: string;
  description: string;
  unit: CostUnit;
  // Rollup bucket on the Review page. "dm" = Deferred Maintenance + Elevators
  // subtotal; "interior" = everything else (interior renovation, IT, BOH,
  // MEP, etc.). Also drives step ordering — dm steps come first.
  category: "dm" | "interior";
  // Whether this area contributes to the design-fee basis (roof/envelope,
  // IT, MEP, Life Safety typically excluded per the spec).
  design_basis: boolean;
  // Whether the user can flag a separate FF&E replacement line.
  has_ffe: boolean;
  // Whether the default SF estimate scales with room count (public areas do;
  // pure $/key items don't need SF input).
  sf_default?: (roomCount: number, suiteCount: number) => number;
  // $/unit benchmarks keyed by brand tier.
  ranges: Record<BrandTier, AreaBenchmarks>;
  // Area-specific descriptions for the Minor / Partial / Full scope buttons.
  // If absent, the generic SCOPE_LEVEL_BUNDLES description is used.
  scopeDescriptions?: { minor: string; partial: string; full: string };
};

export const BRAND_TIER_BY_BRAND: Record<string, BrandTier> = {
  "Ritz-Carlton": "Luxury",
  "Four Seasons": "Luxury",
  "Rosewood": "Luxury",
  "St. Regis": "Luxury",
  "Waldorf Astoria": "Luxury",
  "Edition": "Luxury",
  "JW Marriott": "Upper-Upscale",
  "W": "Upper-Upscale",
  "Westin": "Upper-Upscale",
  "Sheraton": "Upper-Upscale",
  "Marriott": "Upper-Upscale",
  "Hyatt Regency": "Upper-Upscale",
  "Thompson": "Upper-Upscale",
  "Hyatt Centric": "Upscale",
  "Hyatt Place": "Upscale",
  "InterContinental": "Luxury",
  "Kimpton": "Upper-Upscale",
  "Hotel Indigo": "Upscale",
  "Independent/Boutique": "Upper-Upscale",
  "Other": "Upper-Upscale",
};

export const BRANDS = Object.keys(BRAND_TIER_BY_BRAND);
export const BRAND_TIERS: BrandTier[] = [
  "Luxury", "Upper-Upscale", "Upscale", "Upper-Midscale", "Midscale",
];

// Regional cost multipliers. Default 1.0; bump for expensive markets.
export const REGIONAL_MULTIPLIERS: Record<string, number> = {
  "New York, NY": 1.35,
  "San Francisco, CA": 1.30,
  "Honolulu, HI": 1.30,
  "Miami, FL": 1.15,
  "Los Angeles, CA": 1.20,
  "Boston, MA": 1.20,
  "Washington, DC": 1.15,
  "Chicago, IL": 1.10,
  "Seattle, WA": 1.15,
  "Las Vegas, NV": 1.05,
  "National Average": 1.00,
  "Secondary Market": 0.90,
  "Tertiary Market": 0.82,
};

// Helper: tier-scaled range. Base is Luxury; apply % step-downs for lower
// tiers so we don't hand-key every row.
function scaleTier(base: Range, factor: number): Range {
  return {
    low: Math.round(base.low * factor),
    mid: Math.round(base.mid * factor),
    high: Math.round(base.high * factor),
  };
}

// Tier factors relative to Luxury.
const TIER_FACTORS: Record<BrandTier, number> = {
  "Luxury": 1.00,
  "Upper-Upscale": 0.75,
  "Upscale": 0.55,
  "Upper-Midscale": 0.42,
  "Midscale": 0.32,
};

// How strongly to pull Minor and Full toward Partial before tier-scaling.
// 0 = leave as authored; 1 = collapse Minor/Full to equal Partial.
// Tightens the spread between scope levels uniformly across all areas.
const SCOPE_COMPRESS = 0.35;

function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
function towardPartial(r: Range, p: Range, t: number): Range {
  return {
    low: mix(r.low, p.low, t),
    mid: mix(r.mid, p.mid, t),
    high: mix(r.high, p.high, t),
  };
}

// Build per-tier ranges from a Luxury-spec row.
function tiered(
  luxMinor: Range, luxPartial: Range, luxFull: Range, luxFfe?: Range,
): Record<BrandTier, AreaBenchmarks> {
  const cMinor = towardPartial(luxMinor, luxPartial, SCOPE_COMPRESS);
  const cFull  = towardPartial(luxFull,  luxPartial, SCOPE_COMPRESS);
  const out = {} as Record<BrandTier, AreaBenchmarks>;
  for (const t of BRAND_TIERS) {
    const f = TIER_FACTORS[t];
    out[t] = {
      minor: scaleTier(cMinor, f),
      partial: scaleTier(luxPartial, f),
      full: scaleTier(cFull, f),
      ...(luxFfe ? { ffe: scaleTier(luxFfe, f) } : {}),
    };
  }
  return out;
}

const R = (low: number, mid: number, high: number): Range => ({ low, mid, high });

// ---------------------------------------------------------------------------
// Area definitions with benchmarks.
// ---------------------------------------------------------------------------
export const AREAS: AreaDef[] = [
  // ---- Deferred Maintenance bucket (appears first in the wizard) ----------
  {
    key: "deferred_maintenance",
    name: "Building Envelope",
    description: "Roof, façade, windows, waterproofing, structural",
    unit: "per_key",
    category: "dm",
    design_basis: false,
    has_ffe: false,
    ranges: tiered(R(2000, 4000, 7000), R(8000, 14000, 20000), R(20000, 30000, 45000)),
  },
  {
    key: "dm_allowance",
    name: "Deferred Maintenance Allowance",
    description: "Catch-all allowance for deferred maintenance items not itemized elsewhere — punch-list, backlog, smaller repairs",
    unit: "per_key",
    category: "dm",
    design_basis: false,
    has_ffe: false,
    ranges: tiered(R(500, 800, 1200), R(2000, 3000, 5000), R(5000, 8000, 12000)),
  },
  {
    key: "vertical_transport",
    name: "Vertical Transportation (elevators / escalators)",
    description: "Modernization / cab refurbishment priced per elevator. If count is unknown, we estimate from key count (~1 car per 75 keys + 1 service, minimum 2).",
    unit: "per_elevator",
    category: "dm",
    design_basis: false,
    has_ffe: false,
    // Default elevator count: ~1 passenger car per 75 keys + 1 service, min 2.
    sf_default: (k) => Math.max(2, Math.ceil(k / 75) + (k >= 100 ? 1 : 0)),
    ranges: tiered(R(15000, 25000, 40000), R(75000, 125000, 175000), R(225000, 325000, 475000)),
  },
  {
    key: "mep_mechanical",
    name: "MEP — Mechanical",
    description: "HVAC, boilers, chillers, distribution — priced per key across full property",
    unit: "per_key",
    category: "dm",
    design_basis: false,
    has_ffe: false,
    ranges: tiered(R(1500, 2500, 4000), R(7500, 12000, 18000), R(20000, 30000, 45000)),
  },
  {
    key: "mep_electrical",
    name: "MEP — Electrical",
    description: "Service, distribution, panels, emergency power",
    unit: "per_key",
    category: "dm",
    design_basis: false,
    has_ffe: false,
    ranges: tiered(R(1200, 2000, 3000), R(5500, 9000, 13500), R(15000, 22000, 32000)),
  },
  {
    key: "mep_plumbing",
    name: "MEP — Plumbing",
    description: "Risers, fixtures, domestic hot water, drainage — scaled to hotel size",
    unit: "per_key",
    category: "dm",
    design_basis: false,
    has_ffe: false,
    ranges: tiered(R(400, 700, 1100), R(1800, 2800, 4200), R(5000, 7500, 11000)),
  },
  {
    key: "life_safety",
    name: "Fire / Life Safety",
    description: "Sprinkler, fire alarm, detection, egress — proportional to hotel size",
    unit: "per_key",
    category: "dm",
    design_basis: false,
    has_ffe: false,
    ranges: tiered(R(150, 250, 400), R(600, 1000, 1500), R(1800, 2800, 4200)),
  },
  {
    key: "code_required_upgrades",
    name: "Code Required Upgrades",
    description: "ADA / accessibility, current energy code, egress, and other jurisdiction-mandated upgrades triggered by the renovation",
    unit: "per_key",
    category: "dm",
    design_basis: false,
    has_ffe: false,
    ranges: tiered(R(500, 1000, 1800), R(2500, 4500, 7500), R(7000, 12000, 20000)),
  },
  // ---- Interior renovation / systems / BOH bucket -------------------------
  {
    key: "site_hardscape",
    name: "Site & Hardscape / Porte Cochère",
    description: "Driveways, landscape, porte cochère, entry sequence",
    unit: "per_key",
    category: "interior",
    design_basis: true,
    has_ffe: false,
    ranges: tiered(R(1500, 2500, 4000), R(5000, 8000, 12000), R(12000, 20000, 30000)),
  },
  {
    key: "lobby",
    name: "Lobby & Public Space",
    description: "Main lobby, reception, seating, check-in",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: (k) => Math.round(25 * k),
    ranges: tiered(R(75, 110, 150), R(200, 300, 400), R(500, 700, 1000), R(150, 225, 325)),
  },
  {
    key: "guestrooms_std",
    name: "Guestrooms (standard)",
    description: "Standard keys — SG, CG, decorative lighting (FF&E toggled separately)",
    unit: "per_key",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    ranges: tiered(R(8000, 12000, 16000), R(25000, 35000, 45000), R(55000, 75000, 95000), R(25000, 35000, 45000)),
  },
  {
    key: "suites",
    name: "Suites",
    description: "Premium/suite keys — priced per suite, replaces standard treatment",
    unit: "per_key",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    ranges: tiered(R(15000, 22000, 30000), R(40000, 55000, 75000), R(90000, 125000, 175000), R(40000, 60000, 85000)),
  },
  {
    key: "guest_corridors",
    name: "Guest Corridors & Elevator Lobbies",
    description: "Carpet, wall vinyl, lighting, doors, elevator lobby finishes — priced per floor (typical ~25 keys/floor). If floor count is unknown, we estimate from key count.",
    unit: "per_floor",
    category: "interior",
    design_basis: true,
    has_ffe: false,
    // Default floor count if not provided: ~25 keys per floor.
    sf_default: (k) => Math.max(1, Math.round(k / 25)),
    ranges: tiered(R(40000, 65000, 90000), R(115000, 165000, 235000), R(260000, 380000, 560000)),
  },
  {
    key: "guest_bathrooms",
    name: "Guest Bathrooms",
    description: "Per-key bathroom scope — tile, fixtures, vanity, tub/shower",
    unit: "per_key",
    category: "interior",
    design_basis: true,
    has_ffe: false,
    ranges: tiered(R(4000, 6000, 8000), R(15000, 22000, 30000), R(35000, 50000, 70000)),
  },
  {
    key: "specialty_restaurant",
    name: "Specialty Restaurant",
    description: "Signature F&B outlet — kitchen scope priced in BOH",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: () => 3500,
    ranges: tiered(R(100, 150, 200), R(300, 425, 575), R(650, 900, 1300), R(175, 250, 350)),
  },
  {
    key: "allday_restaurant",
    name: "All-Day Restaurant / 3-Meal",
    description: "Breakfast/lunch/dinner outlet",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: () => 3000,
    ranges: tiered(R(75, 120, 160), R(225, 325, 450), R(500, 700, 950), R(140, 200, 285)),
  },
  {
    key: "lobby_bar",
    name: "Lobby Bar / Lounge",
    description: "Bar + lounge seating adjacent to lobby",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: () => 1500,
    ranges: tiered(R(100, 150, 200), R(300, 425, 575), R(650, 900, 1250), R(165, 235, 340)),
  },
  {
    key: "rooftop_bar",
    name: "Rooftop Bar / Specialty Bar",
    description: "Elevated or specialty bar venue",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: () => 2500,
    ranges: tiered(R(125, 185, 250), R(350, 500, 700), R(750, 1050, 1500), R(200, 285, 400)),
  },
  {
    key: "market_grab_go",
    name: "Market / Grab-and-Go",
    description: "Pantry / retail-style grab-and-go outlet",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: () => 500,
    ranges: tiered(R(60, 90, 125), R(175, 250, 350), R(400, 550, 750), R(100, 150, 225)),
  },
  {
    key: "meeting_rooms",
    name: "Meeting Rooms / Pre-Function",
    description: "Breakout meeting rooms + pre-function circulation",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: (k) => Math.round(15 * k),
    ranges: tiered(R(65, 100, 135), R(175, 250, 350), R(400, 575, 800), R(90, 135, 200)),
  },
  {
    key: "ballroom",
    name: "Ballroom",
    description: "Main ballroom — flooring, walls, ceiling, lighting, AV infrastructure",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: (k) => Math.round(20 * k),
    ranges: tiered(R(75, 110, 150), R(200, 290, 400), R(475, 675, 950), R(110, 165, 240)),
  },
  {
    key: "boardroom",
    name: "Boardroom",
    description: "Executive boardroom — millwork, AV, finishes",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: () => 600,
    ranges: tiered(R(110, 165, 225), R(300, 425, 600), R(700, 1000, 1400), R(175, 260, 375)),
  },
  {
    key: "fitness",
    name: "Fitness Center",
    description: "Cardio/weight floor — equipment priced as FF&E line",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: (k) => Math.round(Math.max(800, 6 * k)),
    ranges: tiered(R(55, 85, 115), R(175, 250, 340), R(400, 575, 800), R(125, 185, 275)),
  },
  {
    key: "spa",
    name: "Spa",
    description: "Treatment rooms, relaxation, wet facilities",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: (k) => Math.round(Math.max(2000, 10 * k)),
    ranges: tiered(R(150, 225, 300), R(400, 575, 800), R(900, 1300, 1800), R(225, 335, 475)),
  },
  {
    key: "pool",
    name: "Pool & Pool Deck",
    description: "Pool shell refurb, deck, cabanas, pool equipment",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: (k) => Math.round(Math.max(3000, 12 * k)),
    ranges: tiered(R(80, 120, 160), R(225, 325, 450), R(525, 750, 1050), R(90, 135, 200)),
  },
  {
    key: "club_lounge",
    name: "Club Lounge / Executive Lounge",
    description: "Brand-mandated lounge for elite / club-tier guests",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: () => 1200,
    ranges: tiered(R(110, 165, 225), R(275, 400, 550), R(625, 900, 1250), R(165, 250, 360)),
  },
  {
    key: "retail",
    name: "Retail / Sundries",
    description: "Gift shop, sundries, boutique retail",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: () => 400,
    ranges: tiered(R(75, 115, 160), R(225, 325, 450), R(500, 725, 1000), R(120, 180, 260)),
  },
  {
    key: "boh",
    name: "BOH (kitchens, laundry, admin, locker)",
    description: "Back-of-house — kitchens, prep, laundry, admin offices, locker rooms",
    unit: "per_sf",
    category: "interior",
    design_basis: true,
    has_ffe: true,
    sf_default: (k) => Math.round(Math.max(8000, 35 * k)),
    ranges: tiered(R(50, 75, 105), R(150, 220, 300), R(350, 500, 700), R(100, 150, 220)),
  },
  {
    key: "it",
    name: "IT / Technology Infrastructure",
    description: "Cabling, wireless, PMS, door locks, guest tech — scaled to hotel size",
    unit: "per_key",
    category: "interior",
    design_basis: false,
    has_ffe: true,
    ranges: tiered(R(300, 550, 900), R(1100, 1800, 2800), R(2800, 4500, 7000), R(1000, 1700, 2700)),
  },
  {
    key: "signage",
    name: "Signage (interior + exterior)",
    description: "Wayfinding, exterior monument, brand signage",
    unit: "per_key",
    category: "interior",
    design_basis: true,
    has_ffe: false,
    ranges: tiered(R(300, 500, 800), R(1200, 1800, 2700), R(3000, 4500, 6500)),
  },
  {
    key: "exterior_lighting",
    name: "Exterior Lighting",
    description: "Facade lighting, landscape lighting, entry, pathway",
    unit: "per_key",
    category: "interior",
    design_basis: true,
    has_ffe: false,
    ranges: tiered(R(250, 400, 650), R(900, 1400, 2100), R(2200, 3200, 4800)),
  },
];

export const AREA_BY_KEY: Record<string, AreaDef> = Object.fromEntries(
  AREAS.map((a) => [a.key, a]),
);

// Property-type $/unit multipliers applied to the tier-scaled benchmark. These
// reflect how much scope each area typically carries in each property setting
// — e.g. an Urban High-Rise has almost no site / hardscape (the porte cochère
// is a small entry on the sidewalk) while a Resort's grounds are a major
// capital line that scales with key count. Areas omitted default to 1.0.
export const PROPERTY_TYPE_MULTIPLIERS: Record<PropertyType, Partial<Record<string, number>>> = {
  "Urban High-Rise": {
    site_hardscape: 0.15,
    pool: 0.6,
    spa: 0.9,
    lobby: 1.0,
    lobby_bar: 1.0,
    rooftop_bar: 1.4,
    specialty_restaurant: 1.1,
    market_grab_go: 0.8,
    meeting_rooms: 1.2,
    ballroom: 1.3,
    boardroom: 1.2,
    retail: 1.2,
    signage: 0.9,
    exterior_lighting: 1.0,
    vertical_transport: 1.3,
    deferred_maintenance: 1.0,
  },
  "Resort": {
    site_hardscape: 2.5,
    pool: 2.0,
    spa: 1.8,
    lobby: 1.3,
    lobby_bar: 1.2,
    rooftop_bar: 1.2,
    specialty_restaurant: 1.3,
    allday_restaurant: 1.0,
    meeting_rooms: 1.3,
    ballroom: 1.4,
    fitness: 1.2,
    retail: 1.3,
    signage: 1.4,
    exterior_lighting: 1.5,
    vertical_transport: 0.7,
    deferred_maintenance: 1.1,
  },
  "Airport": {
    site_hardscape: 0.4,
    pool: 0.2,
    spa: 0.3,
    lobby: 0.7,
    lobby_bar: 0.8,
    rooftop_bar: 0.3,
    specialty_restaurant: 0.5,
    allday_restaurant: 0.7,
    market_grab_go: 1.3,
    meeting_rooms: 1.1,
    ballroom: 0.5,
    boardroom: 1.0,
    fitness: 0.9,
    retail: 0.7,
    signage: 1.0,
    exterior_lighting: 0.5,
    vertical_transport: 1.0,
    club_lounge: 0.8,
    deferred_maintenance: 0.9,
  },
  "Suburban": {
    // Baseline — all areas at 1.0 by default.
  },
  "Conversion": {
    // Older/retrofit buildings: more envelope risk, less site.
    deferred_maintenance: 1.3,
    site_hardscape: 0.8,
    pool: 0.8,
    rooftop_bar: 1.0,
    vertical_transport: 1.1,
    exterior_lighting: 0.9,
  },
};

export function propertyTypeMultiplier(pt: PropertyType | "", areaKey: string): number {
  if (!pt) return 1;
  return PROPERTY_TYPE_MULTIPLIERS[pt]?.[areaKey] ?? 1;
}

// Per-area scope-level descriptions. These replace the generic
// SCOPE_LEVEL_BUNDLES description on the Minor / Partial / Full buttons so
// the copy on an MEP step actually talks about HVAC equipment instead of
// paint and soft-goods.
const AREA_SCOPE_DESCRIPTIONS: Record<string, { minor: string; partial: string; full: string }> = {
  // ---- DM bucket --------------------------------------------------------
  deferred_maintenance: {
    minor: "Sealant and caulk refresh, minor window gasket repair, isolated roof patching, small façade touch-ups.",
    partial: "Selective roof section replacement, façade repairs, selective window/storefront replacement, targeted waterproofing.",
    full: "Full roof replacement, comprehensive façade restoration, full window replacement, envelope waterproofing throughout.",
  },
  dm_allowance: {
    minor: "Small backlog punch-list items — hardware, latch repairs, touch-up paint, minor equipment fixes.",
    partial: "Medium backlog clearance — selective equipment replacement, finish repairs across public + back-of-house.",
    full: "Broad backlog sweep — significant equipment replacement, repairs across envelope, MEP, and finish systems.",
  },
  vertical_transport: {
    minor: "Cab cosmetic refresh (paint, cove, carpet, fixtures), scheduled mechanical PM catch-up.",
    partial: "Cab interior refurbishment with new finishes, LED lighting and updated fixtures; controls tune-up and selective component replacement.",
    full: "Full modernization — new controller, drives, door operators, cab interior, fixtures; hoistway and pit upgrades where required.",
  },
  mep_mechanical: {
    minor: "Filter and belt changes, valve/actuator repairs, controls calibration, deferred PM catch-up on chillers/boilers/AHUs.",
    partial: "Selective replacement of aged chillers, boilers, AHUs, or guestroom units; duct cleaning; VFD retrofits on major pumps/fans.",
    full: "Full central plant replacement (chiller / boiler / DOAS), new distribution, guestroom HVAC, and BAS / building controls.",
  },
  mep_electrical: {
    minor: "Breaker testing and selective replacement, panel tightening, emergency lighting repair, device audit.",
    partial: "Selective service upgrade, panel replacement in high-use areas, emergency power enhancement, distribution repair.",
    full: "Full service upgrade, new main distribution, panel replacement throughout, new emergency power plant and transfer.",
  },
  mep_plumbing: {
    minor: "Leak remediation, fixture repair, trim replacement, valve repair, isolated pipe repair.",
    partial: "Selective fixture and valve replacement, hot water system repair or partial replacement, riser inspection.",
    full: "Full fixture replacement, domestic water riser replacement, hot water plant replacement, drainage remediation.",
  },
  life_safety: {
    minor: "Detector and pull-station testing, battery and lamp replacement, egress signage refresh, code compliance audit.",
    partial: "Selective fire alarm panel upgrade, sprinkler head replacement in guestroom floors and key public areas, egress lighting refresh.",
    full: "Full fire alarm replacement, sprinkler system modernization throughout, emergency lighting and egress overhaul.",
  },
  code_required_upgrades: {
    minor: "Targeted ADA fixes (grab bars, clear floor space), updated signage, minor egress compliance items.",
    partial: "ADA upgrades across public areas + select guestrooms, partial energy code compliance, accessibility route improvements.",
    full: "Comprehensive compliance — ADA throughout (rooms, public, BOH), current energy code, egress overhaul, jurisdiction-mandated upgrades.",
  },

  // ---- Interior bucket --------------------------------------------------
  site_hardscape: {
    minor: "Crack sealing, re-striping, hedge / bed refresh, power-washing, isolated landscape repair at the entry.",
    partial: "Selective repaving, landscape renewal, entry sequence upgrade, pedestrian lighting and planter refurb.",
    full: "Full repaving of drives and lots, complete landscape + hardscape reset, new porte cochère treatment and entry experience, irrigation.",
  },
  lobby: {
    minor: "Paint, carpet cleaning, lobby FF&E refresh (rugs, lamps, throws), selective upholstery.",
    partial: "New soft goods throughout, refinished millwork, updated decorative lighting, selective FF&E replacement.",
    full: "Full redesign — new stone, millwork, ceiling and lighting packages, FF&E, reception and back-of-house finishes.",
  },
  guestrooms_std: {
    minor: "Soft goods refresh — drapery, bedding, decorative pillows; carpet spot-clean; selective lamp replacement.",
    partial: "Full soft goods, selective case goods replacement, refinished vanity, updated decorative lighting and artwork.",
    full: "Complete guestroom gut — new case goods, bath, flooring, lighting, FF&E, guest technology and brand-standard finishes.",
  },
  suites: {
    minor: "Soft goods refresh in living / bedroom, paint touch-ups, minor case goods repair.",
    partial: "Full soft goods + selective case goods replacement, living area FF&E refresh, bath vanity update.",
    full: "Full suite renovation — all FF&E, bath, millwork, lighting, guest technology, and premium finishes.",
  },
  guest_corridors: {
    minor: "Carpet cleaning and spot repair, paint touch-up at doors and corners, hardware repair.",
    partial: "New carpet and wall vinyl, LED lighting upgrade, door finish refresh, signage update.",
    full: "Complete corridor redesign — ceiling, walls, flooring, lighting, door replacement, and signage package throughout.",
  },
  guest_bathrooms: {
    minor: "Re-caulk, tub re-glazing, fixture polish, minor tile repair.",
    partial: "New fixtures and vanity top, tub/surround replacement, selective tile and accessory replacement.",
    full: "Full bath demo and rebuild — new tile, fixtures, vanity, plumbing trim and accessories.",
  },
  specialty_restaurant: {
    minor: "FF&E refresh (chairs, banquettes, linens, tabletop), paint, decorative lighting tune-up.",
    partial: "New FF&E, millwork refinish, bar top and back-bar refurb, updated lighting package.",
    full: "Concept-level redesign — full FF&E, kitchen upgrade, new bar build-out, finishes, lighting and AV.",
  },
  allday_restaurant: {
    minor: "Seating refresh (chairs, banquettes), paint, buffet line touch-up, lighting tune-up.",
    partial: "New FF&E + selective buffet refurb, millwork refresh, updated flooring in key zones.",
    full: "Complete redesign — new FF&E, buffet build-out, finishes, lighting and kitchen interface.",
  },
  lobby_bar: {
    minor: "Paint, bar top refinish, bar-stool replacement, decorative lighting.",
    partial: "New FF&E throughout, bar refurb (top, die wall, back-bar), updated lighting and selective millwork.",
    full: "Full redesign — new bar, FF&E, AV, decorative and architectural lighting, finishes.",
  },
  rooftop_bar: {
    minor: "Outdoor FF&E refresh, umbrellas / shade replacement, planter refresh.",
    partial: "New FF&E, bar refurb, lighting upgrade, selective weather-protection improvements.",
    full: "Complete rooftop overhaul — FF&E, bar build-out, flooring, shade / pergola, AV, landscape.",
  },
  market_grab_go: {
    minor: "Paint, display / shelving refresh, refrigeration PM, POS refresh.",
    partial: "New display + merchandising fixtures, millwork refresh, updated coolers, POS upgrade.",
    full: "Complete market redesign — all fixtures, coolers, millwork, POS, finishes and signage.",
  },
  meeting_rooms: {
    minor: "Paint, carpet spot repair, AV firmware / mic and speaker tune-up.",
    partial: "New carpet and wall vinyl, AV upgrade, new chairs and tables, updated partitions where needed.",
    full: "Full redesign — AV, lighting, partitions, ceiling, flooring, FF&E, and digital signage.",
  },
  ballroom: {
    minor: "Carpet cleaning, wall touch-up, lighting tune-up, AV firmware and mic upgrade.",
    partial: "New carpet, wall treatments, LED lighting replacement, rigging refresh, AV upgrade.",
    full: "Complete ballroom overhaul — finishes, rigging, lighting, AV, chandeliers, FF&E and pre-function.",
  },
  boardroom: {
    minor: "Table refinish, chair reupholstery, paint, AV firmware refresh.",
    partial: "New FF&E, AV upgrade, millwork refinish, updated wall finishes.",
    full: "Complete rebuild — millwork, AV package, lighting, finishes and premium FF&E.",
  },
  fitness: {
    minor: "Paint, mirror cleaning and re-hang, equipment PM, spot carpet / flooring repair.",
    partial: "Selective equipment replacement, new flooring, updated lighting, locker / towel service area refresh.",
    full: "Complete facility overhaul — all equipment, flooring, AV, lighting, locker and wet-area finishes.",
  },
  spa: {
    minor: "Paint, treatment-room soft goods refresh, linens, sound system tune-up.",
    partial: "New FF&E in treatment rooms, wet-facility repairs, retail / relaxation area refresh, lighting.",
    full: "Full spa renovation — treatment rooms, wet facilities, relaxation lounges, retail and back-of-house.",
  },
  pool: {
    minor: "Deck re-coat, furniture refresh, equipment PM, safety signage refresh.",
    partial: "New deck finish, cabana refresh, pool equipment replacement, updated lighting and landscape.",
    full: "Full pool complex — new shell finish, deck, cabanas, equipment, shade, landscape and water features.",
  },
  club_lounge: {
    minor: "Soft goods refresh, paint, decorative lighting tune-up, minor FF&E repair.",
    partial: "New FF&E, millwork refresh, bar / buffet refurb, updated lighting.",
    full: "Complete lounge redesign — FF&E, bar, AV, technology, and finishes to brand club standard.",
  },
  retail: {
    minor: "Display refresh, paint, fixture PM, signage touch-up.",
    partial: "New fixtures and merchandising, updated lighting, POS upgrade.",
    full: "Complete retail redesign — fixtures, millwork, lighting, finishes and signage package.",
  },
  boh: {
    minor: "Paint, door and hardware repair, targeted equipment PM (walk-ins, laundry, kitchen).",
    partial: "Selective equipment replacement, kitchen line refresh, locker and admin area upgrades.",
    full: "Full BOH overhaul — kitchen build-out, laundry replacement, admin and locker renovation, finishes throughout.",
  },
  it: {
    minor: "PMS patch / minor release, Wi-Fi AP replacement in weak coverage areas, selective guest tech refresh.",
    partial: "Property-wide Wi-Fi upgrade, structured cabling in public areas, door lock firmware or selective hardware refresh.",
    full: "Full Wi-Fi 6 / 6E coverage, door lock replacement throughout, PMS migration, new cable plant and guest technology stack.",
  },
  signage: {
    minor: "Damaged sign repair, re-vinyl, battery PM on illuminated signs, minor wayfinding updates.",
    partial: "New interior wayfinding package, selective exterior signage replacement, ADA / code compliance.",
    full: "Complete signage package — new brand-standard interior + exterior, monument, and compliance-driven updates throughout.",
  },
  exterior_lighting: {
    minor: "Bulb and lamp replacement, fixture PM, photo-cell / timer calibration.",
    partial: "Selective LED retrofit of façade and pathway lighting, new landscape accent lighting.",
    full: "Property-wide LED conversion, façade uplighting, complete landscape + pathway + entry lighting design.",
  },
};

export function scopeDescriptionFor(
  areaKey: string,
  level: "minor" | "partial" | "full",
): string {
  const specific = AREA_SCOPE_DESCRIPTIONS[areaKey]?.[level];
  if (specific) return specific;
  return SCOPE_LEVEL_BUNDLES[level].desc;
}

export const SCOPE_LEVEL_BUNDLES: Record<Exclude<ScopeLevel, "none">, { title: string; desc: string }> = {
  minor: {
    title: "Minor",
    desc: "Paint, touch-ups, selective soft goods refresh, equipment repair, deferred maintenance catch-up. No case goods replacement, no millwork changes, no MEP work.",
  },
  partial: {
    title: "Partial",
    desc: "Full soft goods replacement, selective case goods replacement, decorative lighting updates, refinish millwork, selective flooring. Retain layout.",
  },
  full: {
    title: "Full",
    desc: "Full soft goods + case goods + OSE + decorative & architectural lighting + flooring + millwork. May include layout changes and MEP modifications. Brand-standard-compliant scope.",
  },
};

export function unitLabel(unit: CostUnit): string {
  if (unit === "per_key") return "$/key";
  if (unit === "per_sf") return "$/SF";
  if (unit === "per_elevator") return "$/elevator";
  if (unit === "per_floor") return "$/floor";
  return "$";
}

export function unitQtyLabel(unit: CostUnit): string {
  if (unit === "per_key") return "keys";
  if (unit === "per_sf") return "SF";
  if (unit === "per_elevator") return "elevators";
  if (unit === "per_floor") return "floors";
  return "units";
}
