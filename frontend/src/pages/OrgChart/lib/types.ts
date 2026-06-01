// Org Chart — domain types. Mirrors the JSON save format described in
// the build spec; `ChartState` is what gets serialized.

export type EntityType =
  | "LLC"
  | "Corporation"
  | "LP"
  | "LLP"
  | "Trust"
  | "Individual"
  | "Partnership"
  | "Other";

export const ENTITY_TYPES: EntityType[] = [
  "LLC",
  "Corporation",
  "LP",
  "LLP",
  "Trust",
  "Individual",
  "Partnership",
  "Other",
];

export type ThemeKey =
  | "hyatt-blue"
  | "legal-white"
  | "slate"
  | "forest"
  | "custom";

export type Box = {
  id: string;
  name: string;
  entityType: EntityType;
  /** 0–100, null when not specified. Tolerated as float in validation. */
  ownershipPct: number | null;
  /** Optional jurisdiction / EIN row — single line, hidden when empty. */
  jurisdiction?: string;
  /** Optional notes row — single line, italic, hidden when empty. */
  notes?: string;
  fillColor: string;
  borderColor: string;
  textColor: string;
  /** Border width in CSS pixels. Defaults to 1.5px. Applied as the
   *  box's outline thickness — exposed in the multi-edit panel so
   *  several boxes can be re-styled at once. */
  borderWidth?: number;
  /** Text alignment for the entity NAME row (and other text rows).
   *  Defaults to "left". Mirrors the Word / PowerPoint horizontal-align
   *  control so the user can pick a layout that fits the chart style. */
  textAlign?: "left" | "center" | "right";
  /** Optional CSS font-family override for the entity NAME row.
   *  Populated by the PPTX importer so visually-distinctive decks
   *  (Calibri / Times / etc.) survive round-trip; left undefined for
   *  charts authored in the editor, which use Cormorant Garamond. */
  fontFamily?: string;
  /** Font size for the entity NAME row, in points (pt). Defaults to
   *  11pt. Used so users can author for a real paper size and pick a
   *  font-size in real-world units instead of CSS pixels. Other rows
   *  (entity type, jurisdiction, notes) stay at their fixed sizes. */
  fontSizePt?: number;
  /** When true, the box can't be dragged, resized, or moved as part
   *  of a multi-selection drag. Used to pin reference / parent boxes
   *  in place while the rest of the chart is being rearranged. */
  locked?: boolean;
  /** When true, the entity-type eyebrow ("LLC", "LP", etc.) in the
   *  top-left of the box is hidden and the rest of the text rows
   *  bump up to fill the freed space. Useful when the entity type
   *  is redundant with the entity name or when the user wants a
   *  cleaner card. Defaults to showing the entity type. */
  hideEntityType?: boolean;
  /** Membership in a logical group. Boxes with the same `groupId`
   *  behave like a single object: clicking one selects them all,
   *  drags / aligns / resizes operate on the entire group. Null /
   *  missing means the box is on its own. */
  groupId?: string;
  x: number;
  y: number;
  /** Width/height are managed centrally — every box on the canvas
   *  matches the largest natural size across all boxes. These are still
   *  serialized for layout-time use (importPptx, autoArrange) but are
   *  overwritten whenever content changes. */
  width: number;
  height: number;
};

/** Sizing constraints — applied during measurement so the global box
 *  size stays sane. One huge entity name shouldn't blow out the canvas. */
export const BOX_MIN_W = 80;
export const BOX_MAX_W = 320;
export const BOX_MIN_H = 40;

export type RouteStyle = "orthogonal" | "straight";

export type ConnectorSide = "top" | "right" | "bottom" | "left";

/** A standalone text label attached to a connector. Each label owns
 *  its own position and styling so a single line (especially a long
 *  manifold trunk) can carry multiple independently-edited labels at
 *  different points along its length. */
export type ConnectorTextLabel = {
  /** Stable id so the label can be selected, dragged, or deleted
   *  without colliding with sibling labels on the same connector. */
  id: string;
  text: string;
  /** Path fraction (0..1) where the label sits when `mode` is
   *  "on-connector". 0 = source endpoint, 1 = target endpoint. */
  pathT?: number;
  /** World-space offset from the path point at `pathT`, used when
   *  `mode === "free"`. Cleared when the user switches back to
   *  "on-connector". */
  offset?: { x: number; y: number };
  /** "on-connector" rides the path (with optional pathT). "free"
   *  lets the user drag the chip anywhere on the canvas. */
  mode?: "on-connector" | "free";
  /** Per-label overrides — fall back to the connector's
   *  labelFontSizePt / labelColor / labelAlign when unset so the
   *  label looks like the rest of the connector by default. */
  fontSizePt?: number;
  color?: string;
  align?: "left" | "center" | "right";
};

export type Connector = {
  id: string;
  fromBoxId: string;
  toBoxId: string;
  routeStyle: RouteStyle;
  showArrowhead: boolean;
  /** When true the connector ignores endpoint / elbow / arrow-key
   *  edits — same semantics as `Box.locked`. The user can still
   *  select it, but drags and arrow-bumps no-op. Toggled from the
   *  property panel. */
  locked?: boolean;
  /** Which end of the line carries the arrowhead. Default "end" puts
   *  the arrow at the target box (classic "from → to"). Flip to
   *  "start" when the relationship reads better in the reverse
   *  direction without re-creating the connector. */
  arrowheadAt?: "end" | "start";
  /** Override which side the connector exits / enters. When omitted
   *  the router picks the best pair based on relative positions and
   *  obstacle clearance. Set per-connector when the user wants the
   *  arrow to attach to a specific side. */
  fromSide?: ConnectorSide;
  toSide?: ConnectorSide;
  /** Position along the chosen side, 0..1. 0 = top/left edge of side,
   *  1 = bottom/right edge. Defaults to 0.5 (centered on the side)
   *  when omitted. Set when the user drags the endpoint along the box
   *  perimeter in custom-endpoint mode, or by the "Force H/V" buttons
   *  to align both endpoints on a single axis. */
  fromOffset?: number;
  toOffset?: number;
  /** When true the user has hand-placed the endpoints — the canvas
   *  shows draggable handles at the start/end so they can slide along
   *  the box perimeter. The router still draws the path through them
   *  using `routeStyle`, but won't relocate the attachment points. */
  customEndpoints?: boolean;
  /** When set the connector is locked to a single axis: "horizontal"
   *  forces both endpoints onto left/right sides only; "vertical"
   *  forces top/bottom only. Endpoint drags and the projection logic
   *  honor the lock so dragging can't accidentally break a strictly
   *  H/V routing. Toggled by the Force H / Force V buttons. */
  axisLock?: "horizontal" | "vertical";
  /** Override for the middle bend axis of a parallel-side (Z-shape)
   *  orthogonal connector. `elbowY` is the world Y coord of the
   *  horizontal middle segment in a top↔bottom connector; `elbowX` is
   *  the world X coord of the vertical middle segment in a left↔right
   *  connector. Set by dragging the middle-segment handle so the user
   *  can route the line around an obstacle. Unset = auto midpoint. */
  elbowX?: number;
  elbowY?: number;
  /** Override for the source-side and target-side jog axes of a
   *  stepped (extra) orthogonal route. In parallel-side stepped
   *  paths the source-side jog is the outer leg leaving the source
   *  box; for vertical (top/bottom) edges `step1` is the Y coord of
   *  that horizontal jog and `step2` is the Y coord of the
   *  target-side jog. For horizontal (left/right) edges they hold X
   *  coords instead. Setting one of these (via dragging the pill on
   *  the corresponding segment) shifts that single jog independent
   *  of the cross-segment, so a stepped trunk can take an
   *  asymmetric U-shape rather than the symmetric ±32px default. */
  step1?: number;
  step2?: number;
  /** Manifold grouping. Connectors that share the same `manifoldId`
   *  were "combined" (via the property panel) into a single visual
   *  trunk — dragging the elbow on any one of them moves the trunk on
   *  all of them at once. Cleared by the Separate button. */
  manifoldId?: string;
  /** Override the target endpoint with an absolute world-coord point
   *  instead of attaching to `toBoxId`'s edge. Used when the user
   *  drops a new connector onto an EXISTING connector (a T-junction
   *  on a manifold trunk) — the line terminates at the click point on
   *  the parent line rather than at a box. `toBoxId` is still set (to
   *  the parent's target box) so layout/validation has a hierarchy
   *  reference, but the renderer uses `toAnchor` for the actual end. */
  toAnchor?: { x: number; y: number };
  /** When this connector is a T-junction (`toAnchor` is set), the id
   *  of the parent connector it was dropped onto. The renderer uses
   *  this to re-snap `toAnchor.y` (or `.x`) onto the parent's current
   *  trunk position every frame, so the T-junction stays glued to the
   *  parent line when the parent's source/target boxes move and shift
   *  the trunk. Without this back-reference, the T-junction's anchor
   *  stays at the original absolute click point and visually
   *  disconnects from the parent the moment the parent's geometry
   *  changes. */
  parentConnId?: string;
  /** Orthogonal routing detail. "min" picks the fewest elbows that
   *  satisfies the perpendicular-to-edge constraint (1 for perpendicular
   *  sides, 2 for parallel). "extra" steps up to the next valid count
   *  (3 for perpendicular, 4 for parallel) — use this when the path
   *  needs to detour around something. Default = "min". */
  routeDetail?: "min" | "extra";
  /** DEPRECATED: original single-label slot. Kept for backward
   *  compatibility with saved charts and the PPTX importer; new code
   *  reads / writes `labelMid` instead. When `labelMid` is unset,
   *  `label` is used as the midpoint label. */
  label?: string;
  /** Connector label rendered at the midpoint of the path. Use for
   *  ownership "%", "$", or descriptive labels like "Director". */
  labelMid?: string;
  /** Connector label rendered near the arrow target (just inside the
   *  to-box edge along the connector direction). Use for things like
   *  the destination role or condition that fires at the endpoint. */
  labelEnd?: string;
  /** Font size for both connector labels (mid + end), in points. Defaults
   *  to 11pt — matches the box NAME default for visual consistency.
   *  When the user drops a fresh "Add text" label, this is seeded
   *  from the source box's `fontSizePt` so the text reads at the
   *  same size as the boxes around it. */
  labelFontSizePt?: number;
  /** Color for the midpoint label text. Hex string. Defaults to the
   *  editor's default ink color when unset. Settable from the right-
   *  hand label property panel. */
  labelColor?: string;
  /** Horizontal alignment of multi-line label text. Defaults to
   *  "center" so single-line labels sit centered on the path
   *  midpoint as before. */
  labelAlign?: "left" | "center" | "right";
  /** Positioning mode for the midpoint label.
   *    "on-connector" (default) — label rides the path midpoint.
   *    "free"                   — label is anchored at
   *                               (pathMid + labelOffset). The user
   *                               drags the label box edge to adjust
   *                               the offset. Switching back to
   *                               "on-connector" resets the offset. */
  labelMode?: "on-connector" | "free";
  /** Pixel offset from the connector's path midpoint, used when
   *  `labelMode === "free"`. Cleared when the user toggles back to
   *  "on-connector" mode. */
  labelOffset?: { x: number; y: number };
  /** Additional text labels attached to this connector. Each entry
   *  owns its own pathT (0..1 along the line) and its own styling
   *  so a single connector — or a manifold trunk — can carry
   *  multiple independently-edited labels at different points along
   *  its length. The right-click "Add text" flow appends here once
   *  `labelMid` is populated; the first text always lands in
   *  labelMid for backward compat. */
  labels?: ConnectorTextLabel[];
  /** Intermediate path points the connector must pass through. Set
   *  by the PPTX importer from the source `<p:cxnSp>` bbox so the
   *  manifold-bus pattern (entity → bus row → holding) survives
   *  instead of being re-routed by our generic orthogonal logic.
   *  Empty / missing means "auto-route via routeStyle". The router
   *  still snaps the first/last segments perpendicular to the box
   *  edges they touch, but every intermediate vertex comes from
   *  here verbatim. */
  waypoints?: { x: number; y: number }[];
};

/** Page-size guides shown behind the boxes — like Excel's print
 *  preview boundaries. Sizes are in pixels at 96 DPI (the canvas
 *  coordinate space): 1in = 96px, so 8.5×11" → 816×1056 px. */
export type PaperPresetKey =
  | "off"
  | "letter" | "letter-landscape"
  | "legal" | "legal-landscape"
  | "tabloid" | "tabloid-landscape";

export const PAPER_PRESETS: Record<Exclude<PaperPresetKey, "off">, { width: number; height: number; label: string }> = {
  "letter":            { width: 816,  height: 1056, label: "Letter (8.5×11)" },
  "letter-landscape":  { width: 1056, height: 816,  label: "Letter Landscape (11×8.5)" },
  "legal":             { width: 816,  height: 1344, label: "Legal (8.5×14)" },
  "legal-landscape":   { width: 1344, height: 816,  label: "Legal Landscape (14×8.5)" },
  "tabloid":           { width: 1056, height: 1632, label: "Tabloid (11×17)" },
  "tabloid-landscape": { width: 1632, height: 1056, label: "Tabloid Landscape (17×11)" },
};

export type ChartState = {
  version: 1;
  title: string;
  theme: ThemeKey;
  boxes: Box[];
  connectors: Connector[];
  /** When true (default), the editor enforces a single uniform width/height
   *  across all boxes — every box matches the largest natural size. Imported
   *  charts (PPTX, AI sketch) flip this off so the source layout's relative
   *  proportions survive. The user can re-enable from the toolbar. */
  uniformSize?: boolean;
  /** Optional paper-size guide rendered behind the boxes. "off" (or
   *  unset) hides it. Useful for laying out a chart that needs to fit
   *  on a printed page — the rectangle shows the page boundary. */
  paperSize?: PaperPresetKey;
};

/** Selection model. Multi-box appears when the user shift-clicks
 *  additional boxes; we keep it as an array (not a Set) so order is
 *  stable — used by the "Connect" action to decide who's parent. */
export type Selection =
  | { kind: "none" }
  | { kind: "box"; id: string }
  | { kind: "boxes"; ids: string[] }
  | { kind: "connector"; id: string }
  | { kind: "connectors"; ids: string[] }
  /** Only the text label is selected — the parent connector is NOT.
   *  Used when the user clicks the label chip directly so they can
   *  edit the label's text/color/font without applying changes to
   *  the line itself. `labelId` is "mid" for the connector's
   *  labelMid, or one of the ids in `connector.labels[]`. */
  | { kind: "connectorLabel"; connectorId: string; labelId: string }
  /** Heterogeneous selection — produced when the user shift-clicks
   *  across boxes and connectors. Movement uses the box ids; the
   *  connectors come along for delete and group operations. Both
   *  arrays are non-empty (a single-type selection collapses back to
   *  one of the typed kinds above). */
  | { kind: "mixed"; boxIds: string[]; connectorIds: string[] };

export const DEFAULT_BOX_W = 180;
export const DEFAULT_BOX_H = 80;
