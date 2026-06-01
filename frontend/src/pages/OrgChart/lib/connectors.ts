// Connector geometry. Boxes attach via the midpoint of one of their
// four edges; segments meeting an edge are always PERPENDICULAR to it.
// Default elbow count is the minimum that satisfies the perpendicular
// invariant: 1 elbow for perpendicular sides (L-shape), 2 for parallel
// sides (Z-shape with a centered bend). The user can step up to the
// next valid count via Connector.routeDetail = "extra".

import type { Box, Connector, ConnectorSide, RouteStyle } from "./types";

export type Edge = ConnectorSide;
export type Point = { x: number; y: number };

const ALL_EDGES: Edge[] = ["top", "right", "bottom", "left"];
const OBSTACLE_PADDING = 8;
const EXTRA_STEP = 32;

function center(b: Box): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

function edgePoint(b: Box, edge: Edge, offset = 0.5): Point {
  // `offset` is a fraction along the chosen side (0..1). Defaults to 0.5
  // (centered) when not set; the user can drag endpoints to other
  // positions along the side via the custom-endpoint handles.
  const t = Math.min(1, Math.max(0, offset));
  switch (edge) {
    case "top":    return { x: b.x + b.width * t, y: b.y };
    case "bottom": return { x: b.x + b.width * t, y: b.y + b.height };
    case "left":   return { x: b.x,               y: b.y + b.height * t };
    case "right":  return { x: b.x + b.width,     y: b.y + b.height * t };
  }
}

function isHorizontalEdge(edge: Edge): boolean {
  return edge === "left" || edge === "right";
}

function defaultEdges(from: Box, to: Box): { fromEdge: Edge; toEdge: Edge } {
  // Pick the pair of faces that are CLOSEST between the two boxes. The
  // axis with the smaller signed gap wins; on a true diagonal (gap on
  // both axes) the smaller gap dominates. When the boxes overlap on
  // both axes we fall through to the legacy center-to-center heuristic.
  const ax1 = from.x, ax2 = from.x + from.width;
  const ay1 = from.y, ay2 = from.y + from.height;
  const bx1 = to.x, bx2 = to.x + to.width;
  const by1 = to.y, by2 = to.y + to.height;
  const aLeftOfB = bx1 > ax2;
  const aRightOfB = ax1 > bx2;
  const aAboveB = by1 > ay2;
  const aBelowB = ay1 > by2;
  const hGap = aLeftOfB ? (bx1 - ax2) : aRightOfB ? (ax1 - bx2) : -1;
  const vGap = aAboveB ? (by1 - ay2) : aBelowB ? (ay1 - by2) : -1;
  const hsep = hGap >= 0;
  const vsep = vGap >= 0;
  if (hsep && !vsep) {
    return aLeftOfB
      ? { fromEdge: "right", toEdge: "left" }
      : { fromEdge: "left",  toEdge: "right" };
  }
  if (vsep && !hsep) {
    return aAboveB
      ? { fromEdge: "bottom", toEdge: "top" }
      : { fromEdge: "top",    toEdge: "bottom" };
  }
  if (hsep && vsep) {
    if (hGap <= vGap) {
      return aLeftOfB
        ? { fromEdge: "right", toEdge: "left" }
        : { fromEdge: "left",  toEdge: "right" };
    }
    return aAboveB
      ? { fromEdge: "bottom", toEdge: "top" }
      : { fromEdge: "top",    toEdge: "bottom" };
  }
  // Both axes overlap — boxes touch or contain each other. Fall back
  // to center-to-center direction so we still pick a sensible pair.
  const fc = center(from);
  const tc = center(to);
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { fromEdge: "bottom", toEdge: "top" }
      : { fromEdge: "top",    toEdge: "bottom" };
  }
  return dx >= 0
    ? { fromEdge: "right", toEdge: "left" }
    : { fromEdge: "left",  toEdge: "right" };
}

/** Resolve which edges to use, honoring per-connector side overrides
 *  and avoiding obstacles when possible. Returns the chosen edge pair. */
export function pickEdges(
  from: Box, to: Box,
  override: { fromSide?: Edge; toSide?: Edge } = {},
  obstacles: Box[] = [],
  routeDetail: "min" | "extra" = "min",
): { fromEdge: Edge; toEdge: Edge } {
  const def = defaultEdges(from, to);
  const fromEdge = override.fromSide ?? def.fromEdge;
  const toEdge   = override.toSide   ?? def.toEdge;
  if (override.fromSide && override.toSide) return { fromEdge, toEdge };

  // Prefer the closest-face default — it produces the shortest, most
  // intuitive route. Only fall back to alternatives if the default
  // path actually crosses another box; obstacle-free defaults always
  // win even when a longer side-pair has fewer manhattan units.
  {
    const defA = edgePoint(from, fromEdge);
    const defB = edgePoint(to, toEdge);
    const defPath = orthogonalPolyline(defA, fromEdge, defB, toEdge, routeDetail);
    if (countObstacleCrossings(defPath, obstacles) === 0) {
      return { fromEdge, toEdge };
    }
  }

  const candidates: Array<{ from: Edge; to: Edge }> = [{ from: fromEdge, to: toEdge }];
  for (const f of ALL_EDGES) for (const t of ALL_EDGES) {
    if (override.fromSide && f !== override.fromSide) continue;
    if (override.toSide && t !== override.toSide) continue;
    if (f === fromEdge && t === toEdge) continue;
    candidates.push({ from: f, to: t });
  }

  let bestCrossings = Infinity;
  let bestLen = Infinity;
  let bestPair = { fromEdge, toEdge };
  for (const c of candidates) {
    const a = edgePoint(from, c.from);
    const b = edgePoint(to, c.to);
    const path = orthogonalPolyline(a, c.from, b, c.to, routeDetail);
    const crossings = countObstacleCrossings(path, obstacles);
    const len = manhattan(path);
    if (crossings < bestCrossings || (crossings === bestCrossings && len < bestLen)) {
      bestCrossings = crossings;
      bestLen = len;
      bestPair = { fromEdge: c.from, toEdge: c.to };
    }
  }
  return bestPair;
}

/** SVG path for a connector. Always orthogonal-friendly: segments
 *  meeting a box edge are perpendicular to that edge. The router picks
 *  the minimum valid elbow count by default; pass `routeDetail="extra"`
 *  to step up by 2 elbows when the user wants a stepped detour.
 *
 *  When `waypoints` is non-empty (set by the PPTX importer from the
 *  source `<p:cxnSp>` bbox), the auto-router is skipped: the path is
 *  built as `start → wp0 → wp1 → ... → end`, preserving whatever
 *  manifold/elbow shape the source deck encoded. */
export function connectorPath(
  from: Box, to: Box,
  style: RouteStyle,
  override: {
    fromSide?: Edge; toSide?: Edge;
    fromOffset?: number; toOffset?: number;
    elbowX?: number; elbowY?: number;
    step1?: number; step2?: number;
    toAnchor?: Point;
  } = {},
  obstacles: Box[] = [],
  routeDetail: "min" | "extra" = "min",
  waypoints: Point[] = [],
): string {
  const { fromEdge, toEdge } = pickEdges(from, to, override, obstacles, routeDetail);
  const a = edgePoint(from, fromEdge, override.fromOffset);
  // T-junction: when the user dropped this connector onto another
  // connector (rather than a box), `toAnchor` is the absolute click
  // point on the parent line. The route still leaves the source box
  // perpendicular to its edge, but terminates at the anchor instead
  // of the target box's edge.
  const b = override.toAnchor ?? edgePoint(to, toEdge, override.toOffset);

  if (waypoints.length > 0) {
    // Honor source-anchored waypoints verbatim. Snap the FIRST and
    // LAST intermediate vertices to the start/end edge axes so the
    // perpendicular invariant survives — this fixes drift when the
    // box positions have moved since the source bbox was captured
    // (e.g. user dragged a box after import).
    const snapped: Point[] = waypoints.map((p) => ({ ...p }));
    if (snapped.length > 0) {
      // `isHorizontalEdge` returns TRUE for left/right (edges that
      // sit at a horizontal endpoint of the box, i.e. vertical
      // lines). Connectors meeting those edges exit horizontally —
      // first segment moves in X, so we pin Y to the start point.
      // Top/bottom edges flip the axes.
      if (isHorizontalEdge(fromEdge)) snapped[0].y = a.y;
      else snapped[0].x = a.x;
      const lastIdx = snapped.length - 1;
      if (isHorizontalEdge(toEdge)) snapped[lastIdx].y = b.y;
      else snapped[lastIdx].x = b.x;
    }
    const all: Point[] = [a, ...snapped, b];
    return all.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
  }

  if (style === "straight") return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

  const pts = orthogonalPolyline(a, fromEdge, b, toEdge, routeDetail, { x: override.elbowX, y: override.elbowY, step1: override.step1, step2: override.step2 });
  // Skip auto obstacle-avoidance when the user has manually placed
  // the elbow — they're explicitly routing around something and the
  // automatic shifter would fight their placement.
  const userPlaced = override.elbowX != null || override.elbowY != null || override.step1 != null || override.step2 != null;
  const cleared = userPlaced ? pts : avoidObstacles(pts, fromEdge, toEdge, obstacles);
  return cleared.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
}

/** Build the polyline. Perpendicular invariant: the segment touching
 *  a box edge is always perpendicular to that edge.
 *
 *  - Perpendicular sides (e.g. right + top): 1 elbow (L-shape).
 *  - Parallel sides   (e.g. bottom + top): 2 elbows (Z with centered bend).
 *  - "extra" mode adds 2 more bends to either case, producing a
 *    stepped path that still meets the invariant at both ends.
 */
function orthogonalPolyline(
  a: Point, fromEdge: Edge, b: Point, toEdge: Edge,
  routeDetail: "min" | "extra" = "min",
  elbow: { x?: number; y?: number; step1?: number; step2?: number } = {},
): Point[] {
  const fromH = isHorizontalEdge(fromEdge);
  const toH = isHorizontalEdge(toEdge);
  const perpendicular = fromH !== toH;

  if (perpendicular && routeDetail === "min") {
    // L-shape: bend at the corner where the two perpendicular axes meet.
    // Either elbow override (elbow.x and/or elbow.y) promotes the L
    // into a 4-segment "extra"-style path so the bend lands exactly
    // at the user's click point. When BOTH overrides are set the bend
    // sits at (elbow.x, elbow.y); when only one is set the other
    // axis falls back to the auto-midpoint between source and target.
    if (fromH) {
      if (elbow.x !== undefined || elbow.y !== undefined) {
        const elbX = elbow.x ?? (a.x + b.x) / 2;
        const midY = elbow.y ?? (a.y + b.y) / 2;
        return [a, { x: elbX, y: a.y }, { x: elbX, y: midY }, { x: b.x, y: midY }, b];
      }
      return [a, { x: b.x, y: a.y }, b];
    }
    if (elbow.x !== undefined || elbow.y !== undefined) {
      const elbY = elbow.y ?? (a.y + b.y) / 2;
      const midX = elbow.x ?? (a.x + b.x) / 2;
      return [a, { x: a.x, y: elbY }, { x: midX, y: elbY }, { x: midX, y: b.y }, b];
    }
    return [a, { x: a.x, y: b.y }, b];
  }

  if (!perpendicular && routeDetail === "min") {
    // Z-shape: one bend axis halfway along the dominant direction so
    // the entry/exit segments stay perpendicular to their box edges.
    // The user can override the bend axis (elbow.x for horizontal
    // connectors, elbow.y for vertical) to move the middle segment.
    if (fromH) {
      const midX = elbow.x ?? (a.x + b.x) / 2;
      return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
    }
    const midY = elbow.y ?? (a.y + b.y) / 2;
    return [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b];
  }

  // "extra" mode — step up by 2 elbows so direction-alternation still
  // lands the last segment perpendicular to the target edge. Elbow
  // overrides (elbow.x / elbow.y) replace the cross-segment axis when
  // present, so the bar adjuster on a stepped path actually shifts the
  // bend the user is dragging instead of being ignored.
  if (perpendicular) {
    // Source side perpendicular to target side. Need an EVEN number of
    // segments: 2 (min) or 4 (extra). Pattern for fromH/!toH:
    //   H — V — H — V   (jog out, cross, sweep across, enter)
    if (fromH) {
      const jogDir = Math.sign(b.x - a.x) || 1;
      const jogX = elbow.x ?? (a.x + jogDir * EXTRA_STEP);
      const midY = elbow.y ?? (a.y + b.y) / 2;
      return [a, { x: jogX, y: a.y }, { x: jogX, y: midY }, { x: b.x, y: midY }, b];
    }
    // Source vertical (top/bottom), target horizontal (left/right).
    //   V — H — V — H
    const jogDir = Math.sign(b.y - a.y) || 1;
    const jogY = elbow.y ?? (a.y + jogDir * EXTRA_STEP);
    const midX = elbow.x ?? (a.x + b.x) / 2;
    return [a, { x: a.x, y: jogY }, { x: midX, y: jogY }, { x: midX, y: b.y }, b];
  }

  // Parallel + extra: 4 elbows (5 segments). Add a stepped detour.
  // The middle cross-segment honors the elbow override (elbow.y for
  // horizontal-side connectors, elbow.x for vertical) so the user can
  // shift the stepped trunk. The two outer jog axes honor `step1`
  // (source-side) and `step2` (target-side) so the user can drag
  // them via the segment-2 and segment-4 pills, turning a symmetric
  // step into an asymmetric one without dragging boxes.
  if (fromH) {
    const stepX1 = elbow.step1 ?? (a.x + Math.sign(b.x - a.x || 1) * EXTRA_STEP);
    const stepX2 = elbow.step2 ?? (b.x - Math.sign(b.x - a.x || 1) * EXTRA_STEP);
    const midY = elbow.y ?? (a.y + b.y) / 2;
    return [a, { x: stepX1, y: a.y }, { x: stepX1, y: midY }, { x: stepX2, y: midY }, { x: stepX2, y: b.y }, b];
  }
  const stepY1 = elbow.step1 ?? (a.y + Math.sign(b.y - a.y || 1) * EXTRA_STEP);
  const stepY2 = elbow.step2 ?? (b.y - Math.sign(b.y - a.y || 1) * EXTRA_STEP);
  const midX = elbow.x ?? (a.x + b.x) / 2;
  return [a, { x: a.x, y: stepY1 }, { x: midX, y: stepY1 }, { x: midX, y: stepY2 }, { x: b.x, y: stepY2 }, b];
}

/** Step through all interior segments and shift their bend axis when
 *  one collides with an obstacle. Endpoints are pinned. The fix only
 *  moves segments parallel to the box edges they're attached to (so
 *  the perpendicular-to-edge invariant is preserved). */
function avoidObstacles(pts: Point[], fromEdge: Edge, toEdge: Edge, obstacles: Box[]): Point[] {
  if (obstacles.length === 0 || pts.length < 3) return pts;
  const next = pts.map((p) => ({ ...p }));
  const MAX_ROUNDS = 4;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false;
    // Walk every interior segment (skip the first & last segments,
    // which connect directly to the endpoints — those would shift the
    // attachment point and break the perpendicular invariant).
    for (let i = 1; i < next.length - 2; i++) {
      const p1 = next[i];
      const p2 = next[i + 1];
      const horizontal = Math.abs(p1.y - p2.y) < 0.5;
      let hit: Box | null = null;
      for (const b of obstacles) {
        if (segmentIntersectsBox(p1, p2, b, OBSTACLE_PADDING)) { hit = b; break; }
      }
      if (!hit) continue;
      moved = true;
      if (horizontal) {
        const below = hit.y + hit.height + OBSTACLE_PADDING + 1;
        const above = hit.y - OBSTACLE_PADDING - 1;
        const goBelow = Math.abs(below - p1.y) <= Math.abs(above - p1.y);
        const newY = goBelow ? below : above;
        next[i].y = newY;
        next[i + 1].y = newY;
      } else {
        const right = hit.x + hit.width + OBSTACLE_PADDING + 1;
        const left = hit.x - OBSTACLE_PADDING - 1;
        const goRight = Math.abs(right - p1.x) <= Math.abs(left - p1.x);
        const newX = goRight ? right : left;
        next[i].x = newX;
        next[i + 1].x = newX;
      }
    }
    if (!moved) break;
  }

  // The first and last segments may now be longer (since we shifted
  // interior bends), but they remain perpendicular to their edges by
  // construction — interior shifts only move the perpendicular axis.
  void fromEdge; void toEdge;
  return next;
}

function segmentIntersectsBox(p1: Point, p2: Point, b: Box, pad: number): boolean {
  const horizontal = Math.abs(p1.y - p2.y) < 0.5;
  if (horizontal) {
    const [xa, xb] = p1.x < p2.x ? [p1.x, p2.x] : [p2.x, p1.x];
    return p1.y > b.y - pad && p1.y < b.y + b.height + pad &&
           xb > b.x - pad && xa < b.x + b.width + pad;
  }
  const [ya, yb] = p1.y < p2.y ? [p1.y, p2.y] : [p2.y, p1.y];
  return p1.x > b.x - pad && p1.x < b.x + b.width + pad &&
         yb > b.y - pad && ya < b.y + b.height + pad;
}

function countObstacleCrossings(pts: Point[], obstacles: Box[]): number {
  if (obstacles.length === 0 || pts.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    for (const b of obstacles) {
      if (segmentIntersectsBox(pts[i - 1], pts[i], b, OBSTACLE_PADDING)) total += 1;
    }
  }
  return total;
}

function manhattan(pts: Point[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  }
  return total;
}

/** End-tangent direction — used for arrowhead orientation. With the
 *  perpendicular invariant, the final segment direction is determined
 *  entirely by the target edge. */
export function endTangent(
  from: Box, to: Box, style: RouteStyle,
  override: { fromSide?: Edge; toSide?: Edge; fromOffset?: number; toOffset?: number } = {},
  obstacles: Box[] = [],
  routeDetail: "min" | "extra" = "min",
): Point {
  const { fromEdge, toEdge } = pickEdges(from, to, override, obstacles, routeDetail);
  const b = edgePoint(to, toEdge, override.toOffset);
  if (style === "straight") {
    const a = edgePoint(from, fromEdge, override.fromOffset);
    return unit({ x: b.x - a.x, y: b.y - a.y });
  }
  switch (toEdge) {
    case "top":    return { x: 0, y: 1 };
    case "bottom": return { x: 0, y: -1 };
    case "left":   return { x: 1, y: 0 };
    case "right":  return { x: -1, y: 0 };
  }
}

function unit(p: Point): Point {
  const m = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / m, y: p.y / m };
}

export function arrowAnchor(
  to: Box, from: Box, style: RouteStyle,
  override: { fromSide?: Edge; toSide?: Edge; fromOffset?: number; toOffset?: number; toAnchor?: Point } = {},
  obstacles: Box[] = [],
  routeDetail: "min" | "extra" = "min",
): Point {
  if (override.toAnchor) return override.toAnchor;
  const { toEdge } = pickEdges(from, to, override, obstacles, routeDetail);
  void style;
  return edgePoint(to, toEdge, override.toOffset);
}

export function resolveSides(
  conn: Pick<Connector, "fromSide" | "toSide" | "routeDetail">,
  from: Box, to: Box,
  obstacles: Box[] = [],
): { fromEdge: Edge; toEdge: Edge } {
  return pickEdges(
    from, to,
    { fromSide: conn.fromSide, toSide: conn.toSide },
    obstacles,
    conn.routeDetail ?? "min",
  );
}

/** Compute the actual endpoint position on a box's perimeter from the
 *  connector's side + offset. Used by the canvas to render draggable
 *  endpoint handles when `customEndpoints` is on. */
export function connectorEndpoint(b: Box, side: Edge, offset = 0.5): Point {
  return edgePoint(b, side, offset);
}

/** Project an arbitrary world-coord point onto a box's perimeter,
 *  returning the closest side and the offset (0..1) along it. Used by
 *  the endpoint-drag handler to translate cursor position into a
 *  side+offset that the connector can be re-anchored to. */
export function projectToBoxPerimeter(
  b: Box, p: Point,
): { side: Edge; offset: number } {
  // Distances from the cursor to each of the four edges. The cursor
  // projects onto whichever edge it's nearest to; offset is the
  // cursor's coordinate along that edge clamped to 0..1.
  const rx = p.x - b.x;
  const ry = p.y - b.y;
  const dTop = Math.abs(ry);
  const dBottom = Math.abs(ry - b.height);
  const dLeft = Math.abs(rx);
  const dRight = Math.abs(rx - b.width);
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  let side: Edge;
  let offset: number;
  if (min === dTop) { side = "top"; offset = rx / b.width; }
  else if (min === dBottom) { side = "bottom"; offset = rx / b.width; }
  else if (min === dLeft) { side = "left"; offset = ry / b.height; }
  else { side = "right"; offset = ry / b.height; }
  return { side, offset: Math.min(1, Math.max(0, offset)) };
}
