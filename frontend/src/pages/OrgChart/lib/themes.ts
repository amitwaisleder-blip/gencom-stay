// Theme presets. `defaults` are applied to NEW boxes; existing boxes
// keep their per-box colors when the theme changes.

import type { ThemeKey } from "./types";

export type ThemeDefaults = {
  fillColor: string;
  borderColor: string;
  textColor: string;
};

export const THEMES: Record<Exclude<ThemeKey, "custom">, { label: string; description: string; defaults: ThemeDefaults }> = {
  "hyatt-blue": {
    label: "Hyatt Blue",
    description: "Modern, clean PE/hospitality",
    defaults: { fillColor: "#D6E6F2", borderColor: "#2563EB", textColor: "#0F172A" },
  },
  "legal-white": {
    label: "Legal White",
    description: "Formal legal / Rosewood-style",
    defaults: { fillColor: "#FFFFFF", borderColor: "#000000", textColor: "#000000" },
  },
  slate: {
    label: "Slate",
    description: "Neutral professional",
    defaults: { fillColor: "#F1F5F9", borderColor: "#64748B", textColor: "#0F172A" },
  },
  forest: {
    label: "Forest",
    description: "Differentiated branch coloring",
    defaults: { fillColor: "#DCFCE7", borderColor: "#16A34A", textColor: "#14532D" },
  },
};

const CUSTOM_KEY = "gencom.orgchart.customTheme.v1";

/** When the theme is "custom", look up the saved defaults from
 *  localStorage. Falls back to the Slate palette if nothing is saved. */
export function customDefaults(): ThemeDefaults {
  if (typeof window === "undefined") return THEMES.slate.defaults;
  try {
    const raw = window.localStorage.getItem(CUSTOM_KEY);
    if (!raw) return THEMES.slate.defaults;
    const parsed = JSON.parse(raw) as Partial<ThemeDefaults>;
    return {
      fillColor: parsed.fillColor || THEMES.slate.defaults.fillColor,
      borderColor: parsed.borderColor || THEMES.slate.defaults.borderColor,
      textColor: parsed.textColor || THEMES.slate.defaults.textColor,
    };
  } catch {
    return THEMES.slate.defaults;
  }
}

export function saveCustomDefaults(d: ThemeDefaults): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(d));
  } catch {
    /* quota — ignore */
  }
}

export function defaultsFor(theme: ThemeKey): ThemeDefaults {
  if (theme === "custom") return customDefaults();
  return THEMES[theme].defaults;
}
