// Pannable / zoomable canvas. The outer scroller handles pan + zoom;
// boxes + connectors live in an inner transformed div. SVG connectors
// are absolutely positioned at the same coordinate space as the boxes
// so they re-route automatically when boxes move.
//
// Pan: hold Space then drag, or middle-mouse drag.
// Zoom: Shift + wheel. Wheel without modifier scrolls.

import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenterHorizontal, AlignCenterVertical,
  AlignEndHorizontal, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter,
  Grid2x2, MoveHorizontal, MoveVertical,
} from "lucide-react";

import type { Box, ChartState, Connector, Selection } from "../lib/types";
import { BOX_MIN_H, BOX_MIN_W, PAPER_PRESETS } from "../lib/types";
import { arrowAnchor, connectorEndpoint, connectorPath, endTangent, projectToBoxPerimeter, resolveSides } from "../lib/connectors";
import type { ParentReport } from "../lib/validation";
import { EntityBox } from "./EntityBox";
import type { Edge } from "./EntityBox";

/** Resize handle identifiers. The two-letter ones are corner handles
 *  (e.g. "ne" = top-right), the one-letter ones are edge midpoints. */
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const CONNECTOR_COLOR = "#374151";
// Selected connectors render in blue so they stand out from the
// emerald box-selection rings; the contrast tells the user at a
// glance which connector is currently in focus.
const SELECTED_CONNECTOR_COLOR = "#2563eb";

export type Viewport = { x: number; y: number; zoom: number };

export type CanvasHandle = {
  fitToContent: () => void;
  /** Pan + zoom so the supplied world-coord rectangle fills the
   *  viewport (with the canvas's natural padding). Used by "Fit
   *  selection to page" to focus on whatever the user has selected. */
  fitToBbox: (rect: { x: number; y: number; width: number; height: number }) => void;
  reset100: () => void;
};

export const Canvas = forwardRef<CanvasHandle, {
  chart: ChartState;
  selection: Selection;
  warningsByParent: Map<string, ParentReport>;
  viewport: Viewport;
  onViewport: (v: Viewport) => void;
  onSelect: (s: Selection) => void;
  onMoveBox: (id: string, x: number, y: number) => void;
  onMoveBoxes: (
    delta: { dx: number; dy: number },
    ids: string[],
    origins: Map<string, { x: number; y: number }>,
    connectorOrigins?: Map<string, { elbowX?: number; elbowY?: number; toAnchor?: { x: number; y: number }; waypoints?: { x: number; y: number }[] }>,
  ) => void;
  onClearSelection: () => void;
  /** True for ~400ms after Auto-arrange — enables the box position
   *  transition so the layout glides instead of snapping. */
  animating?: boolean;
  /** Called when the user finishes a drag from a link handle on box
   *  `fromId` over box `toId`. The parent decides whether to actually
   *  create the connector (e.g. duplicate-prevention). */
  onConnect: (fromId: string, toId: string) => void;
  /** Inline rename (double-click on the box name). */
  onRename: (id: string, next: string) => void;
  /** Inline connector mutations from the canvas — used by the
   *  hover-add-label / inline-edit-label affordance on each line. */
  onUpdateConnector?: (id: string, patch: Partial<Connector>) => void;
  /** Edge `+` clicked — parent shows a "New box / Connect to existing"
   *  popover anchored at `anchor`. */
  onEdgePlus: (sourceId: string, edge: Edge, anchor: { x: number; y: number }) => void;
  /** Set when the user is in "click another box to connect" mode after
   *  picking that option from the edge `+` menu. */
  linkPickFrom: string | null;
  /** Set when the user picked "Resize" from an edge `+` menu. The
   *  matching box renders 8 drag handles and absorbs box-drag events
   *  while the resize is in flight. Cleared via `onExitResize`. */
  resizingBoxId?: string | null;
  /** Called as the user drags a resize handle. The parent applies min
   *  clamps and writes back to chart state. */
  onResizeBox?: (id: string, next: { x: number; y: number; width: number; height: number }) => void;
  /** Called when the user clicks empty canvas while in resize mode so
   *  the parent can clear `resizingBoxId`. */
  onExitResize?: () => void;
  /** Floating action bar for multi-selections (Connect / Build hierarchy
   *  / Cancel). The Canvas knows where the centroid is; the parent
   *  knows what the actions do. */
  /** When set, the matching box renders edge "+" buttons so the user
   *  can pick a direction for the right-click action ("new box" or
   *  "connect to existing"). Cleared once the action fires. */
  boxAction?: { id: string; mode: "newBox" | "connect" } | null;
  /** Right-click on a box. Receives the screen-space click coords so
   *  the parent can anchor a context menu. */
  onBoxContextMenu?: (boxId: string, anchor: { x: number; y: number }) => void;
  /** Drop a new connector onto an existing connector (T-junction). The
   *  parent creates a connector from `fromId` whose endpoint is on
   *  the parent line identified by `parentConnId`. The editor reads
   *  the parent's geometry to snap the drop strictly vertical. */
  onConnectAnchor?: (fromId: string, parentConnId: string, anchor: { x: number; y: number }) => void;
  /** Right-click on a connector. Forwards both the screen-space coord
   *  (for popover placement) and the world-coord click point (for the
   *  resulting drop-line anchor) up to the editor. */
  onConnectorContextMenu?: (
    connectorId: string,
    screen: { x: number; y: number },
    world: { x: number; y: number },
  ) => void;
  /** When set, the user has armed a connector for "drop a new line"
   *  via right-click and is now picking a target box. Clicking any
   *  box completes the gesture instead of selecting it. */
  connectorDropAction?: { connectorId: string; anchor: { x: number; y: number } } | null;
  /** Called when the user clicks a box while `connectorDropAction` is
   *  set — the editor creates the new connector from that box up to
   *  the captured anchor on the line. */
  onCompleteConnectorDrop?: (boxId: string) => void;
  /** Connector id that should auto-enter midpoint-label edit mode the
   *  next time it renders. Used by the right-click "Add text" path so
   *  the user starts typing immediately. ConnectorView clears it via
   *  onLabelEditConsumed once it actually mounts the editor. */
  pendingLabelEditId?: string | null;
  onLabelEditConsumed?: () => void;
  multiActions?: {
    onConnect: () => void;
    onBuildHierarchy: () => void;
    /** Align / distribute the selection. The parent does the math; the
     *  Canvas just exposes the buttons. */
    onAlign: (op:
      | "align-left" | "align-center-x" | "align-right"
      | "align-top"  | "align-center-y" | "align-bottom"
      | "distribute-h" | "distribute-v"
      | "space-equal") => void;
    /** Scale every selected box (size + position + font) so the
     *  entire selection fits a new bounding rectangle. The Canvas
     *  computes the per-box geometry from the bbox handle drag and
     *  the parent applies it in a single setChart. */
    onGroupResize: (updates: Array<{
      id: string; x: number; y: number; width: number; height: number; fontSizePt: number;
    }>) => void;
    /** Make every selected box the same width / height / both. The
     *  `target` arg picks whether to match the LARGEST or SMALLEST
     *  in the selection. Locked boxes always anchor when present. */
    onMatchSize: (dim: "width" | "height" | "both", target: "largest" | "smallest") => void;
    /** Group / ungroup the current selection. Once grouped, clicking
     *  any member auto-selects all members and operations apply to
     *  the group as a unit. */
    onGroup: () => void;
    onUngroup: () => void;
    /** Scale + reposition the selection to fit inside the chart's
     *  active paper-size rectangle. Disabled when no paper is set. */
    onFitToPage: () => void;
    /** True when chart.paperSize is set so the bar can enable the
     *  Fit-to-page button. */
    hasPaperSize: boolean;
    onCancel: () => void;
  };
}>(function Canvas(
  {
    chart, selection, warningsByParent, viewport, onViewport, onSelect, onMoveBox, onMoveBoxes,
    onClearSelection, animating, onConnect, onRename, onEdgePlus, linkPickFrom,
    resizingBoxId, onResizeBox, onExitResize, onUpdateConnector,
    boxAction, onBoxContextMenu,
    onConnectAnchor,
    onConnectorContextMenu,
    connectorDropAction,
    onCompleteConnectorDrop,
    pendingLabelEditId,
    onLabelEditConsumed,
    multiActions,
  },
  ref,
) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  // Link-drag state — only set while dragging from a box's link handle
  // toward another box. `to` is the world-coord cursor position; `over`
  // is the id of the box currently under the cursor (null = empty).
  const [link, setLink] = useState<{ fromId: string; to: { x: number; y: number }; overId: string | null } | null>(null);
  // Smart-snap guides shown while resizing — vertical guides are X
  // positions where the moving edge aligned to another box's edge or
  // center; horizontal guides are Y positions. Cleared on pointer up.
  const [snapGuides, setSnapGuides] = useState<{ vert: number[]; horiz: number[] } | null>(null);
  // Live state of an in-progress marquee selection. Coords are in
  // world space so the rectangle stays anchored to the canvas while
  // the user pans/zooms. Direction (currX vs startX) controls the
  // selection mode at pointerup — Adobe-style: right-to-left = crossing
  // (touches), left-to-right = window (fully inside).
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currX: number; currY: number } | null>(null);
  const dragRef = useRef<{ kind: "pan"; sx: number; sy: number; vx: number; vy: number }
    | { kind: "box"; id: string; ox: number; oy: number; bx: number; by: number;
        multiIds?: string[]; multiOrigins?: Map<string, { x: number; y: number }>;
        connectorOrigins?: Map<string, { elbowX?: number; elbowY?: number; toAnchor?: { x: number; y: number }; waypoints?: { x: number; y: number }[] }>;
        shiftAtStart: boolean; moved: boolean }
    | { kind: "link"; fromId: string }
    | { kind: "resize"; id: string; handle: ResizeHandle; ox: number; oy: number; bx: number; by: number; bw: number; bh: number }
    | { kind: "groupResize"; handle: ResizeHandle; ox: number; oy: number;
        bbox: { x: number; y: number; w: number; h: number };
        origins: Array<{ id: string; x: number; y: number; w: number; h: number; fontSizePt: number }>;
      }
    | { kind: "endpoint"; connId: string; end: "from" | "to"; boxId: string }
    | { kind: "elbow"; connId: string; axis: "x" | "y"; field?: "step1" | "step2" }
    | { kind: "label"; connId: string; startClientX: number; startClientY: number; startOffsetX: number; startOffsetY: number; mode: "free" | "on-connector" }
    | { kind: "marquee"; startX: number; startY: number; currX: number; currY: number; additive: boolean; preexisting: string[] }
    | null>(null);

  // Space-to-pan toggle. Tracked at canvas level so clicking inputs
  // in the property panel doesn't accidentally arm pan mode.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space") {
        if (e.type === "keydown") setSpaceDown(true);
        else setSpaceDown(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // Imperative handle for fit / 100% — exposed so the toolbar can
  // trigger them without lifting all viewport math up.
  useEffect(() => {
    if (!ref) return;
    const handle: CanvasHandle = {
      fitToContent: () => {
        const node = scrollerRef.current;
        if (!node || chart.boxes.length === 0) {
          onViewport({ x: 0, y: 0, zoom: 1 });
          return;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const b of chart.boxes) {
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.width);
          maxY = Math.max(maxY, b.y + b.height);
        }
        const pad = 80;
        const cw = node.clientWidth;
        const ch = node.clientHeight;
        const w = maxX - minX + pad * 2;
        const h = maxY - minY + pad * 2;
        const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(cw / w, ch / h)));
        const x = (cw - (maxX - minX) * z) / 2 - minX * z;
        const y = (ch - (maxY - minY) * z) / 2 - minY * z;
        onViewport({ x, y, zoom: z });
      },
      fitToBbox: (rect) => {
        const node = scrollerRef.current;
        if (!node || rect.width <= 0 || rect.height <= 0) return;
        const cw = node.clientWidth;
        const ch = node.clientHeight;
        const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(cw / rect.width, ch / rect.height)));
        const x = (cw - rect.width * z) / 2 - rect.x * z;
        const y = (ch - rect.height * z) / 2 - rect.y * z;
        onViewport({ x, y, zoom: z });
      },
      reset100: () => onViewport({ x: 0, y: 0, zoom: 1 }),
    };
    if (typeof ref === "function") ref(handle);
    else (ref as React.MutableRefObject<CanvasHandle | null>).current = handle;
  }, [ref, chart.boxes, onViewport]);

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (!e.shiftKey) return; // only zoom when shift held
    e.preventDefault();
    const node = scrollerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // Zoom around cursor: keep the world-point under the cursor pinned.
    const wx = (cx - viewport.x) / viewport.zoom;
    const wy = (cy - viewport.y) / viewport.zoom;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom * factor));
    onViewport({
      x: cx - wx * next,
      y: cy - wy * next,
      zoom: next,
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Only consider primary or middle button.
    const isMiddle = e.button === 1;
    const isPrimary = e.button === 0;
    if (!isPrimary && !isMiddle) return;

    if (spaceDown || isMiddle) {
      e.preventDefault();
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: viewport.x, vy: viewport.y };
      return;
    }
    // Otherwise — pointerdown on empty canvas starts a marquee
    // selection (Adobe-style: right-to-left = crossing/touches,
    // left-to-right = window/fully-inside). Without shift the existing
    // selection is cleared at pointerdown; with shift the marquee
    // ADDS to the selection on release.
    if (e.target === e.currentTarget || (e.target as HTMLElement).id === "orgchart-canvas-inner") {
      e.preventDefault();
      const node = scrollerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const wy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      const preexisting: string[] =
        e.shiftKey
          ? selection.kind === "boxes" ? [...selection.ids]
            : selection.kind === "box" ? [selection.id]
            : []
          : [];
      if (!e.shiftKey) onClearSelection();
      try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      dragRef.current = { kind: "marquee", startX: wx, startY: wy, currX: wx, currY: wy, additive: e.shiftKey, preexisting };
      setMarquee({ startX: wx, startY: wy, currX: wx, currY: wy });
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      onViewport({
        x: drag.vx + (e.clientX - drag.sx),
        y: drag.vy + (e.clientY - drag.sy),
        zoom: viewport.zoom,
      });
    } else if (drag.kind === "box") {
      let dx = (e.clientX - drag.ox) / viewport.zoom;
      let dy = (e.clientY - drag.oy) / viewport.zoom;
      // Track whether the cursor moved enough to count as a real drag.
      // Used at pointerup to decide between drag-vs-click — a tiny
      // jitter between pointerdown and pointerup should still register
      // as a click (and trigger the shift-multi-select toggle).
      const DRAG_THRESHOLD = 3;
      if (Math.abs(e.clientX - drag.ox) > DRAG_THRESHOLD || Math.abs(e.clientY - drag.oy) > DRAG_THRESHOLD) {
        drag.moved = true;
      }
      // Axis lock: holding Shift during a drag constrains motion to
      // the dominant axis so the user can move a box along a single
      // line. Decided per-frame from the bigger raw delta rather than
      // latching at drag-start, so the user can switch axis mid-drag
      // by going further along the other direction.
      if (e.shiftKey && drag.moved) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (!drag.moved) return; // suppress 1-2px jitter from a click
      if (drag.multiIds && drag.multiOrigins) {
        // Move every selected box by the same world-space delta. Keeps
        // the relative layout intact while the user re-positions a
        // group as one unit.
        onMoveBoxes({ dx, dy }, drag.multiIds, drag.multiOrigins, drag.connectorOrigins);
      } else {
        onMoveBox(drag.id, drag.bx + dx, drag.by + dy);
      }
    } else if (drag.kind === "resize") {
      const dx = (e.clientX - drag.ox) / viewport.zoom;
      const dy = (e.clientY - drag.oy) / viewport.zoom;
      let nx = drag.bx, ny = drag.by, nw = drag.bw, nh = drag.bh;
      const h = drag.handle;
      // Right / bottom edges grow with positive delta. Left / top
      // edges shrink width/height while pushing x/y forward — clamp
      // x/y at the point where width/height hit the minimum so the
      // box doesn't slide through the cursor.
      if (h.includes("e")) {
        nw = Math.max(BOX_MIN_W, drag.bw + dx);
      }
      if (h.includes("w")) {
        nw = Math.max(BOX_MIN_W, drag.bw - dx);
        nx = drag.bx + (drag.bw - nw);
      }
      if (h.includes("s")) {
        nh = Math.max(BOX_MIN_H, drag.bh + dy);
      }
      if (h.includes("n")) {
        nh = Math.max(BOX_MIN_H, drag.bh - dy);
        ny = drag.by + (drag.bh - nh);
      }

      // Smart-snap: the moving edge(s) prefer to align with other
      // boxes' edges or centers. Tolerance is in screen pixels (8px)
      // so the snap feels the same at any zoom level.
      const SNAP = 8 / viewport.zoom;
      const others = chart.boxes.filter((b) => b.id !== drag.id);
      const vLines: number[] = [];
      const hLines: number[] = [];
      for (const b of others) {
        vLines.push(b.x, b.x + b.width / 2, b.x + b.width);
        hLines.push(b.y, b.y + b.height / 2, b.y + b.height);
      }
      const guides: { vert: number[]; horiz: number[] } = { vert: [], horiz: [] };

      function nearest(target: number, lines: number[]): number | null {
        let best: { v: number; d: number } | null = null;
        for (const v of lines) {
          const d = Math.abs(v - target);
          if (d <= SNAP && (best === null || d < best.d)) best = { v, d };
        }
        return best?.v ?? null;
      }

      if (h.includes("e")) {
        const snap = nearest(nx + nw, vLines);
        if (snap !== null) {
          nw = Math.max(BOX_MIN_W, snap - nx);
          guides.vert.push(snap);
        }
      }
      if (h.includes("w")) {
        const right = nx + nw;
        const snap = nearest(nx, vLines);
        if (snap !== null) {
          nx = snap;
          nw = Math.max(BOX_MIN_W, right - nx);
          // If the min-width clamp kicked in, the moving edge can't
          // actually reach the snap line; pull it back to the clamped
          // position and skip the guide so we don't show a misleading line.
          if (nx + nw !== right) {
            nx = right - nw;
          } else {
            guides.vert.push(snap);
          }
        }
      }
      if (h.includes("s")) {
        const snap = nearest(ny + nh, hLines);
        if (snap !== null) {
          nh = Math.max(BOX_MIN_H, snap - ny);
          guides.horiz.push(snap);
        }
      }
      if (h.includes("n")) {
        const bottom = ny + nh;
        const snap = nearest(ny, hLines);
        if (snap !== null) {
          ny = snap;
          nh = Math.max(BOX_MIN_H, bottom - ny);
          if (ny + nh !== bottom) {
            ny = bottom - nh;
          } else {
            guides.horiz.push(snap);
          }
        }
      }

      setSnapGuides(guides.vert.length || guides.horiz.length ? guides : null);
      onResizeBox?.(drag.id, { x: nx, y: ny, width: nw, height: nh });
    } else if (drag.kind === "groupResize") {
      // Scale the entire selection's bbox using a fixed anchor (the
      // corner / edge opposite to the handle). Scale factors derived
      // from the new bbox dimensions; each box's position relative to
      // the bbox is preserved, and width / height / font scale together.
      //
      // Shift = constrain proportions: both axes share whichever scale
      // factor the cursor pushed further from 1. No shift = free scale,
      // so width and height can stretch independently.
      const dx = (e.clientX - drag.ox) / viewport.zoom;
      const dy = (e.clientY - drag.oy) / viewport.zoom;
      const h = drag.handle;
      let nx = drag.bbox.x, ny = drag.bbox.y, nw = drag.bbox.w, nh = drag.bbox.h;
      const minBboxW = 20;
      const minBboxH = 20;
      if (h.includes("e")) {
        nw = Math.max(minBboxW, drag.bbox.w + dx);
      }
      if (h.includes("w")) {
        nw = Math.max(minBboxW, drag.bbox.w - dx);
        nx = drag.bbox.x + (drag.bbox.w - nw);
      }
      if (h.includes("s")) {
        nh = Math.max(minBboxH, drag.bbox.h + dy);
      }
      if (h.includes("n")) {
        nh = Math.max(minBboxH, drag.bbox.h - dy);
        ny = drag.bbox.y + (drag.bbox.h - nh);
      }
      if (e.shiftKey) {
        const rx = nw / drag.bbox.w;
        const ry = nh / drag.bbox.h;
        // Pick the dominant axis (further from 1), then clamp so the
        // mirrored axis also stays above its minimum.
        let s = Math.abs(rx - 1) >= Math.abs(ry - 1) ? rx : ry;
        s = Math.max(minBboxW / drag.bbox.w, minBboxH / drag.bbox.h, s);
        nw = drag.bbox.w * s;
        nh = drag.bbox.h * s;
        nx = h.includes("w") ? drag.bbox.x + drag.bbox.w - nw : drag.bbox.x;
        ny = h.includes("n") ? drag.bbox.y + drag.bbox.h - nh : drag.bbox.y;
      }
      const sx = nw / drag.bbox.w;
      const sy = nh / drag.bbox.h;
      const sFont = Math.min(sx, sy);
      const updates = drag.origins.map((o) => ({
        id: o.id,
        x: nx + (o.x - drag.bbox.x) * sx,
        y: ny + (o.y - drag.bbox.y) * sy,
        width: o.w * sx,
        height: o.h * sy,
        fontSizePt: o.fontSizePt * sFont,
      }));
      multiActions?.onGroupResize(updates);
    } else if (drag.kind === "endpoint") {
      // Convert cursor → world coords, then project onto the connected
      // box's perimeter to find the new side + offset for this endpoint.
      const node = scrollerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const wy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      const conn = chart.connectors.find((c) => c.id === drag.connId);
      // T-junction target: end="to" on a toAnchor connector means the
      // target endpoint sits on the parent line, not a box edge. Drag
      // updates toAnchor freely; the render-time parentConnId re-snap
      // (Canvas.tsx near connector mapping) projects it back onto the
      // parent's trunk so the endpoint stays glued to the parent line.
      if (drag.end === "to" && conn?.toAnchor) {
        onUpdateConnector?.(drag.connId, { toAnchor: { x: wx, y: wy } });
        return;
      }
      const box = chart.boxes.find((b) => b.id === drag.boxId);
      if (!box) return;
      // Honor the connector's existing side — once the user has set
      // (or accepted) a side, dragging the endpoint should slide it
      // along THAT edge, never silently flip to a different one. The
      // only ways to change sides are the property panel's side
      // picker and the Force H/Force V buttons, both explicit.
      const currentSide = drag.end === "from" ? conn?.fromSide : conn?.toSide;
      let side: "top" | "right" | "bottom" | "left";
      let offset: number;
      if (currentSide) {
        side = currentSide;
        if (currentSide === "top" || currentSide === "bottom") {
          offset = Math.min(1, Math.max(0, (wx - box.x) / box.width));
        } else {
          offset = Math.min(1, Math.max(0, (wy - box.y) / box.height));
        }
      } else {
        // No side recorded yet (freshly auto-routed connector) — pick
        // whichever edge the cursor is closest to. This still respects
        // the user's later side picks because once `currentSide` is
        // set the projection branch above takes over.
        const projected = projectToBoxPerimeter(box, { x: wx, y: wy });
        side = projected.side;
        offset = projected.offset;
      }
      // Axis lock — Force H/V keeps the connector on one orientation.
      // If the current side somehow violates the axis lock (e.g. the
      // user changed routing), snap back to the legal pair of sides.
      if (conn?.axisLock === "horizontal" && (side === "top" || side === "bottom")) {
        side = wx >= box.x + box.width / 2 ? "right" : "left";
        offset = Math.min(1, Math.max(0, (wy - box.y) / box.height));
      } else if (conn?.axisLock === "vertical" && (side === "left" || side === "right")) {
        side = wy >= box.y + box.height / 2 ? "bottom" : "top";
        offset = Math.min(1, Math.max(0, (wx - box.x) / box.width));
      }
      const patch: Partial<Connector> = drag.end === "from"
        ? { fromSide: side, fromOffset: offset, customEndpoints: true }
        : { toSide: side, toOffset: offset, customEndpoints: true };
      onUpdateConnector?.(drag.connId, patch);
    } else if (drag.kind === "elbow") {
      // Move the connector's draggable midpoint. The patch depends on
      // the connector's shape:
      //   - Z-shape orthogonal → update elbowX / elbowY.
      //   - Drop-line (straight + toAnchor) → slide the whole line
      //     along the drag axis by updating BOTH `toAnchor` and
      //     `fromOffset` so the line stays straight at the new X (or Y).
      // Manifold groups apply the patch to every member so the trunk
      // moves as one.
      const node = scrollerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const wy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      const draggedConn = chart.connectors.find((c) => c.id === drag.connId);
      let patch: Partial<Connector>;
      if (draggedConn?.toAnchor && draggedConn.routeStyle === "straight") {
        // Straight drop-line: slide the whole line along its
        // perpendicular axis while keeping it straight. Clamp to the
        // source box's perpendicular range so the line can't detach
        // from the box.
        const fromBox = chart.boxes.find((b) => b.id === draggedConn.fromBoxId);
        if (!fromBox) return;
        if (drag.axis === "x") {
          const clamped = Math.min(fromBox.x + fromBox.width, Math.max(fromBox.x, wx));
          patch = {
            toAnchor: { ...draggedConn.toAnchor, x: clamped },
            fromOffset: (clamped - fromBox.x) / fromBox.width,
          };
        } else {
          const clamped = Math.min(fromBox.y + fromBox.height, Math.max(fromBox.y, wy));
          patch = {
            toAnchor: { ...draggedConn.toAnchor, y: clamped },
            fromOffset: (clamped - fromBox.y) / fromBox.height,
          };
        }
      } else if (drag.field === "step1" || drag.field === "step2") {
        // Step jog drag — pill on segment 2 (source-side jog) or
        // segment 4 (target-side jog) of a parallel-extra path.
        // Stores the perpendicular coord; the router applies it as
        // stepY1/stepY2 (vertical edges) or stepX1/stepX2 (horizontal
        // edges) per the elbow.step1/step2 protocol.
        patch = { [drag.field]: drag.axis === "y" ? wy : wx };
      } else {
        // Orthogonal route (with or without toAnchor) — bar adjuster
        // shifts a single bend axis. Stepped routes get the same
        // treatment because the router now honors elbowX/elbowY in
        // extra mode (see orthogonalPolyline).
        patch = drag.axis === "y" ? { elbowY: wy } : { elbowX: wx };
      }
      const manifoldId = draggedConn?.manifoldId;
      if (manifoldId && onUpdateConnector) {
        for (const c of chart.connectors) {
          if (c.manifoldId === manifoldId) onUpdateConnector(c.id, patch);
        }
      } else {
        onUpdateConnector?.(drag.connId, patch);
      }
    } else if (drag.kind === "label") {
      // Drag a connector's midpoint label. In "free" mode the label
      // follows the cursor in both axes; "on-connector" mode is a
      // no-op for now (the on-screen position auto-rides the path
      // midpoint and there's no useful 1D slide gesture without
      // projecting onto the path each frame, which would lag at high
      // zooms). The mode toggle on the property panel switches in
      // and out of "free" without re-issuing a drag.
      if (drag.mode !== "free") return;
      const dx = (e.clientX - drag.startClientX) / viewport.zoom;
      const dy = (e.clientY - drag.startClientY) / viewport.zoom;
      onUpdateConnector?.(drag.connId, {
        labelMode: "free",
        labelOffset: { x: drag.startOffsetX + dx, y: drag.startOffsetY + dy },
      });
    } else if (drag.kind === "link") {
      // Convert client coords → world (canvas) coords + hit-test boxes.
      const node = scrollerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const wy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      const overId = boxAt(wx, wy, drag.fromId);
      setLink({ fromId: drag.fromId, to: { x: wx, y: wy }, overId });
    } else if (drag.kind === "marquee") {
      const node = scrollerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const wy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      drag.currX = wx;
      drag.currY = wy;
      setMarquee({ startX: drag.startX, startY: drag.startY, currX: wx, currY: wy });
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag?.kind === "link" && link?.overId) {
      onConnect(drag.fromId, link.overId);
    }
    // Box drag that never moved → treat as a click. With shift held it
    // toggles multi-select membership; without shift it's a no-op (the
    // single-select happened on pointerdown). This is what lets a
    // shift-click still toggle while shift+drag does an axis-locked move.
    if (drag?.kind === "box" && !drag.moved && drag.shiftAtStart) {
      handleShiftSelect(drag.id);
    }
    if (drag?.kind === "marquee") {
      // At least 4 screen-px or it was probably a misclick — fall
      // through and just leave selection as the cleared state from
      // pointerdown.
      const dxw = Math.abs(drag.currX - drag.startX);
      const dyw = Math.abs(drag.currY - drag.startY);
      const minWorld = 4 / viewport.zoom;
      if (dxw > minWorld || dyw > minWorld) {
        const x1 = Math.min(drag.startX, drag.currX);
        const x2 = Math.max(drag.startX, drag.currX);
        const y1 = Math.min(drag.startY, drag.currY);
        const y2 = Math.max(drag.startY, drag.currY);
        // Direction is what determines selection mode — Illustrator's
        // crossing vs window: dragging right-to-left selects everything
        // the rectangle touches; left-to-right selects only what's
        // wholly inside.
        const crossing = drag.currX < drag.startX;
        const ids: string[] = drag.additive ? [...drag.preexisting] : [];
        for (const b of chart.boxes) {
          const intersects =
            !(b.x + b.width < x1 || b.x > x2 || b.y + b.height < y1 || b.y > y2);
          const fullyInside = b.x >= x1 && b.x + b.width <= x2 && b.y >= y1 && b.y + b.height <= y2;
          const hit = crossing ? intersects : fullyInside;
          if (hit && !ids.includes(b.id)) ids.push(b.id);
        }
        // Connectors are now picked up REGARDLESS of whether boxes
        // are hit so the marquee can fence over an interleaved
        // mixture (boxes + connectors). Both endpoints are tested
        // for the connector itself; the label chip's stored
        // position is also tested so a marquee that crosses just
        // the text — without touching either endpoint box — still
        // catches the line via its label. Crossing-mode (right-to-
        // left) treats either endpoint or the label as a hit;
        // window-mode (left-to-right) requires the line endpoints
        // fully inside. When the user has fenced a mix of boxes
        // AND connectors the editor produces a "mixed" selection
        // so both kinds can be operated on as one group.
        const cIds: string[] = [];
        for (const c of chart.connectors) {
          const a = chart.boxes.find((b) => b.id === c.fromBoxId);
          const t = chart.boxes.find((b) => b.id === c.toBoxId);
          if (!a || !t) continue;
          const ap = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
          const tp = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
          const aInside = ap.x >= x1 && ap.x <= x2 && ap.y >= y1 && ap.y <= y2;
          const tInside = tp.x >= x1 && tp.x <= x2 && tp.y >= y1 && tp.y <= y2;
          // Label-chip hit-test: any of the connector's labels (mid
          // or extras) whose stored position falls inside the
          // marquee counts as a connector hit. This is what lets
          // the user fence over a row of labels and grab the
          // parent connectors even when the lines themselves don't
          // cross the marquee rect.
          let labelInside = false;
          const midPos = (c.labelMid || c.label) ? { x: (ap.x + tp.x) / 2 + (c.labelOffset?.x ?? 0), y: (ap.y + tp.y) / 2 + (c.labelOffset?.y ?? 0) } : null;
          if (midPos && midPos.x >= x1 && midPos.x <= x2 && midPos.y >= y1 && midPos.y <= y2) labelInside = true;
          for (const lbl of c.labels ?? []) {
            const lx = lbl.offset?.x ?? (ap.x + tp.x) / 2;
            const ly = lbl.offset?.y ?? (ap.y + tp.y) / 2;
            if (lx >= x1 && lx <= x2 && ly >= y1 && ly <= y2) { labelInside = true; break; }
          }
          const hit = crossing
            ? (aInside || tInside || labelInside)
            : (aInside && tInside);
          if (hit) cIds.push(c.id);
        }
        if (ids.length > 0 && cIds.length > 0) {
          onSelect({ kind: "mixed", boxIds: ids, connectorIds: cIds });
        } else if (ids.length === 1) {
          onSelect({ kind: "box", id: ids[0] });
        } else if (ids.length > 1) {
          onSelect({ kind: "boxes", ids });
        } else if (cIds.length === 1) {
          onSelect({ kind: "connector", id: cIds[0] });
        } else if (cIds.length > 1) {
          onSelect({ kind: "connectors", ids: cIds });
        } else if (drag.additive) {
          // additive marquee with no hits — keep what was there.
          onSelect(
            drag.preexisting.length === 1
              ? { kind: "box", id: drag.preexisting[0] }
              : drag.preexisting.length > 1
              ? { kind: "boxes", ids: drag.preexisting }
              : { kind: "none" },
          );
        }
      }
      setMarquee(null);
    }
    if (dragRef.current) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      dragRef.current = null;
    }
    setLink(null);
    setSnapGuides(null);
  }

  /** Returns the id of the box under (wx, wy) in world coords, or
   *  null. Excludes `excludeId` so a link-drag doesn't self-connect. */
  function boxAt(wx: number, wy: number, excludeId: string): string | null {
    for (let i = chart.boxes.length - 1; i >= 0; i--) {
      const b = chart.boxes[i];
      if (b.id === excludeId) continue;
      if (wx >= b.x && wx <= b.x + b.width && wy >= b.y && wy <= b.y + b.height) {
        return b.id;
      }
    }
    return null;
  }

  function startLinkDrag(boxId: string, e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const node = scrollerRef.current;
    if (!node) return;
    try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = { kind: "link", fromId: boxId };
    const rect = node.getBoundingClientRect();
    const wx = (e.clientX - rect.left - viewport.x) / viewport.zoom;
    const wy = (e.clientY - rect.top - viewport.y) / viewport.zoom;
    setLink({ fromId: boxId, to: { x: wx, y: wy }, overId: null });
  }

  function startLabelDrag(connId: string, e: React.PointerEvent<Element>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const node = scrollerRef.current;
    if (!node) return;
    const conn = chart.connectors.find((c) => c.id === connId);
    if (!conn) return;
    if (conn.locked) return;
    const mode = conn.labelMode === "free" ? "free" : "on-connector";
    try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = {
      kind: "label",
      connId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: conn.labelOffset?.x ?? 0,
      startOffsetY: conn.labelOffset?.y ?? 0,
      mode,
    };
  }

  function startElbowDrag(connId: string, axis: "x" | "y", e: React.PointerEvent<Element>, field?: "step1" | "step2") {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const node = scrollerRef.current;
    if (!node) return;
    const conn = chart.connectors.find((c) => c.id === connId);
    if (conn?.locked) return; // locked connectors ignore drags
    try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = { kind: "elbow", connId, axis, field };
  }

  function startEndpointDrag(connId: string, end: "from" | "to", e: React.PointerEvent<Element>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const node = scrollerRef.current;
    if (!node) return;
    const conn = chart.connectors.find((c) => c.id === connId);
    if (!conn) return;
    if (conn.locked) return; // locked connectors ignore drags
    const boxId = end === "from" ? conn.fromBoxId : conn.toBoxId;
    try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = { kind: "endpoint", connId, end, boxId };
  }

  function startGroupResizeDrag(handle: ResizeHandle, e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    if (selection.kind !== "boxes") return;
    e.preventDefault();
    e.stopPropagation();
    const node = scrollerRef.current;
    if (!node) return;
    const sel = chart.boxes.filter((b) => selection.ids.includes(b.id) && !b.locked);
    if (sel.length === 0) return;
    const minX = Math.min(...sel.map((b) => b.x));
    const minY = Math.min(...sel.map((b) => b.y));
    const maxX = Math.max(...sel.map((b) => b.x + b.width));
    const maxY = Math.max(...sel.map((b) => b.y + b.height));
    try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = {
      kind: "groupResize",
      handle,
      ox: e.clientX,
      oy: e.clientY,
      bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      origins: sel.map((b) => ({
        id: b.id, x: b.x, y: b.y, w: b.width, h: b.height,
        fontSizePt: b.fontSizePt ?? 11,
      })),
    };
  }

  function startResizeDrag(boxId: string, handle: ResizeHandle, e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const box = chart.boxes.find((b) => b.id === boxId);
    const node = scrollerRef.current;
    if (!box || !node) return;
    if (box.locked) return; // locked boxes ignore resize handles
    try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    dragRef.current = {
      kind: "resize",
      id: boxId,
      handle,
      ox: e.clientX,
      oy: e.clientY,
      bx: box.x,
      by: box.y,
      bw: box.width,
      bh: box.height,
    };
  }

  function startBoxDrag(box: Box, e: React.PointerEvent<HTMLDivElement>) {
    if (spaceDown) return; // pan takes precedence
    if (e.button !== 0) return;
    // Locked boxes ignore drag — including drags initiated from a box
    // that's part of a multi-selection. The user can still click to
    // select / inspect them, just can't move or resize.
    if (box.locked) {
      onSelect({ kind: "box", id: box.id });
      return;
    }
    // Clicking a different box while in resize mode exits resize first.
    // The user is moving on; they don't expect handles to linger on the
    // previous box once they've engaged with another.
    if (resizingBoxId && resizingBoxId !== box.id) {
      onExitResize?.();
    }
    e.stopPropagation();
    e.preventDefault();
    // Target-pick mode (after "Connect to existing" from an edge `+`
    // menu): complete the connection on pointerdown and skip the drag.
    // Going through the click handler doesn't work — startBoxDrag would
    // setPointerCapture on the canvas, which redirects pointerup and
    // suppresses the click event on this box.
    if (linkPickFrom && linkPickFrom !== box.id) {
      onConnect(linkPickFrom, box.id);
      return;
    }
    // Connector-drop mode (after right-click → "Add new connector" on
    // a line): the next box click anchors a new drop-line from this
    // box back to the captured point on the connector.
    if (connectorDropAction && onCompleteConnectorDrop) {
      onCompleteConnectorDrop(box.id);
      return;
    }
    // Shift held: defer selection logic to pointerup (handled there
    // by handleShiftSelect when no drag occurs). This lets a static
    // shift-click toggle multi-select while a shift+drag axis-locks
    // the move — both gestures share the same pointerdown.
    let multiIds: string[] | undefined;
    let multiOrigins: Map<string, { x: number; y: number }> | undefined;
    let connectorOrigins: Map<string, { elbowX?: number; elbowY?: number; toAnchor?: { x: number; y: number }; waypoints?: { x: number; y: number }[] }> | undefined;
    const groupBoxIds = selection.kind === "boxes" && selection.ids.includes(box.id)
      ? selection.ids
      : selection.kind === "mixed" && selection.boxIds.includes(box.id)
      ? selection.boxIds
      : null;
    if (groupBoxIds) {
      // Already in the multi/mixed selection — drag the whole group of
      // boxes along with this one, and don't disturb the selection.
      // Connectors in a "mixed" selection don't move on their own; they
      // follow the boxes they're anchored to via the existing
      // moveBoxes connector-translation logic.
      multiIds = groupBoxIds;
      multiOrigins = new Map();
      for (const id of multiIds) {
        const b = chart.boxes.find((x) => x.id === id);
        if (b) multiOrigins.set(id, { x: b.x, y: b.y });
      }
      // Snapshot connector overrides for any connector whose BOTH
      // endpoints are inside the moving group. Manually-placed elbow
      // axes / T-junction anchors / imported waypoints are absolute
      // world coords; the editor translates them by the same delta as
      // the boxes so the routing stays visually consistent during the
      // drag (otherwise the trunk stays put and connector segments
      // route behind the moved boxes, leaving a visible gap).
      const idSet = new Set(multiIds);
      connectorOrigins = new Map();
      for (const cn of chart.connectors) {
        if (!idSet.has(cn.fromBoxId) || !idSet.has(cn.toBoxId)) continue;
        const hasWaypoints = !!cn.waypoints && cn.waypoints.length > 0;
        if (cn.elbowX === undefined && cn.elbowY === undefined && cn.step1 === undefined && cn.step2 === undefined && !cn.toAnchor && !hasWaypoints) continue;
        connectorOrigins.set(cn.id, {
          elbowX: cn.elbowX,
          elbowY: cn.elbowY,
          step1: cn.step1,
          step2: cn.step2,
          toAnchor: cn.toAnchor ? { x: cn.toAnchor.x, y: cn.toAnchor.y } : undefined,
          waypoints: hasWaypoints ? cn.waypoints!.map((p) => ({ x: p.x, y: p.y })) : undefined,
        });
      }
    } else if (!e.shiftKey) {
      // Plain click on a different box: switch to single-select up
      // front. With shift held we leave the selection alone — pointerup
      // will toggle membership if this turns out to be a click.
      onSelect({ kind: "box", id: box.id });
    }
    const node = scrollerRef.current;
    if (!node) return;
    try { node.setPointerCapture(e.pointerId); } catch { /* pointer may have already lifted */ }
    dragRef.current = {
      kind: "box",
      id: box.id,
      ox: e.clientX,
      oy: e.clientY,
      bx: box.x,
      by: box.y,
      multiIds,
      multiOrigins,
      connectorOrigins,
      shiftAtStart: e.shiftKey,
      moved: false,
    };
  }

  /** Reduce a (boxIds, connectorIds) pair to the most specific
   *  Selection variant. An empty mixed selection collapses to "none";
   *  one with just one type collapses to box/boxes/connector/connectors;
   *  only a heterogeneous pair stays as "mixed". Used by both shift-
   *  select handlers when toggling membership in a mixed selection. */
  function collapseMixed(boxIds: string[], connectorIds: string[]): Selection {
    if (boxIds.length === 0 && connectorIds.length === 0) return { kind: "none" };
    if (connectorIds.length === 0) {
      return boxIds.length === 1 ? { kind: "box", id: boxIds[0] } : { kind: "boxes", ids: boxIds };
    }
    if (boxIds.length === 0) {
      return connectorIds.length === 1
        ? { kind: "connector", id: connectorIds[0] }
        : { kind: "connectors", ids: connectorIds };
    }
    return { kind: "mixed", boxIds, connectorIds };
  }

  /** Shift+click on a connector — toggles its membership in a
   *  connectors-multi-selection, OR promotes the current selection to
   *  "mixed" when boxes are already selected (and vice versa from
   *  handleShiftSelect). */
  function handleConnectorShiftSelect(id: string) {
    if (selection.kind === "connector") {
      if (selection.id === id) {
        onSelect({ kind: "none" });
      } else {
        onSelect({ kind: "connectors", ids: [selection.id, id] });
      }
    } else if (selection.kind === "connectors") {
      if (selection.ids.includes(id)) {
        const next = selection.ids.filter((x) => x !== id);
        onSelect(
          next.length === 0
            ? { kind: "none" }
            : next.length === 1
            ? { kind: "connector", id: next[0] }
            : { kind: "connectors", ids: next },
        );
      } else {
        onSelect({ kind: "connectors", ids: [...selection.ids, id] });
      }
    } else if (selection.kind === "box") {
      onSelect({ kind: "mixed", boxIds: [selection.id], connectorIds: [id] });
    } else if (selection.kind === "boxes") {
      onSelect({ kind: "mixed", boxIds: selection.ids, connectorIds: [id] });
    } else if (selection.kind === "mixed") {
      const has = selection.connectorIds.includes(id);
      const nextConnectorIds = has
        ? selection.connectorIds.filter((x) => x !== id)
        : [...selection.connectorIds, id];
      onSelect(collapseMixed(selection.boxIds, nextConnectorIds));
    } else {
      onSelect({ kind: "connector", id });
    }
  }

  /** Shift+click on a box — toggles its membership in the
   *  multi-selection. Mirrors the EntityBox onClick branch but runs on
   *  pointerdown so it isn't eaten by pointer capture. */
  function handleShiftSelect(id: string) {
    if (selection.kind === "box") {
      if (selection.id === id) {
        onSelect({ kind: "none" });
      } else {
        onSelect({ kind: "boxes", ids: [selection.id, id] });
      }
    } else if (selection.kind === "boxes") {
      if (selection.ids.includes(id)) {
        const next = selection.ids.filter((x) => x !== id);
        onSelect(
          next.length === 0
            ? { kind: "none" }
            : next.length === 1
            ? { kind: "box", id: next[0] }
            : { kind: "boxes", ids: next },
        );
      } else {
        onSelect({ kind: "boxes", ids: [...selection.ids, id] });
      }
    } else if (selection.kind === "connector") {
      onSelect({ kind: "mixed", boxIds: [id], connectorIds: [selection.id] });
    } else if (selection.kind === "connectors") {
      onSelect({ kind: "mixed", boxIds: [id], connectorIds: selection.ids });
    } else if (selection.kind === "mixed") {
      const has = selection.boxIds.includes(id);
      const nextBoxIds = has
        ? selection.boxIds.filter((x) => x !== id)
        : [...selection.boxIds, id];
      onSelect(collapseMixed(nextBoxIds, selection.connectorIds));
    } else {
      onSelect({ kind: "box", id });
    }
  }

  // Map for connector lookups + selection coloring.
  const boxesById = new Map<string, Box>();
  for (const b of chart.boxes) boxesById.set(b.id, b);

  return (
    <div
      ref={scrollerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="orgchart-canvas relative w-full h-[calc(100vh-160px)] min-h-[520px] bg-white border border-gencom-sand rounded-md overflow-hidden"
      style={{
        cursor: spaceDown ? "grab" : "default",
        backgroundImage:
          "radial-gradient(circle, #d9d4c8 1px, transparent 1px)",
        backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`,
        backgroundPosition: `${viewport.x % (20 * viewport.zoom)}px ${viewport.y % (20 * viewport.zoom)}px`,
      }}
    >
      <div
        id="orgchart-canvas-inner"
        className="absolute top-0 left-0"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: "0 0",
          // Inner needs to be huge so that translated coords don't clip.
          width: 1,
          height: 1,
        }}
      >
        {/* Paper-size guide — drawn behind everything so connectors
            and boxes sit on top. Origin (0,0) is the top-left of the
            page; the rectangle's size matches the selected preset
            (96 DPI) so 8.5×11" → 816×1056 px. */}
        {chart.paperSize && chart.paperSize !== "off" && PAPER_PRESETS[chart.paperSize] && (() => {
          const p = PAPER_PRESETS[chart.paperSize];
          return (
            <div
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                left: 0,
                top: 0,
                width: p.width,
                height: p.height,
                // Fully transparent — only the dashed border shows the
                // page boundary, so boxes that extend past the page
                // remain visible instead of being washed out.
                background: "transparent",
                border: "1.5px dashed #94a3b8",
                zIndex: 1,
              }}
            >
              <div
                className="absolute"
                style={{
                  top: -22,
                  left: 0,
                  font: "10px Inter, system-ui, sans-serif",
                  color: "#64748b",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                {p.label}
              </div>
            </div>
          );
        })()}

        {/* Connectors — single SVG rendered above the inner-origin so
            paths share the box coordinate system. The explicit
            overflow="visible" attribute is more reliable across
            engines than relying on the CSS-only `overflow-visible`
            utility. zIndex pushes the SVG above the box divs so the
            full line stays visible when a connector crosses behind a
            box (drop-lines from a horizontal trunk would otherwise
            disappear into whatever box they pass through). The wide
            transparent hit-test path picks up clicks on the line
            wherever it's exposed; resize handles and the marquee
            still render above this layer via their own zIndex bumps. */}
        <svg
          className="absolute pointer-events-none"
          overflow="visible"
          style={{ left: 0, top: 0, width: 1, height: 1, overflow: "visible", zIndex: 5 }}
        >
          <defs>
            <marker
              id="orgchart-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={CONNECTOR_COLOR} />
            </marker>
            <marker
              id="orgchart-arrow-selected"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={SELECTED_CONNECTOR_COLOR} />
            </marker>
          </defs>
          {(() => {
            // Sort so selected connectors paint LAST. SVG paint order
            // = document order, so without this a selected line's
            // endpoint circles + bar adjusters can sit underneath an
            // unselected sibling that happens to come later in
            // chart.connectors, making them unclickable. Selection
            // ordering is preserved within the selected group so
            // multi-select behavior stays predictable.
            const isConnSelected = (id: string) =>
              (selection.kind === "connector" && selection.id === id) ||
              (selection.kind === "connectors" && selection.ids.includes(id)) ||
              (selection.kind === "mixed" && selection.connectorIds.includes(id));
            const ordered = [...chart.connectors].sort((a, b) => {
              const sa = isConnSelected(a.id) ? 1 : 0;
              const sb = isConnSelected(b.id) ? 1 : 0;
              return sa - sb;
            });
            return ordered;
          })().map((c) => {
            const from = boxesById.get(c.fromBoxId);
            const to = boxesById.get(c.toBoxId);
            if (!from || !to) return null;
            const isSel =
              (selection.kind === "connector" && selection.id === c.id) ||
              (selection.kind === "connectors" && selection.ids.includes(c.id)) ||
              (selection.kind === "mixed" && selection.connectorIds.includes(c.id));
            const stroke = isSel ? SELECTED_CONNECTOR_COLOR : CONNECTOR_COLOR;
            // Obstacles for routing = all boxes except this connector's
            // own endpoints. The router uses these to pick edges that
            // don't slice through siblings, and to push the elbow past
            // an obstacle when needed.
            const obstacles = chart.boxes.filter((b) => b.id !== from.id && b.id !== to.id);
            // T-junction children re-snap their stored `toAnchor` onto
            // the parent connector's CURRENT trunk Y/X every render.
            // Without this, moving a box that shifts the parent's
            // trunk leaves the dropped child line dangling at the
            // original click point, visibly disconnected from the
            // parent. Only the perpendicular-to-trunk axis is
            // overridden — the other axis is the source box's center
            // column (set when the line was first dropped) and stays
            // pinned to the source box.
            let effectiveConn = c;
            if (c.parentConnId && c.toAnchor) {
              const parent = chart.connectors.find((p) => p.id === c.parentConnId);
              if (parent) {
                const parentFrom = boxesById.get(parent.fromBoxId);
                const parentTo = boxesById.get(parent.toBoxId);
                if (parentFrom && parentTo) {
                  // Horizontal trunk: parent.elbowY (manifold) or the
                  // shared waypoint Y (PPTX import) or the
                  // auto-computed midpoint between the two boxes.
                  const parentWaypointY = parent.waypoints && parent.waypoints.length > 0
                    && parent.waypoints.every((w) => Math.abs(w.y - parent.waypoints![0].y) < 0.5)
                    ? parent.waypoints[0].y
                    : undefined;
                  const trunkY = parent.elbowY ?? parentWaypointY
                    ?? (parentFrom.y + parentFrom.height + parentTo.y) / 2;
                  // Same for horizontal-trunk-on-vertical-parent (rare,
                  // but covers the symmetric case).
                  const parentWaypointX = parent.waypoints && parent.waypoints.length > 0
                    && parent.waypoints.every((w) => Math.abs(w.x - parent.waypoints![0].x) < 0.5)
                    ? parent.waypoints[0].x
                    : undefined;
                  const trunkX = parent.elbowX ?? parentWaypointX;
                  // Pick the axis whose trunk position we know. If
                  // parent has both elbowX and elbowY (unusual), prefer
                  // elbowY since vertical drops onto a horizontal trunk
                  // are the dominant T-junction shape in this app.
                  const liveToAnchor = trunkY !== undefined
                    ? { x: c.toAnchor.x, y: trunkY }
                    : trunkX !== undefined
                    ? { x: trunkX, y: c.toAnchor.y }
                    : c.toAnchor;
                  effectiveConn = { ...c, toAnchor: liveToAnchor };
                }
              }
            }
            return (
              <ConnectorView
                key={c.id}
                connector={effectiveConn}
                from={from}
                to={to}
                obstacles={obstacles}
                stroke={stroke}
                isSelected={isSel}
                onSelect={(opts) => {
                  if (opts?.shift) {
                    handleConnectorShiftSelect(c.id);
                    return;
                  }
                  // Manifold siblings act as one unit: clicking any
                  // connector that's part of a combined trunk selects
                  // the whole group so they all render selected (blue)
                  // and the midpoint drag updates them together.
                  if (c.manifoldId) {
                    const siblingIds = chart.connectors
                      .filter((x) => x.manifoldId === c.manifoldId)
                      .map((x) => x.id);
                    if (siblingIds.length > 1) {
                      onSelect({ kind: "connectors", ids: siblingIds });
                      return;
                    }
                  }
                  onSelect({ kind: "connector", id: c.id });
                }}
                onUpdate={onUpdateConnector ? (patch) => onUpdateConnector(c.id, patch) : undefined}
                onEndpointDragStart={(end, ev) => startEndpointDrag(c.id, end, ev)}
                onElbowDragStart={(axis, ev, field) => startElbowDrag(c.id, axis, ev, field)}
                linkPickActive={!!linkPickFrom && linkPickFrom !== c.fromBoxId && linkPickFrom !== c.toBoxId}
                onLinkPickClick={onConnectAnchor ? (ev) => {
                  // Convert screen click → world coords using the
                  // scroller rect + viewport transform. The new
                  // connector terminates exactly where the user
                  // clicked on this line.
                  const node = scrollerRef.current;
                  if (!node || !linkPickFrom) return;
                  const rect = node.getBoundingClientRect();
                  const wx = (ev.clientX - rect.left - viewport.x) / viewport.zoom;
                  const wy = (ev.clientY - rect.top - viewport.y) / viewport.zoom;
                  onConnectAnchor(linkPickFrom, c.id, { x: wx, y: wy });
                } : undefined}
                onContextMenu={onConnectorContextMenu ? (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  const node = scrollerRef.current;
                  if (!node) return;
                  const rect = node.getBoundingClientRect();
                  const wx = (ev.clientX - rect.left - viewport.x) / viewport.zoom;
                  const wy = (ev.clientY - rect.top - viewport.y) / viewport.zoom;
                  onConnectorContextMenu(c.id, { x: ev.clientX, y: ev.clientY }, { x: wx, y: wy });
                } : undefined}
                zoom={viewport.zoom}
                autoEditMidLabel={pendingLabelEditId === c.id}
                onAutoEditMidLabelConsumed={onLabelEditConsumed}
                onLabelDragStart={(ev) => startLabelDrag(c.id, ev)}
                isLabelSelected={selection.kind === "connectorLabel" && selection.connectorId === c.id && selection.labelId === "mid"}
                onLabelSelect={(labelId) => onSelect({ kind: "connectorLabel", connectorId: c.id, labelId })}
                selectedLabelId={selection.kind === "connectorLabel" && selection.connectorId === c.id ? selection.labelId : undefined}
              />
            );
          })}
        </svg>

        {/* Rubber-band line shown while dragging from a box's link
            handle. Drawn behind the boxes so it can't intercept the
            drop hit-test, and styled distinctly from real connectors. */}
        {link && (() => {
          const from = chart.boxes.find((b) => b.id === link.fromId);
          if (!from) return null;
          const fcx = from.x + from.width / 2;
          const fcy = from.y + from.height / 2;
          return (
            <svg
              className="absolute pointer-events-none"
              overflow="visible"
              style={{ left: 0, top: 0, width: 1, height: 1, overflow: "visible" }}
            >
              <path
                d={`M ${fcx} ${fcy} L ${link.to.x} ${link.to.y}`}
                stroke="#047857"
                strokeWidth={2}
                strokeDasharray="6 4"
                fill="none"
              />
            </svg>
          );
        })()}

        {chart.boxes.map((b) => {
          const isSingle = selection.kind === "box" && selection.id === b.id;
          const isMulti = (selection.kind === "boxes" && selection.ids.includes(b.id))
            || (selection.kind === "mixed" && selection.boxIds.includes(b.id));
          return (
            <EntityBox
              key={b.id}
              box={b}
              selected={isSingle}
              multiSelected={isMulti}
              warning={(warningsByParent.get(b.id)?.ok === false)}
              isLinkPickTarget={!!linkPickFrom && linkPickFrom !== b.id}
              onSelect={(opts) => {
                // Target-pick mode (after "Connect to existing" from an
                // edge `+` menu): the next box click completes the
                // connection instead of changing selection.
                if (linkPickFrom && linkPickFrom !== b.id) {
                  onConnect(linkPickFrom, b.id);
                  return;
                }
                // Shift-click is fully handled by startBoxDrag on
                // pointerdown (it has to be — pointer capture during a
                // drag would suppress the subsequent click event). If
                // we ran the toggle here too, every shift-click would
                // add then immediately remove the box, making the
                // multi-select bar flicker and disappear.
                if (opts?.shift) return;
                // Plain click on a box already in the multi-selection:
                // pointerdown intentionally preserved the multi (so a
                // group drag works). Don't collapse to single here
                // either — the user can clear with Esc or click empty.
                if (selection.kind === "boxes" && selection.ids.includes(b.id)) return;
                onSelect({ kind: "box", id: b.id });
              }}
              onPointerDownStartDrag={(e) => startBoxDrag(b, e)}
              onEdgePlus={(edge, anchor) => onEdgePlus(b.id, edge, anchor)}
              onStartLink={(e) => startLinkDrag(b.id, e)}
              animating={!!animating}
              isLinkTarget={link?.overId === b.id}
              edgeAction={boxAction?.id === b.id ? boxAction.mode : undefined}
              onContextMenu={onBoxContextMenu ? (anchor) => onBoxContextMenu(b.id, anchor) : undefined}
              onRename={(next) => onRename(b.id, next)}
            />
          );
        })}

        {/* Marquee selection rectangle. Rendered in world coords so it
            tracks pan/zoom. Border styled differently for the two
            modes — solid for window (left-to-right, "fully inside"),
            dashed for crossing (right-to-left, "touches"). Inside-fill
            tinted so it's visible against the dotted grid. */}
        {marquee && (() => {
          const x = Math.min(marquee.startX, marquee.currX);
          const y = Math.min(marquee.startY, marquee.currY);
          const w = Math.abs(marquee.currX - marquee.startX);
          const h = Math.abs(marquee.currY - marquee.startY);
          const crossing = marquee.currX < marquee.startX;
          // Border in screen-pixel units so it stays a hairline at any zoom.
          const border = 1.5 / viewport.zoom;
          return (
            <div
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                left: x,
                top: y,
                width: w,
                height: h,
                background: crossing ? "rgba(16,185,129,0.08)" : "rgba(4,120,87,0.08)",
                border: `${border}px ${crossing ? "dashed" : "solid"} ${crossing ? "#10b981" : "#047857"}`,
                zIndex: 26,
              }}
            />
          );
        })()}

        {/* Snap-alignment guides — drawn while a resize drag is in
            flight and the moving edge has snapped to another box's
            edge or center. Lines extend across the bounding box of all
            boxes (plus generous padding) so they're visible even when
            the snap target is far from the box being resized. */}
        {snapGuides && chart.boxes.length > 0 && (() => {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const b of chart.boxes) {
            if (b.x < minX) minX = b.x;
            if (b.y < minY) minY = b.y;
            if (b.x + b.width > maxX) maxX = b.x + b.width;
            if (b.y + b.height > maxY) maxY = b.y + b.height;
          }
          const pad = 200;
          const x0 = minX - pad, x1 = maxX + pad;
          const y0 = minY - pad, y1 = maxY + pad;
          const stroke = "#10b981";
          const sw = 1 / viewport.zoom; // 1 screen pixel
          return (
            <svg
              className="absolute pointer-events-none"
              overflow="visible"
              style={{ left: 0, top: 0, width: 1, height: 1, overflow: "visible", zIndex: 25 }}
            >
              {snapGuides.vert.map((x, i) => (
                <line key={"v" + i} x1={x} x2={x} y1={y0} y2={y1} stroke={stroke} strokeWidth={sw} strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`} />
              ))}
              {snapGuides.horiz.map((y, i) => (
                <line key={"h" + i} x1={x0} x2={x1} y1={y} y2={y} stroke={stroke} strokeWidth={sw} strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`} />
              ))}
            </svg>
          );
        })()}

        {/* Resize handle overlay — rendered for the box currently in
            resize mode. Sits in the same world-coord layer as the
            boxes so it tracks pan + zoom without extra math. Handles
            are sized in screen pixels by dividing by the zoom factor,
            so the affordance stays clickable at any zoom level. */}
        {resizingBoxId && (() => {
          const b = chart.boxes.find((x) => x.id === resizingBoxId);
          if (!b) return null;
          const handles: { h: ResizeHandle; cx: number; cy: number; cursor: string }[] = [
            { h: "nw", cx: b.x,                cy: b.y,                 cursor: "nwse-resize" },
            { h: "n",  cx: b.x + b.width / 2,  cy: b.y,                 cursor: "ns-resize"   },
            { h: "ne", cx: b.x + b.width,      cy: b.y,                 cursor: "nesw-resize" },
            { h: "e",  cx: b.x + b.width,      cy: b.y + b.height / 2,  cursor: "ew-resize"   },
            { h: "se", cx: b.x + b.width,      cy: b.y + b.height,      cursor: "nwse-resize" },
            { h: "s",  cx: b.x + b.width / 2,  cy: b.y + b.height,      cursor: "ns-resize"   },
            { h: "sw", cx: b.x,                cy: b.y + b.height,      cursor: "nesw-resize" },
            { h: "w",  cx: b.x,                cy: b.y + b.height / 2,  cursor: "ew-resize"   },
          ];
          // 10px handles at 100% zoom — divided by zoom so they don't
          // shrink to invisibility when the user zooms out.
          const sizeWorld = 10 / viewport.zoom;
          return (
            <>
              {/* Highlight outline for the resizing box. */}
              <div
                className="absolute pointer-events-none border-2 border-gencom-green rounded"
                style={{
                  left: b.x - 2,
                  top: b.y - 2,
                  width: b.width + 4,
                  height: b.height + 4,
                }}
              />
              {handles.map((hh) => (
                <div
                  key={hh.h}
                  onPointerDown={(e) => startResizeDrag(b.id, hh.h, e)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bg-white border-2 border-gencom-green rounded-sm shadow"
                  style={{
                    left: hh.cx - sizeWorld / 2,
                    top: hh.cy - sizeWorld / 2,
                    width: sizeWorld,
                    height: sizeWorld,
                    cursor: hh.cursor,
                    touchAction: "none",
                    zIndex: 30,
                  }}
                />
              ))}
            </>
          );
        })()}

        {/* Group bounding box + handles — visible when 2+ boxes are
            multi-selected. Dragging a handle scales every selected box
            (position + size + font) proportionally so the user can
            shrink or grow the whole arrangement at once. */}
        {selection.kind === "boxes" && selection.ids.length >= 2 && multiActions && !resizingBoxId && (() => {
          const sel = chart.boxes.filter((bb) => selection.ids.includes(bb.id));
          if (sel.length < 2) return null;
          const minX = Math.min(...sel.map((bb) => bb.x));
          const minY = Math.min(...sel.map((bb) => bb.y));
          const maxX = Math.max(...sel.map((bb) => bb.x + bb.width));
          const maxY = Math.max(...sel.map((bb) => bb.y + bb.height));
          const w = maxX - minX;
          const h = maxY - minY;
          const handles: { h: ResizeHandle; cx: number; cy: number; cursor: string }[] = [
            { h: "nw", cx: minX,         cy: minY,         cursor: "nwse-resize" },
            { h: "n",  cx: minX + w / 2, cy: minY,         cursor: "ns-resize"   },
            { h: "ne", cx: maxX,         cy: minY,         cursor: "nesw-resize" },
            { h: "e",  cx: maxX,         cy: minY + h / 2, cursor: "ew-resize"   },
            { h: "se", cx: maxX,         cy: maxY,         cursor: "nwse-resize" },
            { h: "s",  cx: minX + w / 2, cy: maxY,         cursor: "ns-resize"   },
            { h: "sw", cx: minX,         cy: maxY,         cursor: "nesw-resize" },
            { h: "w",  cx: minX,         cy: minY + h / 2, cursor: "ew-resize"   },
          ];
          const sizeWorld = 10 / viewport.zoom;
          const borderW = 1.5 / viewport.zoom;
          return (
            <>
              <div
                className="absolute pointer-events-none"
                style={{
                  left: minX, top: minY, width: w, height: h,
                  border: `${borderW}px dashed #047857`,
                  zIndex: 25,
                }}
              />
              {handles.map((hh) => (
                <div
                  key={"grp-" + hh.h}
                  onPointerDown={(e) => startGroupResizeDrag(hh.h, e)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bg-white border-2 border-gencom-green rounded-sm shadow"
                  style={{
                    left: hh.cx - sizeWorld / 2,
                    top: hh.cy - sizeWorld / 2,
                    width: sizeWorld,
                    height: sizeWorld,
                    cursor: hh.cursor,
                    touchAction: "none",
                    zIndex: 30,
                  }}
                />
              ))}
            </>
          );
        })()}
      </div>

      {/* Floating action bar for multi-selections. Anchored to the
          MOST RECENTLY clicked box (last id in selection.ids) so the
          bar pops up right next to the user's cursor instead of above
          the topmost box, which made it feel like a long trek. Falls
          back to the topmost box if the last id can't be resolved. */}
      {selection.kind === "boxes" && multiActions && (() => {
        const selected = chart.boxes.filter((b) => selection.ids.includes(b.id));
        if (selected.length === 0) return null;
        const lastId = selection.ids[selection.ids.length - 1];
        const anchorBox =
          chart.boxes.find((b) => b.id === lastId) ??
          selected.reduce((a, b) => (a.y < b.y ? a : b));
        // Bar sits just above the anchor box's top edge — close enough
        // that the cursor doesn't have to traverse empty canvas to
        // reach it after a shift-click.
        const anchorCx = anchorBox.x + anchorBox.width / 2;
        const screenX = anchorCx * viewport.zoom + viewport.x;
        const screenY = anchorBox.y * viewport.zoom + viewport.y - 6;
        return (
          <div
            className="absolute z-40 -translate-x-1/2 -translate-y-full"
            style={{ left: screenX, top: screenY }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1 bg-white rounded-md border border-gencom-green shadow-lg p-1">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); multiActions.onConnect(); }}
                className="text-xs font-semibold text-white bg-gencom-green hover:bg-gencom-greendark rounded px-2.5 py-1.5 inline-flex items-center gap-1"
                title="Chain selected boxes — first becomes parent of the rest"
              >
                Connect
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); multiActions.onBuildHierarchy(); }}
                className="text-xs font-semibold text-gencom-green hover:bg-gencom-greensoft rounded px-2.5 py-1.5"
                title="Snap selected boxes to a clean grid; infer parent/child by row"
              >
                Build hierarchy
              </button>

              {/* Align / distribute — Illustrator-style. Three groups
                  separated by hairline rules: align X, align Y,
                  distribute. Distribute requires 3+ selected; the
                  parent guards that. */}
              <span className="self-stretch w-px bg-gencom-sand mx-1" aria-hidden />
              <AlignButton onClick={() => multiActions.onAlign("align-left")}     title="Align left edges"      icon={<AlignStartVertical className="h-3.5 w-3.5" />} />
              <AlignButton onClick={() => multiActions.onAlign("align-center-x")} title="Align horizontal centers" icon={<AlignCenterVertical className="h-3.5 w-3.5" />} />
              <AlignButton onClick={() => multiActions.onAlign("align-right")}    title="Align right edges"     icon={<AlignEndVertical className="h-3.5 w-3.5" />} />
              <span className="self-stretch w-px bg-gencom-sand mx-1" aria-hidden />
              <AlignButton onClick={() => multiActions.onAlign("align-top")}      title="Align top edges"       icon={<AlignStartHorizontal className="h-3.5 w-3.5" />} />
              <AlignButton onClick={() => multiActions.onAlign("align-center-y")} title="Align vertical centers"  icon={<AlignCenterHorizontal className="h-3.5 w-3.5" />} />
              <AlignButton onClick={() => multiActions.onAlign("align-bottom")}   title="Align bottom edges"    icon={<AlignEndHorizontal className="h-3.5 w-3.5" />} />
              <span className="self-stretch w-px bg-gencom-sand mx-1" aria-hidden />
              <AlignButton
                onClick={() => multiActions.onAlign("distribute-h")}
                title="Distribute horizontally — equal gaps along the X axis (3+ boxes)"
                icon={<AlignHorizontalDistributeCenter className="h-3.5 w-3.5" />}
                disabled={selection.kind === "boxes" && selection.ids.length < 3}
              />
              <AlignButton
                onClick={() => multiActions.onAlign("distribute-v")}
                title="Distribute vertically — equal gaps along the Y axis (3+ boxes)"
                icon={<AlignVerticalDistributeCenter className="h-3.5 w-3.5" />}
                disabled={selection.kind === "boxes" && selection.ids.length < 3}
              />
              <AlignButton
                onClick={() => multiActions.onAlign("space-equal")}
                title="Space evenly — uniform gap on both axes so boxes can't overlap"
                icon={<Grid2x2 className="h-3.5 w-3.5" />}
              />

              {/* Match-size — three dropdowns (width / height / both).
                  Each prompts the user to pick "largest" or "smallest"
                  rather than silently picking one. */}
              <span className="self-stretch w-px bg-gencom-sand mx-1" aria-hidden />
              <MatchSizeDropdown
                dim="width"
                icon={<MoveHorizontal className="h-3.5 w-3.5" />}
                label="W"
                onPick={(target) => multiActions.onMatchSize("width", target)}
              />
              <MatchSizeDropdown
                dim="height"
                icon={<MoveVertical className="h-3.5 w-3.5" />}
                label="H"
                onPick={(target) => multiActions.onMatchSize("height", target)}
              />
              <MatchSizeDropdown
                dim="both"
                label="Match size"
                onPick={(target) => multiActions.onMatchSize("both", target)}
              />

              <span className="self-stretch w-px bg-gencom-sand mx-1" aria-hidden />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); multiActions.onGroup(); }}
                title="Group — selected boxes move/resize/align as a unit (Ctrl+G)"
                className="text-[10px] font-semibold text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green rounded px-2 h-7"
              >
                Group
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); multiActions.onUngroup(); }}
                title="Ungroup — break the group so boxes act independently again (Ctrl+Shift+G)"
                className="text-[10px] font-semibold text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green rounded px-2 h-7"
              >
                Ungroup
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); multiActions.onFitToPage(); }}
                disabled={!multiActions.hasPaperSize}
                title={multiActions.hasPaperSize
                  ? "Fit selection to the chart's paper rectangle (scales boxes + font sizes proportionally)"
                  : "Pick a Paper size in the toolbar first"}
                className={
                  "text-[10px] font-semibold rounded px-2 h-7 " +
                  (multiActions.hasPaperSize
                    ? "text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green"
                    : "text-gencom-sand cursor-not-allowed")
                }
              >
                Fit&nbsp;to&nbsp;page
              </button>

              <span className="self-stretch w-px bg-gencom-sand mx-1" aria-hidden />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); multiActions.onCancel(); }}
                className="text-xs text-gencom-stone hover:bg-gencom-mist rounded px-2 py-1.5"
                title="Clear selection"
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
});

function ConnectorView({
  connector,
  from,
  to,
  obstacles,
  stroke,
  isSelected,
  onSelect,
  onUpdate,
  onEndpointDragStart,
  onElbowDragStart,
  linkPickActive,
  onLinkPickClick,
  onContextMenu,
  zoom,
  autoEditMidLabel,
  onAutoEditMidLabelConsumed,
  onLabelDragStart,
  isLabelSelected,
  onLabelSelect,
  selectedLabelId,
}: {
  connector: Connector;
  from: Box;
  to: Box;
  obstacles: Box[];
  stroke: string;
  isSelected: boolean;
  onSelect: (opts?: { shift?: boolean }) => void;
  /** Inline connector mutation. Used for hover-add-label and
   *  in-place editing / deletion of mid + end labels. */
  onUpdate?: (patch: Partial<Connector>) => void;
  /** Start a drag on the from/to endpoint handle. The Canvas owns the
   *  pointer-move logic; this callback just registers the drag intent. */
  onEndpointDragStart?: (end: "from" | "to", e: React.PointerEvent<Element>) => void;
  /** Start a drag on the middle elbow segment of a Z-shape orthogonal
   *  connector. axis is the perpendicular world axis the segment slides
   *  along: "y" for a horizontal middle segment, "x" for a vertical one. */
  onElbowDragStart?: (axis: "x" | "y", e: React.PointerEvent<Element>, field?: "step1" | "step2") => void;
  /** True while the user is in target-pick mode (after right-click →
   *  Connect on a box) and this connector is a valid drop target. The
   *  hit-area path swallows the click and forwards it via
   *  `onLinkPickClick` so the canvas can drop a T-junction at the
   *  click point on this line. */
  linkPickActive?: boolean;
  /** Click on the hit-area path while `linkPickActive`. The Canvas
   *  uses this to convert the screen-space click into a world-coord
   *  anchor point and create a new connector ending there. */
  onLinkPickClick?: (e: React.PointerEvent<Element>) => void;
  /** Right-click on the connector. Receives the React event so the
   *  canvas can compute both screen + world coords for menu placement
   *  and the eventual drop point on the line. */
  onContextMenu?: (e: React.MouseEvent<Element>) => void;
  /** Current canvas zoom — handles / buttons divide by zoom so they
   *  stay a constant screen size at any magnification. */
  zoom: number;
  /** When true, mount the midpoint-label inline editor as soon as
   *  this connector renders. Used by the "Add text" right-click flow
   *  so the user starts typing immediately. The parent clears its
   *  trigger once `onAutoEditMidLabelConsumed` fires. */
  autoEditMidLabel?: boolean;
  onAutoEditMidLabelConsumed?: () => void;
  /** Pointer-down on the label chip — the Canvas takes over to drag
   *  the label freely (labelMode === "free") or slide it along the
   *  path (labelMode === "on-connector"). */
  onLabelDragStart?: (e: React.PointerEvent<Element>) => void;
  /** True when the user has selected the label specifically (not the
   *  parent connector). Drives the highlight on the label chip and
   *  is independent of `isSelected` so clicking the line vs the
   *  text picks one or the other. */
  isLabelSelected?: boolean;
  /** Click-on-label selection — fires with the label id ("mid" for
   *  labelMid, or one of the entries in `connector.labels`). The
   *  Canvas wires this to setSelection({ kind: "connectorLabel" }).
   *  Falls back to plain `onSelect` when unwired so legacy callers
   *  still work. */
  onLabelSelect?: (labelId: string) => void;
  /** When set, the connector renders the matching label as
   *  highlighted. "mid" is the labelMid; otherwise it's one of the
   *  ids in connector.labels[]. */
  selectedLabelId?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState<null | "mid" | "end">(null);
  // Consume the auto-edit request: enter edit mode on the very next
  // commit and notify the parent so it doesn't re-trigger.
  useEffect(() => {
    if (autoEditMidLabel) {
      setEditing("mid");
      onAutoEditMidLabelConsumed?.();
    }
  }, [autoEditMidLabel, onAutoEditMidLabelConsumed]);
  const d = connectorPath(
    from, to, connector.routeStyle,
    {
      fromSide: connector.fromSide,
      toSide: connector.toSide,
      fromOffset: connector.fromOffset,
      toOffset: connector.toOffset,
      elbowX: connector.elbowX,
      elbowY: connector.elbowY,
      step1: connector.step1,
      step2: connector.step2,
      toAnchor: connector.toAnchor,
    },
    obstacles,
    connector.routeDetail ?? "min",
    connector.waypoints ?? [],
  );
  const markerUrl = connector.showArrowhead
    ? `url(#${isSelected ? "orgchart-arrow-selected" : "orgchart-arrow"})`
    : undefined;
  // The marker definition uses orient="auto-start-reverse" so the same
  // glyph works at either end of the path. Flip which marker prop
  // receives it based on the connector's `arrowheadAt`.
  const arrowAt = connector.arrowheadAt ?? "end";
  const markerEnd = arrowAt === "end" ? markerUrl : undefined;
  const markerStart = arrowAt === "start" ? markerUrl : undefined;
  void endTangent;
  void arrowAnchor;
  // Two label slots: midpoint and endpoint. The visual midpoint of an
  // orthogonal connector lives on the elbow, NOT halfway between box
  // centers — so we measure the rendered path with `getPointAtLength`
  // after layout and use those true positions. Initial render falls
  // back to a center-line approximation so the affordances are at
  // least roughly placed before the layout effect runs.
  const labelMid = (connector.labelMid ?? connector.label ?? "").replace(/\s+$/, "");
  const labelEnd = (connector.labelEnd ?? "").trim();
  const fcx = from.x + from.width / 2;
  const fcy = from.y + from.height / 2;
  const tcx = to.x + to.width / 2;
  const tcy = to.y + to.height / 2;
  const fontSizePt = connector.labelFontSizePt ?? 11;
  // Width of the chip is sized to fit the LONGEST line as tightly
  // as possible: 0.55em per char (close to Inter's average glyph
  // width) plus 6px total horizontal padding. The 16px floor keeps
  // a single-character or empty label from collapsing to nothing.
  const fontPx = fontSizePt * (96 / 72);
  function labelWidth(s: string): number {
    const longest = s.split("\n").reduce((m, line) => Math.max(m, line.length), 0);
    return Math.max(16, longest * (fontPx * 0.55) + 6);
  }

  // The "horizontal-ness" of a connector is decided by the relative
  // arrangement of source/target boxes, NOT by which segment the path
  // midpoint lands on — orthogonal connectors with elbows would
  // otherwise put the midpoint on a vertical bend even when the boxes
  // are arranged left-to-right. Horizontal connectors place the label
  // below the line; vertical connectors center on the line.
  const midHorizontal = Math.abs(tcx - fcx) >= Math.abs(tcy - fcy);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [pathPoints, setPathPoints] = useState<{ midX: number; midY: number; endX: number; endY: number }>({
    midX: (fcx + tcx) / 2,
    midY: (fcy + tcy) / 2,
    endX: fcx + (tcx - fcx) * 0.85,
    endY: fcy + (tcy - fcy) * 0.85,
  });
  // Re-measure the path whenever its `d` changes — covers initial
  // mount, route-style changes, side overrides, and any time a box
  // moves (which re-routes through the same useEffect path).
  useLayoutEffect(() => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const len = p.getTotalLength();
      if (!Number.isFinite(len) || len <= 0) return;
      const mid = p.getPointAtLength(len / 2);
      // End label sits near the arrow target — pull back from the
      // very tip so it doesn't sit underneath the arrowhead.
      const end = p.getPointAtLength(Math.max(0, len - 28));
      setPathPoints({ midX: mid.x, midY: mid.y, endX: end.x, endY: end.y });
    } catch { /* ignore — non-SVG path browsers shouldn't reach this */ }
  }, [d]);
  const { endX, endY } = pathPoints;
  // Offset puts the chip's top edge a few px below the stroke at the
  // midpoint (chip half-height + small gap). Suppressed when the
  // user has switched to "free" placement — they're moving the
  // label themselves, no auto-offset.
  const labelMode = connector.labelMode ?? "on-connector";
  const baseMidLabelOffset = midHorizontal && labelMode === "on-connector" ? fontPx + 8 : 0;
  // Free mode: pathMidpoint + user-provided labelOffset. The path
  // midpoint still tracks the line so the user can switch back to
  // "on-connector" without losing the natural origin.
  const offX = (connector.labelOffset?.x ?? 0);
  const offY = (connector.labelOffset?.y ?? 0);
  const midX = pathPoints.midX + (labelMode === "free" ? offX : 0);
  const midY = pathPoints.midY + baseMidLabelOffset + (labelMode === "free" ? offY : 0);
  return (
    <g
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {/* Hit-area (wide, transparent) makes selection forgiving.
          Adding / removing labels happens in the right-hand property
          panel — no inline canvas affordance for empty connectors.
          When the user is in connect-target mode (linkPickActive),
          this path becomes a drop target so they can attach a new
          connector to a point ON this line (T-junction). */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: "stroke", cursor: linkPickActive ? "crosshair" : "pointer" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (linkPickActive && onLinkPickClick) {
            onLinkPickClick(e);
            return;
          }
          onSelect({ shift: e.shiftKey });
        }}
        onContextMenu={onContextMenu}
      />
      <path
        ref={pathRef}
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={isSelected ? 2 : 1.5}
        markerEnd={markerEnd}
        markerStart={markerStart}
      />
      {/* T-junctions render as a clean line meeting another line — no
          dot, circle, or arrowhead at the join. The connector's
          `toAnchor` defines the geometric endpoint; the visual
          terminus is just the path's last vertex. */}

      {/* Mid label slot — render in priority order: editor > existing
          label (with hover delete) > "+" add button when hovered or
          selected. The "+" stays visible while selected so the user
          can find it without having to hover the thin line. */}
      {editing === "mid" ? (
        <ConnectorInlineEditor
          x={midX}
          y={midY}
          initial={labelMid}
          zoom={zoom}
          fontPx={fontPx}
          onCommit={(v) => { onUpdate?.({ labelMid: v, label: undefined }); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      ) : labelMid ? (
        <ConnectorLabel
          text={labelMid}
          x={midX}
          y={midY}
          w={labelWidth(labelMid)}
          fontPx={fontPx}
          stroke={stroke}
          // The label highlights when it OR its parent connector is
          // selected, but clicking the chip selects the label only —
          // so the user can edit text/color/font without changing
          // the line. Click on the line itself still selects the
          // connector via the wide hit-test path.
          isSelected={isSelected || isLabelSelected}
          onSelect={onLabelSelect ? () => onLabelSelect("mid") : onSelect}
          onEdit={onUpdate ? () => setEditing("mid") : undefined}
          onDelete={onUpdate ? () => onUpdate({ labelMid: "", label: undefined }) : undefined}
          showHover={hovered}
          zoom={zoom}
          color={connector.labelColor}
          align={connector.labelAlign ?? "center"}
          onLabelDragStart={onLabelDragStart ? (e) => onLabelDragStart(e) : undefined}
        />
      ) : null}

      {/* Extra labels — every entry in connector.labels[] renders its
          own chip. Free-mode labels live at world coords (label.offset
          stored as absolute world position when added via right-click).
          Each chip is independently selectable / draggable / editable.
          On-connector mode would project pathT against the SVG path,
          but the right-click "Add text" flow seeds new entries as
          mode="free" with absolute coords so the label sits exactly
          where the user clicked. */}
      {(connector.labels ?? []).map((lbl) => {
        const lblFontPx = (lbl.fontSizePt ?? fontSizePt) * (96 / 72);
        const lblText = lbl.text || "";
        const lblW = (() => {
          const longest = lblText.split("\n").reduce((m, line) => Math.max(m, line.length), 0);
          return Math.max(16, longest * (lblFontPx * 0.55) + 6);
        })();
        const lblX = lbl.mode === "on-connector"
          ? pathPoints.midX + (lbl.offset?.x ?? 0)
          : (lbl.offset?.x ?? pathPoints.midX);
        const lblY = lbl.mode === "on-connector"
          ? pathPoints.midY + (lbl.offset?.y ?? 0)
          : (lbl.offset?.y ?? pathPoints.midY);
        const isThisLabelSelected = selectedLabelId === lbl.id;
        return (
          <ConnectorLabel
            key={lbl.id}
            text={lblText}
            x={lblX}
            y={lblY}
            w={lblW}
            fontPx={lblFontPx}
            stroke={stroke}
            isSelected={isThisLabelSelected}
            isLabelSelected={isThisLabelSelected}
            onSelect={onLabelSelect ? () => onLabelSelect(lbl.id) : onSelect}
            onLabelSelect={onLabelSelect ? () => onLabelSelect(lbl.id) : undefined}
            onEdit={onUpdate ? () => {
              const next = prompt("Edit label text", lbl.text) ?? lbl.text;
              const updated = (connector.labels ?? []).map((x) => x.id === lbl.id ? { ...x, text: next } : x);
              onUpdate({ labels: updated });
            } : undefined}
            onDelete={onUpdate ? () => {
              const remaining = (connector.labels ?? []).filter((x) => x.id !== lbl.id);
              onUpdate({ labels: remaining });
            } : undefined}
            showHover={hovered}
            zoom={zoom}
            color={lbl.color ?? connector.labelColor}
            align={lbl.align ?? connector.labelAlign ?? "center"}
            onLabelDragStart={onUpdate ? (e) => {
              e.stopPropagation();
              e.preventDefault();
              const startClientX = e.clientX;
              const startClientY = e.clientY;
              const startOffX = lbl.offset?.x ?? pathPoints.midX;
              const startOffY = lbl.offset?.y ?? pathPoints.midY;
              const onMove = (mv: PointerEvent) => {
                const dx = (mv.clientX - startClientX) / zoom;
                const dy = (mv.clientY - startClientY) / zoom;
                const updated = (connector.labels ?? []).map((x) => x.id === lbl.id ? { ...x, mode: "free" as const, offset: { x: startOffX + dx, y: startOffY + dy } } : x);
                onUpdate({ labels: updated });
              };
              const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            } : undefined}
          />
        );
      })}

      {/* Endpoint label remains supported in the data model + property
          panel for backwards compatibility, but the canvas no longer
          surfaces a "+" affordance for it — labels live at midpoint per
          the simplified UX. */}
      {labelEnd && (
        <ConnectorLabel
          text={labelEnd}
          x={endX}
          y={endY}
          w={labelWidth(labelEnd)}
          fontPx={fontPx}
          stroke={stroke}
          isSelected={isSelected}
          onSelect={onSelect}
          onEdit={onUpdate ? () => setEditing("end") : undefined}
          onDelete={onUpdate ? () => onUpdate({ labelEnd: "" }) : undefined}
          showHover={hovered}
          zoom={zoom}
        />
      )}
      {editing === "end" && (
        <ConnectorInlineEditor
          x={endX}
          y={endY}
          initial={labelEnd}
          zoom={zoom}
          fontPx={fontPx}
          onCommit={(v) => { onUpdate?.({ labelEnd: v }); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Endpoint drag handles — shown whenever the connector is
          selected so the user can slide either end along its box edge
          (or for T-junctions, slide the target along the parent
          line). Each box-anchored handle is pushed slightly OUTSIDE
          the box along the side's outward normal so it sits clear of
          the box body. T-junction target handles render AT the
          toAnchor's stored position; dragging updates `toAnchor` and
          the render-time parentConnId re-snap projects it back onto
          the parent's trunk. `pointerEvents: auto` is required
          because the parent SVG layer has pointer-events: none. */}
      {isSelected && onEndpointDragStart && !connector.locked && (() => {
        const { fromEdge, toEdge } = resolveSides(
          { fromSide: connector.fromSide, toSide: connector.toSide, routeDetail: connector.routeDetail },
          from, to, obstacles,
        );
        const fromPt = connectorEndpoint(from, fromEdge, connector.fromOffset);
        const toPt = connector.toAnchor ?? connectorEndpoint(to, toEdge, connector.toOffset);
        const r = 7 / zoom;
        const sw = 2 / zoom;
        const out = 12 / zoom;
        function offsetByEdge(side: "top" | "right" | "bottom" | "left"): { dx: number; dy: number } {
          switch (side) {
            case "top":    return { dx: 0,    dy: -out };
            case "bottom": return { dx: 0,    dy:  out };
            case "left":   return { dx: -out, dy: 0    };
            case "right":  return { dx:  out, dy: 0    };
          }
        }
        const fromOff = offsetByEdge(fromEdge);
        const toOff = connector.toAnchor ? { dx: 0, dy: 0 } : offsetByEdge(toEdge);
        return (
          <>
            <circle
              cx={fromPt.x + fromOff.dx} cy={fromPt.y + fromOff.dy} r={r}
              fill="#ffffff" stroke="#047857" strokeWidth={sw}
              style={{ cursor: "move", pointerEvents: "auto" }}
              onPointerDown={(e) => onEndpointDragStart("from", e)}
            />
            <circle
              cx={toPt.x + toOff.dx} cy={toPt.y + toOff.dy} r={r}
              fill="#ffffff" stroke="#047857" strokeWidth={sw}
              style={{ cursor: "move", pointerEvents: "auto" }}
              onPointerDown={(e) => onEndpointDragStart("to", e)}
            />
          </>
        );
      })()}

      {/* Midpoint drag handle — lets the user slide the line as a
          unit. Renders for two connector shapes:
            - Z-shape orthogonal (parallel sides, "min" detail): drag
              the middle bend axis up/down (or left/right) to route
              around an obstructing box.
            - Drop-line (straight + toAnchor): drag the whole vertical
              (or horizontal) line perpendicular to its direction; the
              handler updates `toAnchor` and `fromOffset` together so
              the line stays straight at the new position. */}
      {isSelected && onElbowDragStart && !connector.locked && (() => {
        const { fromEdge, toEdge } = resolveSides(
          { fromSide: connector.fromSide, toSide: connector.toSide, routeDetail: connector.routeDetail },
          from, to, obstacles,
        );
        const aPt = connectorEndpoint(from, fromEdge, connector.fromOffset);
        // When the connector terminates at a T-junction anchor (drop-
        // line onto another connector), handle math has to use the
        // anchor as the effective endpoint — using the to-box edge
        // instead places the handle floating in space wherever the
        // to-box happens to be, off the line entirely.
        const bPt = connector.toAnchor ?? connectorEndpoint(to, toEdge, connector.toOffset);
        // Each entry produces one bar adjuster on a segment.
        //   kind="elbow"    → drag updates elbowX/elbowY (interior bends).
        //   kind="endpoint" → drag slides the touched box endpoint along
        //                     its edge (stub segments). T-junction
        //                     targets (toAnchor connectors) skip the
        //                     "to" stub handle since the target end is
        //                     pinned to the parent line, not a box edge.
        type SegHandle =
          | { kind: "elbow"; cx: number; cy: number; axis: "x" | "y"; field?: "step1" | "step2" }
          | { kind: "endpoint"; cx: number; cy: number; axis: "x" | "y"; end: "from" | "to" };
        const handles: SegHandle[] = [];
        // Manifold connectors share a trunk with siblings — when many
        // are selected at once, emitting source-stub + cross + target-
        // stub pills per connector floods the screen with overlapping
        // and stub-only handles that don't sit on the visible trunk
        // (they sit on the per-connector vertical drops below the
        // trunk). Collapse to JUST the cross pill so the only handle
        // shown sits on the trunk itself; the manifold drag handler
        // already propagates the elbow change to every sibling.
        // Endpoint circles still render at each box for sliding
        // along edges.
        const inManifold = !!connector.manifoldId;
        const allowToStub = !connector.toAnchor && onEndpointDragStart && !inManifold;
        const allowFromStub = onEndpointDragStart && !inManifold;

        if (connector.toAnchor && connector.routeStyle === "straight") {
          // Straight drop-line: single midpoint bar that slides the
          // whole line perpendicular to its direction (the elbow drag
          // handler treats this as a slide instead of an elbow shift).
          const fromIsV = fromEdge === "top" || fromEdge === "bottom";
          handles.push({
            kind: "elbow",
            cx: (aPt.x + bPt.x) / 2,
            cy: (aPt.y + bPt.y) / 2,
            axis: fromIsV ? "x" : "y",
          });
        } else if (connector.routeStyle === "orthogonal") {
          const fromIsH = fromEdge === "left" || fromEdge === "right";
          const toIsH = toEdge === "left" || toEdge === "right";
          const isExtra = (connector.routeDetail ?? "min") === "extra";
          if (fromIsH === toIsH) {
            // Parallel sides — shape depends on routeDetail:
            //   min (Z-shape): 3 segments, cross is perpendicular to
            //                  the source edge.
            //   extra (5-seg): cross flips to PARALLEL to the source
            //                  edge (the router pushes the trunk
            //                  outward via stepX1/stepX2 jogs).
            // Each variant places handles on every visible segment:
            // source stub, the cross, and target stub.
            if (isExtra) {
              if (fromIsH) {
                // Path: a → (stepX1,a.y) → (stepX1,midY) → (stepX2,midY) → (stepX2,b.y) → b.
                // 5 segments. Pills on every one — source-stub
                // (endpoint drag), source-jog at stepX1 (step1), cross
                // at midY (elbow), target-jog at stepX2 (step2),
                // target-stub (endpoint drag).
                const stepX1 = connector.step1 ?? (aPt.x + Math.sign(bPt.x - aPt.x || 1) * 32);
                const stepX2 = connector.step2 ?? (bPt.x - Math.sign(bPt.x - aPt.x || 1) * 32);
                const midY = connector.elbowY ?? (aPt.y + bPt.y) / 2;
                if (allowFromStub) handles.push({ kind: "endpoint", end: "from", cx: (aPt.x + stepX1) / 2, cy: aPt.y, axis: "y" });
                handles.push({ kind: "elbow", cx: stepX1, cy: (aPt.y + midY) / 2, axis: "x", field: "step1" });
                handles.push({ kind: "elbow", cx: (stepX1 + stepX2) / 2, cy: midY, axis: "y" });
                handles.push({ kind: "elbow", cx: stepX2, cy: (midY + bPt.y) / 2, axis: "x", field: "step2" });
                if (allowToStub) handles.push({ kind: "endpoint", end: "to", cx: (stepX2 + bPt.x) / 2, cy: bPt.y, axis: "y" });
              } else {
                // Path: a → (a.x,stepY1) → (midX,stepY1) → (midX,stepY2) → (b.x,stepY2) → b.
                // 5 segments. Pills on every one — source-stub, source-
                // jog at stepY1 (step1), cross at midX (elbow.x),
                // target-jog at stepY2 (step2), target-stub.
                const stepY1 = connector.step1 ?? (aPt.y + Math.sign(bPt.y - aPt.y || 1) * 32);
                const stepY2 = connector.step2 ?? (bPt.y - Math.sign(bPt.y - aPt.y || 1) * 32);
                const midX = connector.elbowX ?? (aPt.x + bPt.x) / 2;
                if (allowFromStub) handles.push({ kind: "endpoint", end: "from", cx: aPt.x, cy: (aPt.y + stepY1) / 2, axis: "x" });
                handles.push({ kind: "elbow", cx: (aPt.x + midX) / 2, cy: stepY1, axis: "y", field: "step1" });
                handles.push({ kind: "elbow", cx: midX, cy: (stepY1 + stepY2) / 2, axis: "x" });
                handles.push({ kind: "elbow", cx: (midX + bPt.x) / 2, cy: stepY2, axis: "y", field: "step2" });
                if (allowToStub) handles.push({ kind: "endpoint", end: "to", cx: bPt.x, cy: (stepY2 + bPt.y) / 2, axis: "x" });
              }
            } else if (fromIsH) {
              const midX = connector.elbowX ?? (aPt.x + bPt.x) / 2;
              // Source stub: horizontal from aPt to (midX, aPt.y).
              // Perpendicular drag = vertical = axis "y" → updates
              // fromOffset on the source's left/right edge.
              if (allowFromStub) handles.push({ kind: "endpoint", end: "from", cx: (aPt.x + midX) / 2, cy: aPt.y, axis: "y" });
              // Cross-segment elbow.
              handles.push({ kind: "elbow", cx: midX, cy: (aPt.y + bPt.y) / 2, axis: "x" });
              // Target stub: horizontal from (midX, bPt.y) to bPt.
              if (allowToStub) handles.push({ kind: "endpoint", end: "to", cx: (midX + bPt.x) / 2, cy: bPt.y, axis: "y" });
            } else {
              const midY = connector.elbowY ?? (aPt.y + bPt.y) / 2;
              // Source stub: vertical from aPt to (aPt.x, midY).
              // Perpendicular drag = horizontal = axis "x" → updates
              // fromOffset on the source's top/bottom edge.
              if (allowFromStub) handles.push({ kind: "endpoint", end: "from", cx: aPt.x, cy: (aPt.y + midY) / 2, axis: "x" });
              handles.push({ kind: "elbow", cx: (aPt.x + bPt.x) / 2, cy: midY, axis: "y" });
              if (allowToStub) handles.push({ kind: "endpoint", end: "to", cx: bPt.x, cy: (midY + bPt.y) / 2, axis: "x" });
            }
          } else if (!isExtra) {
            // Perpendicular sides + min → L-shape (or 2-bend Z when
            // overridden). Two stub segments meet at the corner. The
            // source-side gets an elbow handle (drag promotes L→Z via
            // the elbow override); the target side gets an endpoint
            // handle that slides the target along its edge. We skip
            // an endpoint pill on the source stub because it would
            // sit at the same midpoint as the elbow pill — the user
            // can use the source endpoint circle to slide the source.
            if (fromIsH) {
              const cornerX = connector.elbowX ?? bPt.x;
              handles.push({ kind: "elbow", cx: (aPt.x + cornerX) / 2, cy: aPt.y, axis: "x" });
              if (allowToStub) handles.push({ kind: "endpoint", end: "to", cx: cornerX, cy: (aPt.y + bPt.y) / 2, axis: "x" });
            } else {
              const cornerY = connector.elbowY ?? bPt.y;
              handles.push({ kind: "elbow", cx: aPt.x, cy: (aPt.y + cornerY) / 2, axis: "y" });
              if (allowToStub) handles.push({ kind: "endpoint", end: "to", cx: (aPt.x + bPt.x) / 2, cy: cornerY, axis: "y" });
            }
          } else {
            // Perpendicular + extra (4-segment). The source-side
            // elbow handle covers the source stub (overlapping
            // midpoint, so we skip the endpoint pill there); the
            // target stub is its own segment with an endpoint pill.
            if (fromIsH) {
              const jogX = connector.elbowX ?? (aPt.x + Math.sign(bPt.x - aPt.x || 1) * 32);
              const midY = connector.elbowY ?? (aPt.y + bPt.y) / 2;
              handles.push({ kind: "elbow", cx: (aPt.x + jogX) / 2, cy: aPt.y, axis: "x" });
              handles.push({ kind: "elbow", cx: (jogX + bPt.x) / 2, cy: midY, axis: "y" });
              if (allowToStub) handles.push({ kind: "endpoint", end: "to", cx: bPt.x, cy: (midY + bPt.y) / 2, axis: "x" });
            } else {
              const jogY = connector.elbowY ?? (aPt.y + Math.sign(bPt.y - aPt.y || 1) * 32);
              const midX = connector.elbowX ?? (aPt.x + bPt.x) / 2;
              handles.push({ kind: "elbow", cx: aPt.x, cy: (aPt.y + jogY) / 2, axis: "y" });
              handles.push({ kind: "elbow", cx: midX, cy: (jogY + bPt.y) / 2, axis: "x" });
              if (allowToStub) handles.push({ kind: "endpoint", end: "to", cx: (midX + bPt.x) / 2, cy: bPt.y, axis: "y" });
            }
          }
        }

        if (handles.length === 0) return null;
        const sw = 2 / zoom;
        return (
          <>
            {handles.map((hp, i) => {
              const w = (hp.axis === "y" ? 18 : 6) / zoom;
              const h = (hp.axis === "y" ? 6 : 18) / zoom;
              return (
                <rect
                  key={i}
                  x={hp.cx - w / 2}
                  y={hp.cy - h / 2}
                  width={w}
                  height={h}
                  rx={2 / zoom}
                  ry={2 / zoom}
                  fill="#ffffff"
                  stroke="#047857"
                  strokeWidth={sw}
                  style={{ cursor: hp.axis === "y" ? "ns-resize" : "ew-resize", pointerEvents: "auto" }}
                  onPointerDown={(e) => {
                    if (hp.kind === "endpoint") onEndpointDragStart?.(hp.end, e);
                    else onElbowDragStart(hp.axis, e, hp.field);
                  }}
                />
              );
            })}
          </>
        );
      })()}
    </g>
  );
}

function ConnectorLabel({
  text, x, y, w, fontPx, stroke, isSelected, onSelect,
  onEdit, onDelete, showHover, zoom, color, align, onLabelDragStart,
}: {
  text: string;
  x: number; y: number; w: number;
  /** Pre-computed font size in CSS px — derived from connector.labelFontSizePt. */
  fontPx: number;
  stroke: string;
  isSelected: boolean;
  onSelect: () => void;
  /** Single-click selects the connector; double-click swaps the label
   *  out for an inline editor. Optional so the panel-only flow still
   *  works if `onUpdateConnector` isn't wired through. */
  onEdit?: () => void;
  /** Inline X delete button shown on hover. */
  onDelete?: () => void;
  /** True when the parent connector is being hovered — drives the
   *  delete affordance visibility. */
  showHover?: boolean;
  /** Canvas zoom — keeps the X button a constant screen size. */
  zoom: number;
  /** Optional override of the text fill — defaults to the connector
   *  stroke color when unset. */
  color?: string;
  /** Horizontal alignment of multi-line text inside the label chip.
   *  Defaults to "center". */
  align?: "left" | "center" | "right";
  /** Pointer-down on the label rect. The Canvas dispatches into a
   *  drag handler that either slides the label along the path
   *  (labelMode === "on-connector") or repositions freely
   *  (labelMode === "free"). Optional — the label still selects /
   *  edits when this is unwired. */
  onLabelDragStart?: (e: React.PointerEvent<Element>) => void;
}) {
  // Multi-line layout: split on \n, render each as its own <tspan>.
  // Bounding box is sized just-tight enough to contain the text —
  // padY is the vertical breathing room above + below the glyphs,
  // padX matches the same number of pixels on each side. Reducing
  // either drops the chip closer to the text outline.
  const lines = text.split(/\n/);
  const lineHeight = fontPx * 1.2;
  const padY = 2;
  const padX = 3;
  const h = lines.length * lineHeight + padY * 2;
  const halfH = h / 2;
  const textAnchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
  const textX = align === "left" ? x - w / 2 + padX : align === "right" ? x + w / 2 - padX : x;
  // X-button positioned at the right edge of the label chip.
  const btnSize = 14 / zoom;
  const btnX = x + w / 2 - btnSize / 2;
  const btnY = y - halfH - btnSize / 2;
  const fill = color || stroke;
  return (
    <g
      style={{ pointerEvents: "auto", cursor: onLabelDragStart ? "move" : (onEdit ? "text" : "pointer") }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
        onLabelDragStart?.(e);
      }}
      onDoubleClick={onEdit ? (e) => { e.stopPropagation(); onEdit(); } : undefined}
    >
      <rect
        x={x - w / 2}
        y={y - halfH}
        width={w}
        height={h}
        rx={3}
        ry={3}
        fill="#ffffff"
        stroke={isSelected ? stroke : "transparent"}
        strokeWidth={1}
      />
      <text
        x={textX}
        y={y - halfH + padY + fontPx * 0.85}
        textAnchor={textAnchor}
        fontFamily="Inter, system-ui, sans-serif"
        fontSize={fontPx}
        fontWeight={500}
        fill={fill}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={textX} dy={i === 0 ? 0 : lineHeight}>{line || " "}</tspan>
        ))}
      </text>
      {showHover && onDelete && (
        <g
          style={{ cursor: "pointer" }}
          onPointerDown={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <circle cx={btnX + btnSize / 2} cy={btnY + btnSize / 2} r={btnSize / 2} fill="#ef4444" stroke="#ffffff" strokeWidth={1 / zoom} />
          <line
            x1={btnX + btnSize * 0.3} y1={btnY + btnSize * 0.3}
            x2={btnX + btnSize * 0.7} y2={btnY + btnSize * 0.7}
            stroke="#ffffff" strokeWidth={1.5 / zoom} strokeLinecap="round"
          />
          <line
            x1={btnX + btnSize * 0.7} y1={btnY + btnSize * 0.3}
            x2={btnX + btnSize * 0.3} y2={btnY + btnSize * 0.7}
            stroke="#ffffff" strokeWidth={1.5 / zoom} strokeLinecap="round"
          />
        </g>
      )}
    </g>
  );
}

/** Inline-edit input for a connector label. Rendered via SVG
 *  foreignObject so HTML form elements work inside the connector
 *  layer. Auto-focuses on mount; Enter / blur commits, Esc cancels. */
function ConnectorInlineEditor({
  x, y, initial, zoom, fontPx, onCommit, onCancel,
}: { x: number; y: number; initial: string; zoom: number; fontPx: number; onCommit: (v: string) => void; onCancel: () => void }) {
  // Sized so the editor's footprint matches the rendered label that
  // will replace it — width scales with the font, with a sensible
  // floor so very short labels still get a usable input.
  const W = Math.max(160, fontPx * 12);
  const H = fontPx + 8;
  // Multi-line awareness: pre-size the editor based on the initial
  // text's line count so a 2-line label opens at 2-line height
  // immediately. Plain Enter commits, Shift+Enter inserts a newline,
  // Escape cancels.
  const lineCount = Math.max(1, initial.split("\n").length);
  const editorH = (fontPx * 1.25) * lineCount + 8;
  return (
    <foreignObject x={x - W / 2} y={y - editorH / 2} width={W} height={editorH} style={{ overflow: "visible" }}>
      <textarea
        autoFocus
        defaultValue={initial}
        rows={lineCount}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => onCommit(e.currentTarget.value.replace(/\s+$/, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onCommit((e.target as HTMLTextAreaElement).value.replace(/\s+$/, ""));
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          // Shift+Enter falls through to default textarea behavior →
          // newline inserted. Auto-grow the textarea so the user
          // sees the new line right away instead of a hidden scroll.
          else if (e.key === "Enter" && e.shiftKey) {
            requestAnimationFrame(() => {
              const el = e.currentTarget as HTMLTextAreaElement | null;
              if (el) el.style.height = `${el.scrollHeight}px`;
            });
          }
        }}
        style={{
          width: "100%",
          height: "100%",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: fontPx,
          fontWeight: 500,
          lineHeight: 1.25,
          padding: `${2}px ${6}px`,
          border: `${1.5 / zoom}px solid #047857`,
          borderRadius: 3 / zoom,
          outline: "none",
          background: "#ffffff",
          color: "#0f172a",
          textAlign: "center",
          boxSizing: "border-box",
          resize: "none",
        }}
      />
    </foreignObject>
  );
}

/** Match-size dropdown — clicking opens a menu prompting whether to
 *  set every selected box to the LARGEST or SMALLEST in the group.
 *  Used for three variants: width-only, height-only, and both. The
 *  caller wires `dim` so the prompt copy reflects the dimension. */
function MatchSizeDropdown({
  dim, icon, label, onPick,
}: {
  dim: "width" | "height" | "both";
  icon?: React.ReactNode;
  label: string;
  onPick: (target: "largest" | "smallest") => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  function toggle() {
    if (open) { setOpen(false); return; }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ left: rect.left, top: rect.bottom + 4 });
    setOpen(true);
  }
  function pick(t: "largest" | "smallest") { setOpen(false); onPick(t); }
  const subjectLargest =
    dim === "width"  ? "widest one's width"
    : dim === "height" ? "tallest one's height"
    :                    "biggest one's width & height";
  const subjectSmallest =
    dim === "width"  ? "narrowest one's width"
    : dim === "height" ? "shortest one's height"
    :                    "smallest one's width & height";
  const titleHint =
    dim === "width"  ? "Match width — pick whether to grow / shrink every selected box's width"
    : dim === "height" ? "Match height — pick whether to grow / shrink every selected box's height"
    :                    "Match size — pick whether every selected box snaps to the largest or smallest in the group";
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        title={titleHint}
        aria-haspopup="menu"
        aria-expanded={open}
        className="text-[10px] font-semibold text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green rounded px-2 h-7 inline-flex items-center gap-1"
      >
        {icon}
        {label}
        <span aria-hidden style={{ fontSize: 9, lineHeight: 1, opacity: 0.6 }}>▾</span>
      </button>
      {open && anchor && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={titleHint}
          className="fixed z-50 bg-white rounded-md border border-gencom-sand shadow-xl py-1.5 min-w-[220px]"
          style={{ left: anchor.left, top: anchor.top }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); pick("largest"); }}
            className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition"
          >
            <span className="block text-[13px] font-semibold text-gencom-ink">Match largest</span>
            <span className="block text-[11px] text-gencom-stone leading-snug">Grow every selected box to the {subjectLargest}.</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={(e) => { e.stopPropagation(); pick("smallest"); }}
            className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition"
          >
            <span className="block text-[13px] font-semibold text-gencom-ink">Match smallest</span>
            <span className="block text-[11px] text-gencom-stone leading-snug">Shrink every selected box to the {subjectSmallest}.</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Square icon button used in the multi-select align bar. */
function AlignButton({
  onClick, title, icon, disabled,
}: { onClick: () => void; title: string; icon: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      title={title}
      disabled={disabled}
      className={
        "h-7 w-7 grid place-items-center rounded transition " +
        (disabled
          ? "text-gencom-sand cursor-not-allowed"
          : "text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green")
      }
    >
      {icon}
    </button>
  );
}
