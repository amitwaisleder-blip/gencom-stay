// Hierarchical top-down tree layout for the Auto-arrange button.
//
// Treat the chart as a forest: every box that no connector points
// AT becomes a root. A box's children are the targets of connectors
// originating from it. For each root we compute subtree widths
// recursively, then place each node centered above its children.
// Multiple roots line up side-by-side at depth 0.
//
// Returns a map of `id → { x, y }` so the caller can write them
// back into chart.boxes (and animate via CSS transition).

import type { Box, ChartState } from "./types";

const H_GAP = 32;
const V_GAP = 56;
const ORIGIN_X = 80;
const ORIGIN_Y = 60;

export type Positions = Map<string, { x: number; y: number }>;

export function autoArrange(chart: ChartState): Positions {
  if (chart.boxes.length === 0) return new Map();

  const byId = new Map<string, Box>();
  for (const b of chart.boxes) byId.set(b.id, b);

  // children[parentId] = [childIds]; tracked from the connector
  // graph. Skips connectors with dangling endpoints.
  const children = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const c of chart.connectors) {
    if (!byId.has(c.fromBoxId) || !byId.has(c.toBoxId)) continue;
    const arr = children.get(c.fromBoxId) ?? [];
    arr.push(c.toBoxId);
    children.set(c.fromBoxId, arr);
    incoming.add(c.toBoxId);
  }

  const visited = new Set<string>();
  const widths = new Map<string, number>();

  function subtreeWidth(id: string): number {
    if (widths.has(id)) return widths.get(id)!;
    if (visited.has(id)) {
      // Cycle protection — treat as a leaf.
      widths.set(id, byId.get(id)?.width ?? 180);
      return widths.get(id)!;
    }
    visited.add(id);
    const box = byId.get(id);
    const ownWidth = box?.width ?? 180;
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      widths.set(id, ownWidth);
      return ownWidth;
    }
    const childTotal =
      kids.reduce((a, k) => a + subtreeWidth(k), 0) + H_GAP * (kids.length - 1);
    const w = Math.max(ownWidth, childTotal);
    widths.set(id, w);
    return w;
  }

  const positions: Positions = new Map();
  function place(id: string, leftX: number, level: number) {
    const box = byId.get(id);
    if (!box) return;
    const w = subtreeWidth(id);
    const cx = leftX + w / 2;
    positions.set(id, {
      x: cx - box.width / 2,
      y: ORIGIN_Y + level * (box.height + V_GAP),
    });
    let cursor = leftX;
    for (const k of children.get(id) ?? []) {
      if (positions.has(k)) continue; // cycle short-circuit
      place(k, cursor, level + 1);
      cursor += subtreeWidth(k) + H_GAP;
    }
  }

  // Roots: boxes with no incoming connector. Stable order = current
  // canvas left-to-right so the result is predictable.
  const roots = chart.boxes
    .filter((b) => !incoming.has(b.id))
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
    .map((b) => b.id);

  // Defensive: if everything is in a cycle, just use the box that
  // currently sits highest as the entry point so we still produce
  // some layout instead of an empty map.
  const startList = roots.length > 0 ? roots : [
    chart.boxes
      .slice()
      .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y))[0].id,
  ];

  let cursor = ORIGIN_X;
  for (const r of startList) {
    place(r, cursor, 0);
    cursor += subtreeWidth(r) + H_GAP;
  }

  // Any remaining boxes (unreachable from any root because of cycles
  // or isolated components) — stack them off to the right at depth 0
  // so the user sees them and can move them manually.
  let extraCursor = cursor;
  for (const b of chart.boxes) {
    if (positions.has(b.id)) continue;
    positions.set(b.id, { x: extraCursor, y: ORIGIN_Y });
    extraCursor += b.width + H_GAP;
  }

  return positions;
}
