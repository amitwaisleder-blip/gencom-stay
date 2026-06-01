// Structural menu classifier.
//
// Every lunch-menu day is a 4-line structure laid out by the catering
// office in a fixed order:
//
//   Line 1 — Main dish
//   Line 2 — Side dish
//   Line 3 — Side dish
//   Line 4 — Soup
//
// Two special cases override the layout. When line 1 is either of
// these, the remaining lines are ignored and the whole day is counted
// as a single special entry:
//
//   "Deli Day"      → the day is a deli bar; no mains/sides/soup count
//   "Chef's Choice" → the chef picks on the fly; no other items count
//
// The classifier returns a role for every dish that belongs to the
// day (after the special-case override is applied) so the Metrics
// view can bucket "served X times as a main" vs "X times as a side".

export type StructuralRole = "main" | "side" | "soup" | "deli" | "chef_choice" | "other";


export type MenuStructure = {
  /** The special flag, if the first line matched Deli Day or Chef's Choice. */
  special: "deli_day" | "chef_choice" | null;
  /** Per-role slots. `null` when not present in the menu. */
  main: string | null;
  sides: string[];          // 0..2 entries (lines 2 and 3)
  soup: string | null;      // line 4
  other: string[];          // anything beyond line 4
  /** Convenience — flat list of (name, role) pairs for every dish that
   *  should contribute to the served-count roll-up. For special days
   *  this contains exactly one entry: the special day label. */
  dishes: { name: string; role: StructuralRole }[];
};


const DELI_PATTERNS = [
  /^\s*deli\s*day\s*$/i,
  /^\s*deli\s*bar\s*$/i,
  /^\s*deli\s*$/i,
];

const CHEF_PATTERNS = [
  /^\s*chef'?s?\s*choice\s*$/i,
  /^\s*chefs?\s+choice\s*$/i,
];


function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(name));
}


export function classifyMenu(rawItems: readonly string[]): MenuStructure {
  const items = (rawItems ?? [])
    .map((s) => String(s ?? "").trim())
    .filter(Boolean);

  if (items.length === 0) {
    return { special: null, main: null, sides: [], soup: null, other: [], dishes: [] };
  }

  const first = items[0];

  if (matchesAny(first, DELI_PATTERNS)) {
    return {
      special: "deli_day",
      main: null, sides: [], soup: null, other: [],
      dishes: [{ name: "Deli Day", role: "deli" }],
    };
  }

  if (matchesAny(first, CHEF_PATTERNS)) {
    return {
      special: "chef_choice",
      main: null, sides: [], soup: null, other: [],
      dishes: [{ name: "Chef's Choice", role: "chef_choice" }],
    };
  }

  const main = items[0] ?? null;
  const sides = items.slice(1, 3);   // positions 2-3
  const soup = items[3] ?? null;      // position 4
  const other = items.slice(4);

  const dishes: { name: string; role: StructuralRole }[] = [];
  if (main) dishes.push({ name: main, role: "main" });
  for (const s of sides) dishes.push({ name: s, role: "side" });
  if (soup) dishes.push({ name: soup, role: "soup" });
  for (const o of other) dishes.push({ name: o, role: "other" });

  return { special: null, main, sides, soup, other, dishes };
}


/** Detect whether a single dish name is one of the special-day flags
 *  (Deli Day / Chef's Choice). Used by the Predict view to short-circuit
 *  layout when a forecast resolves to a special day. */
export function specialDayKind(name: string): "deli" | "chef_choice" | null {
  const n = (name ?? "").trim();
  if (matchesAny(n, DELI_PATTERNS)) return "deli";
  if (matchesAny(n, CHEF_PATTERNS)) return "chef_choice";
  return null;
}


/** Build a `name (lowercased) → most-common role` map from a list of
 *  menus. Used when we need to know the typical role of a dish in
 *  contexts where positional info isn't available (e.g. prediction
 *  payloads, which arrive as flat lists ordered by frequency). */
export function buildRoleByName(menus: { items?: string[] }[]): Map<string, StructuralRole> {
  const counts = new Map<string, Map<StructuralRole, number>>();
  for (const m of menus) {
    const s = classifyMenu(m.items ?? []);
    for (const d of s.dishes) {
      const k = d.name.trim().toLowerCase();
      let inner = counts.get(k);
      if (!inner) { inner = new Map(); counts.set(k, inner); }
      inner.set(d.role, (inner.get(d.role) ?? 0) + 1);
    }
  }
  const result = new Map<string, StructuralRole>();
  for (const [k, inner] of counts) {
    let bestRole: StructuralRole = "other";
    let bestN = -1;
    for (const [role, n] of inner) {
      if (n > bestN) { bestN = n; bestRole = role; }
    }
    result.set(k, bestRole);
  }
  return result;
}


export const ROLE_CATEGORIES: {
  key: StructuralRole; label: string; plural: string;
}[] = [
  { key: "main",        label: "Main",          plural: "Main dishes" },
  { key: "side",        label: "Side",          plural: "Sides" },
  { key: "soup",        label: "Soup",          plural: "Soups" },
  { key: "deli",        label: "Deli Day",      plural: "Deli Days" },
  { key: "chef_choice", label: "Chef's Choice", plural: "Chef's Choices" },
  { key: "other",       label: "Other",         plural: "Other" },
];
