// Box measurement — every box on the canvas renders at the same
// size, where that size is the max natural size across all boxes. The
// "natural size" for one box is what it'd be if it sized itself to fit
// its populated content (within min/max width clamps). Hide an empty
// field's row entirely so a box with only name + % is shorter than one
// with all 5 fields.
//
// Implementation: a single hidden measurement node. For each box we
// fill the node with the same content the real box would render, read
// `getBoundingClientRect()`, and take the max.

import type { Box } from "./types";
import { BOX_MAX_W, BOX_MIN_H, BOX_MIN_W } from "./types";

export type Size = { width: number; height: number };

/** Build the inner HTML for a measurement of one box. Mirrors the
 *  layout in EntityBox — same rows, same row-hiding for empty fields,
 *  same typography. The node itself owns padding + min/max widths via
 *  CSS, so this fragment only carries text content + per-row styling. */
function renderMeasurementHtml(b: Box): string {
  const rows: string[] = [];

  // Entity type — uppercase mono caps.
  rows.push(
    `<div style="font-family:Inter,system-ui,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;line-height:1.1;opacity:0.6">${escapeHtml(b.entityType)}</div>`,
  );

  // Entity name — Cormorant Garamond 15px, up to 2 lines.
  const name = b.name || "Untitled";
  rows.push(
    `<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:15px;font-weight:500;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(name)}</div>`,
  );

  // Ownership % — Inter 13px, right-aligned.
  if (b.ownershipPct != null) {
    rows.push(
      `<div style="font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:500;line-height:1.2;text-align:right;font-variant-numeric:tabular-nums">${formatPct(b.ownershipPct)}</div>`,
    );
  }

  // Jurisdiction / EIN — single line, ellipsis.
  if (b.jurisdiction && b.jurisdiction.trim() !== "") {
    rows.push(
      `<div style="font-family:Inter,system-ui,sans-serif;font-size:10px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(b.jurisdiction)}</div>`,
    );
  }

  // Notes — italic single line, ellipsis.
  if (b.notes && b.notes.trim() !== "") {
    rows.push(
      `<div style="font-family:Inter,system-ui,sans-serif;font-size:10px;font-style:italic;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(b.notes)}</div>`,
    );
  }

  return rows.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPct(n: number): string {
  return (n.toFixed(2).replace(/\.?0+$/, "") || "0") + "%";
}

/** Style the measurement node so its `getBoundingClientRect()` already
 *  reflects the clamped natural size. Caller mounts this once. */
export function applyMeasurementStyles(el: HTMLElement) {
  Object.assign(el.style, {
    position: "absolute",
    top: "-9999px",
    left: "-9999px",
    visibility: "hidden",
    pointerEvents: "none",
    boxSizing: "border-box",
    display: "inline-flex",
    flexDirection: "column",
    gap: "4px",
    padding: "12px 14px",
    border: "1.5px solid transparent", // mirrors real box border so width math matches
    minWidth: `${BOX_MIN_W}px`,
    maxWidth: `${BOX_MAX_W}px`,
    minHeight: `${BOX_MIN_H}px`,
  });
}

/** Measure ONE box's natural size — what it would render to if it
 *  sized itself to fit its current text content. Used by the PPTX
 *  importer so each box is wide enough that the source label is fully
 *  legible, even when the source PPT shape was tiny. The caller
 *  applies the styles via `applyMeasurementStyles` once and reuses
 *  the same node for every measurement. */
export function measureBoxNatural(box: Box, measureEl: HTMLElement): Size {
  measureEl.innerHTML = renderMeasurementHtml(box);
  const rect = measureEl.getBoundingClientRect();
  return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
}

/** Mount a hidden measurement node, run `fn` against it, and clean
 *  up. Convenience wrapper for one-shot measurement passes (e.g. the
 *  importer needs to measure N boxes once and discard the node). */
export function withMeasureNode<T>(fn: (el: HTMLElement) => T): T {
  const el = document.createElement("div");
  applyMeasurementStyles(el);
  document.body.appendChild(el);
  try {
    return fn(el);
  } finally {
    document.body.removeChild(el);
  }
}

/** Compute the global box size from the current set of boxes. Returns
 *  the default min size when there are no boxes. */
export function computeGlobalBoxSize(boxes: Box[], measureEl: HTMLElement | null): Size {
  if (!measureEl || boxes.length === 0) {
    return { width: BOX_MIN_W, height: BOX_MIN_H };
  }
  let maxW = BOX_MIN_W;
  let maxH = BOX_MIN_H;
  for (const b of boxes) {
    measureEl.innerHTML = renderMeasurementHtml(b);
    const rect = measureEl.getBoundingClientRect();
    if (rect.width > maxW) maxW = rect.width;
    if (rect.height > maxH) maxH = rect.height;
  }
  // Round up so subpixel measurements don't cause flicker.
  return { width: Math.ceil(maxW), height: Math.ceil(maxH) };
}
