// Per-box color palettes. Replaces the raw HTML5 color spectrum picker
// in the property panel with a curated set of swatches: each entry is a
// fill / border / text triple plus a basic-color swatch list for fine
// edits. Keeps the chart visually coherent and stops users from picking
// colors that print badly.

import type { ThemeDefaults } from "./themes";

export type Palette = {
  key: string;
  label: string;
  defaults: ThemeDefaults;
};

/** Curated palettes the user can apply to a single box with one click.
 *  These mirror the global Theme presets but read as "swatch rows"
 *  instead of a full theme switch. */
export const BOX_PALETTES: Palette[] = [
  { key: "white",   label: "White",        defaults: { fillColor: "#FFFFFF", borderColor: "#0F172A", textColor: "#0F172A" } },
  { key: "ink",     label: "Ink",          defaults: { fillColor: "#0F172A", borderColor: "#0F172A", textColor: "#FFFFFF" } },
  { key: "stone",   label: "Stone",        defaults: { fillColor: "#F5F5F4", borderColor: "#57534E", textColor: "#1C1917" } },
  { key: "navy",    label: "Navy",         defaults: { fillColor: "#E0E7FF", borderColor: "#1E3A8A", textColor: "#0F172A" } },
  { key: "blue",    label: "Sky",          defaults: { fillColor: "#DBEAFE", borderColor: "#2563EB", textColor: "#0F172A" } },
  { key: "teal",    label: "Teal",         defaults: { fillColor: "#CCFBF1", borderColor: "#0F766E", textColor: "#134E4A" } },
  { key: "emerald", label: "Emerald",      defaults: { fillColor: "#DCFCE7", borderColor: "#047857", textColor: "#064E3B" } },
  { key: "lime",    label: "Lime",         defaults: { fillColor: "#ECFCCB", borderColor: "#65A30D", textColor: "#1A2E05" } },
  { key: "amber",   label: "Amber",        defaults: { fillColor: "#FEF3C7", borderColor: "#B45309", textColor: "#451A03" } },
  { key: "rose",    label: "Rose",         defaults: { fillColor: "#FCE7F3", borderColor: "#BE185D", textColor: "#500724" } },
  { key: "violet",  label: "Violet",       defaults: { fillColor: "#EDE9FE", borderColor: "#6D28D9", textColor: "#1E1B4B" } },
  { key: "slate",   label: "Slate",        defaults: { fillColor: "#F1F5F9", borderColor: "#475569", textColor: "#0F172A" } },
];

/** Basic per-channel swatches — used in the property panel when the
 *  user wants to nudge one of fill/border/text without applying a full
 *  palette. Limited to colors that work well on light printouts. */
export const FILL_SWATCHES = [
  "#FFFFFF", "#F5F5F4", "#F1F5F9", "#FEF3C7", "#DBEAFE",
  "#DCFCE7", "#FCE7F3", "#EDE9FE", "#CCFBF1", "#FEE2E2",
  "#0F172A", "#1E3A8A", "#064E3B", "#7C2D12", "#4C0519",
];

export const BORDER_SWATCHES = [
  "#0F172A", "#475569", "#64748B", "#1E3A8A", "#2563EB",
  "#0F766E", "#047857", "#65A30D", "#B45309", "#BE185D",
  "#6D28D9", "#9333EA", "#DC2626", "#000000", "#FFFFFF",
];

export const TEXT_SWATCHES = [
  "#0F172A", "#1C1917", "#000000", "#FFFFFF", "#374151",
  "#1E3A8A", "#064E3B", "#451A03", "#500724", "#1E1B4B",
];

/** Find which palette best matches a Box's current colors. Returns
 *  null if nothing matches exactly. */
export function matchPalette(d: ThemeDefaults): Palette | null {
  for (const p of BOX_PALETTES) {
    if (
      p.defaults.fillColor.toUpperCase() === d.fillColor.toUpperCase() &&
      p.defaults.borderColor.toUpperCase() === d.borderColor.toUpperCase() &&
      p.defaults.textColor.toUpperCase() === d.textColor.toUpperCase()
    ) {
      return p;
    }
  }
  return null;
}
