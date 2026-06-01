// Round-trip export — turn a ChartState into a `.pptx` blob the user
// can open in PowerPoint, Keynote, or upload back into the app via
// Import .pptx. The deck is a single 16:9 slide whose extent is
// computed from the chart's bounding box (with a 64 EMU/px padding)
// so even sprawling charts fit on slide 1 — PowerPoint slide-size
// caps cap out at 142,222,800 EMU (about 156 inches) which we'll
// hit only for absurdly large charts.
//
// The OOXML envelope is hand-rolled rather than imported via
// pptxgenjs to avoid a heavyweight dependency. Files emitted:
//
//   [Content_Types].xml
//   _rels/.rels
//   ppt/presentation.xml
//   ppt/_rels/presentation.xml.rels
//   ppt/theme/theme1.xml
//   ppt/slideMasters/slideMaster1.xml
//   ppt/slideMasters/_rels/slideMaster1.xml.rels
//   ppt/slideLayouts/slideLayout1.xml
//   ppt/slideLayouts/_rels/slideLayout1.xml.rels
//   ppt/slides/slide1.xml
//   ppt/slides/_rels/slide1.xml.rels
//   ppt/presProps.xml
//   ppt/viewProps.xml
//   ppt/tableStyles.xml
//
// PowerPoint accepts the deck even though most of the auxiliary
// files are minimal — they exist solely to satisfy schema. Slide1
// carries every chart box as a rectangle and every connector as a
// `<p:cxnSp>` with `<a:stCxn>` / `<a:endCxn>` so re-importing the
// emitted deck round-trips boxes + connectors + labels.

import JSZip from "jszip";

import { connectorPath } from "./connectors";
import type { Box, ChartState, Connector, ConnectorSide } from "./types";

const EMU_PER_PX = 9525;
const PAD_EMU = 64 * EMU_PER_PX; // 64px breathing room around the bbox

export async function exportPptx(chart: ChartState): Promise<Blob> {
  const zip = new JSZip();

  // ---- Slide bbox + size -------------------------------------------
  // Compute the smallest rectangle that contains every box, expand
  // by PAD_EMU on each side, and translate everything so (0,0) sits
  // at top-left of the slide. PowerPoint's editor lets the user pan
  // beyond slide bounds but exporters generally produce decks where
  // shapes fit on the slide.
  let minX = 0, minY = 0, maxX = 1280, maxY = 720;
  if (chart.boxes.length > 0) {
    minX = Math.min(...chart.boxes.map((b) => b.x));
    minY = Math.min(...chart.boxes.map((b) => b.y));
    maxX = Math.max(...chart.boxes.map((b) => b.x + b.width));
    maxY = Math.max(...chart.boxes.map((b) => b.y + b.height));
  }
  const slideCxEmu = Math.max(720, maxX - minX) * EMU_PER_PX + PAD_EMU * 2;
  const slideCyEmu = Math.max(540, maxY - minY) * EMU_PER_PX + PAD_EMU * 2;
  // Translation: subtracting min*EMU and adding PAD shifts the
  // chart so its top-left is at (PAD, PAD) on the slide.
  const tx = -minX * EMU_PER_PX + PAD_EMU;
  const ty = -minY * EMU_PER_PX + PAD_EMU;

  // ---- Stable PPT shape ids ----------------------------------------
  // Every shape needs a unique <p:cNvPr id> within the slide. PPT
  // expects ids ≥ 2 (id 1 is reserved for the spTree itself). We
  // assign sequentially starting at 2, build a Box.id → PPT id map
  // so connectors can reference endpoints.
  let nextId = 2;
  const boxToPptId = new Map<string, number>();
  for (const b of chart.boxes) {
    boxToPptId.set(b.id, nextId++);
  }

  // ---- Build slide1.xml --------------------------------------------
  const shapesXml: string[] = [];
  for (const b of chart.boxes) {
    shapesXml.push(renderBox(b, boxToPptId.get(b.id)!, tx, ty));
  }
  for (const c of chart.connectors) {
    const fromId = boxToPptId.get(c.fromBoxId);
    const toId = boxToPptId.get(c.toBoxId);
    if (!fromId || !toId) continue; // dangling connector — skip
    const from = chart.boxes.find((b) => b.id === c.fromBoxId)!;
    const to = chart.boxes.find((b) => b.id === c.toBoxId)!;
    shapesXml.push(renderConnector(c, fromId, toId, from, to, chart, nextId++, tx, ty));
  }

  const slide1Xml = SLIDE_TEMPLATE.replace("{{SHAPES}}", shapesXml.join(""));

  // ---- Drop every file in the deck ---------------------------------
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.file("_rels/.rels", ROOT_RELS_XML);
  zip.file("ppt/presentation.xml", presentationXml(slideCxEmu, slideCyEmu));
  zip.file("ppt/_rels/presentation.xml.rels", PRESENTATION_RELS_XML);
  zip.file("ppt/theme/theme1.xml", THEME1_XML);
  zip.file("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER_XML);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", SLIDE_MASTER_RELS_XML);
  zip.file("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT_XML);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", SLIDE_LAYOUT_RELS_XML);
  zip.file("ppt/slides/slide1.xml", slide1Xml);
  zip.file("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS_XML);
  zip.file("ppt/presProps.xml", PRES_PROPS_XML);
  zip.file("ppt/viewProps.xml", VIEW_PROPS_XML);
  zip.file("ppt/tableStyles.xml", TABLE_STYLES_XML);

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    compression: "DEFLATE",
  });
}

// ---- Shape generators --------------------------------------------

function renderBox(b: Box, pptId: number, tx: number, ty: number): string {
  const x = Math.round(b.x * EMU_PER_PX + tx);
  const y = Math.round(b.y * EMU_PER_PX + ty);
  const cx = Math.max(1, Math.round(b.width * EMU_PER_PX));
  const cy = Math.max(1, Math.round(b.height * EMU_PER_PX));
  const fillRgb = hexToRgb6(b.fillColor) || "FFFFFF";
  const borderRgb = hexToRgb6(b.borderColor) || "000000";
  const textRgb = hexToRgb6(b.textColor) || "000000";

  // Use ONE consistent font size across every box. PowerPoint sz is
  // expressed in 1/100 of a point, so 1100 = 11pt. We ignore per-box
  // fontSizePt because PPTX imports often carry inconsistent sizes
  // (boxes inherited from different source decks) and the user wants
  // every box in the deck to read uniformly. subPx = 800 (8pt) keeps
  // jurisdiction / notes a step below the name.
  const namePx = 1100;
  const subPx = 800;
  const nameFace = cssFamilyToTypeface(b.fontFamily) ?? "Cormorant Garamond";
  const headerFace = "Inter";
  const paragraphs: string[] = [];
  // Header row at subPx (8pt) instead of namePx (11pt) so the
  // entity-type eyebrow doesn't appear visually larger than the
  // jurisdiction / notes lines. The whole row is dropped when
  // `hideEntityType` is set AND there's no ownership % to display
  // — the next row (the name) takes the top of the box. The
  // earlier version paired entity-type + ownership-% in a single
  // paragraph via a tab-stop; PowerPoint flagged the resulting
  // OOXML as malformed and refused to open the deck. We now emit
  // them as separate centered paragraphs so the file opens
  // reliably; the visual approximates the editor's flex header
  // without needing tab stops.
  if (!b.hideEntityType) {
    paragraphs.push(rPara(b.entityType, textRgb, { sz: subPx, bold: true, caps: true, typeface: headerFace, align: "l" }));
  }
  if (b.ownershipPct != null) {
    paragraphs.push(rPara(formatPct(b.ownershipPct), textRgb, { sz: subPx, bold: true, typeface: headerFace, align: "r" }));
  }
  paragraphs.push(rPara(b.name || "Untitled", textRgb, { sz: namePx, typeface: nameFace, align: "l" }));
  if (b.jurisdiction) {
    paragraphs.push(rPara(`(${b.jurisdiction})`, textRgb, { sz: subPx, typeface: headerFace, align: "l" }));
  }
  if (b.notes) {
    paragraphs.push(rPara(b.notes, textRgb, { sz: subPx, italic: true, typeface: headerFace, align: "l" }));
  }

  // roundRect with adj=11% (~8px on a 70px-tall box) approximates the
  // editor's `borderRadius: 8`. PPT accepts the adj as a fraction
  // out of 100000.
  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${pptId}" name="${escapeAttr(b.name)}"/>
      <p:cNvSpPr/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm>
        <a:off x="${x}" y="${y}"/>
        <a:ext cx="${cx}" cy="${cy}"/>
      </a:xfrm>
      <a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 11000"/></a:avLst></a:prstGeom>
      <a:solidFill><a:srgbClr val="${fillRgb}"/></a:solidFill>
      <a:ln w="19050"><a:solidFill><a:srgbClr val="${borderRgb}"/></a:solidFill></a:ln>
    </p:spPr>
    <p:txBody>
      <a:bodyPr wrap="square" anchor="t" lIns="60960" tIns="45720" rIns="60960" bIns="45720"/>
      <a:lstStyle/>
      ${paragraphs.join("")}
    </p:txBody>
  </p:sp>`;
}

/** Header paragraph that puts the entity-type label on the left and
 *  the ownership % on the right, mirroring the editor's flex header
 *  with `justify-between`. PowerPoint paragraphs don't have flex —
 *  we use a right-aligned tab stop placed near the box's right edge
 *  so the % sits flush right regardless of label length. */
function rHeaderRow(
  entity: string,
  pct: string,
  rgb: string,
  sz: number,
  typeface: string,
  boxCxEmu: number,
): string {
  // Tab stop at (boxCxEmu - lIns - rIns)/EMU * 1000 — PPT measures
  // tabs from the txBody's content area in 1/1000ths of a point.
  // We use a generous offset so the % lands at the right edge.
  const tabPosTwips = Math.max(1000, Math.round((boxCxEmu - 121920) / 12700 * 100));
  return `<a:p>
    <a:pPr algn="l"><a:tabLst><a:tab pos="${tabPosTwips}" algn="r"/></a:tabLst></a:pPr>
    <a:r>
      <a:rPr lang="en-US" sz="${sz}" b="1" cap="all"><a:solidFill><a:srgbClr val="${rgb}"/></a:solidFill><a:latin typeface="${escapeAttr(typeface)}"/></a:rPr>
      <a:t>${escapeXml(entity)}</a:t>
    </a:r>
    <a:r>
      <a:rPr lang="en-US" sz="${sz}" b="1"><a:solidFill><a:srgbClr val="${rgb}"/></a:solidFill><a:latin typeface="${escapeAttr(typeface)}"/></a:rPr>
      <a:t>\t${escapeXml(pct)}</a:t>
    </a:r>
  </a:p>`;
}

function renderConnector(
  c: Connector,
  fromPptId: number,
  toPptId: number,
  from: Box,
  to: Box,
  chart: ChartState,
  pptId: number,
  tx: number,
  ty: number,
): string {
  // Use the editor's actual `connectorPath` to compute the polyline
  // verbatim, then emit a `<p:cxnSp>` with `<a:custGeom>` that traces
  // the same points. PowerPoint's preset connectors (bentConnector3
  // etc.) only support specific topologies and put the elbow at the
  // bbox center, which doesn't match the editor's elbow position
  // when the user has placed an override (elbowX/elbowY/step1/step2)
  // or a T-junction toAnchor — exactly the cases where the old
  // export looked "disconnected." Custom geometry preserves every
  // segment exactly. We still keep stCxn/endCxn so a re-import
  // recovers the box connections, even though PPT will draw the
  // line via the custGeom path.
  const obstacles = chart.boxes.filter((bb) => bb.id !== from.id && bb.id !== to.id);
  // Resolve T-junction toAnchor through the parent's current trunk
  // (mirrors the live render's parentConnId re-snap).
  let liveToAnchor = c.toAnchor;
  if (c.parentConnId && c.toAnchor) {
    const parent = chart.connectors.find((p) => p.id === c.parentConnId);
    if (parent) {
      const trunkY = parent.elbowY ?? (parent.waypoints && parent.waypoints.length > 0 && parent.waypoints.every((w) => Math.abs(w.y - parent.waypoints![0].y) < 0.5) ? parent.waypoints[0].y : undefined);
      if (trunkY !== undefined) liveToAnchor = { x: c.toAnchor.x, y: trunkY };
    }
  }
  const pathStr = connectorPath(
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
  const points = parsePathPoints(pathStr);
  // Compute path bbox; use it for the shape's xfrm. Custom-geom path
  // coords are normalized to (W, H) — we use the bbox dims so the
  // shape's natural size matches the path extent.
  // Path bbox in chart coords. Use the actual computed points so the
  // shape's xfrm matches whatever shape the editor drew.
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const bx = xs.length > 0 ? Math.min(...xs) : a.x;
  const by = ys.length > 0 ? Math.min(...ys) : a.y;
  const bMaxX = xs.length > 0 ? Math.max(...xs) : a.x;
  const bMaxY = ys.length > 0 ? Math.max(...ys) : a.y;
  // Clamp dimensions to a minimum of 1px so a perfectly-axis-aligned
  // path (zero-height horizontal or zero-width vertical) still has a
  // valid bbox in PowerPoint.
  const bcx = Math.max(1, bMaxX - bx);
  const bcy = Math.max(1, bMaxY - by);
  const offX = Math.round(bx * EMU_PER_PX + tx);
  const offY = Math.round(by * EMU_PER_PX + ty);
  const extCx = Math.round(bcx * EMU_PER_PX);
  const extCy = Math.round(bcy * EMU_PER_PX);

  const stIdx = sideToIdx(c.fromSide);
  const enIdx = sideToIdx(c.toSide);
  const tail = c.showArrowhead && (c.arrowheadAt ?? "end") === "end" ? `<a:tailEnd type="triangle"/>` : "";
  const head = c.showArrowhead && c.arrowheadAt === "start" ? `<a:headEnd type="triangle"/>` : "";

  // Build custGeom path. PPT path coords run 0..pathW/pathH within
  // the shape's bbox. We use a fixed grid of 100000 (matches PPT's
  // adj-value scale) for resolution; each chart point maps to
  // (x - bx) / bcx * pathW.
  const pathW = 100000;
  const pathH = 100000;
  const pathOps = points.map((p, i) => {
    const px = bcx > 0 ? Math.round((p.x - bx) / bcx * pathW) : 0;
    const py = bcy > 0 ? Math.round((p.y - by) / bcy * pathH) : 0;
    return i === 0
      ? `<a:moveTo><a:pt x="${px}" y="${py}"/></a:moveTo>`
      : `<a:lnTo><a:pt x="${px}" y="${py}"/></a:lnTo>`;
  }).join("");
  const custGeom = `<a:custGeom>
    <a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>
    <a:rect l="0" t="0" r="${pathW}" b="${pathH}"/>
    <a:pathLst><a:path w="${pathW}" h="${pathH}" fill="none">${pathOps}</a:path></a:pathLst>
  </a:custGeom>`;

  // Connector text labels — both the primary labelMid AND every
  // entry in connector.labels[] get their own text-box shape so all
  // labels show up in the deck (not just the legacy `label` field).
  // Position is the path midpoint plus the label's free-mode offset
  // (extras are stored as absolute world coords).
  const labelsXml: string[] = [];
  // Compute path midpoint from the actual path points so the primary
  // label sits where the editor renders it instead of at a naive
  // segment midpoint.
  const midPt = points.length >= 2
    ? (() => {
      let total = 0;
      const segs: number[] = [];
      for (let i = 1; i < points.length; i++) {
        const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
        segs.push(len);
        total += len;
      }
      if (total === 0) return points[0];
      const half = total / 2;
      let acc = 0;
      for (let i = 0; i < segs.length; i++) {
        if (acc + segs[i] >= half) {
          const t = segs[i] === 0 ? 0 : (half - acc) / segs[i];
          return {
            x: points[i].x + (points[i + 1].x - points[i].x) * t,
            y: points[i].y + (points[i + 1].y - points[i].y) * t,
          };
        }
        acc += segs[i];
      }
      return points[points.length - 1];
    })()
    : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  let labelShapeId = pptId + 1;
  function emitLabel(text: string, worldX: number, worldY: number, fontSizePt: number, color?: string): void {
    const sz = Math.round(fontSizePt * 100);
    const fontPx = fontSizePt * (96 / 72);
    const lines = text.split("\n");
    const longest = lines.reduce((m, line) => Math.max(m, line.length), 0);
    const widthPx = Math.max(16, longest * fontPx * 0.55 + 6);
    const heightPx = lines.length * fontPx * 1.2 + 4;
    const cxEmu = Math.max(1, Math.round(widthPx * EMU_PER_PX));
    const cyEmu = Math.max(1, Math.round(heightPx * EMU_PER_PX));
    const offXEmu = Math.round(worldX * EMU_PER_PX + tx) - Math.round(cxEmu / 2);
    const offYEmu = Math.round(worldY * EMU_PER_PX + ty) - Math.round(cyEmu / 2);
    const colorRgb = (color && hexToRgb6(color)) || "475569";
    const lineParas = lines.map((line) => rPara(line || " ", colorRgb, { sz, bold: true, typeface: "Inter" })).join("");
    const id = labelShapeId++;
    labelsXml.push(`<p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${id}" name="ConnectorLabel"/>
        <p:cNvSpPr txBox="1"/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm>
          <a:off x="${offXEmu}" y="${offYEmu}"/>
          <a:ext cx="${cxEmu}" cy="${cyEmu}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
        <a:ln><a:noFill/></a:ln>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="none" anchor="ctr" lIns="36576" tIns="18288" rIns="36576" bIns="18288"/>
        <a:lstStyle/>
        ${lineParas}
      </p:txBody>
    </p:sp>`);
  }
  const midText = (c.labelMid ?? c.label ?? "").replace(/\s+$/, "");
  if (midText) {
    const mode = c.labelMode ?? "on-connector";
    const ox = c.labelOffset?.x ?? 0;
    const oy = c.labelOffset?.y ?? 0;
    emitLabel(midText, midPt.x + (mode === "free" ? ox : 0), midPt.y + (mode === "free" ? oy : 0), c.labelFontSizePt ?? 11, c.labelColor);
  }
  for (const lbl of c.labels ?? []) {
    if (!lbl.text) continue;
    const mode = lbl.mode ?? "free";
    const x = mode === "on-connector" ? midPt.x + (lbl.offset?.x ?? 0) : (lbl.offset?.x ?? midPt.x);
    const y = mode === "on-connector" ? midPt.y + (lbl.offset?.y ?? 0) : (lbl.offset?.y ?? midPt.y);
    emitLabel(lbl.text, x, y, lbl.fontSizePt ?? c.labelFontSizePt ?? 11, lbl.color ?? c.labelColor);
  }
  const labelXml = labelsXml.join("");

  // Emit the connector as a regular `<p:sp>` with custGeom instead
  // of `<p:cxnSp>` — PowerPoint refuses to load a deck whose
  // connector shapes carry a custom geometry, and shows the
  // "PowerPoint found a problem with content … Repaired and removed
  // it" dialog. The downside is that we drop the stCxn/endCxn
  // box-side connections, so on re-import the route geometry has to
  // be re-derived from the path's bbox. The line itself still
  // matches the editor exactly because the path coordinates encode
  // every elbow/step verbatim.
  void fromPptId; void toPptId; void stIdx; void enIdx;
  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${pptId}" name="Connector"/>
      <p:cNvSpPr/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm>
        <a:off x="${offX}" y="${offY}"/>
        <a:ext cx="${extCx}" cy="${extCy}"/>
      </a:xfrm>
      ${custGeom}
      <a:noFill/>
      <a:ln w="19050"><a:solidFill><a:srgbClr val="475569"/></a:solidFill>${head}${tail}</a:ln>
    </p:spPr>
  </p:sp>${labelXml}`;
}

/** Parse an SVG path string into an ordered list of points. The
 *  editor's `connectorPath` only emits absolute M / L commands, so we
 *  just split on those tokens and pull the X/Y pairs. Anything more
 *  exotic (curves, relative commands) would need extra handling but
 *  doesn't currently appear in the chart's path output. */
function parsePathPoints(d: string): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  // Match "M 1 2" or "L 3 4" tokens — number = optional sign,
  // optional digits, optional decimal.
  const re = /([MLml])\s*([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    out.push({ x: parseFloat(m[2]), y: parseFloat(m[3]) });
  }
  return out;
}

// ---- Geometry helpers --------------------------------------------

function anchorOf(b: Box, side: ConnectorSide): { x: number; y: number } {
  switch (side) {
    case "top":    return { x: b.x + b.width / 2, y: b.y };
    case "right":  return { x: b.x + b.width, y: b.y + b.height / 2 };
    case "bottom": return { x: b.x + b.width / 2, y: b.y + b.height };
    case "left":   return { x: b.x, y: b.y + b.height / 2 };
  }
}

function autoSide(self: Box, other: Box): ConnectorSide {
  // Pick the side that points toward the other box's center —
  // matches what the editor's router does when fromSide/toSide are
  // omitted.
  const scx = self.x + self.width / 2;
  const scy = self.y + self.height / 2;
  const ocx = other.x + other.width / 2;
  const ocy = other.y + other.height / 2;
  const dx = ocx - scx;
  const dy = ocy - scy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

function sideToIdx(side: ConnectorSide | undefined): string {
  switch (side) {
    case "top": return "0";
    case "right": return "1";
    case "bottom": return "2";
    case "left": return "3";
    default: return "2"; // bottom — most common org-chart parent attachment
  }
}

// ---- Text helpers ------------------------------------------------

function rPara(
  text: string,
  rgb: string,
  opts: { sz?: number; bold?: boolean; italic?: boolean; caps?: boolean; typeface?: string; align?: "l" | "ctr" | "r" } = {},
): string {
  const props: string[] = [];
  if (opts.sz) props.push(`sz="${opts.sz}"`);
  if (opts.bold) props.push(`b="1"`);
  if (opts.italic) props.push(`i="1"`);
  if (opts.caps) props.push(`cap="all"`);
  const propsAttr = props.join(" ");
  // Inner children of <a:rPr>: solidFill always, latin typeface only
  // when the box overrides the deck default. Empty typeface means
  // "use whatever PowerPoint inherits from the master."
  const latinXml = opts.typeface
    ? `<a:latin typeface="${escapeAttr(opts.typeface)}"/>`
    : "";
  const algn = opts.align ?? "ctr";
  return `<a:p>
    <a:pPr algn="${algn}"/>
    <a:r>
      <a:rPr lang="en-US" ${propsAttr}>
        <a:solidFill><a:srgbClr val="${rgb}"/></a:solidFill>
        ${latinXml}
      </a:rPr>
      <a:t>${escapeXml(text)}</a:t>
    </a:r>
  </a:p>`;
}

/** Pull the first typeface name out of a CSS font-family stack —
 *  inverse of `cssFontStack` from importPptx. Returns null if the
 *  stack is empty, undefined, or starts with a generic family. */
function cssFamilyToTypeface(family: string | undefined): string | undefined {
  if (!family) return undefined;
  // Stack is comma-separated; first item may be quoted. Strip quotes
  // and surrounding whitespace.
  const first = family.split(",")[0].trim().replace(/^["']|["']$/g, "");
  if (!first) return undefined;
  // Generic CSS families aren't real PPT typefaces — leave them out
  // so PowerPoint inherits the master's font.
  if (/^(serif|sans-serif|monospace|system-ui|ui-monospace)$/i.test(first)) return undefined;
  return first;
}

function hexToRgb6(hex: string | undefined): string | null {
  if (!hex) return null;
  const m = hex.replace(/^#/, "").trim();
  // Expand the 3-char shorthand `#FA0` → `FFAA00`. Without this, any
  // chart with a shorthand fill (common from CSS hand-edits) fell
  // through to the white default and boxes lost their colors in the
  // pptx export.
  if (/^[0-9A-Fa-f]{3}$/.test(m)) {
    return (m[0] + m[0] + m[1] + m[1] + m[2] + m[2]).toUpperCase();
  }
  if (/^[0-9A-Fa-f]{6}$/.test(m)) return m.toUpperCase();
  if (/^[0-9A-Fa-f]{8}$/.test(m)) return m.slice(0, 6).toUpperCase();
  return null;
}

function formatPct(n: number): string {
  return (n.toFixed(2).replace(/\.?0+$/, "") || "0") + "%";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
const escapeAttr = escapeXml;

// ---- Static OOXML file bodies -----------------------------------
// These templates are minimal but valid — they pass the OOXML schema
// check that PowerPoint runs on open. Don't tweak them casually; an
// extra space inside an <a:graphicFrame> will fail the schema even
// though it looks identical to your eyes.

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>
  <Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

function presentationXml(cx: number, cy: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="${cx}" cy="${cy}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

const PRESENTATION_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>
</Relationships>`;

const THEME1_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="5B9BD5"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="4472C4"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont>
        <a:latin typeface="Calibri Light"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle/>
    <p:bodyStyle/>
    <p:otherStyle/>
  </p:txStyles>
</p:sldMaster>`;

const SLIDE_MASTER_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`;

const SLIDE_LAYOUT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const SLIDE_TEMPLATE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      {{SHAPES}}
    </p:spTree>
  </p:cSld>
</p:sld>`;

const SLIDE_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const PRES_PROPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`;

const VIEW_PROPS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`;

const TABLE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;
