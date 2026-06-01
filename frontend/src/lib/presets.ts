/**
 * Soft-cost preset library, persisted to localStorage so the user can curate it.
 *
 * The defaults cover the full list from the spec (consultants, legal, permits,
 * brand fees, insurance, financing, owner costs, pre-opening, FF&E, etc.).
 * Users can add/remove and the changes survive refresh.
 */

export type SoftCostPreset = {
  label: string;
  name: string;
  defaultPct?: number;
  defaultFixed?: number;
  group?: "soft" | "contingency" | "dev_fee";
};

// Bumped whenever the default list changes so stale, user-customized caches
// from prior versions don't linger. Update this to force a refresh.
const STORAGE_KEY = "pipbudget.softCostPresets.v2";

const DEFAULT_PRESETS: SoftCostPreset[] = [
  // ── Soft cost group ──────────────────────────────────────────────
  { label: "GC General Conditions, Insurance & Fees", name: "GC General Conditions, Insurance & Fees", defaultPct: 0.08, group: "soft" },
  { label: "Architect fees", name: "Architect fees", defaultPct: 0.05, group: "soft" },
  { label: "Interior designer", name: "Interior designer", defaultPct: 0.05, group: "soft" },
  { label: "MEP engineering", name: "MEP engineering", defaultPct: 0.015, group: "soft" },
  { label: "Structural engineering", name: "Structural engineering", defaultPct: 0.01, group: "soft" },
  { label: "Civil and landscape engineering", name: "Civil and landscape engineering", defaultPct: 0.007, group: "soft" },
  { label: "Lighting design", name: "Lighting design", defaultPct: 0.005, group: "soft" },
  { label: "Acoustical consultant", name: "Acoustical consultant", defaultPct: 0.003, group: "soft" },
  { label: "Kitchen and laundry consultants", name: "Kitchen and laundry consultants", defaultPct: 0.005, group: "soft" },
  { label: "AV / low-voltage design", name: "AV / low-voltage design", defaultPct: 0.005, group: "soft" },
  { label: "Code consultant", name: "Code consultant", defaultPct: 0.003, group: "soft" },
  { label: "Waterproofing / envelope consultant", name: "Waterproofing / envelope consultant", defaultPct: 0.003, group: "soft" },
  { label: "Project management", name: "Project management", defaultPct: 0.04, group: "soft" },
  { label: "Building permits and impact fees", name: "Building permits and impact fees", defaultFixed: 75000, group: "soft" },
  { label: "Expediter fees", name: "Expediter fees", defaultFixed: 25000, group: "soft" },
  { label: "Structural probes and GPR scanning", name: "Structural probes and GPR scanning", defaultFixed: 25000, group: "soft" },
  { label: "Matterport / Existing-conditions documentation", name: "Matterport / Existing-conditions documentation", defaultFixed: 10000, group: "soft" },
  { label: "Mock room construction", name: "Mock room construction", defaultFixed: 50000, group: "soft" },
  { label: "Procurement Agent", name: "Procurement Agent", defaultPct: 0.05, group: "soft" },
  { label: "IT / technology", name: "IT / technology", defaultPct: 0.02, group: "soft" },
  { label: "FF&E warehousing, logistics, install", name: "FF&E warehousing, logistics, install", defaultPct: 0.42, group: "soft" },

  // ── Contingency group ────────────────────────────────────────────
  { label: "Contingency", name: "Contingency", defaultPct: 0.07, group: "contingency" },
  { label: "Design contingency", name: "Design contingency", defaultPct: 0.03, group: "contingency" },

  // ── Developer fee group ──────────────────────────────────────────
  { label: "Developer's Fee", name: "Developer's Fee", defaultPct: 0.03, group: "dev_fee" },
];

export function loadPresets(): SoftCostPreset[] {
  try {
    // One-time cleanup of the pre-v2 cache so the old list doesn't resurrect
    // if the user ever reverts their localStorage.
    localStorage.removeItem("pipbudget.softCostPresets");
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {
    /* ignore */
  }
  return DEFAULT_PRESETS;
}

export function savePresets(presets: SoftCostPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (_) {
    /* ignore */
  }
}

export function resetPresetsToDefault(): SoftCostPreset[] {
  savePresets(DEFAULT_PRESETS);
  return DEFAULT_PRESETS;
}
