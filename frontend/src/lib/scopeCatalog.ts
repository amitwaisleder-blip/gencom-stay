/**
 * Comprehensive scope catalog — powers the Scope Overview "browse catalog"
 * page and the per-division "+ add from catalog" popovers.
 *
 * Each entry has:
 *   - key (unique)
 *   - label (what the user sees)
 *   - category (Soft goods, Casegoods, Seating, Lighting, Art, Window treatments,
 *     Wall/floor/ceiling, Bath FF&E, OS&E, Technology, Signage, Roof, Envelope,
 *     Structural, HVAC, Electrical, Plumbing, Fire/life safety, Vertical,
 *     Pool, Kitchen & F&B, Laundry, IT/Low voltage, Site, Landscape, Parking,
 *     Life safety/Code, BOH, Acoustics, Restaurant/Bar, Common area, Corridor)
 *   - division (maps to the Gencom template division)
 *   - unit (default unit for the line item)
 *   - description (optional — longer explanation, used as scope_item.description)
 *   - quantity — function returning qty from the property context
 *
 * Items that can't be easily auto-sized use qty=1 with unit "allowance" or "ls"
 * so the user can override after adding.
 */

import type { ScopeItem } from "./api";
import type { GuestroomMix } from "./guestroomTemplates";

export type ScopeCategory =
  | "Soft goods"
  | "Casegoods"
  | "Seating"
  | "Lighting"
  | "Art & accessories"
  | "Window treatment hardware"
  | "Wall/floor/ceiling finishes"
  | "Bath FF&E"
  | "OS&E"
  | "Technology/AV"
  | "Signage & wayfinding"
  | "Corridor-specific"
  | "Common area-specific"
  | "Restaurant/Bar"
  | "Kitchen & F&B equipment"
  | "Suite — Living & parlor"
  | "Suite — Bedroom & dressing"
  | "Suite — Bathroom & powder"
  | "Suite — Soft goods & rugs"
  | "Suite — Finishes & trim"
  | "Meeting — Architectural & millwork"
  | "Meeting — Finishes"
  | "Meeting — Lighting"
  | "Meeting — AV"
  | "Meeting — MEP & FP"
  | "Meeting — FF&E"
  | "DM — Roof"
  | "DM — Exterior envelope"
  | "DM — Structural"
  | "DM — HVAC"
  | "DM — Electrical"
  | "DM — Plumbing"
  | "DM — Fire & life safety"
  | "DM — Vertical transportation"
  | "DM — Pool & water features"
  | "DM — Laundry"
  | "DM — IT / low voltage"
  | "DM — Site & hardscape"
  | "DM — Landscape & irrigation"
  | "DM — Parking garage"
  | "DM — Life safety & code"
  | "DM — Guestroom MEP & finishes"
  | "DM — Back of house";

/** Quantity function may carry a `__basis` marker. When present, the catalog
 *  entry is stored with `multiplier_basis` set and totals auto-scale with
 *  the property's keys / floors. The function itself returns the PER-BASIS
 *  count (e.g. `2` for "2 nightstands per key"). */
export type QuantityFn = ((mix: GuestroomMix, totalKeys: number) => number) & {
  __basis?: "keys" | "floors";
};

export type ScopeCatalogEntry = {
  key: string;
  label: string;
  category: ScopeCategory;
  division: string;
  unit: ScopeItem["unit"];
  description?: string;
  quantity: QuantityFn;
};

const sum = (...xs: (number | undefined)[]) =>
  xs.reduce<number>((s, x) => s + (x ?? 0), 0);

/** Per-key items store the raw per-key count (e.g. `2`) and attach a
 *  `__basis="keys"` marker so the UI knows to set multiplier_basis on save. */
const perKey = (n: number): QuantityFn => {
  const fn: QuantityFn = () => n;
  fn.__basis = "keys";
  return fn;
};
const once = () => 1;
const kingEquiv = (n: number) => (mix: GuestroomMix) =>
  n * sum(mix.king, mix.junior_suite, mix.suite_1br, mix.suite_2br, mix.signature_suite);
const queenEquiv = (n: number) => (mix: GuestroomMix) =>
  n * sum(mix.double_queen, mix.double_double) * 2;
const suites = (n: number) => (mix: GuestroomMix) =>
  n * sum(mix.junior_suite, mix.suite_1br, mix.suite_2br, mix.signature_suite);

// ─── Guestrooms — soft goods ───────────────────────────────────────────
const GUESTROOM_SOFT_GOODS: ScopeCatalogEntry[] = [
  { key: "gr_drapery", label: "Drapery", category: "Soft goods", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "gr_sheers", label: "Sheers", category: "Soft goods", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "gr_bedspread", label: "Bedspreads / Duvets", category: "Soft goods", division: "GUESTROOMS", unit: "each", quantity: (m) => sum(m.king, m.junior_suite, m.suite_1br, m.suite_2br, m.signature_suite) + 2 * sum(m.double_queen, m.double_double) },
  { key: "gr_bed_scarf", label: "Bed Scarves", category: "Soft goods", division: "GUESTROOMS", unit: "each", quantity: (m) => sum(m.king, m.junior_suite, m.suite_1br, m.suite_2br, m.signature_suite) + 2 * sum(m.double_queen, m.double_double) },
  { key: "gr_pillows", label: "Pillows", category: "Soft goods", division: "GUESTROOMS", unit: "each", description: "4 per bed (2 sleeping + 2 accent).", quantity: (m) => 4 * (sum(m.king, m.junior_suite, m.suite_1br, m.suite_2br, m.signature_suite) + 2 * sum(m.double_queen, m.double_double)) },
  { key: "gr_decorative_cushions", label: "Decorative Cushions", category: "Soft goods", division: "GUESTROOMS", unit: "each", quantity: perKey(2) },
  { key: "gr_upholstered_headboard", label: "Upholstered Headboards", category: "Soft goods", division: "GUESTROOMS", unit: "each", quantity: (m) => sum(m.king, m.junior_suite, m.suite_1br, m.suite_2br, m.signature_suite) + 2 * sum(m.double_queen, m.double_double) },
  { key: "gr_upholstery_fabric", label: "Upholstery Fabrics", category: "Soft goods", division: "GUESTROOMS", unit: "allowance", quantity: once },
  { key: "gr_area_rug", label: "Area Rugs", category: "Soft goods", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_carpet", label: "Carpet (broadloom)", category: "Soft goods", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "gr_carpet_custom", label: "Carpet — custom (suites)", category: "Soft goods", division: "SUITES", unit: "each", quantity: (m) => sum(m.junior_suite, m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "gr_bath_linens", label: "Bath Linens", category: "Soft goods", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "gr_bed_linens", label: "Bed Linens", category: "Soft goods", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
];

// ─── Guestrooms — casegoods ────────────────────────────────────────────
const GUESTROOM_CASEGOODS: ScopeCatalogEntry[] = [
  { key: "gr_nightstand", label: "Nightstand", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: perKey(2) },
  { key: "gr_dresser", label: "Dresser", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_desk", label: "Desk", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_credenza", label: "Credenza", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_armoire", label: "Armoire", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_wood_headboard", label: "Headboard — wood", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: (m) => sum(m.king, m.junior_suite, m.suite_1br, m.suite_2br, m.signature_suite) + 2 * sum(m.double_queen, m.double_double) },
  { key: "gr_luggage_bench", label: "Luggage Bench", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_writing_table", label: "Writing Table", category: "Casegoods", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "gr_minibar_cabinet", label: "Minibar Cabinet", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_entertainment_console", label: "Entertainment Console", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_coffee_table", label: "Coffee / Side Table", category: "Casegoods", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_dining_table_suite", label: "Dining Table (suites)", category: "Casegoods", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "gr_builtin_millwork", label: "Built-in Millwork", category: "Casegoods", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
];

// ─── Guestrooms — seating ──────────────────────────────────────────────
const GUESTROOM_SEATING: ScopeCatalogEntry[] = [
  { key: "gr_desk_chair", label: "Desk Chair", category: "Seating", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_lounge_chair", label: "Lounge Chair", category: "Seating", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_sofa_suite", label: "Sofa (suites)", category: "Seating", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "gr_sectional_suite", label: "Sectional (suites)", category: "Seating", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "gr_ottoman", label: "Ottoman", category: "Seating", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_dining_chair_suite", label: "Dining Chair (suites)", category: "Seating", division: "SUITES", unit: "each", quantity: (m) => 4 * sum(m.junior_suite, m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "gr_accent_chair", label: "Accent Chair", category: "Seating", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
];

// ─── Guestrooms — lighting ─────────────────────────────────────────────
const GUESTROOM_LIGHTING: ScopeCatalogEntry[] = [
  { key: "gr_table_lamp", label: "Table Lamp", category: "Lighting", division: "GUESTROOMS", unit: "each", quantity: perKey(2) },
  { key: "gr_floor_lamp", label: "Floor Lamp", category: "Lighting", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_desk_lamp", label: "Desk Lamp", category: "Lighting", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_bedside_sconce", label: "Bedside Sconce", category: "Lighting", division: "GUESTROOMS", unit: "each", quantity: perKey(2) },
  { key: "gr_pendant", label: "Pendant Fixture", category: "Lighting", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_chandelier_suite", label: "Chandelier (suites)", category: "Lighting", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "gr_reading_light", label: "Reading Light", category: "Lighting", division: "GUESTROOMS", unit: "each", quantity: perKey(2) },
  { key: "gr_decorative_sconce", label: "Decorative Wall Sconce", category: "Lighting", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_picture_light", label: "Picture Light", category: "Lighting", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
];

// ─── Guestrooms — art & accessories ────────────────────────────────────
const GUESTROOM_ART: ScopeCatalogEntry[] = [
  { key: "gr_framed_art", label: "Framed Art", category: "Art & accessories", division: "GUESTROOMS", unit: "each", quantity: perKey(3) },
  { key: "gr_mirror", label: "Mirrors", category: "Art & accessories", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_sculpture", label: "Sculptures", category: "Art & accessories", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "gr_decorative_object", label: "Decorative Objects", category: "Art & accessories", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "gr_vase", label: "Vases", category: "Art & accessories", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_tray", label: "Trays", category: "Art & accessories", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_books", label: "Books", category: "Art & accessories", division: "GUESTROOMS", unit: "allowance", quantity: once },
  { key: "gr_botanicals", label: "Botanicals / Florals", category: "Art & accessories", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_decorative_screen", label: "Decorative Screens (suites)", category: "Art & accessories", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },
];

// ─── Window treatment hardware ─────────────────────────────────────────
const WINDOW_HARDWARE: ScopeCatalogEntry[] = [
  { key: "gr_drapery_rods", label: "Drapery Rods", category: "Window treatment hardware", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_drapery_tracks", label: "Tracks", category: "Window treatment hardware", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_motorized_shade", label: "Motorized Shade System", category: "Window treatment hardware", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "gr_blackout_mechanism", label: "Blackout Mechanism", category: "Window treatment hardware", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
];

// ─── Wall/floor/ceiling finishes ───────────────────────────────────────
const FINISHES: ScopeCatalogEntry[] = [
  { key: "fin_wallcovering", label: "Wallcovering / Wallpaper", category: "Wall/floor/ceiling finishes", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "fin_vinyl", label: "Vinyl", category: "Wall/floor/ceiling finishes", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "fin_wood_paneling", label: "Applied Wood Paneling", category: "Wall/floor/ceiling finishes", division: "GUESTROOMS", unit: "allowance", quantity: once },
  { key: "fin_decorative_tile", label: "Decorative Tile", category: "Wall/floor/ceiling finishes", division: "GUESTROOMS", unit: "allowance", quantity: once },
  { key: "fin_stone", label: "Stone", category: "Wall/floor/ceiling finishes", division: "GUESTROOMS", unit: "allowance", quantity: once },
  { key: "fin_ceiling_specialty", label: "Specialty Ceiling Treatments", category: "Wall/floor/ceiling finishes", division: "GUESTROOMS", unit: "allowance", quantity: once },
];

// ─── Bath FF&E ─────────────────────────────────────────────────────────
const BATH_FFE: ScopeCatalogEntry[] = [
  { key: "bath_freestanding_tub", label: "Freestanding Tub", category: "Bath FF&E", division: "GUESTROOMS", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "bath_vanity_stool", label: "Vanity Stool", category: "Bath FF&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "bath_robe_hook", label: "Robe Hooks (decorative)", category: "Bath FF&E", division: "GUESTROOMS", unit: "each", quantity: perKey(2) },
  { key: "bath_towel_bar", label: "Towel Bars", category: "Bath FF&E", division: "GUESTROOMS", unit: "each", quantity: perKey(2) },
  { key: "bath_tissue_holder", label: "Tissue Holder", category: "Bath FF&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "bath_waste_bin", label: "Waste Bin", category: "Bath FF&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "bath_amenity_tray", label: "Amenity Tray", category: "Bath FF&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "bath_accessories", label: "Bath Accessories (pkg)", category: "Bath FF&E", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "bath_decorative_mirror", label: "Decorative Mirror", category: "Bath FF&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
];

// ─── OS&E ──────────────────────────────────────────────────────────────
const OSE: ScopeCatalogEntry[] = [
  { key: "ose_glassware", label: "Glassware", category: "OS&E", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "ose_china", label: "China", category: "OS&E", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "ose_flatware", label: "Flatware", category: "OS&E", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "ose_coffee_maker", label: "In-room Coffee Maker", category: "OS&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "ose_ice_bucket", label: "Ice Bucket", category: "OS&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "ose_tray", label: "Trays", category: "OS&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "ose_hangers", label: "Hangers", category: "OS&E", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "ose_hair_dryer", label: "Hair Dryer", category: "OS&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "ose_iron_board", label: "Iron / Board", category: "OS&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "ose_safe", label: "In-room Safe", category: "OS&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "ose_minibar_contents", label: "Minibar Contents", category: "OS&E", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "ose_trash_can", label: "Trash Can", category: "OS&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "ose_laundry_bag", label: "Laundry Bags", category: "OS&E", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "ose_stationery", label: "Stationery", category: "OS&E", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "ose_collateral", label: "Collateral", category: "OS&E", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "ose_amenities", label: "Guest Amenities", category: "OS&E", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "ose_hk_cart", label: "Housekeeping Carts", category: "OS&E", division: "MISC. ITEMS", unit: "each", quantity: (_m, k) => Math.max(1, Math.ceil(k / 20)) },
];

// ─── Technology / AV ───────────────────────────────────────────────────
const TECH: ScopeCatalogEntry[] = [
  { key: "tech_tv", label: "In-room TV (55\")", category: "Technology/AV", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "tech_soundbar", label: "Sound Bar", category: "Technology/AV", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "tech_control_system", label: "Control System (Crestron / Lutron)", category: "Technology/AV", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "tech_thermostat", label: "Digital Thermostat", category: "Technology/AV", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "tech_door_lock", label: "Electronic Door Lock", category: "Technology/AV", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "tech_phone", label: "Phone", category: "Technology/AV", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "tech_clock", label: "Clock / Alarm", category: "Technology/AV", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "tech_usb", label: "USB / Charging Solutions", category: "Technology/AV", division: "GUESTROOMS", unit: "per key", quantity: perKey(1) },
  { key: "tech_wifi_ap", label: "Wi-Fi Access Point", category: "Technology/AV", division: "GUESTROOMS", unit: "each", quantity: (_m, k) => Math.max(1, Math.ceil(k / 3)) },
  { key: "tech_digital_signage", label: "Digital Signage", category: "Technology/AV", division: "COMMON AREA", unit: "each", quantity: () => 4 },
];

// ─── Signage ───────────────────────────────────────────────────────────
const SIGNAGE: ScopeCatalogEntry[] = [
  { key: "sig_room_plaque", label: "Room Number Plaque", category: "Signage & wayfinding", division: "GUESTROOMS", unit: "each", quantity: perKey(1) },
  { key: "sig_ada", label: "ADA Signage", category: "Signage & wayfinding", division: "COMMON AREA", unit: "allowance", quantity: once },
  { key: "sig_directional", label: "Directional Signage", category: "Signage & wayfinding", division: "COMMON AREA", unit: "allowance", quantity: once },
  { key: "sig_elevator_lobby", label: "Elevator Lobby Signs", category: "Signage & wayfinding", division: "CORRIDORS", unit: "each", quantity: (_m, _k) => 2 },
  { key: "sig_brand", label: "Brand Signage", category: "Signage & wayfinding", division: "COMMON AREA", unit: "allowance", quantity: once },
];

// ─── Corridor-specific ─────────────────────────────────────────────────
const CORRIDOR: ScopeCatalogEntry[] = [
  { key: "corr_carpet", label: "Corridor Runner / Carpet", category: "Corridor-specific", division: "CORRIDORS", unit: "allowance", quantity: once, description: "Broadloom or custom Axminster. Size via area sqft." },
  { key: "corr_console", label: "Console Tables", category: "Corridor-specific", division: "CORRIDORS", unit: "each", quantity: (_m, _k) => 4 },
  { key: "corr_bench", label: "Corridor Benches", category: "Corridor-specific", division: "CORRIDORS", unit: "each", quantity: (_m, _k) => 4 },
  { key: "corr_large_art", label: "Large-scale Art", category: "Corridor-specific", division: "CORRIDORS", unit: "each", quantity: (_m, _k) => 6 },
  { key: "corr_decorative_light", label: "Decorative Lighting (corridor)", category: "Corridor-specific", division: "CORRIDORS", unit: "allowance", quantity: once },
  { key: "corr_vending_millwork", label: "Ice/Vending Alcove Millwork", category: "Corridor-specific", division: "CORRIDORS", unit: "each", quantity: (_m, _k) => 2 },
];

// ─── Common area-specific ──────────────────────────────────────────────
const COMMON_AREA: ScopeCatalogEntry[] = [
  { key: "ca_reception_desk", label: "Reception Desk & Back Millwork", category: "Common area-specific", division: "COMMON AREA", unit: "ls", quantity: once },
  { key: "ca_lobby_vignette", label: "Lobby Seating Vignettes", category: "Common area-specific", division: "COMMON AREA", unit: "allowance", quantity: once },
  { key: "ca_bell_cart", label: "Bell Carts", category: "Common area-specific", division: "COMMON AREA", unit: "each", quantity: (_m, _k) => 4 },
  { key: "ca_luggage_storage", label: "Luggage Storage Fixtures", category: "Common area-specific", division: "COMMON AREA", unit: "allowance", quantity: once },
  { key: "ca_fireplace", label: "Fireplace Surround", category: "Common area-specific", division: "COMMON AREA", unit: "allowance", quantity: once },
  { key: "ca_decorative_screen", label: "Decorative Columns / Screens", category: "Common area-specific", division: "COMMON AREA", unit: "allowance", quantity: once },
  { key: "ca_planter", label: "Planters", category: "Common area-specific", division: "COMMON AREA", unit: "each", quantity: (_m, _k) => 8 },
  { key: "ca_porte_cochere_furn", label: "Porte-cochère Furniture", category: "Common area-specific", division: "COMMON AREA", unit: "allowance", quantity: once },
  { key: "ca_pool_cabana", label: "Pool & Cabana Furniture", category: "Common area-specific", division: "COMMON AREA", unit: "allowance", quantity: once },
];

// ─── Restaurant / Bar ──────────────────────────────────────────────────
const RESTAURANT_BAR: ScopeCatalogEntry[] = [
  { key: "fnb_bar_die", label: "Bar — Die (front)", category: "Restaurant/Bar", division: "F&B", unit: "lf", quantity: once },
  { key: "fnb_bar_top", label: "Bar — Top (stone/wood/metal)", category: "Restaurant/Bar", division: "F&B", unit: "lf", quantity: once },
  { key: "fnb_back_bar_millwork", label: "Back Bar Millwork", category: "Restaurant/Bar", division: "F&B", unit: "allowance", quantity: once },
  { key: "fnb_bar_stool", label: "Bar Stool", category: "Seating", division: "F&B", unit: "each", quantity: (_m, _k) => 12 },
  { key: "fnb_counter_stool", label: "Counter Stool", category: "Seating", division: "F&B", unit: "each", quantity: (_m, _k) => 8 },
  { key: "fnb_dining_chair", label: "Dining Chair", category: "Seating", division: "F&B", unit: "each", quantity: (_m, _k) => 80 },
  { key: "fnb_banquette", label: "Banquette", category: "Seating", division: "F&B", unit: "lf", quantity: once },
  { key: "fnb_booth", label: "Booth", category: "Seating", division: "F&B", unit: "each", quantity: (_m, _k) => 8 },
  { key: "fnb_host_seating", label: "Host / Waiting Area Seating", category: "Seating", division: "F&B", unit: "allowance", quantity: once },
  { key: "fnb_dining_table", label: "Dining Table", category: "Casegoods", division: "F&B", unit: "each", quantity: (_m, _k) => 30 },
  { key: "fnb_high_top_table", label: "High-top Table", category: "Casegoods", division: "F&B", unit: "each", quantity: (_m, _k) => 6 },
  { key: "fnb_communal_table", label: "Communal Table", category: "Casegoods", division: "F&B", unit: "each", quantity: (_m, _k) => 1 },
  { key: "fnb_host_stand", label: "Host Stand", category: "Casegoods", division: "F&B", unit: "each", quantity: (_m, _k) => 1 },
  { key: "fnb_service_station", label: "Service / POS Station", category: "Casegoods", division: "F&B", unit: "each", quantity: (_m, _k) => 3 },
  { key: "fnb_wine_display", label: "Wine Display Cabinetry", category: "Casegoods", division: "F&B", unit: "allowance", quantity: once },
  { key: "fnb_flooring", label: "Flooring", category: "Wall/floor/ceiling finishes", division: "F&B", unit: "allowance", quantity: once },
  { key: "fnb_walls_paint", label: "Paint & Walls", category: "Wall/floor/ceiling finishes", division: "F&B", unit: "allowance", quantity: once },
  { key: "fnb_ceiling", label: "Ceiling (acoustic / decorative)", category: "Wall/floor/ceiling finishes", division: "F&B", unit: "allowance", quantity: once },
  { key: "fnb_chandelier", label: "Chandelier (F&B)", category: "Lighting", division: "F&B", unit: "each", quantity: (_m, _k) => 4 },
  { key: "fnb_pendant", label: "Pendant Fixtures (F&B)", category: "Lighting", division: "F&B", unit: "each", quantity: (_m, _k) => 12 },
  { key: "fnb_decorative_sconce", label: "Decorative Sconces (F&B)", category: "Lighting", division: "F&B", unit: "each", quantity: (_m, _k) => 8 },
  { key: "fnb_drapery", label: "Drapery / Sheers (F&B)", category: "Soft goods", division: "F&B", unit: "allowance", quantity: once },
  { key: "fnb_artwork", label: "Artwork (F&B)", category: "Art & accessories", division: "F&B", unit: "allowance", quantity: once },
];

// ─── Kitchen & F&B equipment ───────────────────────────────────────────
const KITCHEN: ScopeCatalogEntry[] = [
  { key: "kit_range", label: "Range", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_combi_oven", label: "Combi Oven", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_deck_oven", label: "Deck / Pizza Oven", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_charbroiler", label: "Charbroiler", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_fryer", label: "Fryer", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: (_m, _k) => 2 },
  { key: "kit_flat_top", label: "Flat Top / Griddle", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_walkin_cooler", label: "Walk-in Cooler", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_walkin_freezer", label: "Walk-in Freezer", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_reach_in", label: "Reach-in Refrigerator / Freezer", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: (_m, _k) => 4 },
  { key: "kit_ice_machine", label: "Ice Machine", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: (_m, _k) => 2 },
  { key: "kit_dishwasher", label: "Dishwasher (conveyor)", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_3comp_sink", label: "3-Compartment Sink", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_hood", label: "Exhaust Hood (+ fire suppression)", category: "Kitchen & F&B equipment", division: "F&B", unit: "lf", quantity: once },
  { key: "kit_ansul", label: "Ansul Fire Suppression", category: "Kitchen & F&B equipment", division: "F&B", unit: "ls", quantity: once },
  { key: "kit_prep_table", label: "Prep Table", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: (_m, _k) => 4 },
  { key: "kit_shelving", label: "Smallwares Shelving", category: "Kitchen & F&B equipment", division: "F&B", unit: "allowance", quantity: once },
  { key: "kit_grease_trap", label: "Grease Trap / Interceptor", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
  { key: "kit_booster_heater", label: "Booster Heater (dishwasher)", category: "Kitchen & F&B equipment", division: "F&B", unit: "each", quantity: once },
];

// ─── Deferred Maintenance — Roof ───────────────────────────────────────
const DM_ROOF: ScopeCatalogEntry[] = [
  { key: "dm_roof_membrane", label: "Roof Membrane (TPO/EPDM/Mod.Bit.)", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once, description: "Size via roof sqft — Claude can estimate if unknown." },
  { key: "dm_roof_insulation", label: "Roof Insulation", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_parapet", label: "Parapet Walls & Coping", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
  { key: "dm_roof_drains", label: "Roof Drains & Scuppers", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_gutters", label: "Gutters & Downspouts", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
  { key: "dm_flashing", label: "Flashing (base/counter/step)", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_roof_hatch", label: "Roof Hatches", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "each", quantity: (_m, _k) => 2 },
  { key: "dm_skylight", label: "Skylights", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "each", quantity: once },
  { key: "dm_expansion_joint_roof", label: "Roof Expansion Joints", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
  { key: "dm_roof_pavers", label: "Roof Pavers / Ballast", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_equip_screens", label: "Roof Equipment Screens", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
  { key: "dm_lightning", label: "Lightning Protection System", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_fall_protection", label: "Fall Protection Anchors", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_amenity_waterproofing", label: "Amenity Deck Waterproofing", category: "DM — Roof", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
];

// ─── DM — Exterior envelope ────────────────────────────────────────────
const DM_ENVELOPE: ScopeCatalogEntry[] = [
  { key: "dm_stucco_eifs", label: "Stucco / EIFS", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_exterior_paint", label: "Exterior Painted Surfaces", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_sealants", label: "Sealants & Caulking", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
  { key: "dm_tuckpointing", label: "Brick Mortar / Tuckpointing", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_window_glazing", label: "Window Glazing & Seals", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_window_frames", label: "Window Frames & Gaskets", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_storefront", label: "Storefront System", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
  { key: "dm_curtainwall", label: "Curtain Wall System", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_balcony_railing", label: "Balcony Railings / Glass", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
  { key: "dm_balcony_waterproof", label: "Balcony Waterproofing / Coatings", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_sliding_doors", label: "Sliding Glass Doors + Hardware", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "each", quantity: once },
  { key: "dm_exterior_doors", label: "Exterior Doors + Hardware", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "each", quantity: once },
  { key: "dm_louvers", label: "Louvers & Vents", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_awning", label: "Awnings & Canopies", category: "DM — Exterior envelope", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
];

// ─── DM — Structural ───────────────────────────────────────────────────
const DM_STRUCTURAL: ScopeCatalogEntry[] = [
  { key: "dm_concrete_spalling", label: "Concrete Spalling / Cracks", category: "DM — Structural", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_post_tension", label: "Post-tension Cable Corrosion", category: "DM — Structural", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_rebar_corrosion", label: "Rebar Corrosion", category: "DM — Structural", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_balcony_delam", label: "Balcony Slab Delamination", category: "DM — Structural", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_pool_deck_struct", label: "Pool Deck Structure", category: "DM — Structural", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_garage_struct", label: "Parking Garage Structure", category: "DM — Structural", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_foundation_wp", label: "Foundation Waterproofing", category: "DM — Structural", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_seawall", label: "Seawall / Bulkhead", category: "DM — Structural", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
];

// ─── DM — HVAC ─────────────────────────────────────────────────────────
const DM_HVAC: ScopeCatalogEntry[] = [
  { key: "dm_chiller", label: "Chillers", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_cooling_tower", label: "Cooling Towers", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_boiler", label: "Boilers", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_hw_heater", label: "Hot Water Heaters", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_pump", label: "Pumps (CHW / CW / HW)", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_ahu", label: "Air Handling Units", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_fcu", label: "Fan Coil Units", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  { key: "dm_ptac", label: "PTAC / VTAC Units", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  { key: "dm_vrf", label: "VRF / VRV Systems", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_rtu", label: "Rooftop Units", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 2 },
  { key: "dm_exhaust_fan", label: "Exhaust Fans", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_mau", label: "Makeup Air Units", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_erv", label: "Energy Recovery Ventilators", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_ductwork", label: "Ductwork & Insulation", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_vav", label: "VAV Boxes", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "each", quantity: (_m, _k) => 20 },
  { key: "dm_diffuser", label: "Diffusers & Grilles", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_bms", label: "Building Management System (BMS)", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_kitchen_hood_sys", label: "Kitchen Hood / Exhaust System", category: "DM — HVAC", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
];

// ─── DM — Electrical ───────────────────────────────────────────────────
const DM_ELECTRICAL: ScopeCatalogEntry[] = [
  { key: "dm_switchgear", label: "Main Switchgear", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_transformer", label: "Transformers", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_panel", label: "Distribution & Sub-Panels", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_generator", label: "Emergency Generator", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_ats", label: "Automatic Transfer Switches", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_ups", label: "UPS Systems", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_branch_wiring", label: "Branch Circuit Wiring", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_ext_lighting", label: "Exterior Lighting", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_corridor_lighting", label: "Corridor & Common Area Lighting", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_egress_lighting", label: "Emergency / Egress Lighting", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_exit_signs", label: "Exit Signs", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "each", quantity: (_m, _k) => 30 },
  { key: "dm_garage_lighting", label: "Parking Garage Lighting", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_dimming", label: "Lighting Controls / Dimming", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_vfd", label: "Variable Frequency Drives", category: "DM — Electrical", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 3 },
];

// ─── DM — Plumbing ─────────────────────────────────────────────────────
const DM_PLUMBING: ScopeCatalogEntry[] = [
  { key: "dm_dom_water_riser", label: "Domestic Water Risers", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_recirc_pump", label: "Recirculation Pumps", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 2 },
  { key: "dm_booster_pump", label: "Booster Pumps", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_prv", label: "Pressure Reducing Valves", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_backflow", label: "Backflow Preventers", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 2 },
  { key: "dm_water_softener", label: "Water Softeners", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_sanitary_pipe", label: "Sanitary Waste & Vent Piping", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_sump_pump", label: "Sump / Ejector Pumps", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 2 },
  { key: "dm_gas_piping", label: "Gas Piping & Shutoffs", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_gr_fixtures", label: "Guestroom Fixtures (toilets/sinks/tubs/showers)", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "per key", quantity: perKey(1) },
  { key: "dm_shower_valve", label: "Shower Valves & Diverters", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  { key: "dm_faucet_cartridge", label: "Faucet Cartridges", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "per key", quantity: perKey(1) },
  { key: "dm_water_filtration", label: "Water Filtration Systems", category: "DM — Plumbing", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
];

// ─── DM — Fire & life safety ───────────────────────────────────────────
const DM_FIRE: ScopeCatalogEntry[] = [
  { key: "dm_sprinkler", label: "Fire Sprinkler System", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_standpipe", label: "Standpipes", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_fire_pump", label: "Fire Pumps", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_sprinkler_head", label: "Sprinkler Heads", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "per key", quantity: perKey(1) },
  { key: "dm_fire_alarm_panel", label: "Fire Alarm Control Panel", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_smoke_detector", label: "Smoke Detectors", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(2) },
  { key: "dm_pull_station", label: "Pull Stations", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "each", quantity: (_m, _k) => 20 },
  { key: "dm_notification", label: "Notification Appliances (horns/strobes)", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_voice_evac", label: "Voice Evacuation System", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_fire_ext", label: "Fire Extinguishers", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "each", quantity: (_m, _k) => 40 },
  { key: "dm_kitchen_ansul", label: "Kitchen Hood Suppression (Ansul)", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_fire_doors", label: "Fire-rated Doors & Hardware", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_smoke_damper", label: "Fire & Smoke Dampers", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_smoke_control", label: "Smoke Control / Pressurization", category: "DM — Fire & life safety", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
];

// ─── DM — Vertical transportation ──────────────────────────────────────
const DM_VERTICAL: ScopeCatalogEntry[] = [
  { key: "dm_elevator_cab", label: "Passenger Elevator Cabs", category: "DM — Vertical transportation", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 4 },
  { key: "dm_service_elev", label: "Service / Freight Elevators", category: "DM — Vertical transportation", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_elev_machine", label: "Elevator Machines & Controllers", category: "DM — Vertical transportation", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_hoist_cables", label: "Hoist Cables", category: "DM — Vertical transportation", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_door_operator", label: "Door Operators / Restrictors", category: "DM — Vertical transportation", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_cab_interior", label: "Cab Interiors & Finishes", category: "DM — Vertical transportation", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 4 },
  { key: "dm_escalator", label: "Escalators", category: "DM — Vertical transportation", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 0 },
  { key: "dm_dumbwaiter", label: "Dumbwaiters", category: "DM — Vertical transportation", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
];

// ─── DM — Pool & water features ────────────────────────────────────────
const DM_POOL: ScopeCatalogEntry[] = [
  { key: "dm_pool_shell", label: "Pool Shell / Waterproofing", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_pool_tile", label: "Pool Tile & Coping", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_pool_deck", label: "Pool Deck Surface", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_pool_pump", label: "Pool Pumps / Motors", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 2 },
  { key: "dm_pool_filter", label: "Pool Filters", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_pool_heater", label: "Pool Heaters", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_pool_chem", label: "Chemical Feed System", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_pool_lighting", label: "Pool Lighting", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_pool_vgb", label: "Pool Drains / VGB Covers", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_spa_equip", label: "Spa Equipment", category: "DM — Pool & water features", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
];

// ─── DM — Laundry ──────────────────────────────────────────────────────
const DM_LAUNDRY: ScopeCatalogEntry[] = [
  { key: "dm_washer", label: "Washers", category: "DM — Laundry", division: "DEFERRED MAINTENANCE", unit: "each", quantity: (_m, k) => Math.max(2, Math.ceil(k / 50)) },
  { key: "dm_dryer", label: "Dryers", category: "DM — Laundry", division: "DEFERRED MAINTENANCE", unit: "each", quantity: (_m, k) => Math.max(2, Math.ceil(k / 50)) },
  { key: "dm_ironer", label: "Ironers / Flatwork", category: "DM — Laundry", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_lint", label: "Lint Collection System", category: "DM — Laundry", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_laundry_chem", label: "Chemical Feed System (laundry)", category: "DM — Laundry", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_laundry_exhaust", label: "Exhaust Ductwork (laundry)", category: "DM — Laundry", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
];

// ─── DM — IT / low voltage ─────────────────────────────────────────────
const DM_IT: ScopeCatalogEntry[] = [
  { key: "dm_data_cabling", label: "Data Cabling", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_network_sw", label: "Network Switches / Routers", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_server_cooling", label: "Server Room Cooling", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_server_fire", label: "Server Room Fire Suppression", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_wifi", label: "Guestroom Wi-Fi Access Points", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "each", quantity: (_m, k) => Math.max(1, Math.ceil(k / 3)) },
  { key: "dm_das", label: "DAS (Distributed Antenna System)", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_cctv", label: "CCTV Cameras & NVR", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_access_control", label: "Access Control System", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_gr_door_lock", label: "Guestroom Door Locks", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  { key: "dm_pbx", label: "PBX / Phone System", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_iptv", label: "IPTV System", category: "DM — IT / low voltage", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
];

// ─── DM — Site, landscape, parking, code, guestroom MEP, BOH ──────────
const DM_OTHER: ScopeCatalogEntry[] = [
  // Site & hardscape
  { key: "dm_asphalt", label: "Asphalt Paving", category: "DM — Site & hardscape", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_concrete_paving", label: "Concrete Paving / Sidewalks", category: "DM — Site & hardscape", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_pavers", label: "Pavers & Hardscape", category: "DM — Site & hardscape", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_retaining_wall", label: "Retaining Walls", category: "DM — Site & hardscape", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
  { key: "dm_site_drainage", label: "Site Drainage / Storm Systems", category: "DM — Site & hardscape", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_porte_cochere", label: "Porte-cochère Structure & Finishes", category: "DM — Site & hardscape", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  // Landscape
  { key: "dm_irrigation_controller", label: "Irrigation Controllers", category: "DM — Landscape & irrigation", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_landscape_lighting", label: "Landscape Lighting", category: "DM — Landscape & irrigation", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_trees", label: "Trees / Canopy Replacement", category: "DM — Landscape & irrigation", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  // Parking garage
  { key: "dm_traffic_coating", label: "Garage Traffic Coating", category: "DM — Parking garage", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_garage_vent", label: "Garage Ventilation / CO Monitoring", category: "DM — Parking garage", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_garage_striping", label: "Line Striping", category: "DM — Parking garage", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_ev_charger", label: "EV Charging Stations", category: "DM — Parking garage", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 4 },
  // Code / life safety
  { key: "dm_ada", label: "ADA Compliance Items", category: "DM — Life safety & code", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_stair_pressure", label: "Stairwell Pressurization", category: "DM — Life safety & code", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_exit_hardware", label: "Exit Hardware / Panic Devices", category: "DM — Life safety & code", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_refuge_comm", label: "Area of Refuge Communication", category: "DM — Life safety & code", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  { key: "dm_elev_recall", label: "Elevator Recall / Firefighter Service", category: "DM — Life safety & code", division: "DEFERRED MAINTENANCE", unit: "ls", quantity: once },
  // GR MEP + finishes tied to DM
  { key: "dm_bath_waterproof", label: "Bathroom Waterproofing & Membranes", category: "DM — Guestroom MEP & finishes", division: "DEFERRED MAINTENANCE", unit: "per key", quantity: perKey(1) },
  { key: "dm_grout_tile", label: "Grout & Tile Repair", category: "DM — Guestroom MEP & finishes", division: "DEFERRED MAINTENANCE", unit: "per key", quantity: perKey(1) },
  { key: "dm_shower_pan", label: "Shower Pans", category: "DM — Guestroom MEP & finishes", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  { key: "dm_vanity_top", label: "Vanity Countertops", category: "DM — Guestroom MEP & finishes", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  { key: "dm_gr_entry_door", label: "Guestroom Entry Doors & Frames", category: "DM — Guestroom MEP & finishes", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  { key: "dm_door_closer", label: "Door Closers & Hinges", category: "DM — Guestroom MEP & finishes", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  { key: "dm_gr_thermostat", label: "Guestroom Thermostats & Controls", category: "DM — Guestroom MEP & finishes", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  { key: "dm_gr_exhaust", label: "Guestroom Exhaust Fans", category: "DM — Guestroom MEP & finishes", division: "DEFERRED MAINTENANCE", unit: "each", quantity: perKey(1) },
  // BOH
  { key: "dm_boh_employee_locker", label: "Employee Locker Rooms", category: "DM — Back of house", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_boh_hk_closet", label: "Housekeeping Closets", category: "DM — Back of house", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_boh_trash_room", label: "Trash & Recycling Rooms", category: "DM — Back of house", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_compactor", label: "Compactor", category: "DM — Back of house", division: "DEFERRED MAINTENANCE", unit: "each", quantity: () => 1 },
  { key: "dm_dock_seal", label: "Loading Dock Seals & Bumpers", category: "DM — Back of house", division: "DEFERRED MAINTENANCE", unit: "allowance", quantity: once },
  { key: "dm_boh_flooring", label: "BOH Flooring (sealed concrete / quarry tile)", category: "DM — Back of house", division: "DEFERRED MAINTENANCE", unit: "sf", quantity: once },
  { key: "dm_boh_wall_protect", label: "BOH Wall Protection", category: "DM — Back of house", division: "DEFERRED MAINTENANCE", unit: "lf", quantity: once },
];

// ─── Suite-specific ────────────────────────────────────────────────────
// Additive to GUESTROOMS — items unique to suites (living/parlor, dressing,
// powder room, expanded bath). Quantities scale with suite count from the mix.
const SUITE_SPECIFIC: ScopeCatalogEntry[] = [
  // Living / parlor casegoods
  { key: "su_sleeper_sofa_mech", label: "Sleeper Sofa Mechanism + Mattress", category: "Suite — Living & parlor", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_end_tables", label: "End Tables (sofa flanking)", category: "Suite — Living & parlor", division: "SUITES", unit: "each", quantity: suites(2) },
  { key: "su_console_behind_sofa", label: "Console Table (behind sofa)", category: "Suite — Living & parlor", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_entry_console", label: "Entry / Foyer Console", category: "Suite — Living & parlor", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_buffet_sideboard", label: "Buffet / Sideboard", category: "Suite — Living & parlor", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "su_wet_bar_millwork", label: "Wet Bar Millwork (stone top + undercounter ref)", category: "Suite — Living & parlor", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "su_etagere", label: "Étagère / Bookcase / Display Cabinet", category: "Suite — Living & parlor", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_bar_stool", label: "Bar Stool (wet bar)", category: "Suite — Living & parlor", division: "SUITES", unit: "each", quantity: (m) => 2 * sum(m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "su_cocktail_table_oversized", label: "Cocktail Table (oversized, stone/wood/metal)", category: "Suite — Living & parlor", division: "SUITES", unit: "each", quantity: suites(1) },

  // Bedroom & dressing (suite-specific)
  { key: "su_vanity_desk", label: "Vanity / Makeup Desk + Mirror", category: "Suite — Bedroom & dressing", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "su_vanity_stool_bedroom", label: "Vanity Stool (bedroom)", category: "Suite — Bedroom & dressing", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "su_full_length_mirror", label: "Full-Length Floor Mirror", category: "Suite — Bedroom & dressing", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_wardrobe_millwork", label: "Custom Wardrobe Millwork (hanging + shelving + drawers)", category: "Suite — Bedroom & dressing", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "su_packing_bench", label: "Packing Bench (dressing area)", category: "Suite — Bedroom & dressing", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },

  // Bathroom (suite upgrades)
  { key: "su_bath_vanity_dbl", label: "Double Vanity Millwork + Stone Top", category: "Suite — Bathroom & powder", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_linen_tower", label: "Linen Tower / Freestanding Linen Cabinet", category: "Suite — Bathroom & powder", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_towel_warmer", label: "Towel Warmer", category: "Suite — Bathroom & powder", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_tub_deck_millwork", label: "Tub Deck / Apron Millwork", category: "Suite — Bathroom & powder", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_shower_bench", label: "Built-in Shower Bench (stone or teak)", category: "Suite — Bathroom & powder", division: "SUITES", unit: "each", quantity: suites(1) },
  // Powder room (larger suites)
  { key: "su_powder_vanity", label: "Powder Room Vanity + Basin", category: "Suite — Bathroom & powder", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },
  { key: "su_powder_mirror", label: "Powder Room Mirror + Sconce Lighting", category: "Suite — Bathroom & powder", division: "SUITES", unit: "each", quantity: (m) => sum(m.suite_1br, m.suite_2br, m.signature_suite) },

  // Soft goods & rugs (living/dining specific)
  { key: "su_sofa_uph", label: "Sofa Upholstery (performance fabric/leather)", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_sleeper_uph", label: "Sleeper Sofa Upholstery (reinforced seat)", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_sofa_cushions", label: "Sofa Seat & Back Cushions (down-wrapped)", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_sofa_throw_pillows", label: "Decorative Throw Pillows — Sofa (4-6 per suite)", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(5) },
  { key: "su_throw_blankets", label: "Throw Blankets (wool/cashmere/performance)", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(2) },
  { key: "su_coverlet", label: "Coverlet / Matelassé Throw", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_bed_skirt", label: "Bed Skirt / Upholstered Base Wrap", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_living_rug", label: "Area Rug — Living Room (9×12+)", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_dining_rug", label: "Area Rug — Dining", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_entry_runner", label: "Entry Runner / Foyer Rug", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_bath_runner", label: "Bathroom Decorative Runner", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: suites(1) },
  { key: "su_cornice_valance", label: "Cornice Boards / Valances", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "allowance", quantity: suites(1) },
  { key: "su_canopy_bed_drapery", label: "Canopy / Four-Poster Bed Drapery (presidential)", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "each", quantity: (m) => m.signature_suite ?? 0 },
  { key: "su_passementerie", label: "Custom Passementerie (trim/banding/welt)", category: "Suite — Soft goods & rugs", division: "SUITES", unit: "allowance", quantity: () => 1 },

  // Finishes & trim (suite-specific)
  { key: "su_hard_floor_entry", label: "Hard Surface Flooring — Entry/Wet Bar (porcelain/stone/wood)", category: "Suite — Finishes & trim", division: "SUITES", unit: "sf", quantity: once },
  { key: "su_crown_molding", label: "Crown Molding + Chair Rail + Trim", category: "Suite — Finishes & trim", division: "SUITES", unit: "lf", quantity: once },
  { key: "su_stone_bath", label: "Stone / Tile — Bath Walls, Floors, Shower Surround", category: "Suite — Finishes & trim", division: "SUITES", unit: "sf", quantity: once },
  { key: "su_accent_panel", label: "Decorative Wall Paneling / Wood Slat Feature", category: "Suite — Finishes & trim", division: "SUITES", unit: "allowance", quantity: suites(1) },
  { key: "su_floor_transitions", label: "Floor Transitions, Thresholds, Reducers", category: "Suite — Finishes & trim", division: "SUITES", unit: "allowance", quantity: once },
  { key: "su_wall_base", label: "Wall Base (resilient / wood / stone)", category: "Suite — Finishes & trim", division: "SUITES", unit: "lf", quantity: once },
  { key: "su_decorative_mirror_living", label: "Decorative Mirror (entry/dining/accent)", category: "Suite — Finishes & trim", division: "SUITES", unit: "each", quantity: suites(2) },
  { key: "su_planters", label: "Planters (live or premium artificial)", category: "Suite — Finishes & trim", division: "SUITES", unit: "each", quantity: suites(2) },
];

// ─── Meeting space ─────────────────────────────────────────────────────
// Items for meeting rooms, ballrooms, pre-function. Quantities default to
// "allowance" / 1 since they typically scale with sqft, which the user
// enters per-item after adding.
const MEETING: ScopeCatalogEntry[] = [
  // Architectural & millwork
  { key: "mt_gwb_partitions", label: "Gypsum Partitions, Soffits, Bulkheads", category: "Meeting — Architectural & millwork", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_acoustic_walls", label: "Acoustic Upgrades at Demising Walls (insulation, RC, 2× GWB)", category: "Meeting — Architectural & millwork", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_operable_partition", label: "Operable Partition Walls (upgraded STC)", category: "Meeting — Architectural & millwork", division: "MEETING SPACE", unit: "lf", quantity: once },
  { key: "mt_credenzas_millwork", label: "Custom Credenzas / Buffet / Built-in Storage", category: "Meeting — Architectural & millwork", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_coffee_stations", label: "Coffee / Refreshment Service Stations (solid surface)", category: "Meeting — Architectural & millwork", division: "MEETING SPACE", unit: "each", quantity: () => 4 },
  { key: "mt_wall_paneling", label: "Decorative Wall Paneling / Wood Slat Feature", category: "Meeting — Architectural & millwork", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_acoustic_doors", label: "Door Replacement (acoustic-rated assemblies)", category: "Meeting — Architectural & millwork", division: "MEETING SPACE", unit: "each", quantity: once },

  // Finishes
  { key: "mt_carpet", label: "Carpet (broadloom or tile, acoustic backing)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "sy", quantity: once },
  { key: "mt_carpet_pad", label: "Carpet Pad Upgrade (sound attenuation)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "sy", quantity: once },
  { key: "mt_hard_floor_prefn", label: "Hard Surface Flooring — Pre-function / Service (porcelain/LVT/stone)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "sf", quantity: once },
  { key: "mt_floor_transitions", label: "Floor Transitions, Thresholds, Reducers", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_wall_base", label: "Wall Base (resilient / wood / stone)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "lf", quantity: once },
  { key: "mt_wallcovering", label: "Wallcovering (vinyl / textile / specialty)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "sf", quantity: once },
  { key: "mt_accent_walls", label: "Accent Wall Treatments (wood / metal / stone / upholstered)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_acoustic_panels", label: "Acoustic Wall Panels (fabric-wrapped / perforated / felt)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "sf", quantity: once },
  { key: "mt_paint", label: "Paint (ceilings, soffits, doors, trim)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_ceiling_deco", label: "Decorative Ceiling Treatments (coffers / wood / metal)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_act_high_nrc", label: "Acoustic Ceiling Tile (high-NRC, tegular / concealed)", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "sf", quantity: once },
  { key: "mt_ceiling_clouds", label: "Specialty Ceiling Clouds / Baffles", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_crown_trim", label: "Crown Molding / Chair Rail / Trim", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "lf", quantity: once },
  { key: "mt_drapery", label: "Drapery / Sheers / Blackout Treatments", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_motorized_shades", label: "Motorized Shade Systems", category: "Meeting — Finishes", division: "MEETING SPACE", unit: "each", quantity: once },

  // Lighting
  { key: "mt_ambient_light", label: "General Ambient Lighting (downlights / troffers / linear)", category: "Meeting — Lighting", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_chandelier", label: "Decorative Chandeliers / Pendants", category: "Meeting — Lighting", division: "MEETING SPACE", unit: "each", quantity: () => 6 },
  { key: "mt_wall_sconce", label: "Wall Sconces / Decorative Accent Lighting", category: "Meeting — Lighting", division: "MEETING SPACE", unit: "each", quantity: () => 12 },
  { key: "mt_cove_indirect", label: "Cove / Indirect Lighting (perimeters & features)", category: "Meeting — Lighting", division: "MEETING SPACE", unit: "lf", quantity: once },

  // AV
  { key: "mt_av_allowance", label: "AV Allowance", category: "Meeting — AV", division: "MEETING SPACE", unit: "allowance", quantity: once },

  // MEP / FP
  { key: "mt_hvac_zoning", label: "HVAC Zoning (independent per room + combined configs)", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_vav_boxes", label: "VAV Box Additions / Relocations", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "each", quantity: once },
  { key: "mt_diffuser_grille", label: "Diffuser / Return Grille Replacement (low-profile linear)", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "each", quantity: once },
  { key: "mt_thermostat_bms", label: "Thermostat / Sensor Relocation (BMS-integrated)", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "each", quantity: once },
  { key: "mt_duct_acoustic", label: "Ductwork Acoustic Treatment at Room Penetrations", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_pantry_exhaust", label: "Dedicated Exhaust at Service Pantries / Refreshment", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_coffee_plumbing", label: "Plumbing Rough-in + Fixtures at Coffee Stations", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "each", quantity: () => 4 },
  { key: "mt_sprinkler_relocate", label: "Sprinkler Head Relocation / Replacement", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "each", quantity: once },
  { key: "mt_fire_alarm_relocate", label: "Fire Alarm Device Relocation (strobe/speaker/pull)", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_smoke_detection", label: "Smoke Detection — Ceiling Config Coordination", category: "Meeting — MEP & FP", division: "MEETING SPACE", unit: "allowance", quantity: once },

  // FF&E
  { key: "mt_banquet_chair", label: "Stackable / Nesting Banquet Chairs (+10% overage)", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "each", quantity: () => 200 },
  { key: "mt_boardroom_chair", label: "Executive Boardroom Chairs", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "each", quantity: () => 20 },
  { key: "mt_prefunction_lounge", label: "Pre-function Lounge Seating (sofas/chairs/ottomans)", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_banquet_tables", label: "Banquet Tables (rounds / rectangles / serpentines / cocktail)", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "each", quantity: () => 40 },
  { key: "mt_boardroom_table", label: "Boardroom Table (fixed or modular, integrated power/data)", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "each", quantity: () => 2 },
  { key: "mt_conference_table", label: "Conference Table (cable management + connectivity)", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "each", quantity: () => 4 },
  { key: "mt_mobile_bar", label: "Mobile Bars / Service Stations", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "each", quantity: () => 4 },
  { key: "mt_occasional_tables", label: "Decorative Occasional / Console / Accent Tables", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_artwork", label: "Artwork Program (prints / originals / sculpture / installations)", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_mirrors_objects", label: "Mirrors & Decorative Wall Objects", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_accessories", label: "Decorative Accessories (vases / books / objects)", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "allowance", quantity: once },
  { key: "mt_area_rugs", label: "Area Rugs at Lounge Groupings", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "each", quantity: () => 4 },
  { key: "mt_planters", label: "Plants & Planters (live or premium artificial)", category: "Meeting — FF&E", division: "MEETING SPACE", unit: "each", quantity: () => 8 },
];

// ─── Catalog ───────────────────────────────────────────────────────────
export const SCOPE_CATALOG: ScopeCatalogEntry[] = [
  ...GUESTROOM_SOFT_GOODS,
  ...GUESTROOM_CASEGOODS,
  ...GUESTROOM_SEATING,
  ...GUESTROOM_LIGHTING,
  ...GUESTROOM_ART,
  ...WINDOW_HARDWARE,
  ...FINISHES,
  ...BATH_FFE,
  ...OSE,
  ...TECH,
  ...SIGNAGE,
  ...CORRIDOR,
  ...COMMON_AREA,
  ...RESTAURANT_BAR,
  ...KITCHEN,
  ...DM_ROOF,
  ...DM_ENVELOPE,
  ...DM_STRUCTURAL,
  ...DM_HVAC,
  ...DM_ELECTRICAL,
  ...DM_PLUMBING,
  ...DM_FIRE,
  ...DM_VERTICAL,
  ...DM_POOL,
  ...DM_LAUNDRY,
  ...DM_IT,
  ...DM_OTHER,
  ...SUITE_SPECIFIC,
  ...MEETING,
];

export const ALL_CATEGORIES: ScopeCategory[] = Array.from(
  new Set(SCOPE_CATALOG.map((e) => e.category)),
);

/** True if the scope list already contains an item matching this catalog entry
 *  (by case-insensitive name match on the line_item). */
export function isAlreadyAdded(
  entry: ScopeCatalogEntry,
  existingItems: { line_item: string; deleted: boolean }[],
): boolean {
  const needle = entry.label.trim().toLowerCase();
  return existingItems.some(
    (i) => !i.deleted && i.line_item.trim().toLowerCase() === needle,
  );
}

/** Same as isAlreadyAdded but also checks that the match is in the same
 *  division (area). Returns the matching item's division if found. */
export function findDuplicateInSameArea(
  label: string,
  division: string,
  existingItems: { line_item: string; division: string; deleted: boolean }[],
): { line_item: string; division: string } | null {
  const needle = label.trim().toLowerCase();
  const found = existingItems.find(
    (i) => !i.deleted
      && i.line_item.trim().toLowerCase() === needle
      && i.division.trim().toLowerCase() === division.trim().toLowerCase(),
  );
  return found ?? null;
}
