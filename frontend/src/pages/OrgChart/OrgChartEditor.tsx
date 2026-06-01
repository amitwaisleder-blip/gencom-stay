// Org Chart editor — opens one project from localStorage, auto-saves
// edits back to it. URL is /org-chart/:id. If the id doesn't resolve
// (project deleted, bad link), redirect to the home screen.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import type {
  Box, ChartState, Connector, ConnectorSide, ConnectorTextLabel, PaperPresetKey, Selection, ThemeKey,
} from "./lib/types";
import { BOX_MIN_H, BOX_MIN_W, DEFAULT_BOX_H, DEFAULT_BOX_W, PAPER_PRESETS } from "./lib/types";
import { autoArrange } from "./lib/autoArrange";
import { exportPptx } from "./lib/exportPptx";
import { renderChartHtml } from "./lib/renderHtml";
import { importPptx, listPptxSlides } from "./lib/importPptx";
import type { SlideInfo } from "./lib/importPptx";
import { applyMeasurementStyles, computeGlobalBoxSize } from "./lib/measure";
import { defaultsFor } from "./lib/themes";
import { seedChart } from "./lib/seed";
import { getProject, saveProject } from "./lib/storage";
import { validate, warningCount } from "./lib/validation";

import { Canvas } from "./components/Canvas";
import type { CanvasHandle, Viewport } from "./components/Canvas";
import { EdgePlusMenu } from "./components/EdgePlusMenu";
import type { Edge } from "./components/EntityBox";
import { PropertyPanel } from "./components/PropertyPanel";
import { Toolbar } from "./components/Toolbar";
import {
  ThemePickerModal, markThemePickerSeen, shouldShowThemePicker,
} from "./components/ThemePickerModal";

import "./orgchart.css";

function newId(): string {
  return "id_" + Math.random().toString(36).slice(2, 10);
}

export type GridMode = "free" | "fine" | "coarse";
export const GRID_STEP: Record<GridMode, number> = { free: 1, fine: 10, coarse: 40 };

/** Snap a value to the nearest grid step. `free` returns the input
 *  unchanged (still pixel-rounded for stability). */
export function snapToGrid(v: number, mode: GridMode): number {
  const step = GRID_STEP[mode];
  if (step <= 1) return Math.round(v);
  return Math.round(v / step) * step;
}

export default function OrgChartEditor() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // null = still loading; the redirect-on-missing happens once the
  // first effect runs.
  const [chart, setChart] = useState<ChartState | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [showThemePicker, setShowThemePicker] = useState<boolean>(() => shouldShowThemePicker());
  const [animating, setAnimating] = useState(false);
  const [edgePlus, setEdgePlus] = useState<{ sourceId: string; edge: Edge; anchor: { x: number; y: number } } | null>(null);
  // Right-click context menu on a box. Shows the [New box / Connect /
  // Resize] picker; choosing an action arms `boxAction` so edge "+"
  // affordances appear, then clicking an edge fires the action. This is
  // distinct from `edgePlus` (legacy edge-click flow) — only one is
  // active at a time.
  const [boxContextMenu, setBoxContextMenu] = useState<{ boxId: string; anchor: { x: number; y: number } } | null>(null);
  const [boxAction, setBoxAction] = useState<{ id: string; mode: "newBox" | "connect" } | null>(null);
  const [linkPickFrom, setLinkPickFrom] = useState<string | null>(null);
  // Right-click context menu on a connector — captures the click's
  // screen coords (for menu placement) plus world coords (used as the
  // drop-line anchor when the user picks "Add new connector").
  const [connectorContextMenu, setConnectorContextMenu] = useState<{
    connectorId: string;
    screenAnchor: { x: number; y: number };
    worldAnchor: { x: number; y: number };
  } | null>(null);
  // Armed after the user picks "Add new connector" — the next box
  // click drops a new line from that box to `anchor`.
  const [connectorDropAction, setConnectorDropAction] = useState<{
    connectorId: string;
    anchor: { x: number; y: number };
  } | null>(null);
  // Auto-enters the connector's midpoint label into edit mode when
  // set. Used by the right-click "Add text" path so the user can
  // start typing immediately instead of clicking the line a second
  // time. ConnectorView clears this once it consumes the request.
  const [pendingLabelEditId, setPendingLabelEditId] = useState<string | null>(null);
  // Set when the user picks "Resize" from an edge `+` menu. While set,
  // that box renders 8 drag handles (4 corners, 4 edge midpoints); the
  // user drags any of them to adjust dimensions. Clicking elsewhere or
  // hitting Esc exits resize mode.
  const [resizingBoxId, setResizingBoxId] = useState<string | null>(null);
  // True while a sketch upload is being parsed by the backend. Disables
  // the Import-sketch button and surfaces a "Reading…" label so the
  // user doesn't double-fire and doesn't think the click was lost.
  const [sketchBusy, setSketchBusy] = useState(false);
  // Multi-slide picker state. Set when a PPTX import found chart-bearing
  // shapes on more than one slide and the user needs to pick which one
  // to import. Cleared on selection or cancel.
  const [slidePicker, setSlidePicker] = useState<{
    file: File;
    slides: SlideInfo[];
  } | null>(null);
  // Grid snapping mode for box drag. UI-only (not persisted to chart
  // state) but mirrored to localStorage so the choice survives editor
  // remounts (HMR in dev, or navigating away and back). The previous
  // implementation reset to "free" on every remount.
  const [gridMode, setGridModeRaw] = useState<GridMode>(() => {
    try {
      const saved = window.localStorage.getItem("orgchart.gridMode");
      if (saved === "fine" || saved === "coarse" || saved === "free") return saved;
    } catch { /* ignore */ }
    return "free";
  });
  function setGridMode(g: GridMode) {
    setGridModeRaw(g);
    try { window.localStorage.setItem("orgchart.gridMode", g); } catch { /* quota — ignore */ }
  }
  // "Saved · 2s ago" indicator. Updated whenever auto-save runs.
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  // Used to skip the auto-save effect on the initial chart-load so
  // we don't bump updatedAt without a real edit.
  const skipNextSaveRef = useRef<boolean>(true);

  // ---- Undo / redo --------------------------------------------------
  // Bursts of changes (a drag, a resize, typing in a field) collapse
  // into one undo entry via a 250ms idle debounce — otherwise every
  // pixel of a drag would be its own entry. The "snapshot" is the
  // chart state from BEFORE the burst; on undo we restore it and push
  // the current chart onto the redo stack.
  const historyRef = useRef<{ undo: ChartState[]; redo: ChartState[] }>({ undo: [], redo: [] });
  const lastSnapshotRef = useRef<ChartState | null>(null);
  const pushTimerRef = useRef<number | null>(null);
  // Set right before a programmatic `setChart` from undo / redo / load
  // so the history effect knows to skip pushing that change.
  const skipHistoryRef = useRef<boolean>(false);
  const HISTORY_MAX = 50;
  const HISTORY_COALESCE_MS = 250;

  function flushPendingHistory(currentChart: ChartState | null) {
    if (pushTimerRef.current !== null) {
      window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
      const snap = lastSnapshotRef.current;
      if (snap && currentChart && snap !== currentChart) {
        historyRef.current.undo.push(snap);
        if (historyRef.current.undo.length > HISTORY_MAX) historyRef.current.undo.shift();
        historyRef.current.redo = [];
        lastSnapshotRef.current = currentChart;
      }
    }
  }

  function resetHistory(c: ChartState | null) {
    if (pushTimerRef.current !== null) {
      window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }
    historyRef.current = { undo: [], redo: [] };
    lastSnapshotRef.current = c;
  }

  function undo() {
    flushPendingHistory(chart);
    const stack = historyRef.current.undo;
    if (stack.length === 0 || !chart) return;
    const prev = stack.pop()!;
    historyRef.current.redo.push(chart);
    skipHistoryRef.current = true;
    lastSnapshotRef.current = prev;
    setChart(prev);
  }

  function redo() {
    flushPendingHistory(chart);
    const stack = historyRef.current.redo;
    if (stack.length === 0 || !chart) return;
    const next = stack.pop()!;
    historyRef.current.undo.push(chart);
    skipHistoryRef.current = true;
    lastSnapshotRef.current = next;
    setChart(next);
  }

  // History push effect — runs after every chart change. Captures the
  // previous chart into the undo stack on a 250ms idle debounce so a
  // single drag / typing burst becomes one entry.
  useEffect(() => {
    if (!chart) return;
    if (lastSnapshotRef.current === null) {
      lastSnapshotRef.current = chart;
      return;
    }
    if (lastSnapshotRef.current === chart) return;
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      lastSnapshotRef.current = chart;
      return;
    }
    if (pushTimerRef.current !== null) {
      window.clearTimeout(pushTimerRef.current);
    }
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null;
      const snap = lastSnapshotRef.current;
      if (!snap) return;
      historyRef.current.undo.push(snap);
      if (historyRef.current.undo.length > HISTORY_MAX) historyRef.current.undo.shift();
      historyRef.current.redo = [];
      lastSnapshotRef.current = chart;
    }, HISTORY_COALESCE_MS);
  }, [chart]);

  // ---- Load project on mount / id change --------------------------
  useEffect(() => {
    if (!projectId) {
      navigate("/org-chart", { replace: true });
      return;
    }
    const p = getProject(projectId);
    if (!p) {
      navigate("/org-chart", { replace: true });
      return;
    }
    skipNextSaveRef.current = true;
    resetHistory(p.chart);
    setChart(p.chart);
    setSelection({ kind: "none" });
  }, [projectId, navigate]);

  // ---- Auto-save on chart changes ---------------------------------
  // Saves are cheap (single localStorage round-trip) so debounce is
  // light — 250ms catches keystroke bursts without delaying real edits.
  useEffect(() => {
    if (!chart || !projectId) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      saveProject(projectId, chart);
      setLastSavedAt(Date.now());
    }, 250);
    return () => window.clearTimeout(t);
  }, [chart, projectId]);

  const validation = useMemo(() => (chart ? validate(chart) : { parents: new Map() }), [chart]);

  // ---- Uniform box sizing -----------------------------------------
  // Skipped when `chart.uniformSize === false` (set by importers that
  // want the source layout's per-box proportions to survive). For all
  // other charts the canvas pegs every box to the largest natural size
  // so a deck stays visually consistent.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el || !chart) return;
    if (chart.uniformSize === false) return;
    applyMeasurementStyles(el);
    const next = computeGlobalBoxSize(chart.boxes, el);
    setChart((c) => {
      if (!c || c.boxes.length === 0) return c;
      const same = c.boxes.every((b) => b.width === next.width && b.height === next.height);
      if (same) return c;
      return {
        ...c,
        boxes: c.boxes.map((b) => ({ ...b, width: next.width, height: next.height })),
      };
    });
  }, [chart?.boxes, chart?.uniformSize]);

  // ---- Mutations (no-op while loading) ----------------------------
  function patchChart(p: Partial<ChartState>) {
    setChart((c) => (c ? { ...c, ...p } : c));
  }
  function updateBox(id: string, patch: Partial<Box>) {
    setChart((c) => (c ? { ...c, boxes: c.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) } : c));
  }
  /** Apply the same patch to every box in `ids`. Used by the property
   *  panel's multi-box editor (shift-click + palette/swatch). */
  function updateBoxes(ids: string[], patch: Partial<Box>) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.map((b) => (idSet.has(b.id) ? { ...b, ...patch } : b)),
    } : c));
  }
  function moveBox(id: string, x: number, y: number) {
    if (chart?.boxes.find((b) => b.id === id)?.locked) return;
    const sx = snapToGrid(x, gridMode);
    const sy = snapToGrid(y, gridMode);
    setChart((c) => {
      if (!c) return c;
      const oldBox = c.boxes.find((b) => b.id === id);
      if (!oldBox) return c;
      const dx = sx - oldBox.x;
      const dy = sy - oldBox.y;
      if (dx === 0 && dy === 0) return c;
      // Slide the trunk by half the box's delta when only one endpoint
      // of a connector moves. Trunk Y/X is conceptually the midpoint
      // between source and target — half-delta keeps it centered as
      // one end shifts, so the line stays connected at both ends
      // without dragging the trunk fully along with the moving box
      // (which would detach it from the unmoved endpoint and break
      // any manifold siblings sharing the trunk). Applies to elbow
      // overrides AND imported PPTX waypoints; toAnchor is skipped
      // because it's a T-junction on another connector, not a trunk.
      const halfDx = dx / 2;
      const halfDy = dy / 2;
      return {
        ...c,
        boxes: c.boxes.map((b) => (b.id === id ? { ...b, x: sx, y: sy } : b)),
        connectors: c.connectors.map((cn) => {
          const isSource = cn.fromBoxId === id;
          const isTarget = cn.toBoxId === id;
          if (isSource === isTarget) return cn; // untouched, or self-loop
          const next = { ...cn };
          if (cn.elbowX !== undefined) next.elbowX = cn.elbowX + halfDx;
          if (cn.elbowY !== undefined) next.elbowY = cn.elbowY + halfDy;
          // Step jogs travel on the perpendicular axis only — top/bottom-
          // edge connectors store Y in step1/step2; left/right-edge ones
          // store X. Translate by the matching half-delta so a stepped
          // trunk follows when one of its endpoint boxes moves.
          if (cn.step1 !== undefined) next.step1 = cn.step1 + (cn.fromSide === "top" || cn.fromSide === "bottom" ? halfDy : halfDx);
          if (cn.step2 !== undefined) next.step2 = cn.step2 + (cn.fromSide === "top" || cn.fromSide === "bottom" ? halfDy : halfDx);
          if (cn.waypoints) next.waypoints = cn.waypoints.map((w) => ({ x: w.x + halfDx, y: w.y + halfDy }));
          return next;
        }),
      };
    });
  }
  function moveBoxes(
    delta: { dx: number; dy: number },
    ids: string[],
    origins: Map<string, { x: number; y: number }>,
    connectorOrigins?: Map<string, { elbowX?: number; elbowY?: number; step1?: number; step2?: number; toAnchor?: { x: number; y: number }; waypoints?: { x: number; y: number }[] }>,
  ) {
    const sdx = snapToGrid(delta.dx, gridMode) - snapToGrid(0, gridMode);
    const sdy = snapToGrid(delta.dy, gridMode) - snapToGrid(0, gridMode);
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.map((b) => {
        if (!ids.includes(b.id)) return b;
        // Locked boxes ignore group drags — they stay pinned while the
        // rest of the selection moves around them.
        if (b.locked) return b;
        const o = origins.get(b.id);
        if (!o) return b;
        return { ...b, x: o.x + sdx, y: o.y + sdy };
      }),
      // Translate connector overrides for connectors that live entirely
      // inside the moving set. This keeps T-junction anchors, user-
      // placed elbow axes, and imported PPTX waypoints glued to the
      // boxes they belong to so a grouped move doesn't tear the routing
      // apart (otherwise the trunk stays at its original Y while the
      // boxes move past it, leaving the line routing behind the moved
      // boxes — visible as a gap between trunk and box).
      connectors: connectorOrigins && connectorOrigins.size > 0
        ? c.connectors.map((cn) => {
          const o = connectorOrigins.get(cn.id);
          if (!o) return cn;
          const next = { ...cn };
          if (o.elbowX !== undefined) next.elbowX = o.elbowX + sdx;
          if (o.elbowY !== undefined) next.elbowY = o.elbowY + sdy;
          // step1/step2 are perpendicular-axis world coords (Y for
          // top/bottom-edge connectors, X for left/right-edge ones).
          // Translate them by the matching delta so a stepped trunk
          // travels with the boxes when the group moves as a unit.
          if (o.step1 !== undefined) next.step1 = o.step1 + (cn.fromSide === "top" || cn.fromSide === "bottom" ? sdy : sdx);
          if (o.step2 !== undefined) next.step2 = o.step2 + (cn.fromSide === "top" || cn.fromSide === "bottom" ? sdy : sdx);
          if (o.toAnchor) next.toAnchor = { x: o.toAnchor.x + sdx, y: o.toAnchor.y + sdy };
          if (o.waypoints) next.waypoints = o.waypoints.map((p) => ({ x: p.x + sdx, y: p.y + sdy }));
          return next;
        })
        : c.connectors,
    } : c));
  }

  function setPaperSize(p: PaperPresetKey) {
    patchChart({ paperSize: p });
  }

  /** Auto-expand selection to include every group-sibling of any
   *  selected box. Called from a `useEffect` so manual selection
   *  changes (clicks, marquee, Ctrl+A) all flow through this. Keeps
   *  the selection stable so we don't loop forever. */
  function expandedSelection(s: Selection, c: ChartState): Selection {
    // Group expansion only applies to box-bearing selections. Connector-
    // only and "mixed" (boxes + connectors) selections are returned
    // as-is — connectors don't carry a `groupId`, and broadening a
    // user's deliberate heterogeneous selection would be surprising.
    if (s.kind === "none" || s.kind === "connector" || s.kind === "connectors" || s.kind === "mixed" || s.kind === "connectorLabel") return s;
    const ids = s.kind === "box" ? new Set([s.id]) : new Set(s.ids);
    const groupIds = new Set<string>();
    for (const id of ids) {
      const b = c.boxes.find((x) => x.id === id);
      if (b?.groupId) groupIds.add(b.groupId);
    }
    if (groupIds.size === 0) return s;
    for (const b of c.boxes) {
      if (b.groupId && groupIds.has(b.groupId)) ids.add(b.id);
    }
    if (ids.size === (s.kind === "box" ? 1 : s.ids.length)) return s;
    const arr = Array.from(ids);
    return arr.length === 1 ? { kind: "box", id: arr[0] } : { kind: "boxes", ids: arr };
  }

  useEffect(() => {
    if (!chart) return;
    const next = expandedSelection(selection, chart);
    if (next !== selection) setSelection(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, chart]);

  function groupSelection() {
    if (!chart || selection.kind !== "boxes" || selection.ids.length < 2) return;
    const ids = new Set(selection.ids);
    const gid = "g_" + Math.random().toString(36).slice(2, 10);
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.map((b) => (ids.has(b.id) ? { ...b, groupId: gid } : b)),
    } : c));
  }

  function ungroupSelection() {
    if (!chart) return;
    const ids =
      selection.kind === "boxes" ? selection.ids
      : selection.kind === "box" ? [selection.id]
      : [];
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.map((b) => (idSet.has(b.id) ? { ...b, groupId: undefined } : b)),
    } : c));
  }

  /** Scale + translate the selected boxes (or every box) so they fit
   *  inside the current paper-size rectangle with a small margin.
   *  Uniform scale on both axes so proportions are preserved. Font
   *  size scales with the boxes. Locked boxes are skipped. */
  function fitToPage() {
    if (!chart) return;
    const paper = chart.paperSize && chart.paperSize !== "off" ? PAPER_PRESETS[chart.paperSize] : null;
    if (!paper) {
      window.alert("Pick a paper size first (toolbar → Paper) so we know the target dimensions.");
      return;
    }
    const ids =
      selection.kind === "boxes" ? new Set(selection.ids)
      : selection.kind === "box" ? new Set([selection.id])
      : new Set(chart.boxes.map((b) => b.id));
    const sel = chart.boxes.filter((b) => ids.has(b.id));
    if (sel.length === 0) return;
    const minX = Math.min(...sel.map((b) => b.x));
    const minY = Math.min(...sel.map((b) => b.y));
    const maxX = Math.max(...sel.map((b) => b.x + b.width));
    const maxY = Math.max(...sel.map((b) => b.y + b.height));
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const margin = 40;
    const scale = Math.min((paper.width - 2 * margin) / w, (paper.height - 2 * margin) / h);
    if (chart.uniformSize !== false) patchChart({ uniformSize: false });
    setAnimating(true);
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.map((b) => {
        if (!ids.has(b.id)) return b;
        if (b.locked) return b;
        return {
          ...b,
          x: Math.round((b.x - minX) * scale + margin),
          y: Math.round((b.y - minY) * scale + margin),
          width: Math.max(BOX_MIN_W, Math.round(b.width * scale)),
          height: Math.max(BOX_MIN_H, Math.round(b.height * scale)),
          fontSizePt: Math.max(6, +(((b.fontSizePt ?? 11) * scale)).toFixed(1)),
        };
      }),
    } : c));
    window.setTimeout(() => setAnimating(false), 450);
  }

  function visibleCenter(): { x: number; y: number } {
    const node = document.querySelector(".orgchart-canvas") as HTMLElement | null;
    if (!node) return { x: 360, y: 200 };
    const rect = node.getBoundingClientRect();
    const cx = (rect.width / 2 - viewport.x) / viewport.zoom;
    const cy = (rect.height / 2 - viewport.y) / viewport.zoom;
    return { x: Math.round(cx - DEFAULT_BOX_W / 2), y: Math.round(cy - DEFAULT_BOX_H / 2) };
  }

  function addBox(initial?: Partial<Box>): string | undefined {
    if (!chart) return;
    const d = defaultsFor(chart.theme);
    const id = newId();
    const center = visibleCenter();
    let { x, y } = center;
    while (chart.boxes.some((b) => Math.abs(b.x - x) < 4 && Math.abs(b.y - y) < 4)) {
      x += 24;
      y += 24;
    }
    const box: Box = {
      id,
      name: "Untitled",
      entityType: "LLC",
      ownershipPct: null,
      fillColor: d.fillColor,
      borderColor: d.borderColor,
      textColor: d.textColor,
      x: snapToGrid(x, gridMode),
      y: snapToGrid(y, gridMode),
      width: DEFAULT_BOX_W,
      height: DEFAULT_BOX_H,
      ...initial,
    };
    setChart((c) => (c ? { ...c, boxes: [...c.boxes, box] } : c));
    setSelection({ kind: "box", id });
    return id;
  }

  function deleteBox(id: string) {
    // Box-only delete: leave connectors alone. Connectors that
    // referenced this box are skipped at render time (the renderer
    // bails when from/to lookup fails) but stay in storage so the
    // user can reattach by dragging an endpoint onto a different
    // box. Cascading would silently delete every line touching the
    // box and break sibling branches.
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.filter((b) => b.id !== id),
    } : c));
    setSelection({ kind: "none" });
  }

  function addConnector(fromId: string, toId: string) {
    if (!chart || fromId === toId) return;
    const exists = chart.connectors.some(
      (c) =>
        (c.fromBoxId === fromId && c.toBoxId === toId) ||
        (c.fromBoxId === toId && c.toBoxId === fromId),
    );
    if (exists) return;
    const conn: Connector = {
      id: newId(),
      fromBoxId: fromId,
      toBoxId: toId,
      routeStyle: "orthogonal",
      showArrowhead: true,
    };
    setChart((c) => (c ? { ...c, connectors: [...c.connectors, conn] } : c));
  }

  /** Drop a new connector at an absolute point on the canvas — used
   *  when the user clicks an existing connector (the parent line)
   *  while in target-pick mode. We FORCE the new line to be strictly
   *  vertical: the X of both endpoints is snapped to the source box's
   *  center, and the Y of the trunk endpoint is snapped to the parent
   *  connector's actual Y at that X (so the line meets the trunk
   *  exactly — no gap or overlap). `toBoxId` keeps the parent
   *  connector's target so hierarchy validation still has a downstream
   *  reference; `parentConnId` is used purely to read the parent's
   *  geometry for snapping. */
  function addConnectorToAnchor(
    fromId: string,
    parentConnId: string | null,
    anchorClick: { x: number; y: number },
  ) {
    if (!chart) return;
    const fromBox = chart.boxes.find((b) => b.id === fromId);
    if (!fromBox) return;
    const parentConn = parentConnId
      ? chart.connectors.find((c) => c.id === parentConnId) ?? null
      : null;
    const parentBoxId = parentConn?.toBoxId ?? fromId;
    if (fromId === parentBoxId && !parentConn) return;
    const fromCenterX = fromBox.x + fromBox.width / 2;
    const fromCenterY = fromBox.y + fromBox.height / 2;
    // Snap the anchor to a strictly vertical drop:
    //   X = box's horizontal center (so the line exits at the top
    //       midpoint and goes straight up/down with no diagonal).
    //   Y = parent connector's actual Y at that X (for horizontal
    //       trunks that's `elbowY`; otherwise the user's click Y).
    //       This prevents the gap / overlap the user reported when
    //       the click landed slightly off the trunk's exact Y.
    const snappedX = fromCenterX;
    const trunkY = parentConn?.elbowY ?? anchorClick.y;
    const fromSide: ConnectorSide = trunkY >= fromCenterY ? "bottom" : "top";
    const fromOffset = 0.5;
    const conn: Connector = {
      id: newId(),
      fromBoxId: fromId,
      toBoxId: parentBoxId,
      routeStyle: "straight",
      showArrowhead: false,
      fromSide,
      fromOffset,
      customEndpoints: true,
      toAnchor: { x: snappedX, y: trunkY },
      parentConnId: parentConn?.id,
    };
    setChart((c) => (c ? { ...c, connectors: [...c.connectors, conn] } : c));
    setLinkPickFrom(null);
  }

  function updateConnector(id: string, patch: Partial<Connector>) {
    setChart((c) => (c ? { ...c, connectors: c.connectors.map((cn) => (cn.id === id ? { ...cn, ...patch } : cn)) } : c));
  }

  function deleteConnector(id: string) {
    setChart((c) => (c ? { ...c, connectors: c.connectors.filter((cn) => cn.id !== id) } : c));
    setSelection({ kind: "none" });
  }

  function addNeighborOf(sourceId: string, edge: Edge) {
    if (!chart) return;
    const src = chart.boxes.find((b) => b.id === sourceId);
    if (!src) return;
    const offset = 120;
    let x = src.x;
    let y = src.y;
    switch (edge) {
      case "top":    y = src.y - offset - DEFAULT_BOX_H; break;
      case "bottom": y = src.y + src.height + offset; break;
      case "left":   x = src.x - offset - DEFAULT_BOX_W; break;
      case "right":  x = src.x + src.width + offset; break;
    }
    const id = addBox({ x: snapToGrid(x, gridMode), y: snapToGrid(y, gridMode), name: "" });
    if (id) addConnector(sourceId, id);
    return id;
  }

  function setTheme(t: ThemeKey) {
    patchChart({ theme: t });
  }

  function handleEdgePlus(sourceId: string, edge: Edge, anchor: { x: number; y: number }) {
    setEdgePlus({ sourceId, edge, anchor });
  }
  function handlePickNewBox() {
    if (!edgePlus) return;
    addNeighborOf(edgePlus.sourceId, edgePlus.edge);
    setEdgePlus(null);
  }
  function handlePickConnectExisting() {
    if (!edgePlus) return;
    setLinkPickFrom(edgePlus.sourceId);
    setEdgePlus(null);
  }
  function handlePickResize() {
    if (!edgePlus) return;
    // Uniform sizing would snap a manual resize back to the global box
    // size on the next layout pass. Flip it off so the new dimensions
    // stick — the user can re-enable from the toolbar to re-uniform.
    if (chart && chart.uniformSize !== false) {
      patchChart({ uniformSize: false });
    }
    setResizingBoxId(edgePlus.sourceId);
    setSelection({ kind: "box", id: edgePlus.sourceId });
    setEdgePlus(null);
  }
  /** Clamp resize so the box never collapses below the measurement
   *  minimums. Called from the canvas drag handler. */
  function resizeBox(id: string, next: { x: number; y: number; width: number; height: number }) {
    if (!chart) return;
    const target = chart.boxes.find((b) => b.id === id);
    if (!target) return;
    if (target.locked) return;
    const nx = Math.round(next.x);
    const ny = Math.round(next.y);
    const nw = Math.max(BOX_MIN_W, Math.round(next.width));
    const nh = Math.max(BOX_MIN_H, Math.round(next.height));
    // Per-frame delta against the box's current state. When the box
    // is part of a group, every other member follows the same delta
    // so the group resizes in sync — locked members are skipped.
    const dx = nx - target.x;
    const dy = ny - target.y;
    const dw = nw - target.width;
    const dh = nh - target.height;
    setChart((c) => {
      if (!c) return c;
      return {
        ...c,
        boxes: c.boxes.map((b) => {
          if (b.id === id) return { ...b, x: nx, y: ny, width: nw, height: nh };
          if (target.groupId && b.groupId === target.groupId && !b.locked) {
            return {
              ...b,
              x: Math.round(b.x + dx),
              y: Math.round(b.y + dy),
              width: Math.max(BOX_MIN_W, Math.round(b.width + dw)),
              height: Math.max(BOX_MIN_H, Math.round(b.height + dh)),
            };
          }
          return b;
        }),
      };
    });
  }

  /** Apply a per-frame group-resize update from the canvas. The canvas
   *  computes new geometry for every selected box from the bounding-box
   *  drag; we just clamp + persist. Like single-box resize, this turns
   *  off uniformSize so the new dimensions stick. */
  function groupResize(updates: Array<{
    id: string; x: number; y: number; width: number; height: number; fontSizePt: number;
  }>) {
    if (!chart) return;
    if (chart.uniformSize !== false) {
      patchChart({ uniformSize: false });
    }
    const byId = new Map(updates.map((u) => [u.id, u]));
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.map((b) => {
        const u = byId.get(b.id);
        if (!u || b.locked) return b;
        return {
          ...b,
          x: Math.round(u.x),
          y: Math.round(u.y),
          width: Math.max(BOX_MIN_W, Math.round(u.width)),
          height: Math.max(BOX_MIN_H, Math.round(u.height)),
          fontSizePt: Math.max(6, +u.fontSizePt.toFixed(1)),
        };
      }),
    } : c));
  }

  function bulkConnect() {
    if (!chart) return;
    if (selection.kind !== "boxes" || selection.ids.length < 2) return;
    const [head, ...rest] = selection.ids;
    setChart((c) => {
      if (!c) return c;
      const next: Connector[] = [...c.connectors];
      for (const child of rest) {
        const exists = next.some(
          (cn) =>
            (cn.fromBoxId === head && cn.toBoxId === child) ||
            (cn.fromBoxId === child && cn.toBoxId === head),
        );
        if (exists) continue;
        next.push({
          id: newId(),
          fromBoxId: head,
          toBoxId: child,
          routeStyle: "orthogonal",
          showArrowhead: true,
        });
      }
      return { ...c, connectors: next };
    });
  }

  function buildHierarchy() {
    if (!chart) return;
    if (selection.kind !== "boxes" || selection.ids.length < 2) return;
    const ids = new Set(selection.ids);
    const sel = chart.boxes.filter((b) => ids.has(b.id));
    if (sel.length < 2) return;

    const ROW_TOL = Math.max(DEFAULT_BOX_H, 60);
    const sortedByY = [...sel].sort((a, b) => a.y - b.y);
    const rows: Box[][] = [];
    for (const b of sortedByY) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(b.y - row[0].y) < ROW_TOL) row.push(b);
      else rows.push([b]);
    }

    const H_GAP = 40;
    const V_GAP = 80;
    const stepX = DEFAULT_BOX_W + H_GAP;
    const stepY = DEFAULT_BOX_H + V_GAP;

    let cx = 0;
    for (const b of sel) cx += b.x + b.width / 2;
    cx /= sel.length;
    const baseY = Math.min(...sel.map((b) => b.y));

    const newPositions = new Map<string, { x: number; y: number }>();
    rows.forEach((row, rowIdx) => {
      row.sort((a, b) => a.x - b.x);
      const totalWidth = row.length * DEFAULT_BOX_W + (row.length - 1) * H_GAP;
      const startX = cx - totalWidth / 2;
      row.forEach((b, i) => {
        newPositions.set(b.id, {
          x: Math.round(startX + i * stepX),
          y: Math.round(baseY + rowIdx * stepY),
        });
      });
    });

    const newConnectors: Connector[] = [];
    for (let r = 1; r < rows.length; r++) {
      const child = rows[r];
      const parent = rows[r - 1];
      for (const c of child) {
        const cp = newPositions.get(c.id)!;
        let best: Box | null = null;
        let bestDx = Infinity;
        for (const p of parent) {
          const pp = newPositions.get(p.id)!;
          const dx = Math.abs((cp.x + DEFAULT_BOX_W / 2) - (pp.x + DEFAULT_BOX_W / 2));
          if (dx < bestDx) { bestDx = dx; best = p; }
        }
        if (best) {
          newConnectors.push({
            id: newId(),
            fromBoxId: best.id,
            toBoxId: c.id,
            routeStyle: "orthogonal",
            showArrowhead: true,
          });
        }
      }
    }

    setAnimating(true);
    setChart((c) => {
      if (!c) return c;
      const kept = c.connectors.filter(
        (cn) => !(ids.has(cn.fromBoxId) && ids.has(cn.toBoxId)),
      );
      return {
        ...c,
        boxes: c.boxes.map((b) => {
          const p = newPositions.get(b.id);
          return p ? { ...b, x: p.x, y: p.y } : b;
        }),
        connectors: [...kept, ...newConnectors],
      };
    });
    window.setTimeout(() => setAnimating(false), 450);
  }

  // ---- Alignment / distribution -----------------------------------
  // All eight operations work on the current multi-selection. Each
  // computes a single new x/y per id and dispatches one setChart so
  // the layout transition (when animating) plays as a unit.
  type AlignOp =
    | "align-left" | "align-center-x" | "align-right"
    | "align-top"  | "align-center-y" | "align-bottom"
    | "distribute-h" | "distribute-v"
    | "space-equal";

  /** Make every selected box the same width / height / both. Each
   *  dimension is set to the MAX across the selection so no box's
   *  content gets clipped. Like resize, this turns off `uniformSize`
   *  — otherwise the global-size effect would snap everything back. */
  function matchSize(dim: "width" | "height" | "both", target: "largest" | "smallest" = "largest") {
    if (!chart) return;
    if (selection.kind !== "boxes" || selection.ids.length < 2) return;
    const ids = new Set(selection.ids);
    const sel = chart.boxes.filter((b) => ids.has(b.id));
    if (sel.length < 2) return;
    // Locked boxes always win as the anchor when present — match the
    // first locked box's size and skip mutating any locked box. With
    // no lock, the user's `target` choice picks the largest or
    // smallest dimension across the selection.
    const lockedSel = sel.filter((b) => b.locked);
    const widths = sel.map((b) => b.width);
    const heights = sel.map((b) => b.height);
    const reduceFn = target === "smallest" ? Math.min : Math.max;
    const targetW = lockedSel.length > 0 ? lockedSel[0].width  : reduceFn(...widths);
    const targetH = lockedSel.length > 0 ? lockedSel[0].height : reduceFn(...heights);
    if (chart.uniformSize !== false) {
      patchChart({ uniformSize: false });
    }
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.map((b) => {
        if (!ids.has(b.id)) return b;
        if (b.locked) return b; // anchor — never modified
        const next: Partial<Box> = {};
        if (dim === "width" || dim === "both") next.width = targetW;
        if (dim === "height" || dim === "both") next.height = targetH;
        return { ...b, ...next };
      }),
    } : c));
  }

  function alignSelection(op: AlignOp) {
    if (!chart) return;
    if (selection.kind !== "boxes" || selection.ids.length < 2) return;
    const ids = new Set(selection.ids);
    const sel = chart.boxes.filter((b) => ids.has(b.id));
    if (sel.length < 2) return;
    const positions = new Map<string, { x: number; y: number }>();
    const connectorPatches = new Map<string, Partial<Connector>>();

    if (op.startsWith("align-")) {
      // Anchor selection: a locked box wins (immovable target). Otherwise
      // the FIRST-clicked box anchors — its edges define the target so
      // the user can predict where the alignment will land. Adobe-style:
      // shift-click order is preserved in selection.ids, so ids[0] is
      // whichever box the user originally selected before shift-adding.
      // Boxes in a group align as a unit: each "item" is either a
      // single box or all of its group siblings, and its bbox replaces
      // a single box's edges in the target / translation math.
      const lockedSel = sel.filter((b) => b.locked);
      const anchor = lockedSel.length > 0
        ? lockedSel[0]
        : (chart.boxes.find((b) => b.id === selection.ids[0]) ?? sel[0]);
      const items = new Map<string, Set<string>>();
      for (const b of sel) {
        const key = b.groupId ?? b.id;
        if (!items.has(key)) items.set(key, new Set());
        items.get(key)!.add(b.id);
      }
      function itemBbox(members: Set<string>): { x: number; y: number; right: number; bottom: number } {
        const bs = chart!.boxes.filter((b) => members.has(b.id));
        return {
          x: Math.min(...bs.map((b) => b.x)),
          y: Math.min(...bs.map((b) => b.y)),
          right: Math.max(...bs.map((b) => b.x + b.width)),
          bottom: Math.max(...bs.map((b) => b.y + b.height)),
        };
      }
      const anchorKey = anchor.groupId ?? anchor.id;
      const anchorBbox = itemBbox(items.get(anchorKey)!);
      let target = 0;
      switch (op) {
        case "align-left":     target = anchorBbox.x; break;
        case "align-right":    target = anchorBbox.right; break;
        case "align-center-x": target = (anchorBbox.x + anchorBbox.right) / 2; break;
        case "align-top":      target = anchorBbox.y; break;
        case "align-bottom":   target = anchorBbox.bottom; break;
        case "align-center-y": target = (anchorBbox.y + anchorBbox.bottom) / 2; break;
      }
      // Compute a single dx/dy per item, then apply to every member
      // box + any connector whose endpoints both live in the item.
      const itemDeltas = new Map<string, { dx: number; dy: number }>();
      for (const [key, members] of items) {
        if (key === anchorKey) continue;
        const ib = itemBbox(members);
        let dx = 0, dy = 0;
        switch (op) {
          case "align-left":     dx = target - ib.x; break;
          case "align-right":    dx = target - ib.right; break;
          case "align-center-x": dx = target - (ib.x + ib.right) / 2; break;
          case "align-top":      dy = target - ib.y; break;
          case "align-bottom":   dy = target - ib.bottom; break;
          case "align-center-y": dy = target - (ib.y + ib.bottom) / 2; break;
        }
        itemDeltas.set(key, { dx, dy });
        for (const id of members) {
          const b = chart.boxes.find((x) => x.id === id);
          if (!b || b.locked) continue;
          positions.set(id, { x: Math.round(b.x + dx), y: Math.round(b.y + dy) });
        }
      }
      // Carry connector overrides along with their group so manual
      // elbow / T-junction placements track the group when it moves.
      for (const cn of chart.connectors) {
        if (cn.elbowX === undefined && cn.elbowY === undefined && !cn.toAnchor) continue;
        const fromBox = chart.boxes.find((b) => b.id === cn.fromBoxId);
        const toBox = chart.boxes.find((b) => b.id === cn.toBoxId);
        if (!fromBox || !toBox) continue;
        const fromKey = fromBox.groupId ?? fromBox.id;
        const toKey = toBox.groupId ?? toBox.id;
        if (fromKey !== toKey) continue;
        const d = itemDeltas.get(fromKey);
        if (!d) continue;
        connectorPatches.set(cn.id, {
          ...(cn.elbowX !== undefined ? { elbowX: cn.elbowX + d.dx } : {}),
          ...(cn.elbowY !== undefined ? { elbowY: cn.elbowY + d.dy } : {}),
          ...(cn.toAnchor ? { toAnchor: { x: cn.toAnchor.x + d.dx, y: cn.toAnchor.y + d.dy } } : {}),
        });
      }
    } else if (op === "space-equal") {
      // Space evenly along BOTH axes with a uniform 24px gap so boxes
      // never overlap. Distinct from distribute-h/v which preserves
      // the bounding span and can leave a negative gap when boxes were
      // already overlapping. Each axis is processed independently:
      // sort, lay out from the current min-edge, advance by `box-size + GAP`.
      const GAP = 24;
      // Horizontal pass: sort by x, lay out from current min-x.
      const byX = [...sel].sort((a, b) => a.x - b.x);
      let cursorX = byX[0].x;
      for (const b of byX) {
        positions.set(b.id, { x: Math.round(cursorX), y: b.y });
        cursorX += b.width + GAP;
      }
      // Vertical pass: sort by y, lay out from current min-y. Combine
      // with the horizontal pass — read the just-set X back from
      // positions so the final value carries both axes.
      const byY = [...sel].sort((a, b) => a.y - b.y);
      let cursorY = byY[0].y;
      for (const b of byY) {
        const xWritten = positions.get(b.id)?.x ?? b.x;
        positions.set(b.id, { x: xWritten, y: Math.round(cursorY) });
        cursorY += b.height + GAP;
      }
    } else if (op === "distribute-h" || op === "distribute-v") {
      // Distribute equal gaps between adjacent boxes along the axis.
      // Endpoints stay put; middle boxes redistribute evenly.
      if (sel.length < 3) return; // need 3+ for distribution to be meaningful
      const horizontal = op === "distribute-h";
      const sorted = [...sel].sort((a, b) =>
        horizontal ? a.x - b.x : a.y - b.y,
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = horizontal
        ? (last.x + last.width) - first.x
        : (last.y + last.height) - first.y;
      const sizesSum = sorted.reduce(
        (sum, b) => sum + (horizontal ? b.width : b.height),
        0,
      );
      const gap = (totalSpan - sizesSum) / (sorted.length - 1);
      // First box anchors at its current position; subsequent boxes
      // get their leading edge at previous trailing edge + gap.
      let cursor = horizontal ? first.x + first.width : first.y + first.height;
      positions.set(first.id, { x: first.x, y: first.y });
      for (let i = 1; i < sorted.length - 1; i++) {
        const b = sorted[i];
        if (horizontal) {
          const nx = Math.round(cursor + gap);
          positions.set(b.id, { x: nx, y: b.y });
          cursor = nx + b.width;
        } else {
          const ny = Math.round(cursor + gap);
          positions.set(b.id, { x: b.x, y: ny });
          cursor = ny + b.height;
        }
      }
      positions.set(last.id, { x: last.x, y: last.y });
    }

    setAnimating(true);
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.map((b) => {
        const p = positions.get(b.id);
        return p ? { ...b, x: p.x, y: p.y } : b;
      }),
      connectors: connectorPatches.size > 0
        ? c.connectors.map((cn) => {
          const p = connectorPatches.get(cn.id);
          return p ? { ...cn, ...p } : cn;
        })
        : c.connectors,
    } : c));
    window.setTimeout(() => setAnimating(false), 350);
  }

  /** Export the current chart as a .pptx the user can open in
   *  PowerPoint (or re-import here). Errors surface as an alert
   *  rather than a console-only failure — this is a primary export
   *  surface and a silent miss is worse than a noisy one. */
  async function handleExportPptx() {
    if (!chart) return;
    if (chart.boxes.length === 0) {
      window.alert("Add at least one box before exporting.");
      return;
    }
    try {
      const blob = await exportPptx(chart);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (chart.title || "org-chart").replace(/[^a-zA-Z0-9_\- ]+/g, "").slice(0, 60);
      a.download = `${safe}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      window.alert("Could not export .pptx: " + (err as Error).message);
    }
  }

  // ---- File I/O (download JSON) -----------------------------------
  function save() {
    if (!chart) return;
    const blob = new Blob([JSON.stringify(chart, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = (chart.title || "org-chart").replace(/[^a-zA-Z0-9_\- ]+/g, "").slice(0, 60);
    a.download = `${safe}.orgchart.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function load(loaded: ChartState) {
    resetHistory(loaded);
    setChart(loaded);
    setSelection({ kind: "none" });
  }

  // ---- Keyboard shortcuts -----------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

      // Cmd/Ctrl+S deliberately NOT bound: the chart auto-saves to
      // localStorage on every edit, so the system shortcut would only
      // trigger a JSON download — confusing for users with the muscle
      // memory of "save without leaving the app." Use the Download
      // JSON toolbar button when you actually need a file copy.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        document.getElementById("orgchart-file-input")?.click();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        canvasRef.current?.fitToContent();
        return;
      }

      // Undo / redo. Skipped while typing in an input — the browser's
      // own per-field undo handles text edits, and intercepting here
      // would surprise users mid-rename. Outside fields, Ctrl/Cmd+Z
      // reverts the last chart change; Shift adds redo, as does Ctrl+Y.
      if ((e.metaKey || e.ctrlKey) && !inField && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !inField && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      // Group / ungroup — Ctrl+G groups the selection, Ctrl+Shift+G
      // ungroups. Browser default for Ctrl+G is "find next" — fine to
      // shadow inside the editor since it only fires when nothing in
      // the property panel has focus.
      if ((e.metaKey || e.ctrlKey) && !inField && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }

      // Select-all — switches the selection to a multi-select containing
      // every box on the canvas so the user can apply bulk operations
      // (align, match-size, build hierarchy) without manually shift-clicking.
      if ((e.metaKey || e.ctrlKey) && !inField && e.key.toLowerCase() === "a") {
        e.preventDefault();
        if (chart && chart.boxes.length > 0) {
          if (chart.boxes.length === 1) {
            setSelection({ kind: "box", id: chart.boxes[0].id });
          } else {
            setSelection({ kind: "boxes", ids: chart.boxes.map((b) => b.id) });
          }
        }
        return;
      }

      if (inField) return;
      if (e.key === "Escape") {
        setSelection({ kind: "none" });
        setEdgePlus(null);
        setLinkPickFrom(null);
        setResizingBoxId(null);
        setBoxAction(null);
        setBoxContextMenu(null);
        setConnectorContextMenu(null);
        setConnectorDropAction(null);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selection.kind === "box") deleteBox(selection.id);
        else if (selection.kind === "connector") deleteConnector(selection.id);
        else if (selection.kind === "connectors") {
          const idSet = new Set(selection.ids);
          setChart((c) => (c ? { ...c, connectors: c.connectors.filter((cn) => !idSet.has(cn.id)) } : c));
          setSelection({ kind: "none" });
        } else if (selection.kind === "boxes") {
          const boxIds = new Set(selection.ids);
          setChart((c) => (c ? {
            ...c,
            boxes: c.boxes.filter((b) => !boxIds.has(b.id)),
            connectors: c.connectors.filter((cn) => !boxIds.has(cn.fromBoxId) && !boxIds.has(cn.toBoxId)),
          } : c));
          setSelection({ kind: "none" });
        } else if (selection.kind === "mixed") {
          const boxIds = new Set(selection.boxIds);
          const connIds = new Set(selection.connectorIds);
          setChart((c) => (c ? {
            ...c,
            boxes: c.boxes.filter((b) => !boxIds.has(b.id)),
            // Drop both explicitly-selected connectors AND any connector
            // whose endpoint box is being deleted (otherwise we'd leave
            // dangling connectors pointing at gone boxes).
            connectors: c.connectors.filter((cn) =>
              !connIds.has(cn.id) && !boxIds.has(cn.fromBoxId) && !boxIds.has(cn.toBoxId)
            ),
          } : c));
          setSelection({ kind: "none" });
        }
      }

      // Arrow keys nudge the selected box(es). 1px without modifier
      // for fine adjustments; 10px with Shift for faster movement.
      // Skips locked boxes and bypasses the grid-snap that mouse drags
      // apply, so keyboard nudges are pixel-precise. For a connector
      // with custom endpoints, the same arrow keys slide the endpoints
      // along their attachment sides instead.
      if (e.key.startsWith("Arrow") && chart) {
        let dx = 0, dy = 0;
        const step = e.shiftKey ? 10 : 1;
        if (e.key === "ArrowLeft") dx = -step;
        else if (e.key === "ArrowRight") dx = step;
        else if (e.key === "ArrowUp") dy = -step;
        else if (e.key === "ArrowDown") dy = step;
        else return;
        if (selection.kind === "box") {
          const b = chart.boxes.find((x) => x.id === selection.id);
          if (!b || b.locked) return;
          e.preventDefault();
          updateBox(b.id, { x: b.x + dx, y: b.y + dy });
        } else if (selection.kind === "boxes") {
          e.preventDefault();
          const ids = new Set(selection.ids);
          setChart((c) => (c ? {
            ...c,
            boxes: c.boxes.map((b) =>
              ids.has(b.id) && !b.locked ? { ...b, x: b.x + dx, y: b.y + dy } : b
            ),
            // Translate connector overrides for connectors that sit
            // wholly inside the selection — same reasoning as a mouse
            // group drag: anchors / elbows are absolute world coords.
            connectors: c.connectors.map((cn) => {
              if (!ids.has(cn.fromBoxId) || !ids.has(cn.toBoxId)) return cn;
              if (cn.elbowX === undefined && cn.elbowY === undefined && !cn.toAnchor) return cn;
              const next = { ...cn };
              if (cn.elbowX !== undefined) next.elbowX = cn.elbowX + dx;
              if (cn.elbowY !== undefined) next.elbowY = cn.elbowY + dy;
              if (cn.toAnchor) next.toAnchor = { x: cn.toAnchor.x + dx, y: cn.toAnchor.y + dy };
              return next;
            }),
          } : c));
        } else if (selection.kind === "connector") {
          const c = chart.connectors.find((x) => x.id === selection.id);
          if (!c || !c.customEndpoints) return;
          if (c.locked) return;
          const a = chart.boxes.find((b) => b.id === c.fromBoxId);
          const tBox = chart.boxes.find((b) => b.id === c.toBoxId);
          if (!a || !tBox) return;
          e.preventDefault();
          // For each endpoint, the arrow direction parallel to its
          // side translates into a fractional-offset delta along that
          // side. Top/bottom sides → dx along width; left/right sides
          // → dy along height. Sides perpendicular to the cursor
          // motion are left untouched, so a horizontal connector
          // (right ↔ left) moves only on Up/Down.
          function shiftOffset(side: ConnectorSide, oldOffset: number | undefined, box: { width: number; height: number }): number {
            const t = oldOffset ?? 0.5;
            if (side === "top" || side === "bottom") {
              return Math.min(1, Math.max(0, t + dx / box.width));
            }
            return Math.min(1, Math.max(0, t + dy / box.height));
          }
          const fromSide = c.fromSide ?? "right";
          const toSide = c.toSide ?? "left";
          updateConnector(c.id, {
            fromOffset: shiftOffset(fromSide, c.fromOffset, a),
            toOffset: shiftOffset(toSide, c.toOffset, tBox),
          });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, chart]);

  // ---- Toolbar handlers -------------------------------------------
  function handlePrint() {
    // Print only what's inside the active paper-space boundary. If no
    // paper size is set, ask the user to pick one (or marquee a
    // region) so the print isn't a wall of canvas.
    if (!chart || !chart.paperSize || chart.paperSize === "off") {
      const ok = window.confirm(
        "No paper size is selected. Pick one from the Paper menu in the toolbar to control what gets printed (Letter / Legal / Tabloid in portrait or landscape).\n\nClick OK to default to Letter Landscape and continue, or Cancel to set it yourself.",
      );
      if (!ok) return;
      patchChart({ paperSize: "letter-landscape" });
      // Defer the print until React commits the paper-size change so
      // the @media print rule clips to the new boundary.
      setTimeout(() => printPaperWindow(), 50);
      return;
    }
    printPaperWindow();
  }
  /** Open a self-contained window showing the chart cropped to the
   *  paper boundary, then trigger that window's print dialog. Using a
   *  child window decouples the print from React's live viewport / UI
   *  chrome — the printed page is always exactly the paper rectangle
   *  with the chart inside, regardless of the user's current zoom or
   *  pan in the editor. */
  function printPaperWindow() {
    if (!chart) return;
    const html = renderChartHtml(chart, { autoPrint: true });
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      window.alert("Please allow pop-ups so the print preview can open in a new window.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
  /** Save a self-contained .html snapshot of the chart so it can be
   *  shared / archived without round-tripping through the editor. The
   *  file embeds the same paper-cropped view used for print. */
  function handleExportHtml() {
    if (!chart) return;
    const html = renderChartHtml(chart, { autoPrint: false });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(chart.title || "org-chart").replace(/[^a-z0-9._-]+/gi, "_")}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function jumpToValidation() {
    setSelection({ kind: "none" });
    setTimeout(() => {
      document.getElementById("orgchart-validation")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }
  function reset() {
    if (!window.confirm("Reset this chart to a fresh seed? Edits will be lost.")) return;
    setChart(seedChart());
    setSelection({ kind: "none" });
  }

  /** Toggle uniform-size enforcement. Flipping ON snaps every box to
   *  the largest natural size on the next layout pass; flipping OFF
   *  lets per-box widths/heights ride (used by importers). */
  function toggleUniformSize() {
    if (!chart) return;
    patchChart({ uniformSize: chart.uniformSize === false });
  }

  /** Send a hand-drawn sketch (PDF or image) to the backend AI parser
   *  and replace the current chart with the result. The endpoint
   *  returns ChartState-shaped JSON; we trust the server schema (it's
   *  validated server-side via Pydantic) and only sanity-check that
   *  there's at least one box before applying. */
  async function handleImportSketch(file: File) {
    if (!chart) return;
    // No "save first" prompt: edits auto-save to localStorage and
    // prior charts stay accessible from the Projects screen, so an
    // import is never destructive in the way the prompt implied.
    setSketchBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/orgchart/import-sketch", { method: "POST", body: fd });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Server returned ${res.status}: ${text || res.statusText}`);
      }
      const data = await res.json() as { chart: ChartState; summary: { boxes: number; connectors: number; notes: string[] } };
      if (!data.chart || !Array.isArray(data.chart.boxes) || data.chart.boxes.length === 0) {
        throw new Error("Claude couldn't find any boxes in the sketch. Try a clearer image or a higher-contrast scan.");
      }
      setChart({ ...data.chart, theme: chart.theme, uniformSize: false });
      setSelection({ kind: "none" });
      window.setTimeout(() => canvasRef.current?.fitToContent(), 0);
      const lines = [
        `Imported ${data.summary.boxes} box${data.summary.boxes === 1 ? "" : "es"} and ${data.summary.connectors} connector${data.summary.connectors === 1 ? "" : "s"} from ${file.name}.`,
        ...data.summary.notes,
        "Tip: review labels — Claude reads sketch text, but messy handwriting can mis-OCR.",
      ];
      window.alert(lines.join("\n\n"));
    } catch (err) {
      window.alert("Could not import sketch: " + (err as Error).message);
    } finally {
      setSketchBusy(false);
    }
  }

  async function handleImportPptx(file: File) {
    if (!chart) return;
    // No "save first" prompt: edits auto-save and old projects stay
    // available on the Projects screen — see handleImportSketch.
    // Pre-flight: check how many slides have chart-bearing shapes.
    // 0–1 with shapes → pick automatically. 2+ → show picker so the
    // user explicitly picks the right slide instead of getting the
    // first non-empty one. Decks like Rosewood (one chart, divider
    // slides around it) hit the 0–1 path and skip the picker.
    let slidePath: string | undefined;
    try {
      const slides = await listPptxSlides(file);
      const richSlides = slides.filter((s) => s.shapesWithText >= 2);
      if (richSlides.length > 1) {
        setSlidePicker({ file, slides });
        return;
      }
    } catch {
      // If the pre-scan fails (corrupt zip, weird structure), fall
      // through to importPptx — it has its own error handling.
    }
    await runImportPptx(file, slidePath);
  }

  /** Actually run the PPTX import. Split out from `handleImportPptx`
   *  so the slide-picker modal can call it once the user picks a
   *  slide. The replace-confirm has already been satisfied by the
   *  caller — don't re-prompt. */
  async function runImportPptx(file: File, slidePath: string | undefined) {
    if (!chart) return;
    try {
      const { chart: imported, summary } = await importPptx(file, chart, { slidePath });
      setChart(imported);
      setSelection({ kind: "none" });
      window.setTimeout(() => canvasRef.current?.fitToContent(), 0);
      const lines = [
        `Imported ${summary.imported} box${summary.imported === 1 ? "" : "es"} and ${summary.connectorsLinked} connector${summary.connectorsLinked === 1 ? "" : "s"} from ${file.name}.`,
      ];
      if (summary.skipped > 0) lines.push(`${summary.skipped} shape${summary.skipped === 1 ? "" : "s"} skipped (no text).`);
      lines.push(...summary.notes);
      lines.push("Layout, sizes, and source colors preserved. Toggle UNIFORM in the toolbar to lock all boxes to one size.");
      window.alert(lines.join("\n\n"));
    } catch (err) {
      window.alert("Could not import: " + (err as Error).message);
    }
  }

  function runAutoArrange() {
    if (!chart) return;
    const positions = autoArrange(chart);
    if (positions.size === 0) return;
    setAnimating(true);
    setChart((c) => (c ? {
      ...c,
      boxes: c.boxes.map((b) => {
        const p = positions.get(b.id);
        return p ? { ...b, x: p.x, y: p.y } : b;
      }),
    } : c));
    window.setTimeout(() => setAnimating(false), 450);
    window.setTimeout(() => canvasRef.current?.fitToContent(), 480);
  }

  // While the project is loading, render a tiny placeholder so the
  // measurement node still mounts (avoids a flash of wrong sizes when
  // the chart pops in).
  if (!chart) {
    return (
      <div className="orgchart-root">
        <div ref={measureRef} aria-hidden="true" />
        <div className="text-[12px] text-gencom-stone">Loading project…</div>
      </div>
    );
  }

  return (
    <div className="orgchart-root flex flex-col gap-2 -mt-6">
      <div ref={measureRef} aria-hidden="true" />
      <div className="flex items-center gap-2 -mb-2">
        <Link
          to="/org-chart"
          className="ib-button-ghost text-xs inline-flex items-center gap-1"
          title="Back to projects"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </Link>
        <SaveIndicator at={lastSavedAt} />
      </div>
      <Toolbar
        chart={chart}
        gridMode={gridMode}
        onGridModeChange={setGridMode}
        onTitleChange={(t) => patchChart({ title: t })}
        onAddBox={() => addBox()}
        onThemeChange={setTheme}
        zoom={viewport.zoom}
        onZoomIn={() => setViewport((v) => ({ ...v, zoom: Math.min(2.5, v.zoom * 1.15) }))}
        onZoomOut={() => setViewport((v) => ({ ...v, zoom: Math.max(0.25, v.zoom / 1.15) }))}
        onZoomFit={() => canvasRef.current?.fitToContent()}
        onZoom100={() => canvasRef.current?.reset100()}
        warningCount={warningCount(validation)}
        onJumpToValidation={jumpToValidation}
        onSave={save}
        onLoad={load}
        onPrint={handlePrint}
        onReset={reset}
        onAutoArrange={runAutoArrange}
        onImportPptx={handleImportPptx}
        onExportPptx={handleExportPptx}
        onExportHtml={handleExportHtml}
        onImportSketch={handleImportSketch}
        uniformSize={chart.uniformSize !== false}
        onToggleUniformSize={toggleUniformSize}
        paperSize={chart.paperSize ?? "off"}
        onPaperSizeChange={setPaperSize}
        sketchBusy={sketchBusy}
      />

      <div className="flex gap-3 items-start">
        <div className="flex-1 min-w-0">
          <Canvas
            ref={canvasRef}
            chart={chart}
            selection={selection}
            warningsByParent={validation.parents}
            viewport={viewport}
            onViewport={setViewport}
            onSelect={setSelection}
            onMoveBox={moveBox}
            onMoveBoxes={moveBoxes}
            onClearSelection={() => {
              setSelection({ kind: "none" });
              setLinkPickFrom(null);
              setEdgePlus(null);
              setResizingBoxId(null);
            }}
            resizingBoxId={resizingBoxId}
            onResizeBox={resizeBox}
            onExitResize={() => setResizingBoxId(null)}
            animating={animating}
            onConnect={(fromId, toId) => {
              addConnector(fromId, toId);
              setLinkPickFrom(null);
            }}
            onRename={(id, next) => updateBox(id, { name: next })}
            onUpdateConnector={updateConnector}
            onEdgePlus={(boxId, edge, anchor) => {
              // The legacy popover flow only fires when the user has
              // armed the box for an action via the right-click menu.
              // Translate the click into the requested action directly
              // (no second popover) and clear the action.
              if (!boxAction || boxAction.id !== boxId) {
                handleEdgePlus(boxId, edge, anchor);
                return;
              }
              if (boxAction.mode === "newBox") {
                addNeighborOf(boxId, edge);
              } else {
                setLinkPickFrom(boxId);
              }
              setBoxAction(null);
            }}
            linkPickFrom={linkPickFrom}
            boxAction={boxAction}
            onBoxContextMenu={(boxId, anchor) => {
              // Preserve a multi-box selection when the user right-
              // clicks on a box that's already part of it — otherwise
              // the BoxContextMenu loses access to Group/Ungroup and
              // multi-aware Lock / Delete because it collapsed to a
              // single-box selection. Right-clicking outside the
              // current multi-selection switches to that single box.
              const stillInMulti = selection.kind === "boxes" && selection.ids.includes(boxId);
              const stillInMixed = selection.kind === "mixed" && selection.boxIds.includes(boxId);
              if (!stillInMulti && !stillInMixed) setSelection({ kind: "box", id: boxId });
              setBoxContextMenu({ boxId, anchor });
            }}
            onConnectAnchor={addConnectorToAnchor}
            onConnectorContextMenu={(connectorId, screen, world) => {
              setConnectorContextMenu({ connectorId, screenAnchor: screen, worldAnchor: world });
            }}
            connectorDropAction={connectorDropAction}
            onCompleteConnectorDrop={(boxId) => {
              if (!connectorDropAction || !chart) return;
              addConnectorToAnchor(boxId, connectorDropAction.connectorId, connectorDropAction.anchor);
              setConnectorDropAction(null);
            }}
            pendingLabelEditId={pendingLabelEditId}
            onLabelEditConsumed={() => setPendingLabelEditId(null)}
            multiActions={{
              onConnect: bulkConnect,
              onBuildHierarchy: buildHierarchy,
              onAlign: alignSelection,
              onMatchSize: matchSize,
              onGroup: groupSelection,
              onUngroup: ungroupSelection,
              onFitToPage: fitToPage,
              hasPaperSize: !!chart.paperSize && chart.paperSize !== "off",
              onGroupResize: groupResize,
              onCancel: () => setSelection({ kind: "none" }),
            }}
          />
          <p className="orgchart-help mt-1 text-[11.5px] text-gencom-stone">
            Click empty canvas to deselect. <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Space</kbd>+drag pans · <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Shift</kbd>+scroll zooms · <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Shift</kbd>+drag locks axis · <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Ctrl+A</kbd> selects all · <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Ctrl+Z</kbd> / <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Ctrl+Shift+Z</kbd> undo/redo · <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Del</kbd> deletes selection · edits auto-save.
          </p>
        </div>
        <PropertyPanel
          chart={chart}
          selection={selection}
          validation={validation}
          onUpdateBox={updateBox}
          onUpdateBoxes={updateBoxes}
          onUpdateConnector={updateConnector}
          onUpdateConnectors={(ids, patch) => {
            const idSet = new Set(ids);
            setChart((c) => (c ? {
              ...c,
              connectors: c.connectors.map((cn) => idSet.has(cn.id) ? { ...cn, ...patch } : cn),
            } : c));
          }}
          onDeleteConnectors={(ids) => {
            const idSet = new Set(ids);
            setChart((c) => (c ? {
              ...c,
              connectors: c.connectors.filter((cn) => !idSet.has(cn.id)),
            } : c));
            setSelection({ kind: "none" });
          }}
          onDeleteBox={deleteBox}
          onDeleteConnector={deleteConnector}
          onConnect={addConnector}
          onSelectBox={(id) => setSelection({ kind: "box", id })}
          onGroupMixed={() => {
            if (selection.kind !== "mixed" || selection.boxIds.length === 0) return;
            const gid = "g_" + Math.random().toString(36).slice(2, 10);
            const ids = new Set(selection.boxIds);
            setChart((c) => (c ? { ...c, boxes: c.boxes.map((b) => (ids.has(b.id) ? { ...b, groupId: gid } : b)) } : c));
          }}
          onUngroupMixed={() => {
            if (selection.kind !== "mixed") return;
            const ids = new Set(selection.boxIds);
            setChart((c) => (c ? { ...c, boxes: c.boxes.map((b) => (ids.has(b.id) ? { ...b, groupId: undefined } : b)) } : c));
          }}
          onFitSelectionToPage={() => {
            // Compute a bbox around every selected box + connector
            // endpoint and ask the canvas to pan/zoom to fit it.
            if (!chart) return;
            const sel = selection;
            const boxIds: string[] = sel.kind === "boxes" ? sel.ids
              : sel.kind === "box" ? [sel.id]
              : sel.kind === "mixed" ? sel.boxIds
              : [];
            const connIds: string[] = sel.kind === "connectors" ? sel.ids
              : sel.kind === "connector" ? [sel.id]
              : sel.kind === "mixed" ? sel.connectorIds
              : [];
            const targets = chart.boxes.filter((b) => boxIds.includes(b.id));
            for (const c of chart.connectors) {
              if (!connIds.includes(c.id)) continue;
              const from = chart.boxes.find((b) => b.id === c.fromBoxId);
              const to = chart.boxes.find((b) => b.id === c.toBoxId);
              if (from && !targets.includes(from)) targets.push(from);
              if (to && !targets.includes(to)) targets.push(to);
            }
            if (targets.length === 0) return;
            const minX = Math.min(...targets.map((b) => b.x));
            const minY = Math.min(...targets.map((b) => b.y));
            const maxX = Math.max(...targets.map((b) => b.x + b.width));
            const maxY = Math.max(...targets.map((b) => b.y + b.height));
            canvasRef.current?.fitToBbox({ x: minX - 40, y: minY - 40, width: (maxX - minX) + 80, height: (maxY - minY) + 80 });
          }}
        />
      </div>

      {edgePlus && (
        <EdgePlusMenu
          anchor={edgePlus.anchor}
          onPickNewBox={handlePickNewBox}
          onPickConnectExisting={handlePickConnectExisting}
          onPickResize={handlePickResize}
          onClose={() => setEdgePlus(null)}
        />
      )}

      {/* Right-click context menu on a box. Reuses the EdgePlusMenu UI
          but the picks arm `boxAction` instead of acting on a specific
          edge. Once armed, the corresponding box renders edge "+" buttons
          so the user can pick a direction. */}
      {boxContextMenu && (() => {
        const targetBox = chart?.boxes.find((b) => b.id === boxContextMenu.boxId);
        const isMulti = selection.kind === "boxes"
          && selection.ids.length > 1
          && selection.ids.includes(boxContextMenu.boxId);
        const multiIds = isMulti ? (selection.kind === "boxes" ? selection.ids : []) : [];
        const anyGrouped = isMulti
          ? multiIds.some((id) => chart?.boxes.find((b) => b.id === id)?.groupId)
          : !!targetBox?.groupId;
        return (
          <BoxContextMenu
            anchor={boxContextMenu.anchor}
            isMulti={isMulti}
            isLocked={!!targetBox?.locked}
            isGrouped={anyGrouped}
            onPickNewBox={() => {
              setBoxAction({ id: boxContextMenu.boxId, mode: "newBox" });
              setBoxContextMenu(null);
            }}
            onPickConnectExisting={() => {
              setBoxAction({ id: boxContextMenu.boxId, mode: "connect" });
              setBoxContextMenu(null);
            }}
            onPickResize={() => {
              if (chart && chart.uniformSize !== false) patchChart({ uniformSize: false });
              setResizingBoxId(boxContextMenu.boxId);
              setSelection({ kind: "box", id: boxContextMenu.boxId });
              setBoxContextMenu(null);
            }}
            onPickDelete={() => {
              if (isMulti) {
                const idSet = new Set(multiIds);
                setChart((c) => (c ? { ...c, boxes: c.boxes.filter((b) => !idSet.has(b.id)) } : c));
                setSelection({ kind: "none" });
              } else {
                deleteBox(boxContextMenu.boxId);
              }
              setBoxContextMenu(null);
            }}
            onPickLockToggle={() => {
              if (isMulti) {
                // Lock state may be mixed across the selection; the
                // toggle pushes whichever value flips the majority so
                // a second click reverts.
                const lockedCount = multiIds.filter((id) => chart?.boxes.find((b) => b.id === id)?.locked).length;
                const targetLocked = lockedCount < multiIds.length;
                updateBoxes(multiIds, { locked: targetLocked || undefined });
              } else if (targetBox) {
                updateBox(targetBox.id, { locked: !targetBox.locked || undefined });
              }
              setBoxContextMenu(null);
            }}
            onPickGroupToggle={() => {
              if (anyGrouped) {
                ungroupSelection();
              } else if (isMulti) {
                groupSelection();
              }
              setBoxContextMenu(null);
            }}
            onClose={() => setBoxContextMenu(null)}
          />
        );
      })()}

      {boxAction && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-md shadow-lg">
          {boxAction.mode === "newBox"
            ? "Click a + on the box edge to add a new box in that direction — Esc to cancel"
            : "Click a + on the box edge to start a connection — Esc to cancel"}
        </div>
      )}

      {connectorContextMenu && (() => {
        const cn = chart?.connectors.find((c) => c.id === connectorContextMenu.connectorId);
        return (
          <ConnectorContextMenu
            anchor={connectorContextMenu.screenAnchor}
            canAddElbow={!!cn}
            onPickAddNew={() => {
              setConnectorDropAction({
                connectorId: connectorContextMenu.connectorId,
                anchor: connectorContextMenu.worldAnchor,
              });
              setConnectorContextMenu(null);
            }}
            onPickAddElbow={() => {
              if (!cn) return;
              // Drop a bend at the click point on the line. Behavior
              // depends on the current route style:
              //   - Straight: switch to orthogonal stepped (extra) so
              //     the path can carry a bend; both elbowX/elbowY are
              //     set to the click so the bend lands exactly there.
              //   - Orthogonal: just update the elbow override(s) to
              //     the click point. The router already honors
              //     elbowX/elbowY in min and extra modes — for L-shape
              //     min, providing the override promotes to a 4-segment
              //     path with the bend at the click; for Z-shape min
              //     and stepped, the existing trunk shifts to the
              //     click coordinates.
              const click = connectorContextMenu.worldAnchor;
              const patch: Partial<Connector> = cn.routeStyle === "straight"
                ? { routeStyle: "orthogonal", routeDetail: "extra", elbowX: click.x, elbowY: click.y, customEndpoints: true }
                : { elbowX: click.x, elbowY: click.y, customEndpoints: true };
              updateConnector(cn.id, patch);
              setConnectorContextMenu(null);
            }}
            onPickAddText={() => {
              if (!cn) return;
              const click = connectorContextMenu.worldAnchor;
              const fromBox = chart?.boxes.find((b) => b.id === cn.fromBoxId);
              const seedFontSize = fromBox?.fontSizePt;
              const hasMidLabel = !!(cn.labelMid && cn.labelMid.trim()) || !!(cn.label && cn.label.trim());
              if (!hasMidLabel) {
                // First label on this connector — fill labelMid and
                // arm the inline editor so the user starts typing
                // immediately. Seed fontSize from the source box so
                // the new text reads at box-name scale.
                const patch: Partial<Connector> = { labelMid: "", label: undefined };
                if (cn.labelFontSizePt === undefined && seedFontSize !== undefined) {
                  patch.labelFontSizePt = seedFontSize;
                }
                updateConnector(cn.id, patch);
                setSelection({ kind: "connector", id: cn.id });
                setPendingLabelEditId(cn.id);
              } else {
                // Subsequent labels go into the `labels[]` array so
                // each one keeps its own position + styling. The
                // anchor position is stored as a free-mode offset
                // from the connector's PATH MIDPOINT — that point is
                // the same anchor the primary labelMid uses, so the
                // new label sits exactly where the user clicked
                // regardless of how the path is currently routed.
                // Selecting + arming the editor for this label is
                // wired through pendingLabelEditId once we add inline
                // editing for arbitrary label ids; for now, the user
                // edits the new label via the right-hand label panel.
                const newId = "lbl_" + Math.random().toString(36).slice(2, 10);
                const existing = cn.labels ?? [];
                const newLabel: ConnectorTextLabel = {
                  id: newId,
                  text: "New text",
                  mode: "free",
                  offset: { x: click.x, y: click.y },
                  fontSizePt: cn.labelFontSizePt ?? seedFontSize,
                };
                updateConnector(cn.id, { labels: [...existing, newLabel] });
                setSelection({ kind: "connectorLabel", connectorId: cn.id, labelId: newId });
              }
              setConnectorContextMenu(null);
            }}
            onPickDelete={() => {
              if (!cn) return;
              deleteConnector(cn.id);
              setConnectorContextMenu(null);
            }}
            onClose={() => setConnectorContextMenu(null)}
          />
        );
      })()}

      {connectorDropAction && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-md shadow-lg">
          Click a box to drop the new connector — Esc to cancel
        </div>
      )}

      {resizingBoxId && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-md shadow-lg">
          Drag any handle to resize — Esc or click outside to finish
        </div>
      )}

      {linkPickFrom && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-700 text-white text-xs font-semibold px-3 py-2 rounded-md shadow-lg">
          Click any box to connect — Esc to cancel
        </div>
      )}

      {slidePicker && (
        <SlidePickerModal
          file={slidePicker.file}
          slides={slidePicker.slides}
          onPick={(path) => {
            const f = slidePicker.file;
            setSlidePicker(null);
            void runImportPptx(f, path);
          }}
          onCancel={() => setSlidePicker(null)}
        />
      )}

      {showThemePicker && (
        <ThemePickerModal
          onPick={(t) => {
            markThemePickerSeen();
            setTheme(t);
            setShowThemePicker(false);
          }}
          onClose={() => {
            markThemePickerSeen();
            setShowThemePicker(false);
          }}
        />
      )}
    </div>
  );
}

/** Modal shown when an imported deck has chart-bearing shapes on more
 *  than one slide. Lists each slide with its shape count and lets the
 *  user pick which one becomes the chart. The richest slide (most
 *  text-shapes) is highlighted as the recommended pick. */
function SlidePickerModal({
  file, slides, onPick, onCancel,
}: {
  file: File;
  slides: SlideInfo[];
  onPick: (path: string) => void;
  onCancel: () => void;
}) {
  const recommended = slides.reduce((a, b) => (b.shapesWithText > a.shapesWithText ? b : a));
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-md shadow-xl border border-gencom-sand max-w-sm w-full p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="t-eyebrow">Import .pptx</div>
          <div className="text-base font-semibold text-gencom-ink mt-0.5">
            Pick a slide
          </div>
          <p className="text-[12px] text-gencom-stone mt-1">
            <span className="font-mono">{file.name}</span> has multiple
            chart-bearing slides — pick the one to import.
          </p>
        </div>
        <ul className="max-h-64 overflow-auto -mx-1">
          {slides.map((s) => {
            const isRec = s.path === recommended.path;
            return (
              <li key={s.path}>
                <button
                  type="button"
                  onClick={() => onPick(s.path)}
                  className={
                    "w-full text-left px-3 py-2 mx-1 rounded-md text-[13px] flex items-center justify-between transition " +
                    (isRec
                      ? "bg-emerald-50 text-gencom-ink hover:bg-emerald-100 border border-emerald-200"
                      : "text-gencom-ink hover:bg-gencom-mist border border-transparent")
                  }
                >
                  <span>
                    Slide {s.index}
                    {isRec && (
                      <span className="ml-2 text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">
                        Recommended
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-gencom-stone tabular-nums">
                    {s.shapesWithText} shape{s.shapesWithText === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-gencom-stone hover:bg-gencom-mist rounded px-2 py-1.5"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ at }: { at: number | null }) {
  // Re-render once a minute so "12s ago" doesn't go stale.
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!at) {
    return (
      <span
        className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5"
        title="Every edit you make is auto-saved to this browser. To hand off a copy, use File → Download JSON."
      >
        Auto-save on
      </span>
    );
  }
  const diff = Math.max(0, Date.now() - at);
  const sec = Math.round(diff / 1000);
  const label = sec < 5 ? "just now" : sec < 60 ? `${sec}s ago` : `${Math.round(sec / 60)}m ago`;
  return (
    <span
      className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5"
      title="Every edit auto-saves to this browser. File → Download JSON exports a copy."
    >
      Saved · {label}
    </span>
  );
}

/** Right-click menu for boxes. Shorter / action-only labels (no
 *  descriptions) since each item is short and self-explanatory.
 *  Group/Ungroup only renders when a multi-box selection is active,
 *  and the label flips to "Ungroup" once any selected box already
 *  belongs to a group. Lock/Unlock flips its label based on the
 *  target box's current state (or the majority for multi-select). */
function BoxContextMenu({
  anchor, isMulti, isLocked, isGrouped,
  onPickNewBox, onPickConnectExisting, onPickResize, onPickDelete,
  onPickLockToggle, onPickGroupToggle, onClose,
}: {
  anchor: { x: number; y: number };
  isMulti: boolean;
  isLocked: boolean;
  isGrouped: boolean;
  onPickNewBox: () => void;
  onPickConnectExisting: () => void;
  onPickResize: () => void;
  onPickDelete: () => void;
  onPickLockToggle: () => void;
  onPickGroupToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const w = 180;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, anchor.x + 8));
  const top = Math.min(window.innerHeight - 240, Math.max(8, anchor.y + 8));
  const itemCls = "w-full text-left px-3 py-2 hover:bg-emerald-50 transition text-[13px] font-medium text-gencom-ink";
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Box options"
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-50 bg-white rounded-md border border-gencom-sand shadow-xl py-1.5"
      style={{ left, top, width: w }}
    >
      {!isMulti && (
        <>
          <button type="button" role="menuitem" onClick={onPickNewBox} className={itemCls}>
            New box
          </button>
          <button type="button" role="menuitem" onClick={onPickConnectExisting} className={itemCls + " border-t border-gencom-sand"}>
            Connect to existing
          </button>
          <button type="button" role="menuitem" onClick={onPickResize} className={itemCls + " border-t border-gencom-sand"}>
            Resize
          </button>
        </>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={onPickLockToggle}
        className={itemCls + (isMulti ? "" : " border-t border-gencom-sand")}
      >
        {isLocked ? "Unlock" : "Lock"}
      </button>
      {isMulti && (
        <button
          type="button"
          role="menuitem"
          onClick={onPickGroupToggle}
          className={itemCls + " border-t border-gencom-sand"}
        >
          {isGrouped ? "Ungroup" : "Group"}
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={onPickDelete}
        className="w-full text-left px-3 py-2 hover:bg-red-50 transition text-[13px] font-medium text-red-700 border-t border-gencom-sand"
      >
        Delete
      </button>
    </div>
  );
}

/** Small popover shown when the user right-clicks a connector. Today
 *  it has a single option (drop a new connector to a box) but the
 *  shape mirrors EdgePlusMenu so it can grow if more line-context
 *  actions get added later. */
function ConnectorContextMenu({
  anchor, canAddElbow, onPickAddNew, onPickAddElbow, onPickAddText, onPickDelete, onClose,
}: {
  anchor: { x: number; y: number };
  canAddElbow: boolean;
  onPickAddNew: () => void;
  onPickAddElbow: () => void;
  onPickAddText: () => void;
  onPickDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const w = 220;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, anchor.x + 8));
  const top = Math.min(window.innerHeight - 80, Math.max(8, anchor.y + 8));
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Connector options"
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-50 bg-white rounded-md border border-gencom-sand shadow-xl py-1.5"
      style={{ left, top, width: w }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onPickAddNew}
        className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition text-[13px] font-medium text-gencom-ink"
      >
        Add new connector
      </button>
      {canAddElbow && (
        <button
          type="button"
          role="menuitem"
          onClick={onPickAddElbow}
          className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition border-t border-gencom-sand text-[13px] font-medium text-gencom-ink"
        >
          Add elbow here
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={onPickAddText}
        className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition border-t border-gencom-sand text-[13px] font-medium text-gencom-ink"
      >
        Add text
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onPickDelete}
        className="w-full text-left px-3 py-2 hover:bg-red-50 transition border-t border-gencom-sand text-[13px] font-medium text-red-700"
      >
        Delete connector
      </button>
    </div>
  );
}

