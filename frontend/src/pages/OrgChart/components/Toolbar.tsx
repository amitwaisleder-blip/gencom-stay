// Org Chart toolbar — segmented pill groups (matches the
// BUDGET/CASHFLOW/INVOICES style used elsewhere in the PIP Budget app).
// Each group is a single rounded container with hairline dividers.

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ChevronDown, Code2, FileDown, FilePlus, FileUp, ImageDown, Maximize2, Minus, Plus,
  Presentation, Printer, Upload,
} from "lucide-react";

import type { ChartState, PaperPresetKey, ThemeKey } from "../lib/types";
import { PAPER_PRESETS } from "../lib/types";
import { THEMES } from "../lib/themes";
import type { GridMode } from "../OrgChartEditor";

export function Toolbar({
  chart,
  gridMode,
  onGridModeChange,
  onTitleChange,
  onAddBox,
  onThemeChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onZoom100,
  warningCount,
  onJumpToValidation,
  onSave,
  onLoad,
  onPrint,
  onReset,
  onAutoArrange,
  onImportPptx,
  onExportPptx,
  onExportHtml,
  onImportSketch,
  uniformSize,
  onToggleUniformSize,
  paperSize,
  onPaperSizeChange,
  sketchBusy,
}: {
  chart: ChartState;
  gridMode: GridMode;
  onGridModeChange: (g: GridMode) => void;
  onTitleChange: (t: string) => void;
  onAddBox: () => void;
  onThemeChange: (t: ThemeKey) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onZoom100: () => void;
  warningCount: number;
  onJumpToValidation: () => void;
  onSave: () => void;
  onLoad: (chart: ChartState) => void;
  onPrint: () => void;
  onReset: () => void;
  onAutoArrange: () => void;
  onImportPptx: (file: File) => void;
  onExportPptx: () => void;
  /** Save a self-contained HTML snapshot of the chart that mirrors
   *  the on-screen paper space boundary, styles, and connectors. */
  onExportHtml: () => void;
  /** Import a hand-drawn sketch (image or PDF) — sent to the backend
   *  for AI parsing into boxes + connectors. */
  onImportSketch: (file: File) => void;
  /** Whether the canvas is currently locking every box to a single
   *  uniform size. PPT/sketch imports turn this off so source
   *  proportions survive; user can re-enable from the toolbar. */
  uniformSize: boolean;
  onToggleUniformSize: () => void;
  /** Currently active paper-size guide ("off" hides the rectangle). */
  paperSize: PaperPresetKey;
  onPaperSizeChange: (p: PaperPresetKey) => void;
  /** True while the sketch upload is in flight — disables the button
   *  and shows a spinner-style label so the user knows it's working. */
  sketchBusy: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pptxRef = useRef<HTMLInputElement | null>(null);
  const sketchRef = useRef<HTMLInputElement | null>(null);

  function pickFile() { fileRef.current?.click(); }
  function pickPptx() { pptxRef.current?.click(); }
  function pickSketch() { sketchRef.current?.click(); }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (lower.endsWith(".pptx") || lower.endsWith(".ppt")) {
      onImportPptx(f);
      return;
    }
    if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
      window.alert("Word documents aren't supported yet — try a .pptx export, or rebuild from scratch.");
      return;
    }
    try {
      const text = await f.text();
      const parsed = JSON.parse(text) as ChartState;
      if (parsed?.version !== 1 || !Array.isArray(parsed.boxes)) {
        window.alert("Not a valid Org Chart JSON file.");
        return;
      }
      onLoad(parsed);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("Unexpected token") && msg.includes("PK")) {
        window.alert(
          "That looks like a PowerPoint or Word file, not the Org Chart JSON. Use the Import button for .pptx, or pick a .json file you saved earlier.",
        );
        return;
      }
      window.alert(`Could not load file: ${msg}`);
    }
  }

  async function handlePptx(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    onImportPptx(f);
  }

  async function handleSketch(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    onImportSketch(f);
  }

  return (
    <div className="orgchart-toolbar flex items-center gap-2 flex-wrap pb-3 border-b border-gencom-sand">
      <SegGroup>
        <FileMenuButton
          sketchBusy={sketchBusy}
          onNew={onReset}
          onOpen={pickFile}
          onDownloadJson={onSave}
          onImportPptx={pickPptx}
          onImportSketch={pickSketch}
        />
      </SegGroup>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFile}
      />
      <input
        ref={pptxRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={handlePptx}
      />
      <input
        ref={sketchRef}
        type="file"
        accept=".pdf,application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={handleSketch}
      />

      <SegGroup>
        <SegButton onClick={onAddBox} title="Add a new box at the canvas center" icon={<Plus className="h-4 w-4" />} label="Add box" emphasis />
      </SegGroup>

      <SegGroup label="Grid">
        <select
          value={gridMode}
          onChange={(e) => onGridModeChange(e.target.value as GridMode)}
          className="text-xs h-9 px-3 bg-transparent text-gencom-ink focus:outline-none font-bold tracking-wider uppercase"
          aria-label="Grid snap mode"
          title={
            gridMode === "free" ? "No snapping — pixel-precise drag"
            : gridMode === "fine" ? "Snap dragging to a 10px grid"
            : "Snap dragging to a 40px grid"
          }
        >
          <option value="free">FREE</option>
          <option value="fine">FINE</option>
          <option value="coarse">COARSE</option>
        </select>
      </SegGroup>

      <SegGroup label="Theme">
        <select
          value={chart.theme}
          onChange={(e) => onThemeChange(e.target.value as ThemeKey)}
          className="text-xs h-9 px-3 bg-transparent text-gencom-ink focus:outline-none"
          aria-label="Theme"
        >
          {(Object.keys(THEMES) as Array<keyof typeof THEMES>).map((k) => (
            <option key={k} value={k}>{THEMES[k].label}</option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </SegGroup>

      <SegGroup label="Paper">
        <select
          value={paperSize}
          onChange={(e) => onPaperSizeChange(e.target.value as PaperPresetKey)}
          className="text-xs h-9 px-3 bg-transparent text-gencom-ink focus:outline-none"
          aria-label="Paper size — print-preview rectangle behind the chart"
          title="Show a print-preview rectangle behind the chart so you can see where boxes fall on a printed page."
        >
          <option value="off">Off</option>
          {(Object.keys(PAPER_PRESETS) as Array<keyof typeof PAPER_PRESETS>).map((k) => (
            <option key={k} value={k}>{PAPER_PRESETS[k].label}</option>
          ))}
        </select>
      </SegGroup>

      <SegGroup>
        <SegIcon onClick={onZoomOut} title="Zoom out" icon={<Minus className="h-4 w-4" />} />
        <span className="px-2 text-[12px] tabular-nums w-12 text-center text-gencom-ink h-9 inline-flex items-center justify-center border-l border-r border-gencom-sand">
          {Math.round(zoom * 100)}%
        </span>
        <SegIcon onClick={onZoomIn} title="Zoom in" icon={<Plus className="h-4 w-4" />} />
        <SegIcon onClick={onZoomFit} title="Fit to content (Cmd/Ctrl+0)" icon={<Maximize2 className="h-4 w-4" />} />
      </SegGroup>
      <button onClick={onZoom100} className="ib-button-ghost text-xs h-9">100%</button>

      <div className="flex-1" />

      <input
        value={chart.title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled chart"
        className="ib-input text-sm font-semibold w-64 max-w-[40vw]"
        aria-label="Chart title"
      />

      {warningCount > 0 && (
        <button
          onClick={onJumpToValidation}
          className="inline-flex items-center gap-1 text-xs h-9 px-3 rounded-md bg-amber-100 border border-amber-300 text-amber-900 hover:bg-amber-200"
          title="Jump to validation"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {warningCount}
        </button>
      )}

      <ExportMenu
        onPrint={onPrint}
        onExportPptx={onExportPptx}
        onExportHtml={onExportHtml}
      />
    </div>
  );
}

/** Single dropdown that consolidates all export paths — Print/PDF,
 *  PowerPoint, and self-contained HTML — into one button on the
 *  top-right of the toolbar. The previous toolbar exposed Print and
 *  Export.pptx as separate pills; users wanted one entry point with
 *  HTML alongside, so this menu hides everything behind a single
 *  "Export" button and pops a list of three actions. The button
 *  itself uses the same SegButton chrome as the rest of the toolbar
 *  for visual consistency. */
function ExportMenu({
  onPrint, onExportPptx, onExportHtml,
}: {
  onPrint: () => void;
  onExportPptx: () => void;
  onExportHtml: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Export — print, .pptx, or HTML"
        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold rounded-md bg-gencom-green text-white hover:bg-gencom-greendark transition"
      >
        <Upload className="h-4 w-4" />
        Export
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Export options"
          className="absolute right-0 mt-1 z-50 w-72 bg-white rounded-md border border-gencom-sand shadow-xl py-1.5"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onPrint(); }}
            className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition flex items-start gap-2"
          >
            <Printer className="h-4 w-4 mt-0.5 flex-shrink-0 text-gencom-stone" />
            <span>
              <span className="block text-[13px] font-semibold text-gencom-ink">Print / PDF</span>
              <span className="block text-[11px] text-gencom-stone leading-snug">Crops the print to the active paper-space boundary. If no paper size is set, you'll be prompted to choose one (or marquee a region) first.</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onExportPptx(); }}
            className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition flex items-start gap-2 border-t border-gencom-sand"
          >
            <Presentation className="h-4 w-4 mt-0.5 flex-shrink-0 text-gencom-stone" />
            <span>
              <span className="block text-[13px] font-semibold text-gencom-ink">Export .pptx</span>
              <span className="block text-[11px] text-gencom-stone leading-snug">PowerPoint file that round-trips through Import .pptx — boxes and connectors stay editable in PowerPoint.</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onExportHtml(); }}
            className="w-full text-left px-3 py-2 hover:bg-gencom-greensoft transition flex items-start gap-2 border-t border-gencom-sand"
          >
            <Code2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-gencom-stone" />
            <span>
              <span className="block text-[13px] font-semibold text-gencom-ink">Export HTML</span>
              <span className="block text-[11px] text-gencom-stone leading-snug">Self-contained .html file showing the paper-space boundary, every box, and every connector — opens in any browser.</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ----- Segmented pill primitives ------------------------------------

function SegGroup({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="inline-flex items-stretch">
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-gencom-stone self-center mr-1.5 font-semibold">
          {label}
        </span>
      )}
      <div className="seg-group inline-flex items-stretch rounded-md border border-gencom-sand bg-white overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/** Standard icon-over-label segment. `emphasis` darkens the segment
 *  for the primary action (e.g. Add box). */
function SegButton({
  onClick, title, icon, label, emphasis,
}: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  label: string;
  emphasis?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        "seg-button h-9 px-3 inline-flex items-center gap-1.5 text-[12px] border-l border-gencom-sand first:border-l-0 transition " +
        (emphasis
          ? "bg-gencom-green text-white hover:bg-gencom-greendark"
          : "text-gencom-ink hover:bg-gencom-mist")
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** Compact icon-only segment (for zoom controls). */
function SegIcon({ onClick, title, icon }: { onClick: () => void; title: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="seg-button h-9 px-2.5 inline-flex items-center text-gencom-ink hover:bg-gencom-mist border-l border-gencom-sand first:border-l-0 transition"
    >
      {icon}
    </button>
  );
}

/** "File…" segmented button with a dropdown menu. Bundles the three
 *  actions (Download JSON, Import .pptx, Import sketch) so the
 *  primary toolbar stays uncluttered. */
function FileMenuButton({
  sketchBusy, onNew, onOpen, onDownloadJson, onImportPptx, onImportSketch,
}: {
  sketchBusy: boolean;
  onNew: () => void;
  onOpen: () => void;
  onDownloadJson: () => void;
  onImportPptx: () => void;
  onImportSketch: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Anchor coords for the fixed-position menu — set when opening.
  // Fixed positioning is required because the surrounding SegGroup has
  // `overflow-hidden`, which would otherwise clip the dropdown.
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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ left: rect.left, top: rect.bottom + 4 });
    setOpen(true);
  }
  function pick(fn: () => void) { setOpen(false); fn(); }
  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title="Open file actions — download a JSON copy, import a PowerPoint, or import a sketch."
        className="seg-button h-9 px-3 inline-flex items-center gap-1.5 text-[12px] border-l border-gencom-sand first:border-l-0 text-gencom-ink hover:bg-gencom-mist transition"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FileDown className="h-4 w-4" />
        <span>{sketchBusy ? "Reading…" : "File"}</span>
        <ChevronDown className="h-3.5 w-3.5 -mr-0.5 opacity-70" />
      </button>
      {open && anchor && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="File actions"
          className="fixed z-50 bg-white rounded-md border border-gencom-sand shadow-xl py-1.5 min-w-[220px]"
          style={{ left: anchor.left, top: anchor.top }}
        >
          <FileMenuItem
            onClick={() => pick(onNew)}
            icon={<FilePlus className="h-4 w-4 text-gencom-green" />}
            title="New"
            subtitle="Reset the chart to a fresh seed (current edits are auto-saved as a separate project from the home screen)."
          />
          <FileMenuItem
            onClick={() => pick(onOpen)}
            icon={<FileUp className="h-4 w-4 text-gencom-green" />}
            title="Open"
            subtitle="Open a saved Org Chart JSON file (Cmd/Ctrl+O)."
          />
          <FileMenuItem
            onClick={() => pick(onDownloadJson)}
            icon={<FileDown className="h-4 w-4 text-gencom-green" />}
            title="Download JSON"
            subtitle="Save a JSON copy for handoff or backup."
          />
          <FileMenuItem
            onClick={() => pick(onImportPptx)}
            icon={<Presentation className="h-4 w-4 text-gencom-green" />}
            title="Import .pptx"
            subtitle="Load an existing org chart from PowerPoint."
          />
          <FileMenuItem
            onClick={() => { if (!sketchBusy) pick(onImportSketch); }}
            icon={<ImageDown className="h-4 w-4 text-gencom-green" />}
            title={sketchBusy ? "Reading sketch…" : "Import sketch"}
            subtitle="PDF or image of a hand-drawn chart — Claude reconstructs the layout."
            disabled={sketchBusy}
          />
        </div>
      )}
    </>
  );
}

function FileMenuItem({
  onClick, icon, title, subtitle, disabled,
}: { onClick: () => void; icon: React.ReactNode; title: string; subtitle: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={
        "w-full text-left px-3 py-2 transition flex items-start gap-3 " +
        (disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-gencom-greensoft")
      }
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="flex-1">
        <span className="block text-[13px] font-semibold text-gencom-ink">{title}</span>
        <span className="block text-[11px] text-gencom-stone leading-snug">{subtitle}</span>
      </span>
    </button>
  );
}

/** Toggle segment (FREE / FINE / COARSE). Active = filled emerald, like
 *  the BUDGET/CASHFLOW/INVOICES selector. */
function SegToggle({
  active, onClick, title, label,
}: { active: boolean; onClick: () => void; title: string; label: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={
        "seg-button h-9 px-3.5 inline-flex items-center text-[11px] font-bold tracking-wider border-l border-gencom-sand first:border-l-0 transition " +
        (active
          ? "bg-gencom-green text-white"
          : "text-gencom-ink hover:bg-gencom-mist")
      }
    >
      {label}
    </button>
  );
}
