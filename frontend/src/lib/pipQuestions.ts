// PIP Generator question tree — 25 questions, grouped into 3 tiers, with
// conditional branching. Mirrors the logic document the user supplied.

export type QuestionType =
  | "text" | "long_text" | "number" | "number_pair"
  | "single_select" | "multi_select" | "ranked_list"
  | "file_upload" | "room_mix" | "group";

export type Question = {
  id: string;                    // canonical key (q1, q2, …)
  tier: 1 | 2 | 3;
  title: string;                 // human label shown in the form
  short?: string;                // short label for nav/summary
  type: QuestionType;
  help?: string;
  placeholder?: string;
  options?: string[];            // for single_select/multi_select/ranked_list
  // For single/multi/multi with "Other" write-in support.
  allow_other?: boolean;
  // Secondary inputs that appear when the parent is picked.
  sub_questions?: Question[];
  // Show this question only if predicate returns true against the answers map.
  show_if?: (answers: Answers) => boolean;
  // Marks the question as required — the form won't accept "Continue" until
  // it has a non-empty answer. Branching may toggle this at runtime via a
  // function form.
  required?: boolean | ((answers: Answers) => boolean);
  ai_assist?: boolean;           // renders an "Ask Claude" helper button
  // ── UI affordances on specific questions ────────────────────────────
  // q1: property-name AI lookup that also fills q2-q5
  property_lookup?: boolean;
  // q2: "Search Google" button for the address
  google_search?: boolean;
  // q5: AI fill button that pulls keys & mix from the resolved property
  ai_fill_room_mix?: boolean;
  // q10: AI "Recommend scope" button that proposes additions
  recommend_scope?: boolean;
  // q13, q14: "Fill out full scope" opens the big typical-scope checklist
  full_scope_checklist?: "guestroom" | "bathroom";
};

export type Answer =
  | string
  | number
  | string[]
  | { primary?: string; other?: string }
  | { [key: string]: Answer };

export type Answers = Record<string, Answer>;

// ─── helpers for predicates ────────────────────────────────────────────────
const as = <T>(v: Answer | undefined) => v as T | undefined;

/** Unwrap `{primary: <value>, ...}` wrappers that hold sub-answers for
 * questions which have sub_questions. Leaves plain arrays/strings untouched. */
export function unwrapPrimary(v: Answer | undefined): Answer | undefined {
  if (v == null) return undefined;
  if (typeof v === "object" && !Array.isArray(v) && "primary" in (v as any)) {
    return (v as any).primary;
  }
  return v;
}

const primary = (v: Answer | undefined): string | undefined => {
  const u = unwrapPrimary(v);
  if (u == null) return undefined;
  if (typeof u === "string") return u;
  return undefined;
};

/** Safe extractor for multi-select arrays — handles both plain array and
 * `{primary: [...], ...subKeys}` shapes. */
export function multiSelectArray(v: Answer | undefined): string[] {
  const u = unwrapPrimary(v);
  return Array.isArray(u) ? (u as string[]) : [];
}

const hasAny = (v: Answer | undefined, names: string[]): boolean => {
  if (!v) return false;
  const u = unwrapPrimary(v);
  if (Array.isArray(u)) return u.some((x) => names.includes(String(x)));
  if (u == null) return false;
  return names.includes(String(u));
};
const nowYear = new Date().getFullYear();

// Deep-read a numeric value, tolerant of stringy inputs.
const num = (v: Answer | undefined): number | undefined => {
  if (v == null) return undefined;
  const n = Number(typeof v === "object" ? (v as any).value : v);
  return Number.isFinite(n) ? n : undefined;
};

// ─── THE TREE ──────────────────────────────────────────────────────────────
export const PIP_QUESTIONS: Question[] = [
  // TIER 1 — CORE INTAKE (always asked)
  {
    id: "q1",
    tier: 1,
    title: "Property name and brand flag?",
    short: "Name & flag",
    // "group" so the property_name text input is the primary and the brand
    // flag is a sub-question. Combined with property_lookup, typing the name
    // and clicking "Find with AI" pre-fills Q2–Q5.
    type: "group",
    required: true,
    property_lookup: true,
    help: "Type the property name. Click 'Find with AI' and we'll try to fill in the next several questions for you.",
    sub_questions: [
      {
        id: "property_name", tier: 1, title: "Property name", type: "text",
        required: true, placeholder: "e.g. Sheraton Grand Chicago Riverwalk",
      },
      {
        id: "brand_flag", tier: 1, title: "Brand flag (pick one or type 'Other')",
        type: "single_select", allow_other: true,
        options: [
          "Ritz-Carlton", "Four Seasons", "Rosewood", "St. Regis", "Thompson",
          "InterContinental", "Westin", "Sheraton", "Hyatt", "Independent",
        ],
      },
    ],
  },
  {
    id: "q2",
    tier: 1,
    title: "Property address?",
    short: "Address",
    type: "long_text",
    required: true,
    ai_assist: true,
    google_search: true,
    placeholder: "Street, City, State, ZIP",
  },
  {
    id: "q3",
    tier: 1,
    title: "Property type?",
    short: "Type",
    type: "single_select",
    required: true,
    ai_assist: true,
    options: [
      "Urban Full-Service", "Resort", "Select-Service",
      "Boutique/Lifestyle", "Convention", "Mixed-Use",
    ],
  },
  {
    id: "q4",
    tier: 1,
    title: "Year built and year of last major renovation?",
    short: "Age",
    type: "group",
    required: true,
    sub_questions: [
      { id: "year_built", tier: 1, title: "Year built", type: "number", required: true, placeholder: "e.g. 1985" },
      { id: "year_last_reno", tier: 1, title: "Year of last major renovation", type: "number", placeholder: "e.g. 2012" },
      { id: "last_reno_scope", tier: 1, title: "Brief description of last renovation scope", type: "long_text" },
    ],
  },
  {
    id: "q5",
    tier: 1,
    title: "Total guestroom key count and room mix?",
    short: "Keys & mix",
    type: "room_mix",
    required: true,
    ai_fill_room_mix: true,
  },
  {
    id: "q6",
    tier: 1,
    title: "Renovation trigger?",
    short: "Trigger",
    type: "single_select",
    required: true,
    ai_assist: true,
    allow_other: true,
    options: [
      "Acquisition", "Refinancing", "Brand Conversion",
      "Scheduled Brand PIP Cycle", "Voluntary Repositioning",
      "Deferred Maintenance Catch-Up",
    ],
  },
  {
    id: "q7",
    tier: 1,
    title: "Target repositioning outcome?",
    short: "Reposition target",
    type: "single_select",
    required: true,
    ai_assist: true,
    options: [
      "Maintain Current Flag", "Upscale Within Flag", "Convert to New Brand",
      "Luxury Repositioning", "Soft Brand / Independent Conversion",
    ],
  },
  {
    id: "q8",
    tier: 1,
    title: "Overall renovation budget range?",
    short: "Budget range",
    type: "single_select",
    required: true,
    ai_assist: true,
    options: ["<$10M", "$10–25M", "$25–50M", "$50–100M", "$100M+", "TBD"],
    sub_questions: [
      { id: "custom_budget", tier: 1, title: "Custom budget estimate (optional)", type: "text",
        placeholder: "e.g. $38M target, $45M ceiling" },
    ],
  },
  {
    id: "q9",
    tier: 1,
    title: "Operational status during renovation?",
    short: "Operational status",
    type: "single_select",
    required: true,
    options: ["Fully Operational", "Phased Closure", "Full Closure"],
    sub_questions: [
      {
        id: "max_ooo_keys",
        tier: 1,
        title: "Max out-of-order keys at any time?",
        type: "number",
        show_if: (a) => primary(a.q9) === "Phased Closure",
      },
      {
        id: "closure_months",
        tier: 1,
        title: "Target closure duration (months)?",
        type: "number",
        show_if: (a) => primary(a.q9) === "Full Closure",
      },
    ],
  },
  {
    id: "q10",
    tier: 1,
    title: "Level of renovation?",
    short: "Level",
    type: "single_select",
    required: true,
    ai_assist: true,
    recommend_scope: true,
    // Master branching question — controls visibility of Q13–Q15, Q23, Q24.
    options: [
      "Cosmetic Refresh", "Soft Goods Only", "Case Goods + Soft Goods",
      "Full Gut (Rooms)", "Full Property Gut", "Adaptive Reuse",
    ],
    help: "This is the master branching question — it determines which Tier-2/3 questions apply.",
  },

  // TIER 2 — SCOPE DEFINITION
  {
    id: "q11",
    tier: 2,
    title: "Brand PIP letter status?",
    short: "PIP letter",
    type: "single_select",
    ai_assist: true,
    options: ["Issued (upload PDF)", "In Draft", "Not Yet Issued", "N/A"],
    sub_questions: [
      { id: "pip_file", tier: 2, title: "Upload PIP letter (PDF)", type: "file_upload",
        show_if: (a) => primary(a.q11) === "Issued (upload PDF)" },
    ],
    show_if: (a) => hasAny(primary(a.q6), ["Brand Conversion", "Scheduled Brand PIP Cycle"]),
    required: (a) => primary(a.q6) === "Brand Conversion",
  },
  {
    id: "q12",
    tier: 2,
    title: "Top 3 owner priorities (ranked)?",
    short: "Owner priorities",
    type: "ranked_list",
    ai_assist: true,
    options: [
      "ROI / ADR Lift", "Brand Compliance", "Guest Experience",
      "Deferred Maintenance", "Speed to Market", "Operational Efficiency",
    ],
    required: true,
  },
  {
    id: "q13",
    tier: 2,
    title: "Guestroom scope — what's in?",
    short: "Guestroom FF&E",
    type: "multi_select",
    ai_assist: true,
    full_scope_checklist: "guestroom",
    options: [
      "Soft Goods", "Case Goods", "Lighting", "Entry Doors & Hardware",
      "Closets", "Paint/Wallcovering", "Window Treatments", "In-Room Technology",
    ],
    sub_questions: [
      {
        id: "soft_goods_detail",
        tier: 2,
        title: "Soft Goods — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q13, ["Soft Goods"]),
        options: [
          "Carpet / Broadloom", "Area Rugs", "Drapery & Sheers",
          "Blackout Treatments", "Bedspread / Coverlet", "Bed Scarf / Runner",
          "Decorative Pillows", "Upholstered Headboard",
          "Upholstered Seating Fabrics", "Bench / Ottoman Upholstery",
          "Wallcovering", "Decorative Trim / Passementerie", "Artwork",
          "Mirrors", "Accessories / Tabletop Decor",
        ],
      },
      {
        id: "case_goods_detail",
        tier: 2,
        title: "Case Goods — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q13, ["Case Goods"]),
        options: [
          "Headboard (wood/panel)", "Nightstands", "Dresser / Credenza",
          "Desk / Writing Table", "Desk Chair", "Lounge Chair",
          "Ottoman / Bench", "Sofa / Loveseat", "Coffee Table / Side Table",
          "Luggage Bench", "Wardrobe / Armoire", "Minibar Cabinet",
          "TV Console / Media Unit", "Entry Console", "Bed Frame / Platform",
          "Built-In Millwork", "Closet Millwork",
        ],
      },
      {
        id: "lighting_detail",
        tier: 2,
        title: "Lighting — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q13, ["Lighting"]),
        options: [
          "Ceiling Fixtures", "Recessed Downlights",
          "Bedside Lamps / Sconces", "Desk Lamp", "Floor Lamp",
          "Reading Lights", "Decorative Pendants", "Closet Lighting",
          "Bathroom Vanity Lighting",
        ],
      },
      {
        id: "tech_detail",
        tier: 2,
        title: "In-Room Technology — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q13, ["In-Room Technology"]),
        options: [
          "TV (size/mount)", "Casting / Streaming", "Connectivity Panel",
          "USB/USB-C Outlets", "Smart Thermostat",
          "Lighting Controls / Keypads", "Drapery Motorization",
          "In-Room Tablet", "Voice Control", "Guest Wi-Fi AP",
        ],
      },
    ],
    show_if: (a) => primary(a.q10) !== "Cosmetic Refresh",
  },
  {
    id: "q14",
    tier: 2,
    title: "Guest bathroom scope — what's in?",
    short: "Guest bathroom",
    // Parallels Q13's structure — multi-select of high-level categories
    // (matches the 6 sections in BATHROOM_FULL_SCOPE), each with an
    // expanded sub-checklist that appears only when the parent is picked.
    type: "multi_select",
    ai_assist: true,
    full_scope_checklist: "bathroom",
    options: [
      "Casegoods", "Softgoods", "Plumbing Fixtures",
      "Finishes", "Lighting", "Fixtures",
    ],
    sub_questions: [
      {
        id: "bath_level",
        tier: 2,
        title: "Overall level of work",
        type: "single_select",
        options: ["Refresh Only", "Full Gut"],
      },
      {
        id: "bath_casegoods_detail",
        tier: 2,
        title: "Casegoods — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q14, ["Casegoods"]),
        options: [
          "Vanity cabinet",
          "Vanity countertop with backsplash and side splashes",
          "Vanity mirror",
          "Medicine cabinet",
          "Makeup vanity",
          "Water closet partition or compartment door",
          "Shower enclosure (frameless glass, hardware)",
          "Tub deck and surround panels",
          "Linen tower or built-in shelving",
          "Luggage bench or stool",
          "Bathroom accessories (towel bars, robe hooks, TP holder, grab bars, hair dryer holder, scale)",
        ],
      },
      {
        id: "bath_softgoods_detail",
        tier: 2,
        title: "Softgoods — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q14, ["Softgoods"]),
        options: [
          "Bath mat / bath rug",
          "Shower curtain, liner, hooks, and rod",
          "Window treatments",
          "Vanity stool or bench cushion",
          "Artwork and decorative mirrors",
          "OS&E (decorative towels, trays, vases, candles, objets)",
        ],
      },
      {
        id: "bath_plumbing_detail",
        tier: 2,
        title: "Plumbing Fixtures — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q14, ["Plumbing Fixtures"]),
        options: [
          "Lavatory faucets",
          "Tub filler and diverter",
          "Showerhead (fixed)",
          "Handheld shower and slide bar",
          "Shower valve and trim",
          "Body sprays or rain head",
          "Toilet",
          "Bidet or washlet seat",
          "Drains and trim (lavatory, tub, shower, floor)",
          "Linear shower drain",
          "Angle stops and supply lines",
          "P-traps and escutcheons",
        ],
      },
      {
        id: "bath_finishes_detail",
        tier: 2,
        title: "Finishes — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q14, ["Finishes"]),
        options: [
          "Floor tile",
          "Wall tile",
          "Shower and tub surround tile",
          "Accent or feature wall tile",
          "Stone or quartz countertop",
          "Stone thresholds and curbs",
          "Shower pan (tile or solid surface)",
          "Tile base",
          "Grout and sealant",
          "Paint",
          "Wallcovering",
          "Ceiling finish",
          "Millwork finish and hardware",
          "Door and frame finish",
        ],
      },
      {
        id: "bath_lighting_detail",
        tier: 2,
        title: "Lighting — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q14, ["Lighting"]),
        options: [
          "Vanity sconces",
          "Vanity backlit or LED mirror",
          "Overhead decorative fixture",
          "Recessed downlights",
          "Shower recessed downlight (wet-rated)",
          "Water closet downlight",
          "Toe-kick or cove accent lighting",
          "Night light",
          "Exhaust fan with integrated light",
          "Dimmer and switching",
        ],
      },
      {
        id: "bath_fixtures_detail",
        tier: 2,
        title: "Fixtures — expanded checklist",
        type: "multi_select",
        show_if: (a) => hasAny(a.q14, ["Fixtures"]),
        options: [
          "Bathtub",
          "Shower base or pan",
          "Lavatory sink (integrated or undermount)",
          "Toilet bowl and tank",
          "Urinal (if applicable)",
          "Access panels",
          "Exhaust fan",
          "Heated towel rack",
          "Electrical outlets and GFCI",
          "USB and charging outlets",
          "Thermostat or heated floor control",
          "Smoke and CO detectors",
          "Sprinkler heads and escutcheons",
          "Door hardware (lever, privacy lock, hinges, stops)",
        ],
      },
    ],
    show_if: (a) => hasAny(primary(a.q10), ["Full Gut (Rooms)", "Full Property Gut", "Adaptive Reuse"]),
  },
  {
    id: "q15",
    tier: 2,
    title: "In-room MEP upgrades?",
    short: "Room MEP",
    type: "multi_select",
    ai_assist: true,
    options: [
      "PTAC / Fan Coil Replacement", "Thermostats / Controls",
      "Lighting Controls", "Low-Voltage Rewiring", "Plumbing Rough-In", "None",
    ],
    show_if: (a) => hasAny(primary(a.q10), ["Full Gut (Rooms)", "Full Property Gut", "Adaptive Reuse"]),
  },
  {
    id: "q16",
    tier: 2,
    title: "Guestroom corridors scope?",
    short: "Corridors",
    type: "multi_select",
    ai_assist: true,
    options: [
      "Not in Scope", "Carpet / Broadloom", "Wallcovering / Paint",
      "Ceiling", "Corridor Lighting", "Sconces", "Guestroom Entry Doors",
      "Door Hardware / Locks", "Signage / Room Numbers",
      "Ice / Vending Alcoves", "Elevator Lobby Finishes", "Artwork",
    ],
    show_if: (a) => primary(a.q10) !== "Cosmetic Refresh",
  },
  {
    id: "q17",
    tier: 2,
    title: "Public areas in scope?",
    short: "Public areas",
    type: "multi_select",
    ai_assist: true,
    options: [
      "Lobby", "Porte-Cochère", "Front Desk", "Elevator Lobbies",
      "Public Restrooms", "Retail", "Signage/Wayfinding", "None",
    ],
  },
  {
    id: "q18",
    tier: 2,
    title: "F&B outlet scope?",
    short: "F&B",
    type: "multi_select",
    ai_assist: true,
    options: ["None", "Cosmetic Refresh", "Full Reconcept", "New Outlet Build-Out"],
    sub_questions: [
      { id: "fb_outlet_count", tier: 2, title: "How many outlets in scope?", type: "number" },
      { id: "fb_operator", tier: 2, title: "Third-party operator or celebrity chef involved? (name / no)", type: "text" },
      {
        id: "fb_kitchen",
        tier: 2,
        title: "Kitchen scope (hood, walk-ins, equipment)",
        type: "long_text",
        show_if: (a) => hasAny(a.q18, ["Full Reconcept", "New Outlet Build-Out"]),
      },
    ],
    required: (a) => primary(a.q3) === "Convention",
  },
  {
    id: "q19",
    tier: 2,
    title: "Meeting, ballroom, and ADA scope?",
    short: "Meeting & ADA",
    type: "group",
    ai_assist: true,
    sub_questions: [
      {
        id: "meeting_level",
        tier: 2,
        title: "Meeting space scope",
        type: "single_select",
        options: [
          "Not in Scope", "Finishes Only", "Finishes + AV",
          "Full Renovation", "Expansion/New Build",
        ],
      },
      {
        id: "meeting_rooms",
        tier: 2,
        title: "Meeting areas in scope",
        type: "multi_select",
        options: [
          "Ballroom", "Prefunction", "Breakout Rooms", "Boardrooms",
          "Operable Partitions", "Rigging/Lighting",
        ],
      },
      {
        id: "ada",
        tier: 2,
        title: "ADA approach",
        type: "single_select",
        options: [
          "Maintain Current Compliance",
          "Add/Reconfigure Accessible Rooms",
          "Full ADA Upgrade Property-Wide",
        ],
      },
    ],
    required: (a) => primary(a.q3) === "Convention",
  },
  {
    id: "q20",
    tier: 2,
    title: "Amenities and recreation scope?",
    short: "Amenities",
    type: "multi_select",
    ai_assist: true,
    options: [
      "Spa", "Fitness Center", "Pool/Pool Deck", "Rooftop",
      "Club Lounge", "Kids Club", "Wellness/Co-Working", "None",
    ],
    sub_questions: [
      {
        id: "amenity_levels",
        tier: 2,
        title: "For each amenity in scope, pick a level",
        type: "long_text",
        placeholder: "e.g. Spa: Full Reno · Fitness: Cosmetic · Pool: Expansion",
      },
    ],
    required: (a) => primary(a.q3) === "Resort",
  },

  // TIER 3 — INFRASTRUCTURE, BOH, RISK
  {
    id: "q21",
    tier: 3,
    title: "Vertical transportation scope?",
    short: "Vertical transport",
    type: "single_select",
    ai_assist: true,
    options: ["Not in Scope", "Cab Refresh Only", "Full Modernization", "Replacement"],
    sub_questions: [
      { id: "vt_passenger", tier: 3, title: "# Passenger elevators in scope", type: "number" },
      { id: "vt_service", tier: 3, title: "# Service elevators in scope", type: "number" },
      { id: "vt_escalators", tier: 3, title: "# Escalators in scope", type: "number" },
    ],
    show_if: (a) => {
      const built = num(a.q4 && (a.q4 as any).year_built);
      const ageFlag = built != null && nowYear - built > 10;
      return primary(a.q10) === "Full Property Gut" || ageFlag;
    },
  },
  {
    id: "q22",
    tier: 3,
    title: "Back-of-house improvements scope?",
    short: "BOH",
    type: "multi_select",
    ai_assist: true,
    options: [
      "Not in Scope", "Associate Dining / Break Room",
      "Associate Locker Rooms / Restrooms", "Laundry / OPL",
      "Housekeeping Areas", "Loading Dock / Receiving",
      "Trash / Compactor Area", "Engineering Shop",
      "Admin Offices", "Sales & Catering Offices",
      "Security / CCTV Room", "IT / MDF / IDF Rooms",
      "BOH Corridors", "Kitchen Support (prep, dishwashing, walk-ins)",
      "Employee Entrance / Timekeeping",
    ],
    sub_questions: [
      {
        id: "boh_levels",
        tier: 3,
        title: "Scope level per area",
        type: "long_text",
        placeholder: "e.g. Laundry: Full Reno · HK Areas: Cosmetic · Loading: Reconfig",
      },
    ],
  },
  {
    id: "q23",
    tier: 3,
    title: "Building envelope scope?",
    short: "Envelope",
    type: "multi_select",
    ai_assist: true,
    options: [
      "Not in Scope", "Roof", "Façade/Cladding", "Windows",
      "Balconies", "Waterproofing", "Expansion Joints", "Structural Repairs",
    ],
    show_if: (a) => {
      const level = primary(a.q10);
      if (level === "Full Property Gut" || level === "Adaptive Reuse") return true;
      const built = num(a.q4 && (a.q4 as any).year_built);
      const lastReno = num(a.q4 && (a.q4 as any).year_last_reno);
      const age = built != null ? nowYear - built : undefined;
      const sinceReno = lastReno != null ? nowYear - lastReno : undefined;
      return (age != null && age > 10) || (sinceReno != null && sinceReno > 10);
    },
  },
  {
    id: "q24",
    tier: 3,
    title: "MEP systems scope?",
    short: "MEP",
    type: "multi_select",
    ai_assist: true,
    options: [
      "Not in Scope", "Chillers", "Cooling Towers", "AHUs",
      "Electrical Gear / Switchgear", "Generators",
      "Domestic Water Risers", "Sanitary", "Fire / Life Safety",
    ],
    show_if: (a) => {
      const level = primary(a.q10);
      if (level === "Full Property Gut" || level === "Adaptive Reuse") return true;
      const built = num(a.q4 && (a.q4 as any).year_built);
      const lastReno = num(a.q4 && (a.q4 as any).year_last_reno);
      const age = built != null ? nowYear - built : undefined;
      const sinceReno = lastReno != null ? nowYear - lastReno : undefined;
      return (age != null && age > 10) || (sinceReno != null && sinceReno > 10);
    },
  },
  {
    id: "q25",
    tier: 3,
    title: "Known deferred maintenance and constraints?",
    short: "Constraints",
    type: "group",
    ai_assist: true,
    sub_questions: [
      {
        id: "constraints",
        tier: 3,
        title: "Constraints (select all that apply)",
        type: "multi_select",
        options: [
          "Union Labor", "Historic Designation", "HOA/Condo Approval",
          "Permitting Timeline", "Long-Lead Items", "Brand Review Cycles",
          "Owner Approval Gates", "None",
        ],
      },
      { id: "pcr_file", tier: 3, title: "Upload PCR/PCA if available", type: "file_upload" },
      { id: "known_dm", tier: 3, title: "Other known deferred maintenance items", type: "long_text" },
    ],
    required: (a) => primary(a.q6) === "Acquisition",
  },
];

// ─── Full-scope catalogs (Q13 guestroom, Q14 bathroom) ────────────────────
// Reference lists pulled from the user's typical-scope spec. Used by the
// "Fill out full scope" modal — each group appears as a checklist section.
export type ScopeCatalogSection = { title: string; items: string[] };

export const GUESTROOM_FULL_SCOPE: ScopeCatalogSection[] = [
  {
    title: "Case Goods — Standard Guestroom",
    items: [
      "Headboard (wall-mounted panel or freestanding)",
      "Bed base or platform",
      "Nightstands (one per side for king; often wall-hung in modern specs)",
      "Dresser or credenza (often combined with TV console)",
      "TV console or media cabinet",
      "Desk or writing table",
      "Desk chair",
      "Luggage bench at foot of bed",
      "Lounge chair with side table",
      "Ottoman or bench",
      "Wardrobe or armoire (if no built-in closet)",
      "Minibar cabinet or refreshment center",
      "Entry console or drop zone (upscale/luxury)",
      "Built-in millwork (closet interiors, vanity surrounds, paneling)",
    ],
  },
  {
    title: "Case Goods — Suites (add)",
    items: [
      "Sofa or sectional",
      "Dining table and chairs",
      "Coffee table",
      "Bar cabinet",
      "Occasional and accent tables",
    ],
  },
  {
    title: "Case Goods — Presidential / Specialty Suites (add)",
    items: [
      "Separate writing desk",
      "Expanded dining setup",
      "Entertainment millwork",
      "Additional lounge seating groups",
    ],
  },
  {
    title: "Soft Goods — Textiles & Finishes",
    items: [
      "Carpet or broadloom (full room or inset with hard flooring border)",
      "Area rugs (luxury / lifestyle)",
      "Drapery with sheers and blackout layer",
      "Decorative hardware and tracks",
      "Bedspread or coverlet",
      "Bed scarf or runner",
      "Decorative pillows (typically 3–5 per king bed)",
      "Upholstered headboard panel (if not a case good)",
      "Upholstery fabrics on lounge chair, bench, ottoman, desk chair seat pad",
      "Wallcovering (accent walls or full-room vinyl/textile)",
      "Paint",
      "Decorative trim and passementerie (luxury)",
      "Artwork (typically 2–4 pieces: headboard wall, entry, desk wall)",
      "Decorative mirrors",
      "Accessories and tabletop decor (trays, books, objets)",
    ],
  },
];

export const BATHROOM_FULL_SCOPE: ScopeCatalogSection[] = [
  {
    title: "Casegoods",
    items: [
      "Vanity cabinet",
      "Vanity countertop with backsplash and side splashes",
      "Vanity mirror",
      "Medicine cabinet",
      "Makeup vanity",
      "Water closet partition or compartment door",
      "Shower enclosure (frameless glass, hardware)",
      "Tub deck and surround panels",
      "Linen tower or built-in shelving",
      "Luggage bench or stool",
      "Bathroom accessories (towel bars, robe hooks, toilet paper holder, grab bars, hair dryer holder, scale)",
    ],
  },
  {
    title: "Softgoods",
    items: [
      "Bath mat / bath rug",
      "Shower curtain, liner, hooks, and rod",
      "Window treatments",
      "Vanity stool or bench cushion",
      "Artwork and decorative mirrors",
      "OS&E (decorative towels, trays, vases, candles, objets)",
    ],
  },
  {
    title: "Plumbing Fixtures",
    items: [
      "Lavatory faucets",
      "Tub filler and diverter",
      "Showerhead (fixed)",
      "Handheld shower and slide bar",
      "Shower valve and trim",
      "Body sprays or rain head",
      "Toilet",
      "Bidet or washlet seat",
      "Drains and trim (lavatory, tub, shower, floor)",
      "Linear shower drain",
      "Angle stops and supply lines",
      "P-traps and escutcheons",
    ],
  },
  {
    title: "Finishes",
    items: [
      "Floor tile",
      "Wall tile",
      "Shower and tub surround tile",
      "Accent or feature wall tile",
      "Stone or quartz countertop",
      "Stone thresholds and curbs",
      "Shower pan (tile or solid surface)",
      "Tile base",
      "Grout and sealant",
      "Paint",
      "Wallcovering",
      "Ceiling finish",
      "Millwork finish and hardware",
      "Door and frame finish",
    ],
  },
  {
    title: "Lighting",
    items: [
      "Vanity sconces",
      "Vanity backlit or LED mirror",
      "Overhead decorative fixture",
      "Recessed downlights",
      "Shower recessed downlight (wet-rated)",
      "Water closet downlight",
      "Toe-kick or cove accent lighting",
      "Night light",
      "Exhaust fan with integrated light",
      "Dimmer and switching",
    ],
  },
  {
    title: "Fixtures",
    items: [
      "Bathtub",
      "Shower base or pan",
      "Lavatory sink (integrated or undermount)",
      "Toilet bowl and tank",
      "Urinal (if applicable)",
      "Access panels",
      "Exhaust fan",
      "Heated towel rack",
      "Electrical outlets and GFCI",
      "USB and charging outlets",
      "Thermostat or heated floor control",
      "Smoke and CO detectors",
      "Sprinkler heads and escutcheons",
      "Door hardware (lever, privacy lock, hinges, stops)",
    ],
  },
];

// ─── visibility + requiredness resolution ──────────────────────────────────
export function isVisible(q: Question, answers: Answers): boolean {
  if (!q.show_if) return true;
  try { return q.show_if(answers); } catch { return true; }
}
export function isRequired(q: Question, answers: Answers): boolean {
  const r = q.required;
  if (typeof r === "function") {
    try { return r(answers); } catch { return false; }
  }
  return !!r;
}
