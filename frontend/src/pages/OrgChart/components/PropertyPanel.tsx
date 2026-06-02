// Right-side panel — context-sensitive based on selection. The four
// states from the spec:
//   1. Nothing selected — chart-level summary + validation list.
//   2. Box selected — name, entity type, ownership %, colors, "Connect to"
//      list, delete.
//   3. Connector selected — source/target labels, route style, arrowhead
//      toggle, delete.
//   4. Multi-select — deferred to V2; we only support single-select today.

import { AlignCenter, AlignLeft, AlignRight, ArrowDownToDot, Lock, LockOpen, Trash2, X } from "lucide-react";

import type { Box, ChartState, Connector, ConnectorSide, Selection } from "../lib/types";
import { ENTITY_TYPES } from "../lib/types";
import {
  BORDER_SWATCHES, BOX_PALETTES, FILL_SWATCHES, TEXT_SWATCHES, matchPalette,
} from "../lib/palettes";
import type { Validation } from "../lib/validation";

/** Pick sides + offsets that make a connector a single perfectly
 *  horizontal or vertical segment. For "horizontal" the source and
 *  target use opposite left/right sides; the shared Y is the centre of
 *  the boxes' Y overlap (or the average of their centres if they don't
 *  overlap). "vertical" mirrors with top/bottom + X. routeStyle is
 *  forced to "straight" so the path is a single segment. Sets
 *  `customEndpoints: true` so the user sees handles to fine-tune. */
function forceAxis(
  conn: Connector, from: Box, to: Box, axis: "horizontal" | "vertical",
): Partial<Connector> {
  // Toggle: clicking the same Force button while the axis is already
  // locked clears the lock (and the customEndpoints flag) so the user
  // can return to the auto-router.
  if (conn.axisLock === axis) {
    return { axisLock: undefined, customEndpoints: false };
  }
  if (axis === "horizontal") {
    const fromCx = from.x + from.width / 2;
    const toCx = to.x + to.width / 2;
    const fromSide: ConnectorSide = toCx >= fromCx ? "right" : "left";
    const toSide: ConnectorSide = fromSide === "right" ? "left" : "right";
    const overlapTop = Math.max(from.y, to.y);
    const overlapBottom = Math.min(from.y + from.height, to.y + to.height);
    const overlaps = overlapTop <= overlapBottom;
    if (overlaps) {
      // Both boxes share a Y range — a single straight horizontal
      // line at the shared midpoint truly is horizontal end-to-end.
      const sharedY = (overlapTop + overlapBottom) / 2;
      const fromOffset = clamp01((sharedY - from.y) / from.height);
      const toOffset = clamp01((sharedY - to.y) / to.height);
      return { fromSide, toSide, fromOffset, toOffset, routeStyle: "straight", customEndpoints: true, axisLock: "horizontal" };
    }
    // No Y overlap — a single straight line would be diagonal. Switch
    // to an orthogonal Z-shape: both endpoints exit perpendicular to
    // their left/right sides (so the entry/exit are perfectly
    // horizontal) and a vertical mid-segment at `elbowX` joins them.
    return { fromSide, toSide, fromOffset: 0.5, toOffset: 0.5, routeStyle: "orthogonal", customEndpoints: true, axisLock: "horizontal", elbowX: undefined };
  }
  const fromCy = from.y + from.height / 2;
  const toCy = to.y + to.height / 2;
  const fromSide: ConnectorSide = toCy >= fromCy ? "bottom" : "top";
  const toSide: ConnectorSide = fromSide === "bottom" ? "top" : "bottom";
  const overlapLeft = Math.max(from.x, to.x);
  const overlapRight = Math.min(from.x + from.width, to.x + to.width);
  const overlaps = overlapLeft <= overlapRight;
  if (overlaps) {
    const sharedX = (overlapLeft + overlapRight) / 2;
    const fromOffset = clamp01((sharedX - from.x) / from.width);
    const toOffset = clamp01((sharedX - to.x) / to.width);
    return { fromSide, toSide, fromOffset, toOffset, routeStyle: "straight", customEndpoints: true, axisLock: "vertical" };
  }
  // No X overlap — a single straight line would be diagonal. Switch
  // to an orthogonal Z-shape: both endpoints exit perpendicular to
  // their top/bottom sides (so the entry/exit are perfectly vertical)
  // and a horizontal mid-segment at `elbowY` joins them.
  return { fromSide, toSide, fromOffset: 0.5, toOffset: 0.5, routeStyle: "orthogonal", customEndpoints: true, axisLock: "vertical", elbowY: undefined };
}

function clamp01(v: number): number { return Math.min(1, Math.max(0, v)); }

export function PropertyPanel({
  chart,
  selection,
  validation,
  onUpdateBox,
  onUpdateBoxes,
  onUpdateConnector,
  onUpdateConnectors,
  onDeleteConnectors,
  onDeleteBox,
  onDeleteConnector,
  onConnect,
  onSelectBox,
  onGroupMixed,
  onUngroupMixed,
  onFitSelectionToPage,
}: {
  chart: ChartState;
  selection: Selection;
  validation: Validation;
  onUpdateBox: (id: string, patch: Partial<Box>) => void;
  /** Apply the same patch to every selected box. Wired to the
   *  multi-box editor's palette / swatch buttons. */
  onUpdateBoxes: (ids: string[], patch: Partial<Box>) => void;
  onUpdateConnector: (id: string, patch: Partial<Connector>) => void;
  onUpdateConnectors?: (ids: string[], patch: Partial<Connector>) => void;
  onDeleteConnectors?: (ids: string[]) => void;
  onDeleteBox: (id: string) => void;
  onDeleteConnector: (id: string) => void;
  onConnect: (fromId: string, toId: string) => void;
  onSelectBox: (id: string) => void;
  /** Stamp a shared groupId on every box in the current mixed
   *  selection so they move as one. Optional — wired from the
   *  parent editor; absent → the Mixed panel hides the Group btn. */
  onGroupMixed?: () => void;
  onUngroupMixed?: () => void;
  /** Pan + zoom so the current selection fits the viewport. */
  onFitSelectionToPage?: () => void;
}) {
  const box =
    selection.kind === "box"
      ? chart.boxes.find((b) => b.id === selection.id) ?? null
      : null;
  const connector =
    selection.kind === "connector"
      ? chart.connectors.find((c) => c.id === selection.id) ?? null
      : null;
  const multiBoxes =
    selection.kind === "boxes"
      ? chart.boxes.filter((b) => selection.ids.includes(b.id))
      : [];
  const multiConnectors =
    selection.kind === "connectors"
      ? chart.connectors.filter((c) => selection.ids.includes(c.id))
      : [];

  return (
    <aside
      id="orgchart-panel"
      className="orgchart-panel border border-gencom-sand rounded-md bg-white p-3 w-80 shrink-0 max-h-[calc(100vh-160px)] min-h-[520px] overflow-y-auto"
    >
      {selection.kind === "none" && (
        <ChartSummary chart={chart} validation={validation} onSelectBox={onSelectBox} />
      )}
      {box && (
        <BoxEditor
          box={box}
          chart={chart}
          onUpdate={(patch) => onUpdateBox(box.id, patch)}
          onDelete={() => onDeleteBox(box.id)}
          onConnect={(toId) => onConnect(box.id, toId)}
        />
      )}
      {multiBoxes.length > 0 && (
        <MultiBoxEditor
          boxes={multiBoxes}
          onUpdateAll={(patch) => onUpdateBoxes(multiBoxes.map((b) => b.id), patch)}
        />
      )}
      {connector && (
        <ConnectorEditor
          connector={connector}
          chart={chart}
          onUpdate={(patch) => onUpdateConnector(connector.id, patch)}
          onDelete={() => onDeleteConnector(connector.id)}
          onUpdateConnectors={onUpdateConnectors}
        />
      )}
      {selection.kind === "connectorLabel" && (() => {
        const cn = chart.connectors.find((c) => c.id === selection.connectorId);
        if (!cn) return null;
        return (
          <ConnectorLabelEditor
            connector={cn}
            labelId={selection.labelId}
            onUpdate={(patch) => onUpdateConnector(cn.id, patch)}
          />
        );
      })()}
      {multiConnectors.length > 0 && (
        <MultiConnectorEditor
          connectors={multiConnectors}
          chart={chart}
          onUpdateAll={(patch) => {
            if (onUpdateConnectors) {
              onUpdateConnectors(multiConnectors.map((c) => c.id), patch);
            } else {
              for (const c of multiConnectors) onUpdateConnector(c.id, patch);
            }
          }}
          onDeleteAll={() => {
            if (onDeleteConnectors) {
              onDeleteConnectors(multiConnectors.map((c) => c.id));
            } else {
              for (const c of multiConnectors) onDeleteConnector(c.id);
            }
          }}
        />
      )}
      {selection.kind === "mixed" && (() => {
        const selBoxes = chart.boxes.filter((b) => selection.boxIds.includes(b.id));
        const anyGrouped = selBoxes.some((b) => !!b.groupId);
        return (
          <MixedSelectionEditor
            boxes={selBoxes}
            connectors={chart.connectors.filter((c) => selection.connectorIds.includes(c.id))}
            anyGrouped={anyGrouped}
            onGroup={() => onGroupMixed?.()}
            onUngroup={() => onUngroupMixed?.()}
            onFitToPage={() => onFitSelectionToPage?.()}
            onDeleteAll={() => {
              for (const id of selection.boxIds) onDeleteBox(id);
              if (onDeleteConnectors) onDeleteConnectors(selection.connectorIds);
              else for (const id of selection.connectorIds) onDeleteConnector(id);
            }}
          />
        );
      })()}
    </aside>
  );
}

/** Bulk editor for a heterogeneous selection (boxes + connectors).
 *  Most type-specific operations (palette, route style, force-axis)
 *  don't make sense across both, so this view is intentionally minimal:
 *  it surfaces the selection counts and a single delete-all action.
 *  Movement of the boxes still works via canvas drag — the connectors
 *  in the selection simply ride along with the boxes they're anchored
 *  to, so a user can group-drag a sub-tree (boxes + child T-junction
 *  drop-lines) as one unit. */
function MixedSelectionEditor({
  boxes, connectors, onDeleteAll, onGroup, onFitToPage, anyGrouped, onUngroup,
}: {
  boxes: Box[];
  connectors: Connector[];
  onDeleteAll: () => void;
  /** Stamp a shared groupId on the selected boxes (and tag the
   *  connectors with the same id) so they're treated as a unit on
   *  later drags / aligns. Disabled when fewer than 2 items are
   *  selected (nothing to group with). */
  onGroup: () => void;
  /** Pan + zoom so every item in the current selection fits the
   *  visible viewport. Useful when the user has selected scattered
   *  content and wants to see it all at once. */
  onFitToPage: () => void;
  /** True if any of the selected boxes already carries a groupId —
   *  the Group button flips to Ungroup so a second click clears it. */
  anyGrouped: boolean;
  onUngroup: () => void;
}) {
  const total = boxes.length + connectors.length;
  const canGroup = total >= 2;
  return (
    <div className="space-y-3">
      <div>
        <div className="t-eyebrow">Selection</div>
        <div className="t-h2 mt-0.5">{total} items</div>
        <p className="text-[11.5px] text-gencom-stone mt-1">
          {boxes.length} box{boxes.length === 1 ? "" : "es"} · {connectors.length} connector{connectors.length === 1 ? "" : "s"}.
          Drag any selected box to move the whole group; connectors stay glued to the boxes they're anchored to.
        </p>
      </div>
      <div className="space-y-2">
        <button
          type="button"
          onClick={anyGrouped ? onUngroup : onGroup}
          disabled={!canGroup && !anyGrouped}
          className="w-full ib-button-ghost text-xs"
          title={anyGrouped
            ? "Ungroup — clear the shared groupId so each box moves independently again"
            : "Group — stamp a shared groupId so the selected boxes (and their connectors) move as one unit"}
        >
          {anyGrouped ? "Ungroup" : "Group together"}
        </button>
        <button
          type="button"
          onClick={onFitToPage}
          className="w-full ib-button-ghost text-xs"
          title="Pan + zoom so the entire selection fits the viewport"
        >
          Fit selection to page
        </button>
      </div>
      <div className="border-t border-gencom-sand pt-3 flex justify-end">
        <button
          onClick={onDeleteAll}
          className="text-xs text-red-700 hover:underline inline-flex items-center gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete {total} item{total === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}

/** Property panel section shown when ONLY a connector's text label
 *  is selected (kind: "connectorLabel"). Editing here mutates the
 *  label's styling without touching the line itself — the user can
 *  change the text color, font size, alignment, or position mode
 *  without applying any of those changes to the parent connector's
 *  routing. The line's right-click context menu remains the way to
 *  add additional labels to the same connector. */
function ConnectorLabelEditor({
  connector, labelId, onUpdate,
}: {
  connector: Connector;
  labelId: string;
  onUpdate: (patch: Partial<Connector>) => void;
}) {
  const isMid = labelId === "mid";
  // For "mid" the editor reads/writes connector.labelMid + connector
  // top-level styling; for any other id it reads/writes the matching
  // entry in connector.labels[]. Helpers normalize the two paths so
  // the JSX below stays single-shape.
  const extra = !isMid ? (connector.labels ?? []).find((l) => l.id === labelId) : undefined;
  if (!isMid && !extra) return null;
  const text = isMid
    ? (connector.labelMid ?? connector.label ?? "").replace(/\s+$/, "")
    : (extra!.text ?? "");
  const fontSizePt = isMid
    ? (connector.labelFontSizePt ?? 11)
    : (extra!.fontSizePt ?? connector.labelFontSizePt ?? 11);
  const color = isMid ? connector.labelColor : extra!.color;
  const align = isMid ? (connector.labelAlign ?? "center") : (extra!.align ?? "center");
  const mode = isMid ? (connector.labelMode ?? "on-connector") : (extra!.mode ?? "free");
  // Mutator dispatches to either top-level connector fields (labelMid
  // path) or to the matching entry in connector.labels[] (extra
  // path). All updates flow through onUpdate so the parent commits
  // them atomically.
  function patch(updates: { text?: string; fontSizePt?: number | undefined; color?: string | undefined; align?: "left" | "center" | "right"; mode?: "on-connector" | "free"; clearOffset?: boolean }) {
    if (isMid) {
      const p: Partial<Connector> = {};
      if (updates.text !== undefined) { p.labelMid = updates.text; p.label = undefined; }
      if (updates.fontSizePt !== undefined) p.labelFontSizePt = updates.fontSizePt;
      if (updates.color !== undefined) p.labelColor = updates.color;
      if (updates.align !== undefined) p.labelAlign = updates.align;
      if (updates.mode !== undefined) p.labelMode = updates.mode;
      if (updates.clearOffset) p.labelOffset = undefined;
      onUpdate(p);
    } else {
      const list = (connector.labels ?? []).map((l) => {
        if (l.id !== labelId) return l;
        const next = { ...l };
        if (updates.text !== undefined) next.text = updates.text;
        if (updates.fontSizePt !== undefined) next.fontSizePt = updates.fontSizePt;
        if (updates.color !== undefined) next.color = updates.color;
        if (updates.align !== undefined) next.align = updates.align;
        if (updates.mode !== undefined) next.mode = updates.mode;
        if (updates.clearOffset) next.offset = undefined;
        return next;
      });
      onUpdate({ labels: list });
    }
  }
  return (
    <div className="space-y-3">
      <div>
        <div className="t-eyebrow">Label</div>
        <div className="t-h2 mt-0.5">Connector text</div>
        <p className="text-[11.5px] text-gencom-stone mt-1">
          Editing the label only — the parent line keeps its current routing, color, and arrowhead.
          Click the line itself to edit the connector instead.
        </p>
      </div>
      <Field label="Text">
        <textarea
          className="ib-input"
          rows={Math.max(2, text.split("\n").length)}
          value={text}
          onChange={(e) => patch({ text: e.target.value })}
          placeholder="Type the label text — Shift+Enter for a new line"
        />
      </Field>
      <Field label="Font size (pt)">
        <input
          className="ib-input"
          type="number"
          min={6}
          max={72}
          step={0.5}
          value={fontSizePt}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) patch({ fontSizePt: v });
          }}
        />
      </Field>
      <Field label="Text color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="h-8 w-12 cursor-pointer rounded border border-gencom-sand"
            value={color ?? "#0f172a"}
            onChange={(e) => patch({ color: e.target.value })}
          />
          <input
            className="ib-input flex-1 font-mono text-[11px]"
            value={color ?? "#0f172a"}
            onChange={(e) => patch({ color: e.target.value })}
          />
          {color && (
            <button
              type="button"
              onClick={() => patch({ color: undefined })}
              className="text-[11px] text-gencom-stone hover:text-gencom-ink"
            >
              Clear
            </button>
          )}
        </div>
      </Field>
      <Field label="Justify">
        <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-xs">
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => patch({ align: a })}
              className={
                "px-3 h-8 capitalize " +
                (align === a
                  ? "bg-gencom-green text-white"
                  : "text-gencom-stone hover:bg-gencom-mist")
              }
            >
              {a}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Position">
        <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-xs">
          {([
            { key: "on-connector" as const, label: "On connector" },
            { key: "free" as const, label: "Free" },
          ]).map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => {
                if (m.key === "on-connector") {
                  patch({ mode: "on-connector", clearOffset: true });
                } else {
                  patch({ mode: "free" });
                }
              }}
              className={
                "px-3 h-8 " +
                (mode === m.key
                  ? "bg-gencom-green text-white"
                  : "text-gencom-stone hover:bg-gencom-mist")
              }
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gencom-stone mt-1 leading-snug">
          {mode === "free"
            ? "Drag the label box to reposition anywhere on the canvas."
            : "Label rides the midpoint of the line."}
        </p>
      </Field>
      <div className="border-t border-gencom-sand pt-3 flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (isMid) {
              onUpdate({ labelMid: "", label: undefined, labelMode: undefined, labelOffset: undefined, labelColor: undefined, labelAlign: undefined });
            } else {
              const remaining = (connector.labels ?? []).filter((l) => l.id !== labelId);
              onUpdate({ labels: remaining });
            }
          }}
          className="text-xs text-red-700 hover:underline"
        >
          Delete label
        </button>
      </div>
    </div>
  );
}

/** Compute the patch that merges N connectors that share a source or
 *  target box into a manifold. All connectors get the same side +
 *  offset on the shared end (so they enter / exit the shared box at
 *  the same point) and the same `elbowY` (or `elbowX`) so their middle
 *  segments overlap into a single visual trunk. The non-shared end
 *  keeps its existing attachment. */
function newManifoldId(): string {
  return "m_" + Math.random().toString(36).slice(2, 10);
}

function manifoldPatch(
  connectors: Connector[], chart: ChartState, side: "source" | "target",
): Partial<Connector> | null {
  const sharedId = side === "source"
    ? (new Set(connectors.map((c) => c.fromBoxId)).size === 1 ? connectors[0].fromBoxId : null)
    : (new Set(connectors.map((c) => c.toBoxId)).size === 1 ? connectors[0].toBoxId : null);
  if (!sharedId) return null;
  const sharedBox = chart.boxes.find((b) => b.id === sharedId);
  if (!sharedBox) return null;
  // Find the box(es) on the OTHER end. Decide trunk orientation by
  // comparing centroids: if the others are mostly above/below the
  // shared box → vertical trunk (elbowY); else horizontal (elbowX).
  const otherIds = side === "source"
    ? connectors.map((c) => c.toBoxId)
    : connectors.map((c) => c.fromBoxId);
  const others = chart.boxes.filter((b) => otherIds.includes(b.id));
  if (others.length === 0) return null;
  const sharedCx = sharedBox.x + sharedBox.width / 2;
  const sharedCy = sharedBox.y + sharedBox.height / 2;
  const avgOtherCx = others.reduce((s, b) => s + b.x + b.width / 2, 0) / others.length;
  const avgOtherCy = others.reduce((s, b) => s + b.y + b.height / 2, 0) / others.length;
  const dy = avgOtherCy - sharedCy;
  void avgOtherCx; void sharedCx;
  // Combine ALWAYS produces a horizontal trunk (a single shared
  // horizontal segment) — combining vertically isn't supported per
  // product spec. Sides are top / bottom on both ends so the
  // connectors leave / enter perpendicular to the trunk's direction.
  const manifoldId = newManifoldId();
  const sharedSide: ConnectorSide = dy >= 0 ? "bottom" : "top";
  const otherSide: ConnectorSide = sharedSide === "bottom" ? "top" : "bottom";
  const trunkY = sharedSide === "bottom"
    ? (sharedBox.y + sharedBox.height + Math.max(20, Math.abs(dy) * 0.4))
    : (sharedBox.y - Math.max(20, Math.abs(dy) * 0.4));
  const sideFields = side === "source"
    ? { fromSide: sharedSide, fromOffset: 0.5, toSide: otherSide }
    : { toSide: sharedSide, toOffset: 0.5, fromSide: otherSide };
  return { ...sideFields, elbowY: trunkY, customEndpoints: true, routeStyle: "orthogonal", manifoldId };
}

/** Bulk editor for shift-clicked / marquee-selected connectors. Only
 *  exposes the attributes that make sense to apply uniformly — route
 *  style, arrowhead toggle, label font size, and delete-all. Also
 *  surfaces Combine / Separate so the user can merge connectors with
 *  a shared source/target into a single visual trunk. */
function MultiConnectorEditor({
  connectors, chart, onUpdateAll, onDeleteAll,
}: {
  connectors: Connector[];
  chart: ChartState;
  onUpdateAll: (patch: Partial<Connector>) => void;
  onDeleteAll: () => void;
}) {
  const allOrthogonal = connectors.every((c) => c.routeStyle === "orthogonal");
  const allStraight = connectors.every((c) => c.routeStyle === "straight");
  const allArrowOn = connectors.every((c) => c.showArrowhead);
  const allArrowOff = connectors.every((c) => !c.showArrowhead);
  const fontSizes = new Set(connectors.map((c) => c.labelFontSizePt ?? 11));
  const sharedFont = fontSizes.size === 1 ? [...fontSizes][0] : null;
  const sharedFromIds = new Set(connectors.map((c) => c.fromBoxId));
  const sharedToIds = new Set(connectors.map((c) => c.toBoxId));
  const sharesSource = sharedFromIds.size === 1;
  const sharesTarget = sharedToIds.size === 1;
  const canCombine = connectors.length >= 2 && (sharesSource || sharesTarget);
  // When both source and target are shared we merge from the target
  // end (more common in org charts — children flow up into a parent).
  const combineSide: "source" | "target" = sharesTarget ? "target" : "source";
  return (
    <div className="space-y-3">
      <div>
        <div className="t-eyebrow">Selection</div>
        <div className="t-h2 mt-0.5">{connectors.length} connectors</div>
        <p className="text-[11.5px] text-gencom-stone mt-1">
          Bulk edits apply to every selected connector. Connectors can't be grouped — selection clears on Esc or empty-canvas click.
        </p>
      </div>
      <Field label="Route style">
        <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-xs">
          {(["orthogonal", "straight"] as const).map((r) => {
            const active = (r === "orthogonal" && allOrthogonal) || (r === "straight" && allStraight);
            return (
              <button
                key={r}
                onClick={() => onUpdateAll({ routeStyle: r })}
                className={
                  "px-3 h-8 capitalize " +
                  (active
                    ? "bg-gencom-green text-white"
                    : "text-gencom-stone hover:bg-gencom-mist")
                }
              >
                {r}
              </button>
            );
          })}
        </div>
        {!allOrthogonal && !allStraight && (
          <p className="text-[11px] text-gencom-stone mt-1">Mixed — pick one to apply to all.</p>
        )}
      </Field>
      <Field label="Label font size (pt)">
        <input
          className="ib-input"
          type="number"
          min={6}
          max={72}
          step={0.5}
          placeholder={sharedFont == null ? "mixed" : undefined}
          value={sharedFont ?? ""}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) onUpdateAll({ labelFontSizePt: v });
          }}
        />
      </Field>
      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          checked={allArrowOn}
          ref={(el) => {
            if (el) el.indeterminate = !allArrowOn && !allArrowOff;
          }}
          onChange={(e) => onUpdateAll({ showArrowhead: e.target.checked })}
        />
        Show arrowhead
      </label>
      <Field label="Manifold trunk">
        <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-[11px]">
          <button
            type="button"
            disabled={!canCombine}
            onClick={() => {
              const patch = manifoldPatch(connectors, chart, combineSide);
              if (patch) onUpdateAll(patch);
            }}
            className={
              "h-7 px-3 transition " +
              (canCombine
                ? "text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green"
                : "text-gencom-sand cursor-not-allowed")
            }
            title={canCombine
              ? `Combine — overlap the trunks so the connectors merge into one visual line on the ${combineSide === "target" ? "target" : "source"} end`
              : "Combine requires 2+ connectors that share either the same source or the same target box"}
          >
            Combine
          </button>
          <button
            type="button"
            onClick={() => onUpdateAll({ manifoldId: undefined })}
            className="h-7 px-3 border-l border-gencom-sand text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green transition"
            title="Separate — break the manifold grouping so each connector moves independently again. Each connector keeps its current elbow / endpoint position so the visual layout doesn't jump."
          >
            Separate
          </button>
        </div>
        {!canCombine && (
          <p className="text-[11px] text-gencom-stone mt-1">
            To combine, the selected connectors must share a source or target box.
          </p>
        )}
      </Field>
      <div className="border-t border-gencom-sand pt-3 flex justify-end">
        <button
          onClick={onDeleteAll}
          className="text-xs text-red-700 hover:underline inline-flex items-center gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete {connectors.length} connectors
        </button>
      </div>
    </div>
  );
}

function ChartSummary({
  chart, validation, onSelectBox,
}: { chart: ChartState; validation: Validation; onSelectBox: (id: string) => void }) {
  const warnings = Array.from(validation.parents.values()).filter((p) => !p.ok);
  return (
    <div className="space-y-3">
      <div>
        <div className="t-eyebrow">Chart</div>
        <div className="t-h2 mt-0.5">{chart.title || "Untitled"}</div>
        <p className="text-[12px] text-gencom-stone mt-1">
          {chart.boxes.length} {chart.boxes.length === 1 ? "box" : "boxes"} · {chart.connectors.length} {chart.connectors.length === 1 ? "connection" : "connections"}
        </p>
      </div>
      <div id="orgchart-validation" className="border-t border-gencom-sand pt-3">
        <div className="t-eyebrow mb-1">Validation</div>
        {warnings.length === 0 ? (
          <p className="text-[12px] text-gencom-stone">All multi-child branches sum to 100%.</p>
        ) : (
          <ul className="space-y-1.5">
            {warnings.map((w) => (
              <li key={w.parentId} className="text-[12px]">
                <button
                  className="text-left text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 w-full hover:bg-amber-100"
                  onClick={() => onSelectBox(w.parentId)}
                >
                  <span className="font-semibold">{w.parentName}</span>
                  {" — "}
                  {w.missing.length > 0
                    ? `${w.missing.length} child${w.missing.length === 1 ? "" : "ren"} missing %`
                    : `children sum to ${formatPct(w.sum)}, not 100%`}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-gencom-sand pt-3 text-[11.5px] text-gencom-stone leading-relaxed">
        <p>
          Click a box or connector to edit. Hover any box → use the green <strong>+</strong> on its edges to add a child. <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Space</kbd> + drag to pan, <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Shift</kbd> + scroll to zoom.
        </p>
      </div>
    </div>
  );
}

function BoxEditor({
  box, chart, onUpdate, onDelete, onConnect,
}: {
  box: Box;
  chart: ChartState;
  onUpdate: (patch: Partial<Box>) => void;
  onDelete: () => void;
  onConnect: (toId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="t-eyebrow">Box</div>
        <div className="t-h2 mt-0.5 truncate">{box.name || "Untitled"}</div>
      </div>

      <Field label="Name">
        <input
          className="ib-input"
          value={box.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Entity name"
        />
      </Field>

      <div className="block">
        <span className="block t-eyebrow mb-1">Entity type</span>
        <div className="flex items-center gap-2">
          <select
            className="ib-input flex-1"
            value={box.entityType}
            onChange={(e) => onUpdate({ entityType: e.target.value as Box["entityType"] })}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <label
            className="flex items-center gap-1.5 text-[12px] shrink-0 select-none cursor-pointer"
            title="When unchecked, the entity-type eyebrow ('LLC', 'LP', etc.) is hidden and the rest of the text bumps up to fill the box."
          >
            <input
              type="checkbox"
              checked={!box.hideEntityType}
              onChange={(e) => onUpdate({ hideEntityType: !e.target.checked })}
            />
            Check Entity
          </label>
        </div>
      </div>

      <Field label="Ownership %">
        <div className="flex items-center gap-2">
          <input
            className="ib-input flex-1"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={box.ownershipPct ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") onUpdate({ ownershipPct: null });
              else {
                const n = Number(v);
                onUpdate({ ownershipPct: Number.isFinite(n) ? n : null });
              }
            }}
            placeholder="Optional"
          />
          {box.ownershipPct != null && (
            <button className="ib-button-ghost text-xs" onClick={() => onUpdate({ ownershipPct: null })}>
              Clear
            </button>
          )}
        </div>
      </Field>

      <Field label="Jurisdiction / EIN">
        <input
          className="ib-input"
          value={box.jurisdiction ?? ""}
          onChange={(e) => onUpdate({ jurisdiction: e.target.value })}
          placeholder="Delaware · 12-3456789"
        />
      </Field>

      <Field label="Notes">
        <input
          className="ib-input"
          value={box.notes ?? ""}
          onChange={(e) => onUpdate({ notes: e.target.value })}
          placeholder="Optional"
        />
      </Field>

      <Field label="Name font size (pt)">
        <input
          className="ib-input"
          type="number"
          min={6}
          max={72}
          step={0.5}
          value={box.fontSizePt ?? 11}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) onUpdate({ fontSizePt: v });
          }}
        />
      </Field>

      <Field label="Border width (px)">
        <input
          className="ib-input"
          type="number"
          min={0}
          max={10}
          step={0.5}
          value={box.borderWidth ?? 1.5}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) onUpdate({ borderWidth: v });
          }}
        />
      </Field>

      <Field label="Text alignment">
        <div className="inline-flex items-stretch rounded-md border border-gencom-sand overflow-hidden">
          {(["left", "center", "right"] as const).map((a) => {
            const active = (box.textAlign ?? "left") === a;
            const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
            return (
              <button
                key={a}
                type="button"
                onClick={() => onUpdate({ textAlign: a })}
                title={`Align ${a}`}
                className={
                  "h-8 w-10 grid place-items-center transition " +
                  (active
                    ? "bg-gencom-green text-white"
                    : "bg-white text-gencom-ink hover:bg-gencom-greensoft")
                }
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Lock">
        <button
          type="button"
          onClick={() => onUpdate({ locked: !box.locked })}
          title={box.locked
            ? "Unlock — allow this box to move and resize"
            : "Lock — pin this box in place; multi-drags and group ops will skip it"}
          className={
            "ib-button-ghost text-xs inline-flex items-center gap-1.5 " +
            (box.locked ? "bg-gencom-mist border-gencom-stone" : "")
          }
        >
          {box.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
          {box.locked ? "Locked — click to unlock" : "Unlocked"}
        </button>
      </Field>


      <Field label="Palette">
        <PalettePicker box={box} onUpdate={onUpdate} />
      </Field>

      <div className="space-y-2">
        <SwatchRow
          label="Fill"
          colors={FILL_SWATCHES}
          value={box.fillColor}
          onChange={(c) => onUpdate({ fillColor: c })}
        />
        <SwatchRow
          label="Border"
          colors={BORDER_SWATCHES}
          value={box.borderColor}
          onChange={(c) => onUpdate({ borderColor: c })}
        />
        <SwatchRow
          label="Text"
          colors={TEXT_SWATCHES}
          value={box.textColor}
          onChange={(c) => onUpdate({ textColor: c })}
        />
      </div>

      {/* Only show Connect-to when there's actually a target to pick.
          With a single box on the canvas, the field is dead weight. */}
      {hasConnectableTargets(chart, box.id) && (
        <Field label="Connect to…">
          <ConnectPicker
            fromId={box.id}
            chart={chart}
            onConnect={onConnect}
          />
        </Field>
      )}

      <div className="border-t border-gencom-sand pt-3 flex justify-end">
        <button
          onClick={() => {
            if (window.confirm("Delete this box and any connectors touching it?")) onDelete();
          }}
          className="text-xs text-red-700 hover:underline inline-flex items-center gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete box
        </button>
      </div>
    </div>
  );
}

function ConnectPicker({
  fromId, chart, onConnect,
}: { fromId: string; chart: ChartState; onConnect: (toId: string) => void }) {
  const candidates = chart.boxes.filter((b) => b.id !== fromId);
  // Hide already-connected pairs (either direction).
  const already = new Set<string>();
  for (const c of chart.connectors) {
    if (c.fromBoxId === fromId) already.add(c.toBoxId);
    if (c.toBoxId === fromId) already.add(c.fromBoxId);
  }
  return (
    <select
      className="ib-input"
      value=""
      onChange={(e) => {
        if (e.target.value) onConnect(e.target.value);
      }}
    >
      <option value="">Choose a target…</option>
      {candidates.map((b) => (
        <option key={b.id} value={b.id} disabled={already.has(b.id)}>
          {b.name || "Untitled"} {already.has(b.id) ? "(connected)" : ""}
        </option>
      ))}
    </select>
  );
}

function ConnectorEditor({
  connector, chart, onUpdate, onDelete, onUpdateConnectors,
}: {
  connector: Connector;
  chart: ChartState;
  onUpdate: (patch: Partial<Connector>) => void;
  onDelete: () => void;
  onUpdateConnectors?: (ids: string[], patch: Partial<Connector>) => void;
}) {
  const from = chart.boxes.find((b) => b.id === connector.fromBoxId);
  const to = chart.boxes.find((b) => b.id === connector.toBoxId);
  // Sibling = another connector that shares this one's source OR
  // target. The Combine-with-siblings button lights up only when at
  // least one is found; it then applies a manifold patch to this
  // connector + all siblings so they share a single trunk.
  const siblings = chart.connectors.filter((c) =>
    c.id !== connector.id &&
    (c.fromBoxId === connector.fromBoxId || c.toBoxId === connector.toBoxId),
  );
  const canCombineWithSiblings = siblings.length > 0 && !!onUpdateConnectors;
  return (
    <div className="space-y-3">
      <div>
        <div className="t-eyebrow">Connector</div>
        <div className="text-[13px] text-gencom-ink mt-0.5">
          <span className="font-semibold truncate inline-block max-w-[220px] align-bottom">
            {from?.name ?? "?"}
          </span>
          {" "}
          <ArrowDownToDot className="h-3 w-3 inline -translate-y-px" />
          {" "}
          <span className="font-semibold truncate inline-block max-w-[220px] align-bottom">
            {to?.name ?? "?"}
          </span>
        </div>
      </div>

      <Field label="Midpoint label">
        <div className="flex items-center gap-1">
          <input
            type="text"
            // Read from labelMid first, then fall back to legacy `label`
            // so older saved charts keep their text in the mid slot.
            value={connector.labelMid ?? connector.label ?? ""}
            onChange={(e) => onUpdate({ labelMid: e.target.value, label: undefined })}
            placeholder="e.g. 51% · Director"
            className="ib-input text-sm flex-1"
          />
          <button
            type="button"
            onClick={() => onUpdate({ labelMid: "", label: undefined })}
            title="Delete midpoint label"
            className="h-8 w-8 grid place-items-center rounded text-gencom-stone hover:bg-gencom-mist"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </Field>

      <Field label="Endpoint label">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={connector.labelEnd ?? ""}
            onChange={(e) => onUpdate({ labelEnd: e.target.value })}
            placeholder="e.g. Manager · 100%"
            className="ib-input text-sm flex-1"
          />
          <button
            type="button"
            onClick={() => onUpdate({ labelEnd: "" })}
            title="Delete endpoint label"
            className="h-8 w-8 grid place-items-center rounded text-gencom-stone hover:bg-gencom-mist"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </Field>

      <Field label="Label font size (pt)">
        <input
          className="ib-input"
          type="number"
          min={6}
          max={72}
          step={0.5}
          value={connector.labelFontSizePt ?? 11}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) onUpdate({ labelFontSizePt: v });
          }}
        />
      </Field>

      {/* Label-specific block. Only meaningful when a midpoint label
          exists; collapses otherwise so the panel stays terse for
          connectors without text. */}
      {(connector.labelMid || connector.label) && (
        <div className="space-y-3 border-t border-gencom-sand pt-3">
          <div className="t-eyebrow">Label</div>
          <Field label="Text color">
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-8 w-12 cursor-pointer rounded border border-gencom-sand"
                value={connector.labelColor ?? "#0f172a"}
                onChange={(e) => onUpdate({ labelColor: e.target.value })}
              />
              <input
                className="ib-input flex-1 font-mono text-[11px]"
                value={connector.labelColor ?? "#0f172a"}
                onChange={(e) => onUpdate({ labelColor: e.target.value })}
              />
              {connector.labelColor && (
                <button
                  type="button"
                  onClick={() => onUpdate({ labelColor: undefined })}
                  className="text-[11px] text-gencom-stone hover:text-gencom-ink"
                  title="Clear — fall back to the connector stroke color"
                >
                  Clear
                </button>
              )}
            </div>
          </Field>
          <Field label="Justify">
            <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-xs">
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onUpdate({ labelAlign: a })}
                  className={
                    "px-3 h-8 capitalize " +
                    ((connector.labelAlign ?? "center") === a
                      ? "bg-gencom-green text-white"
                      : "text-gencom-stone hover:bg-gencom-mist")
                  }
                >
                  {a}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Position">
            <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-xs">
              {([
                { key: "on-connector" as const, label: "On connector" },
                { key: "free" as const, label: "Free" },
              ]).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    if (m.key === "on-connector") {
                      // Switching back to "on-connector" clears the
                      // free-mode offset so the label snaps to the
                      // path midpoint instead of staying where it
                      // was last dragged.
                      onUpdate({ labelMode: "on-connector", labelOffset: undefined });
                    } else {
                      onUpdate({ labelMode: "free" });
                    }
                  }}
                  className={
                    "px-3 h-8 " +
                    ((connector.labelMode ?? "on-connector") === m.key
                      ? "bg-gencom-green text-white"
                      : "text-gencom-stone hover:bg-gencom-mist")
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gencom-stone mt-1 leading-snug">
              {(connector.labelMode ?? "on-connector") === "free"
                ? "Drag the label box to reposition anywhere on the canvas."
                : "Label rides the midpoint of the line. Drag is disabled in this mode."}
            </p>
          </Field>
        </div>
      )}

      <Field label="Route style">
        <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-xs">
          {(["orthogonal", "straight"] as const).map((r) => (
            <button
              key={r}
              onClick={() => onUpdate({ routeStyle: r })}
              className={
                "px-3 h-8 capitalize " +
                (connector.routeStyle === r
                  ? "bg-gencom-green text-white"
                  : "text-gencom-stone hover:bg-gencom-mist")
              }
            >
              {r}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Source side">
        <SidePicker
          value={connector.fromSide ?? null}
          onChange={(s) => onUpdate({ fromSide: s ?? undefined })}
        />
      </Field>

      <Field label="Target side (arrow lands here)">
        <SidePicker
          value={connector.toSide ?? null}
          onChange={(s) => onUpdate({ toSide: s ?? undefined })}
        />
      </Field>

      {/* Combine with siblings — finds other connectors that share
          this one's source or target box and applies the manifold
          patch so they merge into a single visual trunk. Disabled
          when no siblings exist. */}
      {canCombineWithSiblings && from && to && (
        <Field label="Trunk siblings">
          <button
            type="button"
            onClick={() => {
              // Decide which end is the "shared" end based on which
              // shared id is most common across this + siblings.
              const fromShares = siblings.filter((s) => s.fromBoxId === connector.fromBoxId).length;
              const toShares = siblings.filter((s) => s.toBoxId === connector.toBoxId).length;
              const side: "source" | "target" = toShares >= fromShares ? "target" : "source";
              const all = [connector, ...siblings.filter((s) => side === "target"
                ? s.toBoxId === connector.toBoxId
                : s.fromBoxId === connector.fromBoxId)];
              const patch = manifoldPatch(all, chart, side);
              if (patch && onUpdateConnectors) {
                onUpdateConnectors(all.map((c) => c.id), patch);
              }
            }}
            className="text-[11px] h-7 px-3 rounded border border-gencom-sand text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green"
            title={`Merge this connector with ${siblings.length} sibling${siblings.length === 1 ? "" : "s"} that share its source or target box into a single trunk`}
          >
            Combine with {siblings.length} sibling{siblings.length === 1 ? "" : "s"}
          </button>
        </Field>
      )}

      {/* Custom-endpoint mode + force-H/V helpers. When custom is on,
          the canvas shows draggable handles at the connector start /
          end so the user can slide them along the box perimeter. The
          force buttons compute side + offset on both ends so the line
          is purely horizontal or vertical (single straight segment). */}
      {from && to && (
        <Field label="Endpoint placement">
          <label className="flex items-center gap-2 text-[12.5px] mb-2">
            <input
              type="checkbox"
              checked={!!connector.customEndpoints}
              onChange={(e) => onUpdate({ customEndpoints: e.target.checked || undefined })}
            />
            Custom endpoints (drag handles on the canvas)
          </label>
          <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => onUpdate(forceAxis(connector, from, to, "horizontal"))}
              className={
                "h-7 px-3 transition " +
                (connector.axisLock === "horizontal"
                  ? "bg-gencom-green text-white"
                  : "text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green")
              }
              aria-pressed={connector.axisLock === "horizontal"}
              title={connector.axisLock === "horizontal"
                ? "Horizontal lock active — endpoint drags stay on left/right sides only. Click again to release."
                : "Lock to a strictly horizontal line — endpoints stay on left/right sides only until released"}
            >
              Force H
            </button>
            <button
              type="button"
              onClick={() => onUpdate(forceAxis(connector, from, to, "vertical"))}
              className={
                "h-7 px-3 border-l border-gencom-sand transition " +
                (connector.axisLock === "vertical"
                  ? "bg-gencom-green text-white"
                  : "text-gencom-ink hover:bg-gencom-greensoft hover:text-gencom-green")
              }
              aria-pressed={connector.axisLock === "vertical"}
              title={connector.axisLock === "vertical"
                ? "Vertical lock active — endpoint drags stay on top/bottom sides only. Click again to release."
                : "Lock to a strictly vertical line — endpoints stay on top/bottom sides only until released"}
            >
              Force V
            </button>
          </div>
        </Field>
      )}

      <Field label="Elbows">
        <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-[11px]">
          {([
            { key: "min" as const,   label: "Minimum", title: "Fewest elbows that satisfy the perpendicular-to-edge constraint (1 for perpendicular sides, 2 for parallel)." },
            { key: "extra" as const, label: "Stepped", title: "Add an extra pair of elbows for a stepped detour. Useful when the minimal path skirts another box." },
          ]).map((o) => {
            const active = (connector.routeDetail ?? "min") === o.key;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => onUpdate({ routeDetail: o.key })}
                title={o.title}
                aria-pressed={active}
                className={
                  "h-7 px-3 border-l border-gencom-sand first:border-l-0 transition " +
                  (active ? "bg-gencom-green text-white" : "text-gencom-ink hover:bg-gencom-mist")
                }
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </Field>

      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          checked={connector.showArrowhead}
          onChange={(e) => onUpdate({ showArrowhead: e.target.checked })}
        />
        Show arrowhead
      </label>

      {connector.showArrowhead && (
        <Field label="Arrowhead side">
          <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-[11px]">
            {([
              { key: "end" as const,   label: "Target end", title: "Default — the arrow lands on the to-box (from → to)." },
              { key: "start" as const, label: "Source end", title: "Flip the arrow to the from-box (target → source) without re-drawing the connector." },
            ]).map((o) => {
              const active = (connector.arrowheadAt ?? "end") === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => onUpdate({ arrowheadAt: o.key })}
                  title={o.title}
                  aria-pressed={active}
                  className={
                    "h-7 px-3 border-l border-gencom-sand first:border-l-0 transition " +
                    (active ? "bg-gencom-green text-white" : "text-gencom-ink hover:bg-gencom-mist")
                  }
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      <label className="flex items-center gap-2 text-[12.5px]">
        <input
          type="checkbox"
          checked={!!connector.locked}
          onChange={(e) => onUpdate({ locked: e.target.checked || undefined })}
        />
        <Lock className="h-3 w-3" />
        Lock connector — endpoint / elbow drags + arrow nudges are ignored while locked
      </label>

      <p className="text-[11px] text-gencom-stone leading-snug">
        Default routing uses the fewest elbows (1 for perpendicular sides, 2 for parallel) and keeps every segment perpendicular to the edge it touches. Switch to <em>Stepped</em> when you need a longer detour.
      </p>

      <div className="border-t border-gencom-sand pt-3 flex justify-end">
        <button
          onClick={onDelete}
          className="text-xs text-red-700 hover:underline inline-flex items-center gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete connector
        </button>
      </div>
    </div>
  );
}

/** Four-button toggle: Top / Right / Bottom / Left. The "Auto"
 *  option was removed because the auto-router was producing edge
 *  picks that surprised users — every connector now has an explicit
 *  side. The current side is highlighted; clicking another side
 *  switches to it. */
function SidePicker({
  value, onChange,
}: { value: ConnectorSide | null; onChange: (s: ConnectorSide | null) => void }) {
  const opts: Array<{ key: ConnectorSide; label: string }> = [
    { key: "top",    label: "Top" },
    { key: "right",  label: "Right" },
    { key: "bottom", label: "Bottom" },
    { key: "left",   label: "Left" },
  ];
  return (
    <div className="inline-flex rounded-md border border-gencom-sand overflow-hidden text-[11px]">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={
            "h-7 px-2 border-l border-gencom-sand first:border-l-0 transition " +
            (value === o.key
              ? "bg-gencom-green text-white"
              : "text-gencom-ink hover:bg-gencom-mist")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block t-eyebrow mb-1">{label}</span>
      {children}
    </label>
  );
}

/** Property panel section shown when 2+ boxes are selected. The only
 *  shared edit that makes sense in bulk is color — names, types, and
 *  ownership % are per-box. Any swatch click applies to every box in
 *  the selection at once. */
function MultiBoxEditor({
  boxes, onUpdateAll,
}: {
  boxes: Box[];
  onUpdateAll: (patch: Partial<Box>) => void;
}) {
  // The "current" color for each channel is the unanimous color across
  // the selection, or null if the selection is mixed. Used to highlight
  // the active swatch only when every box agrees.
  const sharedFill   = unanimous(boxes.map((b) => b.fillColor));
  const sharedBorder = unanimous(boxes.map((b) => b.borderColor));
  const sharedText   = unanimous(boxes.map((b) => b.textColor));
  const sharedPalette = sharedFill && sharedBorder && sharedText
    ? matchPalette({ fillColor: sharedFill, borderColor: sharedBorder, textColor: sharedText })
    : null;

  // Lock-state summary across the selection. "all" / "none" / "mixed"
  // drives the toggle: a single click sets every box to the OPPOSITE
  // of "all locked" — so a mixed group locks everything, then a second
  // click unlocks. Mirrors the "Match" pattern (set the unanimous state).
  const lockedCount = boxes.filter((b) => b.locked).length;
  const lockState: "all" | "none" | "mixed" =
    lockedCount === boxes.length ? "all" : lockedCount === 0 ? "none" : "mixed";

  // Unanimous values across the selection — null when boxes disagree
  // ("mixed"). Inputs render a placeholder so the user knows the
  // current state is non-uniform; typing applies the new value to
  // every selected box at once.
  const sharedFontSize = unanimous(boxes.map((b) => b.fontSizePt ?? 11));
  const sharedAlign = unanimous(boxes.map((b) => b.textAlign ?? "left"));
  const sharedBorderW = unanimous(boxes.map((b) => b.borderWidth ?? 1.5));
  // Show-entity-type state across the selection: "all on", "all off",
  // or "mixed". Mixed renders an indeterminate checkbox; clicking
  // either state pushes the new uniform value to every box.
  const showEntityCount = boxes.filter((b) => !b.hideEntityType).length;
  const allShowEntity = showEntityCount === boxes.length;
  const noneShowEntity = showEntityCount === 0;

  return (
    <div className="space-y-3">
      <div>
        <div className="t-eyebrow">Selection</div>
        <div className="t-h2 mt-0.5">{boxes.length} boxes</div>
        <p className="text-[12px] text-gencom-stone mt-1">
          Color changes apply to every selected box. Per-box fields
          (name, entity type, ownership %) stay where they are.
        </p>
      </div>

      <Field label="Palette">
        <MultiPalettePicker
          activePaletteKey={sharedPalette?.key ?? null}
          onPick={(p) => onUpdateAll({
            fillColor: p.defaults.fillColor,
            borderColor: p.defaults.borderColor,
            textColor: p.defaults.textColor,
          })}
        />
      </Field>

      <div className="space-y-2">
        <SwatchRow
          label={mixedLabel("Fill", sharedFill)}
          colors={FILL_SWATCHES}
          value={sharedFill ?? ""}
          onChange={(c) => onUpdateAll({ fillColor: c })}
        />
        <SwatchRow
          label={mixedLabel("Border", sharedBorder)}
          colors={BORDER_SWATCHES}
          value={sharedBorder ?? ""}
          onChange={(c) => onUpdateAll({ borderColor: c })}
        />
        <SwatchRow
          label={mixedLabel("Text", sharedText)}
          colors={TEXT_SWATCHES}
          value={sharedText ?? ""}
          onChange={(c) => onUpdateAll({ textColor: c })}
        />
      </div>

      <label
        className="flex items-center gap-1.5 text-[12px] select-none"
        title="When unchecked, the entity-type eyebrow is hidden on every selected box and the rest of the text bumps up."
      >
        <input
          type="checkbox"
          checked={allShowEntity}
          ref={(el) => {
            if (el) el.indeterminate = !allShowEntity && !noneShowEntity;
          }}
          onChange={(e) => onUpdateAll({ hideEntityType: !e.target.checked })}
        />
        Check Entity
        {!allShowEntity && !noneShowEntity && (
          <span className="text-[11px] text-gencom-stone">(mixed — click to apply to all)</span>
        )}
      </label>

      <Field label={sharedFontSize === null ? "Name font size — mixed (pt)" : "Name font size (pt)"}>
        <input
          className="ib-input"
          type="number"
          min={6}
          max={72}
          step={0.5}
          value={sharedFontSize ?? ""}
          placeholder={sharedFontSize === null ? "Mixed" : ""}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) onUpdateAll({ fontSizePt: v });
          }}
        />
      </Field>

      <Field label={sharedAlign === null ? "Text alignment — mixed" : "Text alignment"}>
        <div className="inline-flex items-stretch rounded-md border border-gencom-sand overflow-hidden">
          {(["left", "center", "right"] as const).map((a) => {
            const active = sharedAlign === a;
            const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
            return (
              <button
                key={a}
                type="button"
                onClick={() => onUpdateAll({ textAlign: a })}
                title={`Align ${a}`}
                className={
                  "h-8 w-10 grid place-items-center transition " +
                  (active
                    ? "bg-gencom-green text-white"
                    : "bg-white text-gencom-ink hover:bg-gencom-greensoft")
                }
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      </Field>

      <Field label={sharedBorderW === null ? "Border width — mixed (px)" : "Border width (px)"}>
        <input
          className="ib-input"
          type="number"
          min={0}
          max={10}
          step={0.5}
          value={sharedBorderW ?? ""}
          placeholder={sharedBorderW === null ? "Mixed" : ""}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) onUpdateAll({ borderWidth: v });
          }}
        />
      </Field>

      <Field label={lockState === "mixed" ? "Lock (mixed)" : "Lock"}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onUpdateAll({ locked: true })}
            title="Lock every selected box — none of them will move or resize via drag"
            className={
              "ib-button-ghost text-xs inline-flex items-center gap-1.5 " +
              (lockState === "all" ? "bg-gencom-mist border-gencom-stone" : "")
            }
          >
            <Lock className="h-3.5 w-3.5" /> Lock all
          </button>
          <button
            type="button"
            onClick={() => onUpdateAll({ locked: false })}
            title="Unlock every selected box"
            className={
              "ib-button-ghost text-xs inline-flex items-center gap-1.5 " +
              (lockState === "none" ? "bg-gencom-mist border-gencom-stone" : "")
            }
          >
            <LockOpen className="h-3.5 w-3.5" /> Unlock all
          </button>
        </div>
      </Field>

      <div className="border-t border-gencom-sand pt-3 text-[11.5px] text-gencom-stone leading-relaxed">
        <p>Tip: shift-click more boxes to add them, shift-click a selected box to remove it. <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Esc</kbd> to clear.</p>
      </div>
    </div>
  );
}

/** Same look as PalettePicker but driven by an explicit active key
 *  (since there's no single "current box" when multiple are selected). */
function MultiPalettePicker({
  activePaletteKey, onPick,
}: { activePaletteKey: string | null; onPick: (p: typeof BOX_PALETTES[number]) => void }) {
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {BOX_PALETTES.map((p) => {
        const isActive = activePaletteKey === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onPick(p)}
            title={p.label}
            aria-pressed={isActive}
            className={
              "relative h-7 w-full rounded grid place-items-center transition " +
              (isActive ? "ring-2 ring-gencom-green ring-offset-1" : "hover:ring-1 hover:ring-gencom-sand")
            }
            style={{
              background: p.defaults.fillColor,
              border: `2px solid ${p.defaults.borderColor}`,
            }}
          >
            <span
              className="text-[10px] font-bold leading-none"
              style={{ color: p.defaults.textColor }}
            >Aa</span>
          </button>
        );
      })}
    </div>
  );
}

function unanimous<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => v === first) ? first : null;
}

function mixedLabel(base: string, shared: string | null): string {
  return shared === null ? `${base} (mixed)` : base;
}

/** Twelve curated palettes shown as small fill+border previews. Click
 *  applies all three colors at once. The active palette (if any) gets
 *  an emerald ring. */
function PalettePicker({
  box, onUpdate,
}: { box: Box; onUpdate: (p: Partial<Box>) => void }) {
  const active = matchPalette({
    fillColor: box.fillColor,
    borderColor: box.borderColor,
    textColor: box.textColor,
  });
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {BOX_PALETTES.map((p) => {
        const isActive = active?.key === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => onUpdate({
              fillColor: p.defaults.fillColor,
              borderColor: p.defaults.borderColor,
              textColor: p.defaults.textColor,
            })}
            title={p.label}
            aria-pressed={isActive}
            className={
              "relative h-7 w-full rounded grid place-items-center transition " +
              (isActive ? "ring-2 ring-gencom-green ring-offset-1" : "hover:ring-1 hover:ring-gencom-sand")
            }
            style={{
              background: p.defaults.fillColor,
              border: `2px solid ${p.defaults.borderColor}`,
            }}
          >
            <span
              className="text-[10px] font-bold leading-none"
              style={{ color: p.defaults.textColor }}
            >Aa</span>
          </button>
        );
      })}
    </div>
  );
}

/** A row of preset color swatches for one channel (fill / border /
 *  text). Active swatch gets an emerald ring. */
function SwatchRow({
  label, colors, value, onChange,
}: {
  label: string;
  colors: string[];
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div>
      <span className="block t-eyebrow mb-1">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c) => {
          const isActive = c.toUpperCase() === value.toUpperCase();
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              title={c}
              aria-pressed={isActive}
              className={
                "h-6 w-6 rounded border transition " +
                (isActive
                  ? "border-gencom-green ring-2 ring-gencom-green ring-offset-1"
                  : "border-gencom-sand hover:border-gencom-stone")
              }
              style={{ background: c }}
            />
          );
        })}
      </div>
    </div>
  );
}

function formatPct(n: number): string {
  return (n.toFixed(2).replace(/\.?0+$/, "") || "0") + "%";
}

/** True iff there's at least one OTHER box that isn't already
 *  connected to `fromId` in either direction. When false, the
 *  "Connect to…" field is suppressed entirely. */
function hasConnectableTargets(chart: ChartState, fromId: string): boolean {
  if (chart.boxes.length < 2) return false;
  const already = new Set<string>();
  for (const c of chart.connectors) {
    if (c.fromBoxId === fromId) already.add(c.toBoxId);
    if (c.toBoxId === fromId) already.add(c.fromBoxId);
  }
  return chart.boxes.some((b) => b.id !== fromId && !already.has(b.id));
}
