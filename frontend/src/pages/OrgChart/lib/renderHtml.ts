// Self-contained HTML snapshot of an org chart. Used by Print (the
// browser's print dialog opens against this rendering, cropped to the
// active paper boundary) and by Export HTML (downloads the same
// document so it can be archived / shared). The output is a single
// .html file with inline CSS / SVG — no external assets — and matches
// the on-screen styling: same shapes, fills, fonts, connector paths,
// and arrowheads. Anything outside the paper rectangle is clipped out
// so a printed page contains only the page boundary and what's on it.

import { connectorPath } from "./connectors";
import type { Box, ChartState, Connector } from "./types";
import { PAPER_PRESETS } from "./types";

const CONNECTOR_COLOR = "#475569";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ptToPx(pt: number): number {
  return pt * (96 / 72);
}

/** Bounding rectangle to draw — the chosen paper preset when set,
 *  otherwise a tight box around all chart content (with margin) so
 *  the export still has a defined boundary. */
function pickBounds(chart: ChartState): { x: number; y: number; width: number; height: number; label: string } {
  if (chart.paperSize && chart.paperSize !== "off" && PAPER_PRESETS[chart.paperSize]) {
    const p = PAPER_PRESETS[chart.paperSize];
    return { x: 0, y: 0, width: p.width, height: p.height, label: p.label };
  }
  // Fallback: tight bounds around content + 24px padding.
  if (chart.boxes.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600, label: "Auto" };
  }
  const xs = chart.boxes.map((b) => b.x);
  const ys = chart.boxes.map((b) => b.y);
  const xs2 = chart.boxes.map((b) => b.x + b.width);
  const ys2 = chart.boxes.map((b) => b.y + b.height);
  const pad = 24;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs2) + pad;
  const maxY = Math.max(...ys2) + pad;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, label: "Content bounds" };
}

function fmtPct(n: number): string {
  const s = n.toFixed(2);
  return s.replace(/\.?0+$/, "") + "%";
}

function renderBox(b: Box): string {
  // Honor the box's own `fontSizePt` so the printed page matches
  // exactly what the user sees in the editor — overriding with a
  // global 11pt scrambled boxes that were authored at 9pt (typical
  // for AI-imported charts) and pushed long names out of their
  // boxes. Header text (entity type + ownership) renders at
  // max(8, namePx * 0.7) so it stays the smaller eyebrow.
  const namePx = ptToPx(b.fontSizePt ?? 11);
  const padding = namePx * 0.55;
  const gap = namePx * 0.25;
  const subPx = Math.max(8, Math.round(namePx * 0.7));
  const align = b.textAlign ?? "left";
  const nameFont = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
  const headerFont = "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const borderWidth = b.borderWidth ?? 1.5;
  const ownership = b.ownershipPct != null ? fmtPct(b.ownershipPct) : "";
  const entityType = (b.entityType || "").toUpperCase();
  // Header text matches the smaller body-text size (subPx) so the
  // entity-type / ownership eyebrow doesn't visually outweigh the
  // jurisdiction and notes rows. The whole row is dropped when the
  // user has flipped `hideEntityType` AND the box has no ownership %
  // — the next text row (the name) bumps up to fill the freed
  // padding.
  const headerStyle = `font-family: ${headerFont}; font-size: ${subPx}px; font-weight: 600; letter-spacing: 0.08em; color: ${b.textColor}; opacity: 0.6; line-height: 1.1;`;
  const showHeaderRow = !b.hideEntityType || b.ownershipPct != null;
  const headerRow = showHeaderRow
    ? `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px;">
        ${b.hideEntityType ? "" : `<div style="${headerStyle} text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(entityType)}</div>`}
        ${ownership ? `<div style="${headerStyle} font-variant-numeric: tabular-nums; flex-shrink: 0; margin-left: auto;">${escapeHtml(ownership)}</div>` : ""}
      </div>`
    : "";
  // Name uses -webkit-line-clamp: 2 (same as the editor's
  // .line-clamp-2 utility) so long entity names stay clipped to two
  // lines instead of pushing other rows out of the box.
  const nameRow = `<div style="
    font-family: ${nameFont};
    font-size: ${namePx}px;
    font-weight: 500;
    line-height: 1.25;
    color: ${b.textColor};
    text-align: ${align};
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  ">${escapeHtml(b.name || "Untitled")}</div>`;
  const subStyle = `font-family: ${headerFont}; font-size: ${subPx}px; line-height: 1.2; color: ${b.textColor}; opacity: 0.6; text-align: ${align}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
  const jurRow = b.jurisdiction && b.jurisdiction.trim()
    ? `<div style="${subStyle}">${escapeHtml(b.jurisdiction)}</div>`
    : "";
  const notesRow = b.notes && b.notes.trim()
    ? `<div style="${subStyle} font-style: italic;">${escapeHtml(b.notes)}</div>`
    : "";
  return `<div class="oc-box" style="
    left: ${b.x}px;
    top: ${b.y}px;
    width: ${b.width}px;
    height: ${b.height}px;
    background: ${b.fillColor};
    border: ${borderWidth}px solid ${b.borderColor};
    border-radius: 8px;
    overflow: hidden;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    padding: ${padding}px;
    gap: ${gap}px;
  ">
    ${headerRow}
    ${nameRow}
    ${jurRow}
    ${notesRow}
  </div>`;
}

/** Combine every connector that shares a `manifoldId` into a single
 *  trim-bounded trunk. Each connector individually traces a full
 *  source → trunk → target path, so when several share an elbow the
 *  trunk segment gets drawn 2× (or 3×, etc.) along its overlap range
 *  and the rendered SVG ends up with hairlines extending past the
 *  outermost source — what reads on the page as "lines past the main
 *  connector branch." Trimming replaces that with one trunk drawn
 *  exactly between the leftmost and rightmost source/target X (or
 *  topmost/bottommost Y for a vertical trunk) plus per-source
 *  perpendicular stubs and one target stub carrying the arrowhead.
 *  Connectors without `manifoldId` render as before. */
function renderManifoldGroup(connectors: Connector[], chart: ChartState): string {
  // Need at least 2 to be a "group"; a 1-member manifold renders the
  // same as a non-manifold connector.
  if (connectors.length < 2) return renderConnector(connectors[0], chart);
  // Trunk axis: vertical (elbowY shared) when all entries set elbowY,
  // horizontal (elbowX shared) when all set elbowX. Mixed → fall back
  // to per-connector rendering.
  const allElbowY = connectors.every((c) => c.elbowY !== undefined);
  const allElbowX = connectors.every((c) => c.elbowX !== undefined);
  if (!allElbowY && !allElbowX) {
    return connectors.map((c) => renderConnector(c, chart)).join("\n");
  }
  const horizontalTrunk = allElbowY;
  const trunkAxisVal = horizontalTrunk ? connectors[0].elbowY! : connectors[0].elbowX!;
  // Shared end: every connector either targets the same box or
  // sources from the same box. The "free" end of each connector is
  // its non-shared side, where each connector's stub anchors.
  const sameTarget = connectors.every((c) => c.toBoxId === connectors[0].toBoxId);
  const sameSource = connectors.every((c) => c.fromBoxId === connectors[0].fromBoxId);
  if (!sameTarget && !sameSource) {
    return connectors.map((c) => renderConnector(c, chart)).join("\n");
  }
  // Compute the stub anchors. For shared-target manifolds the free
  // end is the source; for shared-source it's the target.
  type Stub = { axis: number; perp: number };
  const freeStubs: Stub[] = [];
  let sharedStub: Stub | null = null;
  let sharedSide: "top" | "right" | "bottom" | "left" | undefined;
  let sharedToOffset: number | undefined;
  let arrowAtSharedEnd = true;
  for (const c of connectors) {
    const fromBox = chart.boxes.find((b) => b.id === c.fromBoxId);
    const toBox = chart.boxes.find((b) => b.id === c.toBoxId);
    if (!fromBox || !toBox) continue;
    const fromAnchor = anchorOnBox(fromBox, c.fromSide ?? "bottom", c.fromOffset ?? 0.5);
    const toAnchor = anchorOnBox(toBox, c.toSide ?? "top", c.toOffset ?? 0.5);
    if (sameTarget) {
      // Free side = source.
      freeStubs.push({
        axis: horizontalTrunk ? fromAnchor.x : fromAnchor.y,
        perp: horizontalTrunk ? fromAnchor.y : fromAnchor.x,
      });
      sharedStub = {
        axis: horizontalTrunk ? toAnchor.x : toAnchor.y,
        perp: horizontalTrunk ? toAnchor.y : toAnchor.x,
      };
      sharedSide = c.toSide ?? "top";
      sharedToOffset = c.toOffset;
      arrowAtSharedEnd = (c.arrowheadAt ?? "end") === "end";
    } else {
      freeStubs.push({
        axis: horizontalTrunk ? toAnchor.x : toAnchor.y,
        perp: horizontalTrunk ? toAnchor.y : toAnchor.x,
      });
      sharedStub = {
        axis: horizontalTrunk ? fromAnchor.x : fromAnchor.y,
        perp: horizontalTrunk ? fromAnchor.y : fromAnchor.x,
      };
      sharedSide = c.fromSide ?? "bottom";
      arrowAtSharedEnd = (c.arrowheadAt ?? "end") === "start";
    }
  }
  if (!sharedStub || freeStubs.length === 0) {
    return connectors.map((c) => renderConnector(c, chart)).join("\n");
  }
  // Trunk span: leftmost stub axis to rightmost stub axis, including
  // the shared end so the trunk reaches the target column even when
  // it sits outside the source range.
  const allAxes = [...freeStubs.map((s) => s.axis), sharedStub.axis];
  const trunkLo = Math.min(...allAxes);
  const trunkHi = Math.max(...allAxes);
  const showArrow = connectors[0].showArrowhead;
  const sharedArrow = showArrow && arrowAtSharedEnd;
  const stubArrow = showArrow && !arrowAtSharedEnd;
  const paths: string[] = [];
  // Free-side stubs (one per connector). Arrow goes here when
  // arrowheadAt is "start" on a shared-target manifold (i.e. the
  // user reversed the arrow).
  for (const stub of freeStubs) {
    const x1 = horizontalTrunk ? stub.axis : trunkAxisVal;
    const y1 = horizontalTrunk ? stub.perp : stub.axis;
    const x2 = horizontalTrunk ? stub.axis : trunkAxisVal;
    const y2 = horizontalTrunk ? trunkAxisVal : stub.axis;
    const marker = stubArrow ? `marker-start="url(#oc-arrow)"` : "";
    paths.push(`<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${CONNECTOR_COLOR}" stroke-width="1.5" ${marker}></path>`);
  }
  // Single trunk segment.
  if (horizontalTrunk) {
    paths.push(`<path d="M ${trunkLo} ${trunkAxisVal} L ${trunkHi} ${trunkAxisVal}" fill="none" stroke="${CONNECTOR_COLOR}" stroke-width="1.5"></path>`);
  } else {
    paths.push(`<path d="M ${trunkAxisVal} ${trunkLo} L ${trunkAxisVal} ${trunkHi}" fill="none" stroke="${CONNECTOR_COLOR}" stroke-width="1.5"></path>`);
  }
  // Shared-end stub: trunk → target (or trunk → source). Arrowhead
  // sits here for the typical "child → parent" manifold where the
  // shared end is the parent.
  void sharedSide; void sharedToOffset;
  {
    const x1 = horizontalTrunk ? sharedStub.axis : trunkAxisVal;
    const y1 = horizontalTrunk ? trunkAxisVal : sharedStub.axis;
    const x2 = horizontalTrunk ? sharedStub.axis : sharedStub.perp;
    const y2 = horizontalTrunk ? sharedStub.perp : sharedStub.axis;
    const marker = sharedArrow ? `marker-end="url(#oc-arrow)"` : "";
    paths.push(`<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${CONNECTOR_COLOR}" stroke-width="1.5" ${marker}></path>`);
  }
  return paths.join("\n");
}

function anchorOnBox(b: Box, side: "top" | "right" | "bottom" | "left", offset: number): { x: number; y: number } {
  switch (side) {
    case "top":    return { x: b.x + b.width * offset, y: b.y };
    case "right":  return { x: b.x + b.width, y: b.y + b.height * offset };
    case "bottom": return { x: b.x + b.width * offset, y: b.y + b.height };
    case "left":   return { x: b.x, y: b.y + b.height * offset };
  }
}

/** Walk the path's straight-line segments and return the world-space
 *  midpoint by cumulative arc length. Reproduces what the editor's
 *  `getPointAtLength(len/2)` does, but works at export time without a
 *  live DOM. Only `M` and `L` commands appear in the editor's path
 *  output so we just regex out those vertices. */
function pathMidpointFromD(d: string): { x: number; y: number } {
  const pts: Array<{ x: number; y: number }> = [];
  const re = /([ML])\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    pts.push({ x: parseFloat(m[2]), y: parseFloat(m[3]) });
  }
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0];
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(len);
    total += len;
  }
  if (total === 0) return pts[0];
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= half) {
      const t = segs[i] === 0 ? 0 : (half - acc) / segs[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    acc += segs[i];
  }
  return pts[pts.length - 1];
}

/** Render every text label attached to this connector as an
 *  absolutely-positioned `<div>` inside the stage. labelMid sits at
 *  the path midpoint (with optional free-mode offset); each entry in
 *  `connector.labels[]` carries its own absolute offset. Pre-fix the
 *  HTML export drew the connectors as SVG paths but never emitted
 *  the label text at all — labels just disappeared in print / HTML
 *  archive. */
function renderConnectorLabels(c: Connector, chart: ChartState, pathD: string): string {
  if (!pathD) return "";
  const mid = pathMidpointFromD(pathD);
  const chips: string[] = [];
  const midText = (c.labelMid ?? c.label ?? "").replace(/\s+$/, "");
  if (midText) {
    const mode = c.labelMode ?? "on-connector";
    const ox = c.labelOffset?.x ?? 0;
    const oy = c.labelOffset?.y ?? 0;
    chips.push(renderLabelChip(midText, mid.x + (mode === "free" ? ox : 0), mid.y + (mode === "free" ? oy : 0), c.labelFontSizePt ?? 11, c.labelColor, c.labelAlign));
  }
  for (const lbl of c.labels ?? []) {
    if (!lbl.text) continue;
    const mode = lbl.mode ?? "free";
    const x = mode === "on-connector" ? mid.x + (lbl.offset?.x ?? 0) : (lbl.offset?.x ?? mid.x);
    const y = mode === "on-connector" ? mid.y + (lbl.offset?.y ?? 0) : (lbl.offset?.y ?? mid.y);
    const fontSizePt = lbl.fontSizePt ?? c.labelFontSizePt ?? 11;
    chips.push(renderLabelChip(lbl.text, x, y, fontSizePt, lbl.color ?? c.labelColor, lbl.align ?? c.labelAlign));
  }
  return chips.join("\n");
}

function renderLabelChip(
  text: string,
  cx: number,
  cy: number,
  fontSizePt: number,
  color: string | undefined,
  align: "left" | "center" | "right" | undefined,
): string {
  const fontPx = ptToPx(fontSizePt);
  const lines = text.split("\n");
  const longest = lines.reduce((m, line) => Math.max(m, line.length), 0);
  // Same tight sizing as the editor's ConnectorLabel chip.
  const w = Math.max(16, longest * fontPx * 0.55 + 6);
  const h = lines.length * fontPx * 1.2 + 4;
  const textAlign = align ?? "center";
  const fill = color || "#475569";
  return `<div class="oc-label" style="
    position: absolute;
    left: ${cx - w / 2}px;
    top: ${cy - h / 2}px;
    width: ${w}px;
    height: ${h}px;
    background: #ffffff;
    border-radius: 3px;
    padding: 2px 3px;
    box-sizing: border-box;
    font-family: Inter, system-ui, sans-serif;
    font-size: ${fontPx}px;
    line-height: 1.2;
    font-weight: 500;
    color: ${fill};
    text-align: ${textAlign};
    white-space: pre-line;
    overflow: hidden;
  ">${escapeHtml(text)}</div>`;
}

function pathDFor(c: Connector, chart: ChartState): string {
  const from = chart.boxes.find((b) => b.id === c.fromBoxId);
  const to = chart.boxes.find((b) => b.id === c.toBoxId);
  if (!from || !to) return "";
  const obstacles = chart.boxes.filter((b) => b.id !== from.id && b.id !== to.id);
  // Resolve toAnchor from parent connector when this is a T-junction —
  // mirrors the live render's parentConnId re-snap so the exported
  // line lands on the parent's current trunk Y/X.
  let liveToAnchor = c.toAnchor;
  if (c.parentConnId && c.toAnchor) {
    const parent = chart.connectors.find((p) => p.id === c.parentConnId);
    if (parent) {
      const trunkY = parent.elbowY ?? (parent.waypoints && parent.waypoints.length > 0 && parent.waypoints.every((w) => Math.abs(w.y - parent.waypoints![0].y) < 0.5) ? parent.waypoints[0].y : undefined);
      if (trunkY !== undefined) liveToAnchor = { x: c.toAnchor.x, y: trunkY };
    }
  }
  return connectorPath(
    from, to, c.routeStyle,
    {
      fromSide: c.fromSide, toSide: c.toSide,
      fromOffset: c.fromOffset, toOffset: c.toOffset,
      elbowX: c.elbowX, elbowY: c.elbowY,
      step1: c.step1, step2: c.step2,
      toAnchor: liveToAnchor,
    },
    obstacles,
    c.routeDetail ?? "min",
    c.waypoints ?? [],
  );
}

function renderConnector(c: Connector, chart: ChartState): string {
  const d = pathDFor(c, chart);
  if (!d) return "";
  const arrowAt = c.arrowheadAt ?? "end";
  const markerEnd = c.showArrowhead && arrowAt === "end" ? `marker-end="url(#oc-arrow)"` : "";
  const markerStart = c.showArrowhead && arrowAt === "start" ? `marker-start="url(#oc-arrow)"` : "";
  return `<path d="${d}" fill="none" stroke="${CONNECTOR_COLOR}" stroke-width="1.5" ${markerEnd} ${markerStart}></path>`;
}

/** Build the full HTML document. With `autoPrint: true` the document
 *  invokes window.print() once it loads — used by the Print path,
 *  which opens the doc in a child window. With `autoPrint: false`
 *  it's a static archive suitable for download. */
export function renderChartHtml(chart: ChartState, opts: { autoPrint?: boolean } = {}): string {
  const bounds = pickBounds(chart);
  const title = escapeHtml(chart.title || "Org Chart");
  const boxes = chart.boxes.map(renderBox).join("\n");
  // Group manifold-grouped connectors so the shared trunk renders
  // exactly once. Singletons + non-grouped connectors fall through to
  // the per-connector path renderer.
  const byManifold = new Map<string, Connector[]>();
  const standalone: Connector[] = [];
  for (const c of chart.connectors) {
    if (c.manifoldId) {
      const arr = byManifold.get(c.manifoldId) ?? [];
      arr.push(c);
      byManifold.set(c.manifoldId, arr);
    } else {
      standalone.push(c);
    }
  }
  const groupedHtml = [...byManifold.values()].map((group) => renderManifoldGroup(group, chart)).join("\n");
  const standaloneHtml = standalone.map((c) => renderConnector(c, chart)).join("\n");
  const connectors = `${groupedHtml}\n${standaloneHtml}`;
  // Connector text labels (labelMid + connector.labels[]) — rendered
  // as absolutely-positioned divs in the stage layer so the printed
  // page shows the same labels the user sees on the canvas. Compute
  // the path once per connector and pass to the label renderer so
  // it can position labels along that path.
  const connectorLabels = chart.connectors.map((c) => {
    const d = pathDFor(c, chart);
    return d ? renderConnectorLabels(c, chart, d) : "";
  }).join("\n");
  const widthIn = (bounds.width / 96).toFixed(2);
  const heightIn = (bounds.height / 96).toFixed(2);
  // Wait for the Google Fonts to actually load before printing —
  // otherwise the print dialog opens against fallback metrics
  // (Times for Cormorant, sans-serif for Inter) which are wider than
  // the editor's fonts, pushing text past the box boundaries. The
  // 1500ms backstop guards against networks where document.fonts
  // never resolves.
  const autoPrintScript = opts.autoPrint
    ? `<script>
        function go() { setTimeout(function(){ window.print(); }, 200); }
        window.addEventListener("load", function() {
          if (document.fonts && document.fonts.ready) {
            Promise.race([document.fonts.ready, new Promise(function(r){ setTimeout(r, 1500); })]).then(go);
          } else { go(); }
        });
      </script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<!-- Same Google Fonts the editor loads — Cormorant Garamond for
     entity names, Inter for UI rows — so the HTML export's text
     looks identical to what the user sees on screen instead of
     falling back to whatever serif/sans the host browser picks. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* Use the bounds rectangle as the @page size so a single-page
     print contains exactly the paper boundary the user sees in the
     editor — no second page bleed, no clipped boxes. */
  @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #0f172a; }
  .oc-paper {
    position: relative;
    width: ${bounds.width}px;
    height: ${bounds.height}px;
    margin: 0 auto;
    background: #fff;
    overflow: hidden;
    box-sizing: border-box;
  }
  .oc-paper-screen { border: 1.5px dashed #94a3b8; }
  .oc-stage {
    position: absolute;
    left: ${-bounds.x}px;
    top: ${-bounds.y}px;
    width: 1px;
    height: 1px;
  }
  .oc-box {
    position: absolute;
    border-radius: 8px;
    padding: 6px 10px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .oc-box-row { display: block; }
  .oc-box-name { display: block; margin-top: 2px; }
  .oc-svg { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; }

  @media print {
    body { background: #fff; }
    /* Hide the dashed paper border in print so it doesn't show as a
       hairline box around content — the page edge IS the boundary. */
    .oc-paper { border: none !important; }
  }
</style>
</head>
<body>
<div class="oc-paper oc-paper-screen">
  <div class="oc-stage">
    <svg class="oc-svg" overflow="visible">
      <defs>
        <marker id="oc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="${CONNECTOR_COLOR}"></path>
        </marker>
      </defs>
      ${connectors}
    </svg>
    ${boxes}
    ${connectorLabels}
  </div>
</div>
${autoPrintScript}
</body>
</html>`;
}
