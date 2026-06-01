// Import an existing org chart from PowerPoint (.pptx).
//
// Strategy: walk the slide's shape tree recursively, resolving group
// transforms so child shapes end up in absolute slide coordinates.
// Track each shape's PPT id alongside the imported Box so we can match
// `<p:cxnSp>` connectors (which reference shape ids via `<a:stCxn>` /
// `<a:endCxn>`) to our internal Box ids.
//
// Connector endpoint mapping:
//  - `<a:stCxn id="13" idx="…">` → start endpoint is the shape with id=13
//  - `<a:endCxn id="14" idx="…">` → end endpoint is the shape with id=14
// `idx` encodes which connection site on the shape (top/right/bottom/left
// or a numbered handle); we map even-indexed to "bottom" and ignore the
// rest, then let the editor's router pick sides at draw time.
//
// Group transform: a child shape's `<a:off>` is in the group's *local*
// coordinate system. To get absolute slide coords we apply, in order
// from outermost group inward:
//     abs = groupOff + (local - groupChOff) * (groupExt / groupChExt)
// Most well-formed decks ship `chExt == ext` so the scale is 1; we still
// honor it because some legacy exports differ.
//
// The chart returned has `uniformSize: false` so the editor leaves the
// per-box widths/heights from PPT alone (otherwise the layout effect
// would inflate every box to the largest text and small boxes would
// overlap their neighbors).

import JSZip from "jszip";

import type { Box, ChartState, Connector, ConnectorSide, EntityType } from "./types";
import { measureBoxNatural, withMeasureNode } from "./measure";
import { defaultsFor } from "./themes";

const EMU_PER_PX = 9525; // EMU per pixel at 96 DPI

export type ImportSummary = {
  shapesFound: number;
  imported: number;
  skipped: number;
  connectorsFound: number;
  connectorsLinked: number;
  /** Shapes the importer recognized as floating labels (e.g. "2.17%
   *  $1,300,274", "Director") and attached to a nearby connector
   *  rather than promoting to their own box. */
  labelsAttached: number;
  notes: string[];
};

type Transform = {
  // World offset added to local coords after scaling.
  ox: number;
  oy: number;
  // Scale factors applied to local coords before adding offset.
  sx: number;
  sy: number;
};

const IDENTITY: Transform = { ox: 0, oy: 0, sx: 1, sy: 1 };

export type SlideInfo = {
  /** Absolute path inside the .pptx zip, e.g. "ppt/slides/slide1.xml". */
  path: string;
  /** Display index (1-based, matches PPT's slide numbering). */
  index: number;
  /** Count of `<p:sp>` shapes that have any text — used to flag empty
   *  title/divider slides so the chooser can demote them. */
  shapesWithText: number;
};

/** Enumerate every slide in the deck with a quick text-shape count.
 *  Used by the editor to decide whether to show a slide-picker modal
 *  (deck has multiple chart-bearing slides) or run the import
 *  directly (only slide 1 has substance). Returns slides sorted by
 *  index so the UI doesn't have to. */
export async function listPptxSlides(file: File): Promise<SlideInfo[]> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  return enumerateSlides(zip);
}

async function enumerateSlides(zip: JSZip): Promise<SlideInfo[]> {
  const out: SlideInfo[] = [];
  const slidePaths = Object.keys(zip.files).filter(
    (k) => /^ppt\/slides\/slide(\d+)\.xml$/.test(k),
  );
  for (const path of slidePaths) {
    const m = path.match(/slide(\d+)\.xml$/);
    if (!m) continue;
    const xml = await zip.file(path)!.async("string");
    // Cheap text-shape count: every `<a:t>` inside an `<p:sp>` block.
    // Imperfect (counts shapes-with-no-real-text) but fast and good
    // enough to rank slides in the picker.
    const shapeWithTextRegex = /<p:sp\b[\s\S]*?<\/p:sp>/g;
    let count = 0;
    for (const block of xml.match(shapeWithTextRegex) || []) {
      if (/<a:t[\s>][^<]*\S/.test(block)) count++;
    }
    out.push({ path, index: Number(m[1]), shapesWithText: count });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/** Resolved color-scheme map for one .pptx, keyed by `schemeClr val=`
 *  values (bg1, bg2, tx1, tx2, accent1..6, hlink, folHlink). All
 *  values are CSS hex strings ("#RRGGBB"). Returns an empty object
 *  if the deck has no theme1.xml (rare — should always exist). */
type ThemeMap = Record<string, string>;

/** Per-deck typography defaults pulled from theme1.xml. PPT shapes
 *  that don't carry an explicit `<a:latin typeface>` inherit one of
 *  these — `minorFont` for body text, `majorFont` for headings. We
 *  use minorFont as the box default, which matches PowerPoint's
 *  rendering for plain entity tiles. */
type ThemeFonts = { minor: string; major: string };

/** Read the deck's color-map alias bindings — which scheme slot
 *  (lt1, dk1, accent1..) each runtime alias (bg1, tx1, ...) resolves
 *  to. Master's `<p:clrMap>` is the baseline; the slide can override
 *  via `<p:clrMapOvr><a:overrideClrMapping .../></p:clrMapOvr>`.
 *
 *  Most decks use the canonical mapping (bg1↔lt1, tx1↔dk1, accent1↔
 *  accent1, etc.), in which case this returns the same object the
 *  V5 hard-coded mapping produced. Override decks (rare — used to
 *  swap dark/light themes per slide) get their actual aliasing. */
async function loadColorMapping(zip: JSZip, slidePath: string): Promise<Record<string, string>> {
  // Default canonical mapping; written here so a deck missing
  // master/clrMap entirely still resolves correctly.
  const fallback = {
    bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2",
    accent1: "accent1", accent2: "accent2", accent3: "accent3",
    accent4: "accent4", accent5: "accent5", accent6: "accent6",
    hlink: "hlink", folHlink: "folHlink",
  };
  let mapping = { ...fallback };

  // Master clrMap. Assume slideMaster1 — most decks have one master,
  // and the rare multi-master deck uses the same canonical mapping
  // anyway (PPT doesn't surface per-master overrides in the editor).
  const masterFile = zip.file("ppt/slideMasters/slideMaster1.xml");
  if (masterFile) {
    const xml = await masterFile.async("string");
    const m = xml.match(/<p:clrMap\b[^/>]*\/?>/);
    if (m) {
      Object.assign(mapping, parseMappingAttrs(m[0]));
    }
  }

  // Slide override. `<a:masterClrMapping/>` means "inherit master" —
  // already true. `<a:overrideClrMapping>` carries the same 12
  // attributes as <p:clrMap> and replaces them.
  const slideFile = zip.file(slidePath);
  if (slideFile) {
    const xml = await slideFile.async("string");
    const ovr = xml.match(/<a:overrideClrMapping\b[^/>]*\/?>/);
    if (ovr) {
      Object.assign(mapping, parseMappingAttrs(ovr[0]));
    }
  }

  return mapping;
}

function parseMappingAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const ATTRS = ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  for (const a of ATTRS) {
    const m = tag.match(new RegExp(`\\b${a}="([^"]+)"`));
    if (m) out[a] = m[1];
  }
  return out;
}

async function loadThemeMap(zip: JSZip): Promise<ThemeMap> {
  const themeFile = zip.file("ppt/theme/theme1.xml");
  if (!themeFile) return {};
  const xml = await themeFile.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const map: ThemeMap = {};
  // Walk every direct child of clrScheme. Each is a color slot
  // (dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink) containing
  // either a single <a:srgbClr> or <a:sysClr lastClr="...">.
  const scheme = doc.getElementsByTagNameNS("*", "clrScheme")[0];
  if (!scheme) return {};
  for (const slot of Array.from(scheme.children)) {
    const slotName = slot.localName; // dk1 | lt1 | dk2 | lt2 | accent1..
    if (!slotName) continue;
    const child = slot.firstElementChild;
    if (!child) continue;
    let hex: string | null = null;
    if (child.localName === "srgbClr") {
      const v = child.getAttribute("val");
      if (v && /^[0-9A-Fa-f]{6}$/.test(v)) hex = "#" + v.toUpperCase();
    } else if (child.localName === "sysClr") {
      // sysClr (windowText / window / etc) carries the resolved RGB
      // in the `lastClr` attribute — that's the value PowerPoint
      // wrote at last save. Honor it; we don't try to evaluate the
      // OS color at runtime.
      const v = child.getAttribute("lastClr");
      if (v && /^[0-9A-Fa-f]{6}$/.test(v)) hex = "#" + v.toUpperCase();
    }
    if (hex) map[slotName] = hex;
  }
  // PPT slide XML uses bg1/tx1 instead of dk1/lt1 — those are the
  // RUNTIME aliases. Bind them to whichever the master maps them to
  // (default: tx1=dk1, bg1=lt1, tx2=dk2, bg2=lt2). The slide can
  // override via <p:clrMapOvr>; we don't honor overrides yet.
  // Slot map (dk1/lt1/accent1..) is built; runtime aliases
  // (bg1/tx1/...) get bound by `applyColorMapping` once we know the
  // deck's clrMap + any slide override.
  return map;
}

/** Apply a color-mapping bindings object (from `loadColorMapping`)
 *  to the slot-keyed theme map. Adds entries like `bg1` → resolved
 *  hex, derived from whichever scheme slot the mapping points to.
 *  Returns a NEW map so the original slot map is untouched (callers
 *  may need both). */
function applyColorMapping(theme: ThemeMap, mapping: Record<string, string>): ThemeMap {
  const out: ThemeMap = { ...theme };
  for (const [alias, slot] of Object.entries(mapping)) {
    if (theme[slot]) out[alias] = theme[slot];
  }
  return out;
}

async function loadThemeFonts(zip: JSZip): Promise<ThemeFonts> {
  const themeFile = zip.file("ppt/theme/theme1.xml");
  if (!themeFile) return { minor: "", major: "" };
  const xml = await themeFile.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const out: ThemeFonts = { minor: "", major: "" };
  const fontScheme = doc.getElementsByTagNameNS("*", "fontScheme")[0];
  if (!fontScheme) return out;
  for (const slot of Array.from(fontScheme.children)) {
    if (slot.localName !== "minorFont" && slot.localName !== "majorFont") continue;
    const latin = firstChildLocal(slot, "latin");
    if (!latin) continue;
    const face = latin.getAttribute("typeface");
    if (!face || !face.trim()) continue;
    if (slot.localName === "minorFont") out.minor = cssFontStack(face.trim());
    else out.major = cssFontStack(face.trim());
  }
  return out;
}

export async function importPptx(
  file: File,
  current: ChartState,
  options?: { slidePath?: string },
): Promise<{ chart: ChartState; summary: ImportSummary }> {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const rawTheme = await loadThemeMap(zip);
  const themeFonts = await loadThemeFonts(zip);

  // Pick a slide. If the caller specified one, use it. Otherwise
  // prefer the slide with the most text-shapes, falling back to
  // slide1 — same behavior as V1/V2 for single-chart decks.
  let slidePath = options?.slidePath;
  if (!slidePath) {
    const slides = await enumerateSlides(zip);
    if (slides.length === 0) {
      throw new Error("This .pptx contains no slides.");
    }
    const richest = slides.reduce((a, b) => (b.shapesWithText > a.shapesWithText ? b : a));
    slidePath = richest.path;
  }
  const slide = zip.file(slidePath);
  if (!slide) {
    throw new Error(`Slide not found in deck: ${slidePath}`);
  }
  // Now that we know the slide path, build the slide-aware theme
  // map: rawTheme has slot bindings (dk1, lt1, accent1..) and we
  // overlay alias bindings (bg1, tx1, ...) using the master's
  // <p:clrMap> + any slide-level <p:clrMapOvr>.
  const colorMapping = await loadColorMapping(zip, slidePath);
  const themeMap = applyColorMapping(rawTheme, colorMapping);
  const xml = await slide.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseErr = doc.querySelector("parsererror");
  if (parseErr) throw new Error("Couldn't parse slide XML: " + parseErr.textContent);

  const spTree = firstChildLocal(doc.documentElement, "cSld")
    ? firstChildLocal(firstChildLocal(doc.documentElement, "cSld")!, "spTree")
    : null;
  if (!spTree) throw new Error("Slide has no shape tree (<p:spTree>).");

  const summary: ImportSummary = {
    shapesFound: 0,
    imported: 0,
    skipped: 0,
    connectorsFound: 0,
    connectorsLinked: 0,
    labelsAttached: 0,
    notes: [],
  };

  // First pass collects EVERY text-bearing shape as a candidate, with
  // its raw geometry. We classify (box vs free-floating label) AFTER
  // the walk so the label heuristics can use connector midpoints, which
  // aren't known until all connectors are seen.
  type Candidate = {
    pptId: string | null;
    /** Joined plaintext (every paragraph concat with " ") — used for
     *  label classification and as a fallback when paragraphs is empty. */
    text: string;
    /** Paragraph-by-paragraph text. paragraphs[0] becomes the box's
     *  name; trailing paragraphs become notes. Jurisdiction is
     *  extracted from any "(XX)" suffix on the name itself. */
    paragraphs: string[];
    /** Per-shape colors lifted from the source PPT — applied verbatim
     *  when the user wants the import to look like the source. Empty
     *  string means "no value found" and the importer falls back to
     *  the chart theme's defaults. */
    fillColor: string;
    borderColor: string;
    textColor: string;
    /** First non-empty `<a:latin typeface="...">` from the shape's
     *  text body, normalized to a CSS font-family stack. Empty when
     *  the source uses the deck-default font. */
    fontFamily: string;
    x: number; y: number; w: number; h: number;
  };
  const candidates: Candidate[] = [];

  type ConnectorSpec = {
    fromPptId: string | null;
    toPptId: string | null;
    fromIdx: string | null;
    toIdx: string | null;
    /** Connector's absolute bbox on the slide. Center is used as the
     *  anchor when matching nearby label shapes; full bbox is used to
     *  derive waypoints for bent connectors so the source elbow path
     *  (typically a manifold-bus across the chart) is preserved. */
    bx: number;
    by: number;
    bw: number;
    bh: number;
    cx: number;
    cy: number;
    /** Preset connector geometry name from `<a:prstGeom prst="">`.
     *  "straightConnector1" → no waypoints (straight line).
     *  "bentConnector2/3/4/5" → waypoints derived from the bbox. */
    prst: string;
  };
  const connectorSpecs: ConnectorSpec[] = [];

  walk(spTree, IDENTITY);

  // ---- Classify candidates: real boxes vs floating labels ---------
  // A "label" is a small text-only chip whose content is mostly
  // numeric/percent/$ signs, or a known role-word like "Director" or
  // "Member". They're attached to the nearest connector instead of
  // becoming their own box. This matches the convention in PPT decks
  // where ownership %s and connector roles live as separate text
  // boxes that float between or beside the entity tiles.
  const realBoxes: Candidate[] = [];
  const labels: Candidate[] = [];
  for (const c of candidates) {
    if (looksLikeLabel(c.text)) labels.push(c);
    else realBoxes.push(c);
  }

  // Box candidates first — we need the box-id map to resolve
  // connector endpoints AND to skip labels that happen to sit on top
  // of a real box (don't steal them).
  const boxes: Box[] = [];
  const pptIdToBoxId = new Map<string, string>();
  const defaultsLocal = defaultsFor(current.theme);

  // First measure each box's natural size in the editor's typography.
  // PPT renders at 10pt; we render Cormorant Garamond 15px on top, so
  // a box drawn tight-to-text in PPT clips our label. We compute the
  // text-fit size, then grow boxes that are too small.
  type Sized = {
    cand: Candidate;
    boxId: string;
    natural: { width: number; height: number };
    finalW: number;
    finalH: number;
  };
  const sized: Sized[] = withMeasureNode((measureEl) => {
    return realBoxes.map((c) => {
      const id = `imp_${Math.random().toString(36).slice(2, 10)}`;
      if (c.pptId) pptIdToBoxId.set(c.pptId, id);
      const split = splitNameJurisdictionNotes(c.paragraphs);
      const provisional: Box = {
        id,
        name: split.name,
        entityType: guessEntityType(split.name),
        ownershipPct: extractPct(c.text),
        jurisdiction: split.jurisdiction,
        notes: split.notes,
        fillColor: c.fillColor || defaultsLocal.fillColor,
        borderColor: c.borderColor || defaultsLocal.borderColor,
        textColor: c.textColor || defaultsLocal.textColor,
        fontFamily: c.fontFamily || undefined,
        x: c.x, y: c.y, width: 0, height: 0,
      };
      const natural = measureBoxNatural(provisional, measureEl);
      return {
        cand: c,
        boxId: id,
        natural,
        finalW: Math.max(80, c.w, natural.width),
        finalH: Math.max(40, c.h, natural.height),
      };
    });
  });

  // PPT positions assume PPT-sized boxes. When we grow boxes to fit our
  // typography, naively keeping the source positions causes neighbors
  // to overlap. Compute an axis-wise stretch factor (max growth ratio
  // observed) and scale positions around the layout's centroid so the
  // visual shape of the chart is preserved while gaps grow with the
  // boxes themselves. Ratio is clamped at [1, 3] so a single oversized
  // outlier doesn't blow the layout out 10x.
  let stretchX = 1;
  let stretchY = 1;
  for (const s of sized) {
    const srcW = Math.max(1, s.cand.w);
    const srcH = Math.max(1, s.cand.h);
    stretchX = Math.max(stretchX, s.finalW / srcW);
    stretchY = Math.max(stretchY, s.finalH / srcH);
  }
  stretchX = Math.min(3, stretchX);
  stretchY = Math.min(3, stretchY);

  // Centroid of source box centers — used as the pivot for scaling so
  // the layout stays roughly centered on its original location.
  let pivotX = 0;
  let pivotY = 0;
  if (sized.length > 0) {
    for (const s of sized) {
      pivotX += s.cand.x + s.cand.w / 2;
      pivotY += s.cand.y + s.cand.h / 2;
    }
    pivotX /= sized.length;
    pivotY /= sized.length;
  }

  for (const s of sized) {
    // Scale the box's CENTER around the pivot, then derive the new
    // top-left from the final size. This is what makes neighbors slide
    // apart smoothly while a single box's center stays roughly where
    // it sat in the source.
    const srcCx = s.cand.x + s.cand.w / 2;
    const srcCy = s.cand.y + s.cand.h / 2;
    const newCx = pivotX + (srcCx - pivotX) * stretchX;
    const newCy = pivotY + (srcCy - pivotY) * stretchY;
    const split = splitNameJurisdictionNotes(s.cand.paragraphs);
    boxes.push({
      id: s.boxId,
      name: split.name,
      entityType: guessEntityType(split.name),
      ownershipPct: extractPct(s.cand.text),
      jurisdiction: split.jurisdiction,
      notes: split.notes,
      fillColor: s.cand.fillColor || defaultsLocal.fillColor,
      borderColor: s.cand.borderColor || defaultsLocal.borderColor,
      textColor: s.cand.textColor || defaultsLocal.textColor,
      fontFamily: s.cand.fontFamily || undefined,
      x: Math.round(newCx - s.finalW / 2),
      y: Math.round(newCy - s.finalH / 2),
      width: s.finalW,
      height: s.finalH,
    });
    summary.imported++;
  }

  // ---- Resolve connector endpoints --------------------------------
  const connectors: Connector[] = [];
  for (const c of connectorSpecs) {
    summary.connectorsFound++;
    if (!c.fromPptId || !c.toPptId) continue; // free-floating connector — skip
    const fromBoxId = pptIdToBoxId.get(c.fromPptId);
    const toBoxId = pptIdToBoxId.get(c.toPptId);
    if (!fromBoxId || !toBoxId) continue;
    if (fromBoxId === toBoxId) continue;
    const dup = connectors.some(
      (x) =>
        (x.fromBoxId === fromBoxId && x.toBoxId === toBoxId) ||
        (x.fromBoxId === toBoxId && x.toBoxId === fromBoxId),
    );
    if (dup) continue;

    // ---- Waypoints from cxnSp bbox -----------------------------
    // Bent connectors carry their elbow path in the bbox: the
    // intermediate vertex of an L/Z-shape sits on a bbox edge or
    // center. Reproducing the exact preset-geometry math
    // (rotation, flip, adj1) is brittle, so we use a robust
    // approximation: take the bbox center (in stretched coords)
    // and emit two waypoints along the axis perpendicular to the
    // start side. For a top-row entity exiting "bottom" toward a
    // holding's "top", that gives the manifold-bus pattern this
    // chart relies on.
    //
    // Stretch the source bbox center the same way box positions
    // were stretched — see the box-build loop above for the same
    // pivot/scale numbers.
    const stretchedCx = pivotX + (c.cx - pivotX) * stretchX;
    const stretchedCy = pivotY + (c.cy - pivotY) * stretchY;
    const fromSide = idxToSide(c.fromIdx);
    const toSide = idxToSide(c.toIdx);
    // For a bentConnector, capture the bend axis as an elbow override
    // (elbowX / elbowY) rather than absolute waypoints. The editor's
    // router re-derives endpoints every frame from the box edges, so
    // an elbow override means the bend follows the boxes when they
    // move. Absolute waypoints (the prior approach) froze the path in
    // slide-coords, which is why imported connectors "didn't sit on
    // the line" after any box moved or was nudged by the layout.
    //
    // For default adj1=50000 (the common case), the bend axis sits at
    // the bbox center on the major axis — i.e. stretchedCy for a
    // top↔bottom run, stretchedCx for a left↔right run. PowerPoint's
    // flipH/flipV swap which corner is start vs end, but the bend
    // axis position is unchanged at the midpoint.
    let elbowX: number | undefined;
    let elbowY: number | undefined;
    if (/^bentConnector/.test(c.prst) && c.bw > 0 && c.bh > 0) {
      const verticalFirst = fromSide
        ? fromSide === "top" || fromSide === "bottom"
        : c.bh >= c.bw;
      if (verticalFirst) {
        elbowY = stretchedCy;
      } else {
        elbowX = stretchedCx;
      }
    }

    connectors.push({
      id: `imp_c_${Math.random().toString(36).slice(2, 10)}`,
      fromBoxId,
      toBoxId,
      routeStyle: "orthogonal",
      showArrowhead: true,
      fromSide,
      toSide,
      elbowX,
      elbowY,
    });
    summary.connectorsLinked++;
  }

  // ---- Manifold grouping ------------------------------------------
  // PowerPoint stores each "drop" off a shared bus row as an
  // independent bentConnector with the same elbowY. Merge those into
  // a single manifold so the editor treats them as one trunk —
  // dragging the bus moves all drops together, and the connector
  // panel shows the manifold's Separate / Adjust controls.
  const BUS_TOL_PX = 8;
  const groupByY = new Map<number, Connector[]>();
  const groupByX = new Map<number, Connector[]>();
  for (const conn of connectors) {
    if (conn.elbowY != null) {
      const key = Math.round(conn.elbowY / BUS_TOL_PX);
      const arr = groupByY.get(key) ?? [];
      arr.push(conn);
      groupByY.set(key, arr);
    } else if (conn.elbowX != null) {
      const key = Math.round(conn.elbowX / BUS_TOL_PX);
      const arr = groupByX.get(key) ?? [];
      arr.push(conn);
      groupByX.set(key, arr);
    }
  }
  for (const arr of groupByY.values()) {
    if (arr.length < 2) continue;
    const mid = "imp_m_" + Math.random().toString(36).slice(2, 10);
    const avg = arr.reduce((s, c) => s + (c.elbowY ?? 0), 0) / arr.length;
    for (const conn of arr) {
      conn.manifoldId = mid;
      conn.elbowY = avg;
    }
  }
  for (const arr of groupByX.values()) {
    if (arr.length < 2) continue;
    const mid = "imp_m_" + Math.random().toString(36).slice(2, 10);
    const avg = arr.reduce((s, c) => s + (c.elbowX ?? 0), 0) / arr.length;
    for (const conn of arr) {
      conn.manifoldId = mid;
      conn.elbowX = avg;
    }
  }
  const dropped = summary.connectorsFound - summary.connectorsLinked;
  if (dropped > 0) {
    summary.notes.push(
      `${dropped} connector${dropped === 1 ? "" : "s"} couldn't be matched to boxes — re-link in the editor.`,
    );
  }

  // ---- Attach labels to nearest connector -------------------------
  // For each label, pick the closest *resolved* connector by midpoint
  // distance. Connector midpoints are computed in the STRETCHED
  // coordinate system (because they derive from box centers, which
  // were scaled around the pivot). Labels are still in source coords,
  // so we apply the same stretch to their centers before matching;
  // otherwise the post-stretch distance is artificially large and
  // labels get rejected at the radius cap. The radius itself also
  // scales with the stretch factor so a 3x-stretched chart gets a
  // proportionally bigger acceptance window.
  const ATTACH_RADIUS_PX = 250 * Math.max(stretchX, stretchY);
  for (const lbl of labels) {
    let best: Connector | null = null;
    let bestDist = Infinity;
    const srcLcx = lbl.x + lbl.w / 2;
    const srcLcy = lbl.y + lbl.h / 2;
    const lcx = pivotX + (srcLcx - pivotX) * stretchX;
    const lcy = pivotY + (srcLcy - pivotY) * stretchY;
    for (const conn of connectors) {
      const a = boxes.find((b) => b.id === conn.fromBoxId);
      const b = boxes.find((bx) => bx.id === conn.toBoxId);
      if (!a || !b) continue;
      const acx = a.x + a.width / 2;
      const acy = a.y + a.height / 2;
      const bcx = b.x + b.width / 2;
      const bcy = b.y + b.height / 2;
      const mcx = (acx + bcx) / 2;
      const mcy = (acy + bcy) / 2;
      const d = Math.hypot(lcx - mcx, lcy - mcy);
      if (d < bestDist && !conn.label) {
        bestDist = d;
        best = conn;
      }
    }
    if (best && bestDist <= ATTACH_RADIUS_PX) {
      // Compact whitespace inside multi-line labels so the rendered
      // chip stays single-line. PPT shows "2.17%" / "$1,300,274" on
      // two lines; we collapse to "2.17% · $1,300,274".
      best.label = lbl.text.replace(/\s*\n\s*/g, " · ").replace(/\s+/g, " ").trim();
      summary.labelsAttached++;
    }
  }
  const orphanLabels = labels.length - summary.labelsAttached;
  if (orphanLabels > 0) {
    summary.notes.push(
      `${orphanLabels} label${orphanLabels === 1 ? "" : "s"} couldn't be matched to a connector and were dropped.`,
    );
  }

  if (boxes.length === 0) {
    throw new Error(
      "No text-bearing shapes found on slide 1. If this chart is on a different slide, copy it onto slide 1 and try again.",
    );
  }

  return {
    chart: {
      ...current,
      title: stripExt(file.name),
      boxes,
      connectors,
      uniformSize: false,
    },
    summary,
  };

  // ---- inner: recursive shape-tree walk ---------------------------
  function walk(parent: Element, t: Transform): void {
    for (const child of Array.from(parent.children)) {
      const ln = child.localName;
      if (ln === "grpSp") {
        // Compose the child transform from the group's xfrm, then recurse.
        const inner = composeGroupTransform(t, child);
        walk(child, inner);
      } else if (ln === "sp") {
        importShape(child, t);
      } else if (ln === "cxnSp") {
        importConnector(child, t);
      }
      // Other children (nvGrpSpPr, grpSpPr, extLst, etc.) are metadata.
    }
  }

  function importShape(sp: Element, t: Transform): void {
    summary.shapesFound++;
    const xfrm = findXfrmIn(sp);
    if (!xfrm) {
      summary.skipped++;
      return;
    }
    const off = firstChildLocal(xfrm, "off");
    const ext = firstChildLocal(xfrm, "ext");
    if (!off || !ext) {
      summary.skipped++;
      return;
    }
    const localX = numAttr(off, "x");
    const localY = numAttr(off, "y");
    const localW = numAttr(ext, "cx");
    const localH = numAttr(ext, "cy");
    const x = Math.round((t.ox + localX * t.sx) / EMU_PER_PX);
    const y = Math.round((t.oy + localY * t.sy) / EMU_PER_PX);
    const w = Math.round((localW * t.sx) / EMU_PER_PX);
    const h = Math.round((localH * t.sy) / EMU_PER_PX);

    const paragraphs = collectParagraphs(sp);
    const text = paragraphs.join(" ").replace(/\s+/g, " ").trim();
    if (!text) {
      summary.skipped++;
      return;
    }

    const cnvPr = findCnvPr(sp);
    const pptId = cnvPr?.getAttribute("id") ?? null;
    const colors = extractShapeColors(sp, themeMap);
    const font = extractShapeFont(sp) || themeFonts.minor;

    candidates.push({
      pptId, text, paragraphs,
      fillColor: colors.fill,
      borderColor: colors.border,
      textColor: colors.text,
      fontFamily: font,
      x, y, w, h,
    });
  }

  function importConnector(cxn: Element, t: Transform): void {
    const cnvCxn = firstDescendantLocal(cxn, "cNvCxnSpPr");
    let fromPptId: string | null = null;
    let toPptId: string | null = null;
    let fromIdx: string | null = null;
    let toIdx: string | null = null;
    if (cnvCxn) {
      const st = firstChildLocal(cnvCxn, "stCxn");
      const en = firstChildLocal(cnvCxn, "endCxn");
      if (st) {
        fromPptId = st.getAttribute("id");
        fromIdx = st.getAttribute("idx");
      }
      if (en) {
        toPptId = en.getAttribute("id");
        toIdx = en.getAttribute("idx");
      }
    }
    // Connector bbox in absolute slide pixel coords (after group
    // transform). The bbox center anchors nearby label matching;
    // the full bbox feeds the bent-connector waypoint derivation
    // below. Straight connectors with cy=0 still have a meaningful
    // bbox — we just don't generate waypoints for them.
    let bx = 0, by = 0, bw = 0, bh = 0, cx = 0, cy = 0;
    const xfrm = findXfrmIn(cxn);
    if (xfrm) {
      const off = firstChildLocal(xfrm, "off");
      const ext = firstChildLocal(xfrm, "ext");
      if (off && ext) {
        const lx = numAttr(off, "x");
        const ly = numAttr(off, "y");
        const lw = numAttr(ext, "cx");
        const lh = numAttr(ext, "cy");
        bx = Math.round((t.ox + lx * t.sx) / EMU_PER_PX);
        by = Math.round((t.oy + ly * t.sy) / EMU_PER_PX);
        bw = Math.round((lw * t.sx) / EMU_PER_PX);
        bh = Math.round((lh * t.sy) / EMU_PER_PX);
        cx = bx + Math.round(bw / 2);
        cy = by + Math.round(bh / 2);
      }
    }

    // Preset geometry name. Default to "line" (treated as straight)
    // when missing — defensive for malformed exports.
    let prst = "line";
    const spPr2 = firstChildLocal(cxn, "spPr");
    if (spPr2) {
      const prstGeom = firstChildLocal(spPr2, "prstGeom");
      if (prstGeom) {
        prst = prstGeom.getAttribute("prst") || "line";
      }
    }

    connectorSpecs.push({ fromPptId, toPptId, fromIdx, toIdx, bx, by, bw, bh, cx, cy, prst });
  }
}

// ---- helpers ------------------------------------------------------

function composeGroupTransform(parent: Transform, grp: Element): Transform {
  const xfrm = findXfrmIn(grp);
  if (!xfrm) return parent;
  const off = firstChildLocal(xfrm, "off");
  const ext = firstChildLocal(xfrm, "ext");
  const chOff = firstChildLocal(xfrm, "chOff");
  const chExt = firstChildLocal(xfrm, "chExt");
  if (!off || !ext || !chOff || !chExt) return parent;
  const ox = numAttr(off, "x");
  const oy = numAttr(off, "y");
  const cx = numAttr(ext, "cx");
  const cy = numAttr(ext, "cy");
  const chx = numAttr(chOff, "x");
  const chy = numAttr(chOff, "y");
  const chcx = numAttr(chExt, "cx") || cx;
  const chcy = numAttr(chExt, "cy") || cy;
  const sx = parent.sx * (chcx === 0 ? 1 : cx / chcx);
  const sy = parent.sy * (chcy === 0 ? 1 : cy / chcy);
  // Translate child-frame origin to world: apply parent's transform
  // to (group's own off) and subtract child-origin offset, scaled.
  const ox2 = parent.ox + ox * parent.sx - chx * sx;
  const oy2 = parent.oy + oy * parent.sy - chy * sy;
  return { ox: ox2, oy: oy2, sx, sy };
}

function firstChildLocal(parent: Element, localName: string): Element | null {
  for (const c of Array.from(parent.children)) {
    if (c.localName === localName) return c;
  }
  return null;
}

function firstDescendantLocal(root: Element, localName: string): Element | null {
  for (const node of Array.from(root.getElementsByTagName("*"))) {
    if (node.localName === localName) return node as Element;
  }
  return null;
}

/** Find the shape's xfrm — it lives under spPr (or grpSpPr for groups).
 *  We don't use getElementsByTagName recursively here because an inner
 *  text-frame's `<a:bodyPr>` may include unrelated nested xfrm-like
 *  elements in some exports; staying scoped to the direct property
 *  block avoids those false positives. */
function findXfrmIn(shape: Element): Element | null {
  for (const c of Array.from(shape.children)) {
    if (c.localName === "spPr" || c.localName === "grpSpPr") {
      const x = firstChildLocal(c, "xfrm");
      if (x) return x;
    }
  }
  return null;
}

function findCnvPr(shape: Element): Element | null {
  // For shapes the path is sp > nvSpPr > cNvPr; for connectors it's
  // cxnSp > nvCxnSpPr > cNvPr. Both have a single nv* wrapper.
  for (const c of Array.from(shape.children)) {
    if (c.localName === "nvSpPr" || c.localName === "nvCxnSpPr" || c.localName === "nvGrpSpPr") {
      const inner = firstChildLocal(c, "cNvPr");
      if (inner) return inner;
    }
  }
  return null;
}

function numAttr(el: Element, name: string): number {
  const v = el.getAttribute(name);
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Extract paragraphs from the shape's text body. Each `<a:p>` becomes
 *  one entry; `<a:t>` runs within a paragraph are concatenated with no
 *  separator (PPT runs are character-level styling, not word breaks).
 *  Empty paragraphs are dropped so a trailing blank line in the source
 *  doesn't pollute the notes field. */
function collectParagraphs(shape: Element): string[] {
  const txBody = firstChildLocal(shape, "txBody");
  if (!txBody) return [];
  const out: string[] = [];
  for (const child of Array.from(txBody.children)) {
    if (child.localName !== "p") continue;
    const parts: string[] = [];
    for (const t of Array.from(child.getElementsByTagName("*"))) {
      if (t.localName === "t" && t.textContent) parts.push(t.textContent);
    }
    const joined = parts.join("").replace(/\s+/g, " ").trim();
    if (joined) out.push(joined);
  }
  return out;
}

/** Split a shape's paragraph list into name / jurisdiction / notes.
 *
 *  Heuristics, in order:
 *   1. Name = first non-empty paragraph, with any trailing "(XX)"
 *      stripped off into `jurisdiction`. Common PPT convention is
 *      "Entity Name LLC (DE)" where DE is the state of formation.
 *   2. Notes = remaining paragraphs joined with " · " (the same
 *      separator we use elsewhere for inline metadata). Empty if
 *      there's only one paragraph.
 *   3. If the only paragraph already includes "ID: XXX" or another
 *      semicolon-separated chunk after the entity name, we attempt
 *      to split on the FIRST trailing field of that pattern. This
 *      catches single-paragraph shapes where the ID was rendered on
 *      the same line.
 */
function splitNameJurisdictionNotes(paragraphs: string[]): {
  name: string;
  jurisdiction?: string;
  notes?: string;
} {
  if (paragraphs.length === 0) return { name: "" };

  // Round-tripped decks (exported from this app) carry the entity-type
  // as an eyebrow row above the name (e.g. paragraphs = ["LLC",
  // "GG Promote Holdco LLC", "(DE)", "ID: 5813943"]). Hand-authored
  // PPT decks generally don't. Detect a leading bare-entity-type
  // paragraph and drop it so re-imports don't move the entity type
  // into the name field. Tokens checked are the same set used in the
  // editor's ENTITY_TYPES enum.
  let work = paragraphs;
  if (work.length > 1 && /^(LLC|Corporation|Corp\.?|Inc\.?|LP|LLP|Trust|Individual|Partnership|Other)$/i.test(work[0].trim())) {
    work = work.slice(1);
  }

  let name = work[0];
  let jurisdiction: string | undefined;
  const remaining = work.slice(1);

  // Trailing "(DE)" / "( BVI )" / "(NY)" on the name line — letters
  // only, 1-6 chars, optional whitespace inside the parens. Anything
  // else (e.g. "(parent)") is left attached to the name.
  const JUR_RE = /^\(\s*([A-Za-z]{1,6})\s*\)$/;
  const jurInline = name.match(/^(.*?)\s*\(\s*([A-Za-z]{1,6})\s*\)\s*$/);
  if (jurInline) {
    name = jurInline[1].trim();
    jurisdiction = jurInline[2].trim().toUpperCase();
  }
  // If the name had no inline jurisdiction, check whether the very
  // next paragraph is a standalone "(XX)" — common when PPT decks
  // place the state of formation on its own line below the entity.
  // Lift it out so jurisdiction stays semantic and notes don't carry
  // a parenthesized country code.
  if (!jurisdiction && remaining.length > 0) {
    const m = remaining[0].match(JUR_RE);
    if (m) {
      jurisdiction = m[1].trim().toUpperCase();
      remaining.shift();
    }
  }

  let notes: string | undefined;
  if (remaining.length > 0) {
    // Re-prefix bare numeric IDs (≥4 digits) with "ID: " so the notes
    // row is self-explanatory. Filings sometimes drop the prefix; we
    // add it back for legibility. Anything alphabetic stays as-is.
    const tagged = remaining.map((p) => {
      if (/^[\d-]{4,}$/.test(p.trim())) return "ID: " + p.trim();
      return p;
    });
    notes = tagged.join(" · ");
  } else {
    // Single-paragraph shapes sometimes carry "ID: XYZ" or a bare
    // entity-id number after the name. Detect both forms and shuttle
    // the trailing chunk to notes so the box name stays clean.
    const idLabeled = name.match(/^(.*?)\s+(ID:\s*\S+.*)$/);
    if (idLabeled) {
      name = idLabeled[1].trim();
      notes = idLabeled[2].trim();
    } else {
      // Bare trailing digit run (≥6 chars) at the end of the name —
      // looks like a state-filing or EIN. Be conservative on length
      // because short trailing numbers are often part of the name
      // itself ("Hotel 33", "Sirata 200").
      const idBare = name.match(/^(.*?[A-Za-z\)])\s+(\d{6,})\s*$/);
      if (idBare) {
        name = idBare[1].trim();
        notes = "ID: " + idBare[2];
      }
    }
  }

  return { name, jurisdiction, notes };
}

/** Extract per-shape colors from PPT presentation XML.
 *
 *  Resolution order (PPT spec):
 *    1. `<p:spPr>` direct override — explicit `<a:solidFill>` / `<a:ln>`.
 *    2. `<p:style>` refs — `<a:fillRef><a:schemeClr>` and
 *       `<a:lnRef><a:schemeClr>`. Common when the shape inherits the
 *       deck's "Subtle Effect 1" or similar style preset; the schemeClr
 *       child names the theme color slot (accent1, etc.).
 *    3. Slide layout / master placeholder defaults — V6 work; we
 *       return "" here and the caller falls back to the chart theme.
 *
 *  Handles `srgbClr` and `schemeClr` (resolved via `theme`). Modifiers
 *  like `<a:shade>` / `<a:tint>` are ignored — V6 work — so a shape
 *  inheriting "accent1 shade 50%" gets the base accent1 color, which
 *  is close enough that the chart still reads correctly.
 */
function extractShapeColors(sp: Element, theme: ThemeMap): { fill: string; border: string; text: string } {
  const result = { fill: "", border: "", text: "" };

  const spPr = firstChildLocal(sp, "spPr");
  const style = firstChildLocal(sp, "style");

  // ---- Fill ------------------------------------------------------
  if (spPr) {
    const fill = firstChildLocal(spPr, "solidFill");
    if (fill) {
      const c = readSolidColor(fill, theme);
      if (c) result.fill = c;
    }
    // Explicit <a:noFill/> — leave result.fill empty so the caller
    // gets the chart theme. This matches the source's "no fill"
    // intent better than fabricating a transparent value.
  }
  if (!result.fill && style) {
    const fillRef = firstChildLocal(style, "fillRef");
    if (fillRef) {
      const c = readRefColor(fillRef, theme);
      if (c) result.fill = c;
    }
  }

  // ---- Border ----------------------------------------------------
  // Three states the source can encode:
  //   1. <a:ln><a:solidFill .../></a:ln>     — explicit color
  //   2. <a:ln><a:noFill/></a:ln>             — explicit NO border
  //   3. no <a:ln> at all                     — inherit
  // V5 conflated #2 with #3 and fell through to the chart theme,
  // which is wrong (the source explicitly wanted no visible border).
  // Detect #2 here and use the box's fill color so the border is
  // effectively invisible without breaking our SVG render's stroke.
  let borderExplicitlyHidden = false;
  if (spPr) {
    const ln = firstChildLocal(spPr, "ln");
    if (ln) {
      const lnFill = firstChildLocal(ln, "solidFill");
      if (lnFill) {
        const c = readSolidColor(lnFill, theme);
        if (c) result.border = c;
      } else if (firstChildLocal(ln, "noFill")) {
        borderExplicitlyHidden = true;
      }
    }
  }
  if (!result.border && !borderExplicitlyHidden && style) {
    const lnRef = firstChildLocal(style, "lnRef");
    if (lnRef) {
      const c = readRefColor(lnRef, theme);
      if (c) result.border = c;
    }
  }
  if (borderExplicitlyHidden && !result.border) {
    // Use the resolved fill so the renderer's stroke disappears
    // visually. If fill is empty too (rare), leave it for the
    // theme fallback — at that point there's no signal at all.
    if (result.fill) result.border = result.fill;
  }

  // ---- Text ------------------------------------------------------
  // First text run with an explicit `<a:rPr><a:solidFill>` wins.
  const txBody = firstChildLocal(sp, "txBody");
  if (txBody) {
    for (const para of Array.from(txBody.children)) {
      if (para.localName !== "p") continue;
      for (const run of Array.from(para.children)) {
        if (run.localName !== "r") continue;
        const rPr = firstChildLocal(run, "rPr");
        if (!rPr) continue;
        const fill = firstChildLocal(rPr, "solidFill");
        if (!fill) continue;
        const c = readSolidColor(fill, theme);
        if (c) {
          result.text = c;
          break;
        }
      }
      if (result.text) break;
    }
  }
  // Fallback: <p:style><a:fontRef><a:schemeClr> — used by deck-style
  // text where every run inherits the same color from the master.
  if (!result.text && style) {
    const fontRef = firstChildLocal(style, "fontRef");
    if (fontRef) {
      const c = readRefColor(fontRef, theme);
      if (c) result.text = c;
    }
  }

  return result;
}

/** Pull the first explicitly-declared `<a:latin typeface="...">` from
 *  the shape's text body and wrap it in a CSS-friendly stack. Returns
 *  empty string when the shape inherits the deck-default font (most
 *  common case — those boxes use our editor's Cormorant Garamond).
 *
 *  We check `<a:rPr><a:latin>` on each text run; the first non-empty
 *  typeface wins. Multi-font shapes (rare in org charts) get the
 *  font of their first run, matching what the eye sees on the
 *  primary line of text. */
function extractShapeFont(sp: Element): string {
  const txBody = firstChildLocal(sp, "txBody");
  if (!txBody) return "";
  for (const para of Array.from(txBody.children)) {
    if (para.localName !== "p") continue;
    for (const run of Array.from(para.children)) {
      if (run.localName !== "r") continue;
      const rPr = firstChildLocal(run, "rPr");
      if (!rPr) continue;
      const latin = firstChildLocal(rPr, "latin");
      if (!latin) continue;
      const face = latin.getAttribute("typeface");
      if (!face || !face.trim()) continue;
      return cssFontStack(face.trim());
    }
  }
  // Also accept the paragraph default (`<a:pPr><a:defRPr><a:latin>`)
  // — some decks set the font once per paragraph rather than per run.
  for (const para of Array.from(txBody.children)) {
    if (para.localName !== "p") continue;
    const pPr = firstChildLocal(para, "pPr");
    if (!pPr) continue;
    const defRPr = firstChildLocal(pPr, "defRPr");
    if (!defRPr) continue;
    const latin = firstChildLocal(defRPr, "latin");
    if (!latin) continue;
    const face = latin.getAttribute("typeface");
    if (face && face.trim()) return cssFontStack(face.trim());
  }
  return "";
}

/** Wrap a typeface name in a sensible CSS font-family stack with
 *  a system-font fallback so the box stays readable when the font
 *  isn't installed. Single-quotes go around faces with spaces. */
function cssFontStack(face: string): string {
  const quoted = /\s/.test(face) ? `"${face}"` : face;
  // Pick a fallback family by font category. "Light" / "Display"
  // are still serif/sans-serif at the family level, so we treat
  // them by the leading word.
  const lower = face.toLowerCase();
  const fallback =
    /(times|garamond|cambria|georgia|serif|book|baskerville|caslon)/.test(lower)
      ? "Georgia, serif"
      : /(mono|consolas|courier|menlo)/.test(lower)
        ? "ui-monospace, monospace"
        : "system-ui, sans-serif";
  return `${quoted}, ${fallback}`;
}

/** Read a color from a `<p:style>` ref element (`<a:fillRef>`,
 *  `<a:lnRef>`, `<a:fontRef>`). Each ref carries an `idx` attribute
 *  (which preset slot in the theme's `<a:fmtScheme>` to use — we
 *  ignore this for color purposes; it controls width/style not hue)
 *  and a child `<a:srgbClr>` or `<a:schemeClr>` carrying the actual
 *  color, plus optional shade/tint/lum* modifiers (very common —
 *  Office's default styles use accent1 with shade 50% etc). */
function readRefColor(ref: Element, theme: ThemeMap): string | null {
  for (const child of Array.from(ref.children)) {
    if (child.localName === "srgbClr") {
      const v = child.getAttribute("val");
      if (v && /^[0-9A-Fa-f]{6}$/.test(v)) {
        return applyColorModifiers("#" + v.toUpperCase(), child);
      }
    } else if (child.localName === "schemeClr") {
      const v = child.getAttribute("val");
      if (v && theme[v]) return applyColorModifiers(theme[v], child);
    }
  }
  return null;
}

/** Read whichever color child a `<a:solidFill>` carries. Handles:
 *
 *   - `srgbClr` (literal RGB)
 *   - `schemeClr` (theme alias — resolved against `theme`)
 *
 *  AND applies the OOXML color modifiers (`<a:shade>`, `<a:tint>`,
 *  `<a:lumMod>`, `<a:lumOff>`) attached to the color. Modifiers turn
 *  e.g. "accent1 shade 50%" into a darkened blue rather than the
 *  raw accent — common in PPT auto-generated chart palettes.
 *
 *  Other color forms (`prstClr`, `hslClr`, `sysClr` outside the
 *  theme) return null and the caller falls back to the chart theme. */
function readSolidColor(solidFill: Element, theme: ThemeMap): string | null {
  let baseHex: string | null = null;
  let colorEl: Element | null = null;

  const srgb = firstChildLocal(solidFill, "srgbClr");
  if (srgb) {
    const v = srgb.getAttribute("val");
    if (v && /^[0-9A-Fa-f]{6}$/.test(v)) {
      baseHex = "#" + v.toUpperCase();
      colorEl = srgb;
    }
  }
  if (!baseHex) {
    const sch = firstChildLocal(solidFill, "schemeClr");
    if (sch) {
      const v = sch.getAttribute("val");
      if (v && theme[v]) {
        baseHex = theme[v];
        colorEl = sch;
      }
    }
  }
  if (!baseHex || !colorEl) return null;
  return applyColorModifiers(baseHex, colorEl);
}

/** Apply `<a:shade>`, `<a:tint>`, `<a:lumMod>`, `<a:lumOff>` modifiers
 *  declared as direct children of a color element. These are stacked
 *  (PPT applies them in document order) and produce the effective
 *  color the user sees. Returns the hex value after every modifier
 *  has been applied; if there are none, returns `baseHex` unchanged.
 *
 *  Formulas (simplified — full PPT also has hueMod, satMod, etc.
 *  which are rare in org charts and skipped here):
 *
 *   - shade(c, p):  c * p              (darken — p is the brightness factor)
 *   - tint(c, p):   c + (255-c)*(1-p)  (lighten toward white)
 *   - lumMod(c, p): luminance multiplied by p (HSL space)
 *   - lumOff(c, p): luminance shifted by p
 *
 *  All modifier `val` attributes are 0–100000 representing 0–100%. */
function applyColorModifiers(baseHex: string, colorEl: Element): string {
  let [r, g, b] = hexToRgb(baseHex);
  for (const mod of Array.from(colorEl.children)) {
    const valAttr = mod.getAttribute("val");
    if (!valAttr) continue;
    const p = Number(valAttr) / 100000;
    if (!Number.isFinite(p)) continue;
    switch (mod.localName) {
      case "shade":
        // Darken: scale every channel toward zero by factor p.
        r = Math.round(r * p);
        g = Math.round(g * p);
        b = Math.round(b * p);
        break;
      case "tint":
        // Lighten toward white. p closer to 0 = lighter result.
        r = Math.round(r + (255 - r) * (1 - p));
        g = Math.round(g + (255 - g) * (1 - p));
        b = Math.round(b + (255 - b) * (1 - p));
        break;
      case "lumMod":
      case "lumOff": {
        // HSL-based luminance adjust. Approximation: convert to HSL,
        // scale L by `lumMod` factor or add `lumOff` percent, convert
        // back. PPT's exact algorithm differs slightly but the
        // visual result is indistinguishable in 99% of org-chart
        // cases.
        const [h, s, l] = rgbToHsl(r, g, b);
        const lNew = mod.localName === "lumMod"
          ? clamp01(l * p)
          : clamp01(l + p);
        [r, g, b] = hslToRgb(h, s, lNew);
        break;
      }
    }
  }
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ];
}

/** Center point of one of a box's four sides — used by the waypoint
 *  derivation to know where the source connector starts/ends so the
 *  intermediate elbow points we emit line up perpendicularly. When
 *  side is unknown, falls back to the box center (the renderer
 *  re-snaps to a real edge later via `pickEdges`). */
function anchorOnBox(b: Box, side: ConnectorSide | undefined): { x: number; y: number } {
  switch (side) {
    case "top":    return { x: b.x + b.width / 2, y: b.y };
    case "right":  return { x: b.x + b.width, y: b.y + b.height / 2 };
    case "bottom": return { x: b.x + b.width / 2, y: b.y + b.height };
    case "left":   return { x: b.x, y: b.y + b.height / 2 };
    default:       return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
}

function idxToSide(idx: string | null): ConnectorSide | undefined {
  // PPT connection-site indices are shape-specific. For a plain
  // rectangle PowerPoint uses: 0=top, 1=right, 2=bottom, 3=left.
  // Most org-chart connectors enter via 0/2 and leave via the other,
  // so this mapping captures the common case. For unknown indices we
  // fall through to undefined, letting the editor's router pick sides.
  if (!idx) return undefined;
  switch (idx) {
    case "0": return "top";
    case "1": return "right";
    case "2": return "bottom";
    case "3": return "left";
    default: return undefined;
  }
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** Best-guess entity type from the box label. Looks for common
 *  suffixes (LLC, LP, Inc., Trust, etc.) and falls back to LLC. */
function guessEntityType(text: string): EntityType {
  const t = text.toLowerCase();
  if (/\btrust\b/.test(t)) return "Trust";
  if (/\bllp\b/.test(t)) return "LLP";
  if (/\bllc\b/.test(t)) return "LLC";
  if (/\b(lp|l\.?p\.?|limited\s+partnership)\b/.test(t)) return "LP";
  if (/\b(inc|corp|corporation)\b/.test(t)) return "Corporation";
  if (/\bpartnership\b/.test(t)) return "Partnership";
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount <= 4 && /^[A-Z][a-z]+(\s+[A-Z]\.?)*(\s+[A-Z][a-z]+)*$/.test(text.trim())) {
    return "Individual";
  }
  return "LLC";
}

/** Decide whether a text-bearing shape should be treated as a free-
 *  floating connector label rather than its own box. The heuristic:
 *
 *   - Pure %/$ chips: "2.17%", "$1,300,274", or both. These are how
 *     decks annotate ownership share + capital invested between the
 *     entity row and the holding box.
 *   - Single short word like "Director", "Member", "Manager",
 *     "Trustee" — sometimes used on connectors to indicate role.
 *   - "100%" alone, "TBD", "—".
 *
 *  Anything with an entity suffix (LLC, LP, Inc., Trust) is NEVER a
 *  label, even if short. Anything with multiple meaningful words is
 *  a box by default.
 */
function looksLikeLabel(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Real entity tiles always carry a suffix or jurisdiction marker.
  if (/\b(LLC|LP|LLP|Inc\.?|Corp\.?|Corporation|Trust|Partnership|Holdings?|Holdco|Ltd\.?|Limited|GmbH|S\.?A\.?|N\.?V\.?)\b/i.test(t)) {
    return false;
  }
  // Strip whitespace + line breaks; if what's left is purely
  // numeric/percent/$/comma/period — it's a label.
  const compact = t.replace(/\s+/g, "");
  if (/^[$%\d.,()\-—–]+$/.test(compact)) return true;
  // Pure %/$ pair across two paragraphs: "2.17%\n$1,300,274"
  if (/^[\d.,%$\s\-]+$/.test(t) && t.length <= 30) return true;
  // Single role word — the most common cases on org charts.
  if (/^(Director|Manager|Member|Trustee|Officer|GP|LP|Partner|CEO|President)$/i.test(compact)) return true;
  // Short sub-30-char single-line snippet without an entity word —
  // probably a chip. Examples: "TBD", "100%", "Class A".
  if (t.length <= 30 && !/[a-zA-Z]{4,}.*[a-zA-Z]{4,}/.test(t)) {
    // Two long alphabetic runs → looks like a name. One or zero → chip.
    return true;
  }
  return false;
}

/** Pull the first XX% / XX.XX% out of the label, if present. */
function extractPct(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
