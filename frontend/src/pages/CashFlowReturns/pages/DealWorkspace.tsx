// Cash Flow Returns — Deal Workspace.
//
// Phases 3–6 layered onto the Phase 2 PDF-mirror layout:
//   · Phase 3 — canvas navigation (sticky header, sticky-left column, minimap)
//   · Phase 4 — live recalc wired from every editable cell
//   · Phase 5 — scenario toggle (Downside / Base / Upside), each
//     scenario owns an independent Assumptions bundle
//   · Phase 6 — multi-deal pipeline; any deal in deals.ts can be opened
//     at /cash-flow-returns/:dealId

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { runModel } from "../engine";
import { getDeal } from "../deals";
import {
  buildScenarios, SCENARIO_KEYS, SCENARIO_LABEL, type ScenarioKey,
} from "../scenarios";
import type { Assumptions } from "../types";
import {
  CostsUsesBlock, ExitBlock, FinancingBlock, NotesBlock, SourcesBlock,
} from "../blocks/LeftColumn";
import PnlBlock from "../blocks/PnlBlock";
import CashflowBlock from "../blocks/CashflowBlock";
import { ReturnsPreTaxBlock, ReturnsPostTaxBlock } from "../blocks/ReturnsBlocks";
import SensitivityBlock from "../blocks/SensitivityBlock";
import DebtSizingBlock from "../blocks/DebtSizingBlock";
import WaterfallBlock from "../blocks/WaterfallBlock";
import Minimap, { type MiniBlock } from "../blocks/Minimap";
import ExportModal from "../components/ExportModal";
import BlockUploadDialog, {
  applyBlockPatch, type BlockKey,
} from "../components/BlockUploadDialog";
import { fmtMultiplier, fmtPct } from "../format";


// Canvas layout — keep these centralized so the minimap's block rects
// can mirror the live layout without drift. Widths sized so every
// block's internal table content fits without truncation:
//   · left blocks need ~326 (label 170 + 2×78 value cells)
//   · P&L needs ~740 (label 180 + 7×80 year cells)
//   · Cash Flow needs ~770 (label 210 + 7×80 year cells)
//   · waterfall/returns right-column blocks need ~580 (label 170 + 4×96)
const CANVAS_WIDTH = 1800;
const CANVAS_HEIGHT = 1600;
const LEFT_COL_W = 336;
const CENTER_COL_W = 792;
const RIGHT_COL_W = 600;
const GUTTER = 16;
const PAD = 20;

// Named regions for the zoom toolbar's "Jump to" presets. Coordinates
// are in canvas space (unscaled). `w` / `h` tell the fit-to-region
// calculation how large a viewport to size for.
type RegionKey = "all" | "left" | "pnl" | "cashflow" | "returns" | "sensitivity";
const REGIONS: Record<RegionKey, { label: string; x: number; y: number; w: number; h: number }> = {
  all:        { label: "All",        x: 0, y: 0, w: CANVAS_WIDTH, h: CANVAS_HEIGHT },
  left:       { label: "Left",       x: 0, y: 0, w: PAD + LEFT_COL_W + GUTTER, h: 960 },
  pnl:        { label: "P&L",        x: PAD + LEFT_COL_W + GUTTER - 8, y: 0, w: CENTER_COL_W + 16, h: 560 },
  cashflow:   { label: "Cash Flow",  x: PAD + LEFT_COL_W + GUTTER - 8, y: 560, w: CENTER_COL_W + 16, h: 580 },
  returns:    { label: "Returns",    x: PAD + LEFT_COL_W + GUTTER + CENTER_COL_W + GUTTER - 8, y: 0, w: RIGHT_COL_W + 16, h: 160 },
  sensitivity:{ label: "Sensitivity",x: PAD + LEFT_COL_W + GUTTER + CENTER_COL_W + GUTTER - 8, y: 160, w: RIGHT_COL_W + 16, h: 1000 },
};

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.0;


export default function DealWorkspaceRoute() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const deal = dealId ? getDeal(dealId) : undefined;

  if (!deal) {
    return (
      <div className="-mx-6 -my-8 min-h-[calc(100vh-100px)] bg-[#faf7f1] flex items-center justify-center">
        <div className="text-center">
          <div className="font-serif-display text-3xl">Deal not found.</div>
          <button onClick={() => navigate("/cash-flow-returns")} className="mt-4 px-4 py-2 border border-[#d9d4c8] rounded-md bg-white">← Back to pipeline</button>
        </div>
      </div>
    );
  }

  // Keying on dealId guarantees the scenarios bundle is re-seeded when
  // the user navigates between deals.
  return <DealWorkspace key={deal.id} dealId={deal.id} dealName={deal.name} seed={deal.seed} />;
}


function DealWorkspace({
  dealId, dealName, seed,
}: { dealId: string; dealName: string; seed: Assumptions }) {
  const [showExport, setShowExport] = useState(false);
  // Per-block upload dialog. Mounted at the workspace level so the
  // `Upload Doc` button in any block opens the same modal scoped to
  // that block's subtree of assumptions.
  const [uploadingBlock, setUploadingBlock] = useState<BlockKey | null>(null);

  // Zoom state. `fitWidth` keeps the canvas width-fit on resize until
  // the user picks a discrete zoom level. Starts in Fit Width mode so a
  // user on a narrow screen immediately sees the full workspace.
  const [zoom, setZoom] = useState<number>(1.0);
  const [fitWidth, setFitWidth] = useState<boolean>(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Re-compute the fit-width zoom whenever the scroll container resizes.
  useEffect(() => {
    if (!fitWidth) return;
    const el = scrollRef.current;
    if (!el) return;
    const recalc = () => {
      const w = el.clientWidth;
      if (!w) return;
      // Allow fit-width to scale ABOVE 100% on wide screens so the
      // canvas fills the viewport edge-to-edge instead of leaving dead
      // space on either side.
      const target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, w / CANVAS_WIDTH));
      setZoom(target);
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    window.addEventListener("resize", recalc);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [fitWidth]);

  const setDiscreteZoom = useCallback((z: number) => {
    setFitWidth(false);
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)));
  }, []);

  const jumpTo = useCallback((key: RegionKey) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = REGIONS[key];
    // If fitting a specific region, pick a zoom that fits the region's
    // larger dimension into the viewport; for "all" just use fit-width.
    if (key === "all") {
      setFitWidth(true);
    } else {
      const zx = el.clientWidth / r.w;
      const zy = el.clientHeight / r.h;
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(zx, zy)));
      setFitWidth(false);
      setZoom(z);
      // Scroll after zoom applies (two frames to be safe).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const sc = scrollRef.current;
          if (!sc) return;
          sc.scrollTo({ left: r.x * z, top: r.y * z, behavior: "smooth" });
        });
      });
      return;
    }
    // For "all", just reset scroll to top-left.
    requestAnimationFrame(() => {
      const sc = scrollRef.current;
      if (!sc) return;
      sc.scrollTo({ left: 0, top: 0, behavior: "smooth" });
    });
  }, []);
  // Three independent Assumptions bundles — one per scenario.
  const [scenarios, setScenarios] = useState(() => buildScenarios(seed));
  const [active, setActive] = useState<ScenarioKey>("base");
  const a = scenarios[active];

  const out = useMemo(() => runModel(a), [a]);
  const keys = a.pnl.keys[0];

  const onPatch = useCallback((patch: Partial<Assumptions>) => {
    setScenarios((cur) => ({
      ...cur,
      [active]: { ...cur[active], ...patch },
    }));
  }, [active]);

  // Block rectangles in canvas coordinates (must match the live render
  // below). The minimap uses these to draw its silhouette.
  const mini: MiniBlock[] = useMemo(() => {
    const leftX = PAD;
    const centerX = leftX + LEFT_COL_W + GUTTER;
    const rightX = centerX + CENTER_COL_W + GUTTER;

    const leftBlocks = [
      { id: "costs", label: "Costs / Uses", h: 210 },
      { id: "sources", label: "Sources", h: 90 },
      { id: "financing", label: "Financing", h: 250 },
      { id: "exit", label: "Exit", h: 240 },
      { id: "notes", label: "Notes", h: 160 },
    ];
    let leftY = PAD + 60;
    const left: MiniBlock[] = leftBlocks.map((b) => {
      const r: MiniBlock = { id: b.id, label: b.label, x: leftX, y: leftY, w: LEFT_COL_W, h: b.h, tone: "left" };
      leftY += b.h + 12;
      return r;
    });

    const centerY = PAD + 60;
    const pnlH = 520;
    const cfH = 560;
    const center: MiniBlock[] = [
      { id: "pnl", label: "P&L", x: centerX, y: centerY, w: CENTER_COL_W, h: pnlH, tone: "center" },
      { id: "cashflow", label: "Cash Flow", x: centerX, y: centerY + pnlH + 12, w: CENTER_COL_W, h: cfH, tone: "center" },
    ];

    const rightY = PAD + 60;
    const retH = 130;
    const sensH = 230;
    const retW = (RIGHT_COL_W - 12) / 2;
    const right: MiniBlock[] = [
      { id: "ret-pre", label: "Returns Pre", x: rightX, y: rightY, w: retW, h: retH, tone: "right" },
      { id: "ret-post", label: "Returns Post", x: rightX + retW + 12, y: rightY, w: retW, h: retH, tone: "right" },
      { id: "sens-1", label: "Sens Unlev Pre", x: rightX, y: rightY + retH + 12, w: RIGHT_COL_W, h: sensH, tone: "sensitivity" },
      { id: "sens-2", label: "Sens Lev Pre", x: rightX, y: rightY + retH + 12 + sensH + 12, w: RIGHT_COL_W, h: sensH, tone: "sensitivity" },
      { id: "sens-3", label: "Sens Unlev Post", x: rightX, y: rightY + retH + 12 + (sensH + 12) * 2, w: RIGHT_COL_W, h: sensH, tone: "sensitivity" },
      { id: "sens-4", label: "Sens Lev Post", x: rightX, y: rightY + retH + 12 + (sensH + 12) * 3, w: RIGHT_COL_W, h: sensH, tone: "sensitivity" },
    ];

    return [...left, ...center, ...right];
  }, []);

  return (
    <div
      className="bg-[#faf7f1] text-[#1a1d24] flex flex-col"
      style={{
        // Break out of `main`'s max-w-[1600px] wrapper so the workspace
        // spans the full browser viewport — scrollbars land at the
        // window edges, tables use every pixel of available width.
        height: "calc(100vh - 100px)",
        width: "100vw",
        marginLeft: "calc(50% - 50vw)",
        marginTop: "-32px",
        marginBottom: "-32px",
      }}
    >
      {/* Pinned header — stays visible while the canvas below scrolls */}
      <div className="sticky top-0 z-20 bg-[#faf7f1] border-b border-[#d9d4c8]">
        <WorkspaceHeader
          dealName={dealName}
          out={out}
          active={active}
          onScenarioChange={setActive}
          onExport={() => setShowExport(true)}
        />
        <ZoomToolbar
          zoom={zoom}
          fitWidth={fitWidth}
          onSetZoom={setDiscreteZoom}
          onFitWidth={() => setFitWidth(true)}
          onJump={jumpTo}
        />
      </div>

      {/* Scroll canvas — two-axis panning happens here. CSS `zoom`
          (not `transform: scale`) so that position: sticky on the
          left column keeps anchoring correctly. */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div
          className="relative"
          style={{ width: CANVAS_WIDTH, padding: PAD, boxSizing: "border-box", zoom }}
        >
          {/* Left column — scrolls with the rest of the page so it
              doesn't overlap the P&L / cashflow when the user pans
              right at high zoom. */}
          <aside
            style={{ width: LEFT_COL_W }}
            className="flex flex-col gap-3 float-left"
          >
            <CostsUsesBlock a={a} out={out} onChange={onPatch} onUpload={() => setUploadingBlock("costs")} />
            <SourcesBlock out={out} />
            <FinancingBlock a={a} out={out} onChange={onPatch} onUpload={() => setUploadingBlock("financing")} />
            <DebtSizingBlock a={a} out={out} onChange={onPatch} />
            <ExitBlock a={a} out={out} onChange={onPatch} onUpload={() => setUploadingBlock("exit")} />
            <NotesBlock value={a.notes ?? ""} onChange={(v) => onPatch({ notes: v })} />
          </aside>

          {/* Remaining columns flow to the right of the sticky left column */}
          <div
            style={{
              marginLeft: LEFT_COL_W + GUTTER,
              display: "grid",
              gridTemplateColumns: `${CENTER_COL_W}px ${RIGHT_COL_W}px`,
              gap: GUTTER,
              alignItems: "start",
            }}
          >
            <div className="flex flex-col gap-3">
              <PnlBlock a={a} out={out} onChange={onPatch} onUpload={() => setUploadingBlock("pnl")} />
              <CashflowBlock a={a} out={out} onChange={onPatch} onUpload={() => setUploadingBlock("cashflow")} />
            </div>

            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <ReturnsPreTaxBlock out={out} />
                <ReturnsPostTaxBlock out={out} />
              </div>
              <WaterfallBlock a={a} out={out} onChange={onPatch} />
              <SensitivityBlock
                title="Sensitivity Analysis: Unlevered, Pre-tax"
                range={out.sensitivity.unleveredPretax}
                keys={keys}
              />
              <SensitivityBlock
                title="Sensitivity Analysis: Levered, Pre-tax"
                range={out.sensitivity.leveredPretax}
                keys={keys}
              />
              <SensitivityBlock
                title="Sensitivity Analysis: Unlevered, Post-tax"
                range={out.sensitivity.unleveredPosttax}
                keys={keys}
              />
              <SensitivityBlock
                title="Sensitivity Analysis: Levered, Post-tax"
                range={out.sensitivity.leveredPosttax}
                keys={keys}
              />
            </div>
          </div>

        </div>
      </div>

      <Minimap
        blocks={mini}
        canvasWidth={CANVAS_WIDTH}
        canvasHeight={CANVAS_HEIGHT}
        scrollRef={scrollRef}
        zoom={zoom}
      />

      {showExport && (
        <ExportModal
          dealId={dealId}
          dealName={`${dealName} — ${active[0].toUpperCase()}${active.slice(1)}`}
          assumptions={a}
          out={out}
          onClose={() => setShowExport(false)}
        />
      )}

      {uploadingBlock && (
        <BlockUploadDialog
          block={uploadingBlock}
          onClose={() => setUploadingBlock(null)}
          onApply={(blk, patch) => onPatch(applyBlockPatch(a, blk, patch))}
        />
      )}
    </div>
  );
}


function WorkspaceHeader({
  dealName, out, active, onScenarioChange, onExport,
}: {
  dealName: string;
  out: ReturnType<typeof runModel>;
  active: ScenarioKey;
  onScenarioChange: (s: ScenarioKey) => void;
  onExport: () => void;
}) {
  return (
    <header className="w-full px-5 pt-4 pb-3 flex items-end justify-between gap-6 flex-wrap">
      <div>
        <Link to="/cash-flow-returns" className="text-[11px] uppercase tracking-[0.18em] text-[#b89555] hover:text-[#1a1d24]">
          ← Cash Flow Returns
        </Link>
        <h1 className="font-serif-display text-3xl leading-tight mt-1">{dealName}</h1>
        <div className="text-[11px] uppercase tracking-[0.18em] text-[#6b6f78] mt-0.5">
          Cash Flow / Returns · Acquisition Year 2025 · EUR 000s
        </div>
      </div>
      <div className="flex items-center gap-4 text-[12px] text-[#1a1d24]">
        <HeaderMetric label="Unlev IRR" value={fmtPct(out.returns.unleveredPretax.irr, 1)} />
        <HeaderMetric label="Lev IRR" value={fmtPct(out.returns.leveredPretax.irr, 1)} highlight />
        <HeaderMetric label="Lev EM" value={fmtMultiplier(out.returns.leveredPretax.em)} />
        <HeaderMetric label="Post-Promote" value={fmtPct(out.returns.postPromote.irr, 1)} />
        <div className="h-8 w-px bg-[#d9d4c8]" />
        <ScenarioToggle active={active} onChange={onScenarioChange} />
        <button
          onClick={onExport}
          title="Export this scenario as XLSX / PDF / CSV / JSON"
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-white hover:bg-[#2a2d34] transition-colors"
          style={{ background: "#1a1d24" }}
        >
          Export
        </button>
      </div>
    </header>
  );
}


function HeaderMetric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="leading-tight">
      <div className="text-[9px] uppercase tracking-[0.15em] text-[#6b6f78]">{label}</div>
      <div className={`font-mono tabular-nums font-semibold ${highlight ? "text-[#b89555]" : ""}`}>
        {value}
      </div>
    </div>
  );
}


function ScenarioToggle({
  active, onChange,
}: { active: ScenarioKey; onChange: (s: ScenarioKey) => void }) {
  return (
    <div className="inline-flex rounded-md overflow-hidden border border-[#d9d4c8] bg-white text-[10px] uppercase tracking-[0.1em] font-semibold">
      {SCENARIO_KEYS.map((key) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            title={`Switch to ${SCENARIO_LABEL[key]} scenario (independent edits)`}
            className="px-2.5 py-1 transition-colors"
            style={isActive
              ? { background: "#1a1d24", color: "#fff" }
              : { color: "#6b6f78" }}
          >
            {SCENARIO_LABEL[key]}
          </button>
        );
      })}
    </div>
  );
}


function ZoomToolbar({
  zoom, fitWidth, onSetZoom, onFitWidth, onJump,
}: {
  zoom: number;
  fitWidth: boolean;
  onSetZoom: (z: number) => void;
  onFitWidth: () => void;
  onJump: (key: RegionKey) => void;
}) {
  const pct = Math.round(zoom * 100);

  return (
    <div className="w-full px-5 py-2 flex items-center gap-4 text-[11px] text-[#1a1d24] border-t border-[#ece6d7] flex-wrap">
      {/* Zoom group — continuous slider spanning MIN_ZOOM..MAX_ZOOM */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.15em] text-[#6b6f78] font-semibold">
          Zoom
        </span>
        <button
          onClick={onFitWidth}
          title="Auto-fit the canvas to the viewport width (follows window resizes)"
          className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] rounded-md border border-[#d9d4c8] transition-colors"
          style={fitWidth
            ? { background: "#1a1d24", color: "#fff", borderColor: "#1a1d24" }
            : { background: "#fff", color: "#6b6f78" }}
        >
          Fit Width
        </button>
        <span className="text-[10px] text-[#6b6f78] tabular-nums">{Math.round(MIN_ZOOM * 100)}%</span>
        <input
          type="range"
          min={Math.round(MIN_ZOOM * 100)}
          max={Math.round(MAX_ZOOM * 100)}
          step={5}
          value={pct}
          onChange={(e) => onSetZoom(Number(e.target.value) / 100)}
          title={`Drag to zoom (${Math.round(MIN_ZOOM * 100)}–${Math.round(MAX_ZOOM * 100)}%)`}
          className="cfr-zoom-slider w-56"
        />
        <span className="text-[10px] text-[#6b6f78] tabular-nums">{Math.round(MAX_ZOOM * 100)}%</span>
        <span className="font-mono tabular-nums font-semibold text-[11px] text-[#1a1d24] min-w-[42px] text-right">
          {pct}%
        </span>
      </div>

      <div className="h-5 w-px bg-[#d9d4c8]" />

      {/* Jump-to group */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.15em] text-[#6b6f78] font-semibold">
          Jump to
        </span>
        <div className="inline-flex rounded-md overflow-hidden border border-[#d9d4c8] bg-white">
          {(Object.keys(REGIONS) as RegionKey[]).map((key, i) => (
            <button
              key={key}
              onClick={() => onJump(key)}
              className={`px-2.5 py-1 text-[#6b6f78] hover:bg-[#faf7f1] hover:text-[#1a1d24] font-semibold ${i > 0 ? "border-l border-[#ece6d7]" : ""}`}
            >
              {REGIONS[key].label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
