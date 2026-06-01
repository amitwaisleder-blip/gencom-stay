/**
 * Guestroom scope templates for the quick-add buttons on Scope Review.
 *
 * Each template computes its quantity from the property's `guestroom_mix`.
 * This keeps the "2 queen beds per double-queen room" math in one place.
 */

import type { ScopeItem } from "./api";

export type GuestroomMix = {
  king?: number;
  double_queen?: number;
  double_double?: number;
  junior_suite?: number;
  suite_1br?: number;
  suite_2br?: number;
  signature_suite?: number;
};

export const ROOM_TYPES: { key: keyof GuestroomMix; label: string }[] = [
  { key: "king", label: "King" },
  { key: "double_queen", label: "Double Queen" },
  { key: "double_double", label: "Double Double" },
  { key: "junior_suite", label: "Junior Suite" },
  { key: "suite_1br", label: "1BR Suite" },
  { key: "suite_2br", label: "2BR Suite" },
  { key: "signature_suite", label: "Signature Suite" },
];

export type ScopeTemplate = {
  key: string;
  label: string;
  category: "Casegoods" | "Soft goods" | "Lighting" | "Art" | "Bath" | "Tech";
  division: string;  // Gencom template division to attach to
  unit: ScopeItem["unit"];
  description?: string;
  quantity: (mix: GuestroomMix, totalKeys: number) => number;
};

/** Shortcut helpers for qty formulas. */
const sum = (...xs: (number | undefined)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
const perKey = (n: number) => (_mix: GuestroomMix, totalKeys: number) => n * totalKeys;

const nonSuiteRooms = (mix: GuestroomMix) =>
  sum(mix.king, mix.double_queen, mix.double_double);

const kingEquivalent = (mix: GuestroomMix) =>
  sum(mix.king, mix.junior_suite, mix.suite_1br, mix.suite_2br, mix.signature_suite);

const suiteRooms = (mix: GuestroomMix) =>
  sum(mix.junior_suite, mix.suite_1br, mix.suite_2br, mix.signature_suite);

export const GUESTROOM_TEMPLATES: ScopeTemplate[] = [
  // Casegoods
  { key: "bed_king", label: "Bed Frame — King", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    description: "Upholstered king-size bed frame + box spring.",
    quantity: (mix) => kingEquivalent(mix) },
  { key: "bed_queen", label: "Bed Frame — Queen", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    description: "Upholstered queen-size bed frame + box spring. 2 per double-queen room.",
    quantity: (mix) => 2 * (mix.double_queen ?? 0) + 2 * (mix.double_double ?? 0) },
  { key: "headboard_king", label: "Headboard — King", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    quantity: (mix) => kingEquivalent(mix) },
  { key: "headboard_queen", label: "Headboard — Queen", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    quantity: (mix) => 2 * (mix.double_queen ?? 0) + 2 * (mix.double_double ?? 0) },
  { key: "nightstand", label: "Nightstand", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    description: "2 per guestroom.", quantity: perKey(2) },
  { key: "dresser", label: "Dresser / Credenza", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "desk", label: "Desk", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "desk_chair", label: "Desk Chair", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "lounge_chair", label: "Lounge Chair", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "ottoman", label: "Ottoman", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "side_table", label: "Side Table", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "luggage_bench", label: "Luggage Bench", category: "Casegoods", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "coffee_table_suite", label: "Coffee Table (Suites)", category: "Casegoods", division: "SUITES", unit: "each",
    quantity: (mix) => suiteRooms(mix) },
  { key: "sofa_suite", label: "Sofa (Suites)", category: "Casegoods", division: "SUITES", unit: "each",
    description: "Sleeper sofa in 1BR/2BR suites.",
    quantity: (mix) => suiteRooms(mix) },

  // Soft goods
  { key: "carpet_pad", label: "Carpet & Pad", category: "Soft goods", division: "GUESTROOMS", unit: "per key",
    description: "Broadloom carpet + pad — installed per key.",
    quantity: perKey(1) },
  { key: "window_treatments", label: "Window Treatments (B/O + Sheers)", category: "Soft goods", division: "GUESTROOMS", unit: "per key",
    description: "Blackout + sheers, incl. hardware.",
    quantity: perKey(1) },
  { key: "bedding_package", label: "Bedding Package", category: "Soft goods", division: "GUESTROOMS", unit: "each",
    description: "Sheets, duvet, pillows, bed scarf. 1 per bed.",
    quantity: (mix) => kingEquivalent(mix) + 2 * (mix.double_queen ?? 0) + 2 * (mix.double_double ?? 0) },
  { key: "decorative_pillows", label: "Decorative Pillows", category: "Soft goods", division: "GUESTROOMS", unit: "each",
    description: "4 per bed (toss + accent).",
    quantity: (mix) => 4 * (kingEquivalent(mix) + 2 * (mix.double_queen ?? 0) + 2 * (mix.double_double ?? 0)) },
  { key: "wallcovering", label: "Wallcovering (behind bed)", category: "Soft goods", division: "GUESTROOMS", unit: "per key",
    quantity: perKey(1) },

  // Lighting
  { key: "table_lamp", label: "Table Lamp", category: "Lighting", division: "GUESTROOMS", unit: "each",
    description: "2 per room (one per nightstand).",
    quantity: perKey(2) },
  { key: "floor_lamp", label: "Floor Lamp", category: "Lighting", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "desk_lamp", label: "Desk Lamp", category: "Lighting", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "welcome_light", label: "Welcome Light", category: "Lighting", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "bath_decorative", label: "Bathroom Decorative Lighting", category: "Lighting", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },

  // Art
  { key: "artwork_framed", label: "Framed Artwork", category: "Art", division: "GUESTROOMS", unit: "each",
    description: "3 pieces per room (typical).",
    quantity: perKey(3) },
  { key: "mirror_dressing", label: "Dressing Mirror", category: "Art", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "accessories_pkg", label: "Accessories Package", category: "Art", division: "GUESTROOMS", unit: "per key",
    description: "Trays, vases, décor items.",
    quantity: perKey(1) },

  // Bath
  { key: "vanity", label: "Vanity (millwork + top)", category: "Bath", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "shower_fixtures", label: "Shower Fixtures", category: "Bath", division: "GUESTROOMS", unit: "each",
    description: "Control valve, hand-held, shower head.",
    quantity: perKey(1) },
  { key: "bath_accessories", label: "Bath Accessories", category: "Bath", division: "GUESTROOMS", unit: "per key",
    description: "Towel bars, robe hooks, TP holder, etc.",
    quantity: perKey(1) },
  { key: "makeup_mirror", label: "Makeup Mirror (electric)", category: "Bath", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },

  // Tech
  { key: "tv_55", label: "Television (55\")", category: "Tech", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
  { key: "thermostat", label: "Digital Thermostat", category: "Tech", division: "GUESTROOMS", unit: "each",
    quantity: perKey(1) },
];

export function totalKeys(mix: GuestroomMix | null | undefined, fallback: number = 0): number {
  if (!mix) return fallback || 0;
  return sum(
    mix.king, mix.double_queen, mix.double_double, mix.junior_suite,
    mix.suite_1br, mix.suite_2br, mix.signature_suite,
  ) || fallback || 0;
}
