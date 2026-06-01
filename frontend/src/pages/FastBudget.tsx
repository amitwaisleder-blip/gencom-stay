import { useEffect, useMemo, useRef, useState } from "react";
import { motion, type PanInfo } from "framer-motion";
import * as XLSX from "xlsx";
import { api } from "../lib/api";
import {
  AREAS, AREA_BY_KEY, BRANDS, BRAND_TIERS, BRAND_TIER_BY_BRAND,
  BENCHMARK_LAST_UPDATED, BENCHMARK_SOURCE, REGIONAL_MULTIPLIERS,
  SCOPE_LEVEL_BUNDLES, propertyTypeMultiplier, scopeDescriptionFor,
  unitLabel, unitQtyLabel,
  type AreaDef, type BrandTier, type Range, type ScopeLevel,
} from "../lib/fastBudgetBenchmarks";

// ---------- Types ---------------------------------------------------------
type PropertyBasics = {
  name: string;
  city: string;
  stateOrCountry: string;
  brand: string;
  tier: BrandTier;
  roomCount: number | "";
  suiteCount: number | "";
  floors: number | "";
  yearBuilt: number | "";
  lastRenovation: number | "";
  propertyType: "" | "Urban High-Rise" | "Resort" | "Airport" | "Suburban" | "Conversion";
  grossSf: number | "";
  startDate: string;
  completionDate: string;
  regionKey: string;
};

type AreaInput = {
  include: boolean;
  scope: ScopeLevel;
  sf: number | "";
  ffe: boolean;
  notes: string;
  /** Multiplier applied to minor/partial/full benchmarks for this area (1.0 = default). */
  adjust: number;
  /** Manual $ overrides for this area's three scope levels. When a value is a
   *  number (>0) the benchmark calc is replaced by that total for that level;
   *  empty/undefined falls back to the benchmark × qty math. Per-area only. */
  manual?: { minor: number | ""; partial: number | ""; full: number | "" };
  /** Per-unit cost override — for `per_key` and `per_floor` areas, a single
   *  $/unit value the user types. Minor/Partial/Full are auto-derived as
   *  ±20% from this baseline. Takes precedence over `manual` and benchmark. */
  perUnitOverride?: number | null;
};

type CustomArea = {
  id: string;
  name: string;
  low: number;
  mid: number;
  high: number;
  notes: string;
  designBasis: boolean;
};

type SoftCostKey = string;
type SoftCostBasis =
  | "hard_design_only"
  | "hard_all"
  | "hard_plus_softs_no_dev"
  | "ffe_only"
  | "hard_minus_ffe"
  | "flat";

type SoftCostRow = {
  key: SoftCostKey;
  label: string;
  pct: number;
  enabled: boolean;
  basis: SoftCostBasis;
  /** Used when basis === "flat": a fixed dollar amount (mid). Low/high
   *  are taken as the same value — it's a fixed line item. */
  flatAmount?: number;
};

// Local-only project archive — keeps the last few exported budgets in
// localStorage so the user can hop back to a recent one without
// re-keying inputs. Capped at ARCHIVE_LIMIT entries; same-named projects
// are deduped (the latest export replaces the prior snapshot).
type ArchivedProject = {
  id: string;
  savedAt: string; // ISO
  name: string;
  basics: PropertyBasics;
  inputs: Record<string, AreaInput>;
  customAreas: CustomArea[];
  softs: SoftCostRow[];
};

const ARCHIVE_KEY = "gencom_fast_budget_archive_v1";
const ARCHIVE_LIMIT = 5;
const SOFTS_PREFS_KEY = "gencom_fast_budget_softs_v1";

function loadArchive(): ArchivedProject[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ARCHIVE_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistArchive(items: ArchivedProject[]) {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded or storage disabled — best-effort, drop silently.
  }
}

// One entry in the dynamic pane list — drives the wizard's step sequence.
type Pane =
  | { kind: "basics" }
  | { kind: "scope_picker" }
  | { kind: "area"; area: AreaDef }
  | { kind: "custom_areas" }
  | { kind: "soft_costs" }
  | { kind: "review" }
  | { kind: "scope_description" };

type ComputedLine = {
  key: string;
  area: string;
  qty: number;
  unit: string;
  low: Range;
  mid: Range;
  high: Range;
  lowTotal: number;
  midTotal: number;
  highTotal: number;
  scope: string;
  ffe: boolean;
  designBasis: boolean;
  notes?: string;
};

// ---------- Helpers -------------------------------------------------------
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money = (n: number) => `$${nf.format(Math.round(n))}`;
function moneyK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000)    return `$${Math.round(n / 1_000)}K`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emptyAreaInput(): AreaInput {
  return { include: false, scope: "none", sf: "", ffe: false, notes: "", adjust: 1 };
}

function defaultAreaInputs(basics: PropertyBasics): Record<string, AreaInput> {
  const out: Record<string, AreaInput> = {};
  const rc = Number(basics.roomCount) || 0;
  const sc = Number(basics.suiteCount) || 0;
  for (const a of AREAS) {
    // Only pre-fill SF if we have a room count to scale from. Otherwise leave
    // blank — the user enters it during the area step.
    const sfDefault = a.sf_default && rc > 0 ? a.sf_default(rc, sc) : undefined;
    out[a.key] = {
      // Areas start excluded — the user opts in on the Scope Selection step.
      include: false,
      scope: "none",
      sf: sfDefault ?? "",
      ffe: false,
      notes: "",
      adjust: 1,
    };
  }
  return out;
}

function emptyBasics(): PropertyBasics {
  return {
    name: "",
    city: "",
    stateOrCountry: "",
    brand: "",
    tier: "Upper-Upscale",
    roomCount: "",
    suiteCount: "",
    floors: "",
    yearBuilt: "",
    lastRenovation: "",
    propertyType: "",
    grossSf: "",
    startDate: "",
    completionDate: "",
    regionKey: "National Average",
  };
}

function defaultSoftCosts(): SoftCostRow[] {
  return [
    { key: "design", label: "Design fees", pct: 8, enabled: true, basis: "hard_design_only" },
    { key: "owners_pm", label: "Owner's PM / project management", pct: 6, enabled: true, basis: "hard_design_only" },
    { key: "purchasing_agent", label: "Purchasing agent", pct: 8, enabled: true, basis: "ffe_only" },
    { key: "construction_costs", label: "Construction costs (GC / CM fee)", pct: 12, enabled: true, basis: "hard_minus_ffe" },
    { key: "contingency", label: "Contingency", pct: 10, enabled: true, basis: "hard_plus_softs_no_dev" },
    { key: "ffe_logistics", label: "FF&E freight, warehousing, install", pct: 32, enabled: true, basis: "ffe_only" },
    // Development fee always sits last — UI surfaces it as its own section.
    { key: "development_fee", label: "Development fee", pct: 3, enabled: true, basis: "hard_plus_softs_no_dev" },
  ];
}

// ---------- Calculation ---------------------------------------------------
function computeQty(area: AreaDef, basics: PropertyBasics, input: AreaInput): number {
  const rc = Number(basics.roomCount) || 0;
  const sc = Number(basics.suiteCount) || 0;
  if (area.unit === "per_key") {
    if (area.key === "suites") return sc;
    if (area.key === "guestrooms_std") return Math.max(0, rc - sc);
    return rc;
  }
  if (area.unit === "per_sf") return Number(input.sf) || 0;
  if (area.unit === "per_elevator") return Number(input.sf) || 0;
  if (area.unit === "per_floor") {
    const explicit = Number(input.sf);
    if (explicit > 0) return explicit;
    const floors = Number(basics.floors);
    if (floors > 0) return floors;
    return Math.max(1, Math.round(rc / 25));
  }
  return 0;
}

function linesFrom(
  basics: PropertyBasics,
  inputs: Record<string, AreaInput>,
  customAreas: CustomArea[],
  scopePct: { minor: number; partial: number; full: number },
): ComputedLine[] {
  const mult = REGIONAL_MULTIPLIERS[basics.regionKey] ?? 1.0;
  const out: ComputedLine[] = [];

  for (const area of AREAS) {
    const input = inputs[area.key];
    if (!input?.include || input.scope === "none") continue;
    const ranges = area.ranges[basics.tier][input.scope];
    const qty = computeQty(area, basics, input);
    if (qty <= 0) continue;
    const adj = input.adjust ?? 1;
    const scopeMult = (scopePct[input.scope as "minor" | "partial" | "full"] ?? 100) / 100;
    const ptMult = propertyTypeMultiplier(basics.propertyType, area.key);
    const combined = mult * adj * scopeMult * ptMult;
    const manualVal = input.manual?.[input.scope as "minor" | "partial" | "full"];
    const useManual = typeof manualVal === "number" && manualVal > 0;
    const perUnitOverride = input.perUnitOverride;
    const usePerUnit = typeof perUnitOverride === "number" && perUnitOverride > 0;

    let applied: Range;
    let lineQty: number;
    let lineUnit: string;
    if (usePerUnit) {
      // Per-unit override: scope acts as ±20% step (Minor 0.8, Partial 1.0, Full 1.2)
      // and within that we keep a ±20% spread so low/mid/high reads naturally.
      const scopeMult = input.scope === "minor" ? 0.8
        : input.scope === "full" ? 1.2
        : 1.0;
      const baseline = perUnitOverride * scopeMult;
      applied = {
        low: baseline * 0.8,
        mid: baseline,
        high: baseline * 1.2,
      };
      lineQty = qty;
      lineUnit = unitLabel(area.unit);
    } else if (useManual) {
      applied = { low: manualVal, mid: manualVal, high: manualVal };
      // For manual overrides we quote a lump sum (qty=1), not per-unit × qty.
      lineQty = 1;
      lineUnit = "LS";
    } else {
      applied = {
        low: ranges.low * combined,
        mid: ranges.mid * combined,
        high: ranges.high * combined,
      };
      lineQty = qty;
      lineUnit = unitLabel(area.unit);
    }
    out.push({
      key: area.key,
      area: area.name,
      qty: lineQty,
      unit: lineUnit,
      low: applied,
      mid: applied,
      high: applied,
      lowTotal: lineQty * applied.low,
      midTotal: lineQty * applied.mid,
      highTotal: lineQty * applied.high,
      scope: input.scope.toUpperCase(),
      ffe: false,
      designBasis: area.design_basis,
      notes: input.notes,
    });

    if (input.ffe && area.has_ffe && area.ranges[basics.tier].ffe) {
      const fr = area.ranges[basics.tier].ffe!;
      const applied2: Range = { low: fr.low * mult, mid: fr.mid * mult, high: fr.high * mult };
      out.push({
        key: area.key + "_ffe",
        area: area.name + " — FF&E",
        qty,
        unit: unitLabel(area.unit),
        low: applied2,
        mid: applied2,
        high: applied2,
        lowTotal: qty * applied2.low,
        midTotal: qty * applied2.mid,
        highTotal: qty * applied2.high,
        scope: "FF&E",
        ffe: true,
        designBasis: area.design_basis,
      });
    }
  }

  for (const c of customAreas) {
    out.push({
      key: "custom_" + c.id,
      area: c.name || "Custom Area",
      qty: 1,
      unit: "LS",
      low: { low: c.low * mult, mid: c.mid * mult, high: c.high * mult },
      mid: { low: c.low * mult, mid: c.mid * mult, high: c.high * mult },
      high: { low: c.low * mult, mid: c.mid * mult, high: c.high * mult },
      lowTotal: c.low * mult,
      midTotal: c.mid * mult,
      highTotal: c.high * mult,
      scope: "CUSTOM",
      ffe: false,
      designBasis: c.designBasis,
      notes: c.notes,
    });
  }

  return out;
}

function sumRange(lines: ComputedLine[], pred?: (l: ComputedLine) => boolean) {
  const picked = pred ? lines.filter(pred) : lines;
  return {
    low: picked.reduce((s, l) => s + l.lowTotal, 0),
    mid: picked.reduce((s, l) => s + l.midTotal, 0),
    high: picked.reduce((s, l) => s + l.highTotal, 0),
  };
}

function basisValue(
  basis: SoftCostBasis,
  lines: ComputedLine[],
  softsSoFar: { key: SoftCostKey; range: Range }[],
): Range {
  if (basis === "hard_all") return sumRange(lines);
  if (basis === "hard_design_only") return sumRange(lines, (l) => l.designBasis);
  if (basis === "ffe_only") return sumRange(lines, (l) => l.ffe);
  if (basis === "hard_minus_ffe") return sumRange(lines, (l) => !l.ffe);
  if (basis === "hard_plus_softs_no_dev") {
    const hard = sumRange(lines);
    const softs = softsSoFar.reduce(
      (s, r) => ({ low: s.low + r.range.low, mid: s.mid + r.range.mid, high: s.high + r.range.high }),
      { low: 0, mid: 0, high: 0 },
    );
    return {
      low: hard.low + softs.low,
      mid: hard.mid + softs.mid,
      high: hard.high + softs.high,
    };
  }
  return { low: 0, mid: 0, high: 0 };
}

function computeSofts(lines: ComputedLine[], softs: SoftCostRow[]) {
  const applied: { row: SoftCostRow; basis: Range; range: Range }[] = [];
  const running: { key: SoftCostKey; range: Range }[] = [];
  for (const row of softs) {
    if (!row.enabled) {
      applied.push({ row, basis: { low: 0, mid: 0, high: 0 }, range: { low: 0, mid: 0, high: 0 } });
      continue;
    }
    // Flat-dollar line: same value across low/mid/high; basis is irrelevant.
    if (row.basis === "flat") {
      const flat = typeof row.flatAmount === "number" && row.flatAmount > 0 ? row.flatAmount : 0;
      const range: Range = { low: flat, mid: flat, high: flat };
      applied.push({ row, basis: { low: 0, mid: 0, high: 0 }, range });
      running.push({ key: row.key, range });
      continue;
    }
    const basis = basisValue(row.basis, lines, running);
    const range: Range = {
      low: basis.low * (row.pct / 100),
      mid: basis.mid * (row.pct / 100),
      high: basis.high * (row.pct / 100),
    };
    applied.push({ row, basis, range });
    running.push({ key: row.key, range });
  }
  return applied;
}

// ---------- Sub-components ------------------------------------------------
function StepHeader({
  step, total, title, titleFor, onJump,
}: {
  step: number;
  total: number;
  title: string;
  titleFor?: (n: number) => string;
  onJump?: (n: number) => void;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="t-h2 capitalize truncate">{title}</div>
        <div className="t-eyebrow whitespace-nowrap">Step {step} / {total}</div>
      </div>
      <div className="mt-3 flex gap-[3px]">
        {Array.from({ length: total }).map((_, i) => {
          const n = i + 1;
          const cls = n < step
            ? "bg-emerald-700"
            : n === step
              ? "bg-gencom-gold"
              : "bg-gencom-sand";
          const label = titleFor ? titleFor(n) : "";
          return (
            <button
              key={i}
              type="button"
              onClick={onJump ? () => onJump(n) : undefined}
              disabled={!onJump}
              title={label ? `Step ${n}: ${label}` : `Step ${n}`}
              aria-label={label ? `Go to step ${n}: ${label}` : `Go to step ${n}`}
              className={`group relative flex-1 h-4 flex items-center ${onJump ? "cursor-pointer" : "cursor-default"}`}
            >
              <div
                className={`h-1.5 w-full rounded-full transition-all ${cls} ${
                  onJump ? "group-hover:h-2 group-hover:brightness-110" : ""
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Compact "Archive" toggle + inline list of recently-exported projects.
// Rendered at the top-right of every pane so the user can hop between
// recent budgets without losing their place. Inline (not absolute) so
// the dropdown can never get clipped by the panes' overflow:hidden.
function ArchiveButton({
  archive, onLoad, onDelete,
}: {
  archive: ArchivedProject[];
  onLoad: (snap: ArchivedProject) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="t-eyebrow px-3 py-1.5 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white flex items-center gap-1.5"
        title="Recently exported projects"
      >
        <span>📂 Archive</span>
        <span className="t-micro text-gencom-stone">({archive.length})</span>
      </button>
      {open && (
        <div className="absolute z-30 bottom-full mb-2 left-1/2 -translate-x-1/2 w-72 border border-gencom-sand rounded-md bg-white shadow-lg">
          {archive.length === 0 ? (
            <div className="p-3 text-xs text-gencom-stone italic text-center">
              No saved projects yet. Export a budget to save it here.
            </div>
          ) : (
            <ul className="divide-y divide-gencom-sand">
              {archive.map((a) => (
                <li key={a.id} className="p-2 flex items-center gap-2 text-xs hover:bg-gencom-mist/40">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate" title={a.name}>{a.name}</div>
                    <div className="t-micro text-gencom-stone">
                      {new Date(a.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {a.basics.roomCount ? ` · ${a.basics.roomCount} keys` : ""}
                      {a.basics.brand ? ` · ${a.basics.brand}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { onLoad(a); setOpen(false); }}
                    className="t-eyebrow px-2 py-1 border border-emerald-700 text-emerald-700 rounded hover:bg-emerald-50"
                    title="Load this project (replaces current inputs)"
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(a.id)}
                    className="t-micro text-red-700 hover:bg-red-50 rounded w-6 h-6 flex items-center justify-center"
                    title="Delete from archive"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label, children, hint,
}: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="t-eyebrow mb-1 truncate" title={label}>{label}</div>
      {children}
      <div className="t-micro mt-0.5 min-h-[14px] leading-tight">{hint ?? ""}</div>
    </label>
  );
}

const inputCls = "w-full px-2.5 py-1 border border-gencom-sand rounded-md text-xs focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold bg-white";

function RangePill({ r }: { r: Range }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums">
      <span className="text-gencom-stone">{moneyK(r.low)}</span>
      <span className="text-gencom-stone">/</span>
      <span className="font-semibold text-gencom-ink">{moneyK(r.mid)}</span>
      <span className="text-gencom-stone">/</span>
      <span className="text-gencom-stone">{moneyK(r.high)}</span>
    </span>
  );
}

// ---------- Main component ------------------------------------------------
const TOTAL_STEPS_BASE = 3; // basics + softs + review; area steps inserted in between

// Each pane is a fixed-width card; the track centres the current pane and
// lets the previous / next panes peek in from either side, clipped by the
// container's overflow.
const PANE_WIDTH = 768; // matches the existing `max-w-3xl` card
const PANE_GAP = 24; // matches `gap-6`
const PANE_SLOT = PANE_WIDTH + PANE_GAP;

// Spring tuned for a deliberate, ~1.6s settle (≈4× the previous feel).
const PAGE_TRANSITION = { type: "spring" as const, duration: 1.6, bounce: 0.08 };

export default function FastBudget() {
  const [basics, setBasics] = useState<PropertyBasics>(emptyBasics());
  const [inputs, setInputs] = useState<Record<string, AreaInput>>(() =>
    defaultAreaInputs(emptyBasics()),
  );

  const [customAreas, setCustomAreas] = useState<CustomArea[]>([]);
  // Soft cost config persists across projects so the user's chosen
  // percentages, custom lines, and toggles carry over to the next budget.
  const [softs, setSofts] = useState<SoftCostRow[]>(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SOFTS_PREFS_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as SoftCostRow[];
      }
    } catch {
      // fall through to defaults
    }
    return defaultSoftCosts();
  });
  useEffect(() => {
    try {
      localStorage.setItem(SOFTS_PREFS_KEY, JSON.stringify(softs));
    } catch {
      // best-effort persistence
    }
  }, [softs]);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);
  // Global scope-level multipliers (percentages, 100 = benchmark baseline).
  // Set via the Override dropdown on any area step; affects every area.
  const [scopePct, setScopePct] = useState<{ minor: number; partial: number; full: number }>(
    { minor: 100, partial: 100, full: 100 },
  );

  const [step, setStep] = useState(1);

  // Local archive of recently-exported projects (last 5). Initialized
  // from localStorage; written every time the user exports a budget.
  const [archive, setArchive] = useState<ArchivedProject[]>(() => loadArchive());
  function archiveCurrent() {
    const name = basics.name?.trim() || "Untitled property";
    const snap: ArchivedProject = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      savedAt: new Date().toISOString(),
      name,
      basics,
      inputs,
      customAreas,
      softs,
    };
    // Replace any prior snapshot with the same name so re-exporting the
    // same project doesn't push older distinct projects out of the slot.
    const filtered = archive.filter((a) => a.name.toLowerCase() !== name.toLowerCase());
    const next = [snap, ...filtered].slice(0, ARCHIVE_LIMIT);
    setArchive(next);
    persistArchive(next);
  }
  function loadFromArchive(snap: ArchivedProject) {
    setBasics(snap.basics);
    setInputs(snap.inputs);
    setCustomAreas(snap.customAreas);
    setSofts(snap.softs);
    setEnrichError(null);
    setEnrichNote(null);
    setStep(1);
  }
  function deleteFromArchive(id: string) {
    const next = archive.filter((a) => a.id !== id);
    setArchive(next);
    persistArchive(next);
  }

  // Dynamic pane list. The user picks areas on the Scope Selection pane;
  // only those areas get their own step, so totalSteps shrinks/grows as the
  // user toggles inclusion.
  const panes = useMemo<Pane[]>(() => {
    const list: Pane[] = [
      { kind: "basics" },
      { kind: "scope_picker" },
    ];
    for (const a of AREAS) {
      if (inputs[a.key]?.include) list.push({ kind: "area", area: a });
    }
    list.push({ kind: "custom_areas" });
    list.push({ kind: "soft_costs" });
    list.push({ kind: "review" });
    list.push({ kind: "scope_description" });
    return list;
  }, [inputs]);
  const totalSteps = panes.length;

  // Clamp step if the user toggles off enough areas that the current step
  // no longer exists.
  useEffect(() => {
    if (step > totalSteps) setStep(totalSteps);
  }, [step, totalSteps]);

  const basicsDone =
    basics.name.trim().length > 0 &&
    Number(basics.roomCount) > 0 &&
    (basics.suiteCount === "" || Number(basics.suiteCount) >= 0) &&
    (basics.suiteCount === "" || Number(basics.suiteCount) <= Number(basics.roomCount));

  // ---- derived --------------------------------------------------------
  const lines = useMemo(() => linesFrom(basics, inputs, customAreas, scopePct), [basics, inputs, customAreas, scopePct]);
  const hardRange = useMemo(() => sumRange(lines), [lines]);
  const softsApplied = useMemo(() => computeSofts(lines, softs), [lines, softs]);
  const softsRange = useMemo(() => {
    return softsApplied.reduce(
      (s, x) => ({
        low: s.low + x.range.low,
        mid: s.mid + x.range.mid,
        high: s.high + x.range.high,
      }),
      { low: 0, mid: 0, high: 0 },
    );
  }, [softsApplied]);
  const grand = useMemo<Range>(
    () => ({
      low: hardRange.low + softsRange.low,
      mid: hardRange.mid + softsRange.mid,
      high: hardRange.high + softsRange.high,
    }),
    [hardRange, softsRange],
  );
  const perKey = useMemo<Range>(() => {
    const k = basics.roomCount || 1;
    return { low: grand.low / k, mid: grand.mid / k, high: grand.high / k };
  }, [grand, basics.roomCount]);
  const perSf = useMemo<Range>(() => {
    const sf = Number(basics.grossSf) || (basics.roomCount || 0) * 700;
    if (sf <= 0) return { low: 0, mid: 0, high: 0 };
    return { low: grand.low / sf, mid: grand.mid / sf, high: grand.high / sf };
  }, [grand, basics.grossSf, basics.roomCount]);

  // ---- step navigation -----------------------------------------------
  const currentPane = panes[step - 1];
  const isReview = currentPane?.kind === "review";

  function titleFor(s: number): string {
    const p = panes[s - 1];
    if (!p) return "";
    if (p.kind === "basics") return "Property Basics";
    if (p.kind === "scope_picker") return "Select Scope";
    if (p.kind === "area") return p.area.name;
    if (p.kind === "custom_areas") return "Custom Areas";
    if (p.kind === "soft_costs") return "Soft Cost Assumptions";
    if (p.kind === "review") return "Review & Output";
    if (p.kind === "scope_description") return "High-Level Scope Description";
    return "";
  }

  // Jump to the first pane matching a given kind (used by "Put in new space"
  // to drop the user onto the Custom Areas editor).
  function goToKind(kind: Pane["kind"]) {
    const idx = panes.findIndex((p) => p.kind === kind);
    if (idx >= 0) setStep(idx + 1);
  }

  // Override (scopePct) resets to baseline when the user leaves the area
  // step — it's a per-page aid, not a global cascade.
  function resetScopeOverride() {
    setScopePct({ minor: 100, partial: 100, full: 100 });
  }
  // Each step change scrolls to the top so the user lands on the page
  // header rather than wherever they were scrolled on the previous step.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  function goNext() {
    if (step >= totalSteps) return;
    resetScopeOverride();
    setStep(step + 1);
  }
  function goPrev() {
    if (step <= 1) return;
    resetScopeOverride();
    setStep(step - 1);
  }
  function goToStep(n: number) {
    if (n < 1 || n > totalSteps) return;
    resetScopeOverride();
    setStep(n);
  }
  function skipToReview() {
    const idx = panes.findIndex((p) => p.kind === "review");
    if (idx >= 0) {
      resetScopeOverride();
      setStep(idx + 1);
    }
  }

  // Keyboard navigation — ignored when typing in a form control.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, totalSteps]);

  // Swipe / drag handling — fires at the end of a horizontal pan.
  function handleDragEnd(_: unknown, info: PanInfo) {
    const { offset, velocity } = info;
    const SWIPE_OFFSET = 100;
    const SWIPE_VELOCITY = 500;
    if (offset.x < -SWIPE_OFFSET || velocity.x < -SWIPE_VELOCITY) {
      goNext();
    } else if (offset.x > SWIPE_OFFSET || velocity.x > SWIPE_VELOCITY) {
      goPrev();
    }
  }
  function clearAll() {
    const ok = window.confirm(
      "Clear all information on this page? Everything you've entered will be lost.",
    );
    if (!ok) return;
    const fresh = emptyBasics();
    setBasics(fresh);
    setInputs(defaultAreaInputs(fresh));
    setCustomAreas([]);
    setSofts(defaultSoftCosts());
    setEnrichError(null);
    setEnrichNote(null);
    setStep(1);
  }
  function startOver() {
    const ok = window.confirm(
      "Start over? All entries on this page will be cleared and you'll return to Step 1.",
    );
    if (!ok) return;
    const fresh = emptyBasics();
    setBasics(fresh);
    setInputs(defaultAreaInputs(fresh));
    setCustomAreas([]);
    setSofts(defaultSoftCosts());
    setEnrichError(null);
    setEnrichNote(null);
    setStep(1);
  }

  async function runEnrich() {
    if (!basics.name.trim()) return;
    setEnriching(true);
    setEnrichError(null);
    setEnrichNote(null);
    try {
      const data = await api.fastBudgetEnrich({
        name: basics.name.trim(),
        city_hint: basics.city.trim() || undefined,
      });
      const next: PropertyBasics = { ...basics };
      if (data.city) next.city = data.city;
      if (data.state_or_country) next.stateOrCountry = data.state_or_country;
      if (data.brand && BRANDS.includes(data.brand)) next.brand = data.brand;
      if (data.tier && BRAND_TIERS.includes(data.tier as BrandTier)) {
        next.tier = data.tier as BrandTier;
      } else if (data.brand && BRAND_TIER_BY_BRAND[data.brand]) {
        next.tier = BRAND_TIER_BY_BRAND[data.brand];
      }
      if (data.room_count != null) next.roomCount = data.room_count;
      if (data.suite_count != null) next.suiteCount = data.suite_count;
      if (data.floors != null) next.floors = data.floors;
      if (data.year_built != null) next.yearBuilt = data.year_built;
      if (data.last_renovation != null) next.lastRenovation = data.last_renovation;
      if (data.property_type) {
        const pt = data.property_type as PropertyBasics["propertyType"];
        if (["Urban High-Rise", "Resort", "Airport", "Suburban", "Conversion"].includes(pt)) {
          next.propertyType = pt;
        }
      }
      if (data.gross_sf != null) next.grossSf = data.gross_sf;
      if (data.region_key && data.region_key in REGIONAL_MULTIPLIERS) {
        next.regionKey = data.region_key;
      }
      setBasics(next);
      // Re-seed area SF defaults now that we have a room count.
      setInputs(defaultAreaInputs(next));
      const tag = data.confidence ? `confidence: ${data.confidence}` : "";
      setEnrichNote(
        [
          `Filled from AI lookup${tag ? ` (${tag})` : ""}.`,
          data.notes ?? "",
        ].filter(Boolean).join(" — "),
      );
    } catch (e) {
      setEnrichError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnriching(false);
    }
  }

  // ---- Excel export ---------------------------------------------------
  function exportExcel() {
    archiveCurrent();
    const wb = XLSX.utils.book_new();
    const today = new Date().toISOString().slice(0, 10);

    // Cover
    const cover: (string | number)[][] = [
      ["ROM CAPEX Budget"],
      [],
      ["Property", basics.name],
      ["Location", `${basics.city}, ${basics.stateOrCountry}`],
      ["Brand", basics.brand],
      ["Tier", basics.tier],
      ["Property Type", basics.propertyType],
      ["Room Count", basics.roomCount],
      ["Suite Count", basics.suiteCount],
      ["Floor Count", basics.floors],
      ["Year Built", basics.yearBuilt || ""],
      ["Last Major Renovation", basics.lastRenovation || ""],
      ["Gross Building SF", basics.grossSf || ""],
      ["Target Start", basics.startDate],
      ["Target Completion", basics.completionDate],
      ["Region", `${basics.regionKey} (×${REGIONAL_MULTIPLIERS[basics.regionKey] ?? 1})`],
      [],
      ["Date Generated", today],
      ["Benchmark Source", BENCHMARK_SOURCE],
      ["Benchmarks Last Updated", BENCHMARK_LAST_UPDATED],
      [],
      ["Confidence Note"],
      ["ROM estimate based on high-level scope assumptions; ±25% accuracy typical at this stage. Detailed scope definition and contractor pricing required for firmer numbers."],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cover), "Cover");

    // Scope summary
    const scope: (string | number)[][] = [
      ["Area", "Include", "SF/Qty", "Scope Level", "FF&E", "Notes"],
    ];
    for (const a of AREAS) {
      const i = inputs[a.key];
      if (!i?.include) continue;
      scope.push([
        a.name,
        "Y",
        Number(i.sf) || computeQty(a, basics, i),
        i.scope.toUpperCase(),
        i.ffe ? "Y" : "N",
        i.notes,
      ]);
    }
    for (const c of customAreas) {
      scope.push([c.name || "Custom Area", "Y", 1, "CUSTOM", "N", c.notes]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scope), "Scope Summary");

    // Cost detail
    const detail: (string | number)[][] = [
      ["Area", "Qty", "Unit", "Scope", "Low $/unit", "Mid $/unit", "High $/unit", "Low Total", "Mid Total", "High Total", "Notes"],
    ];
    for (const l of lines) {
      detail.push([
        l.area, l.qty, l.unit, l.scope,
        Math.round(l.low.low), Math.round(l.low.mid), Math.round(l.low.high),
        Math.round(l.lowTotal), Math.round(l.midTotal), Math.round(l.highTotal),
        l.notes ?? "",
      ]);
    }
    detail.push([]);
    detail.push(["HARD COST SUBTOTAL", "", "", "", "", "", "",
      Math.round(hardRange.low), Math.round(hardRange.mid), Math.round(hardRange.high), ""]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), "Cost Detail");

    // Soft costs
    const soft: (string | number)[][] = [
      ["Soft Cost", "Enabled", "Pct", "Basis", "Basis Low", "Basis Mid", "Basis High", "Low", "Mid", "High"],
    ];
    for (const s of softsApplied) {
      soft.push([
        s.row.label, s.row.enabled ? "Y" : "N", s.row.pct, s.row.basis,
        Math.round(s.basis.low), Math.round(s.basis.mid), Math.round(s.basis.high),
        Math.round(s.range.low), Math.round(s.range.mid), Math.round(s.range.high),
      ]);
    }
    soft.push([]);
    soft.push(["SOFT COST SUBTOTAL", "", "", "", "", "", "",
      Math.round(softsRange.low), Math.round(softsRange.mid), Math.round(softsRange.high)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(soft), "Soft Costs");

    // Summary
    const summary: (string | number)[][] = [
      ["Metric", "Low", "Mid", "High"],
      ["Hard Cost", Math.round(hardRange.low), Math.round(hardRange.mid), Math.round(hardRange.high)],
      ["Soft Cost", Math.round(softsRange.low), Math.round(softsRange.mid), Math.round(softsRange.high)],
      ["GRAND TOTAL", Math.round(grand.low), Math.round(grand.mid), Math.round(grand.high)],
      [],
      ["Cost per Key", Math.round(perKey.low), Math.round(perKey.mid), Math.round(perKey.high)],
      ["Cost per SF", Math.round(perSf.low), Math.round(perSf.mid), Math.round(perSf.high)],
      [],
      ["Room Count", basics.roomCount],
      ["Gross SF (est.)", Number(basics.grossSf) || (basics.roomCount || 0) * 700],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

    const safeName = (basics.name || "property").replace(/[^\w\-]+/g, "_");
    XLSX.writeFile(wb, `${safeName}_ROM_CAPEX_${today}.xlsx`);
  }

  // ---- HTML export ----------------------------------------------------
  // Mirrors the on-screen Review layout exactly: centered hero with the
  // Gencom mark, 1–3 estimate cards (Low / Mid / High), hard costs
  // sectioned by Deferred Maintenance vs. Interior with per-section
  // subtotals, soft costs with Development Fee broken out into its own
  // table, and a single-line confidence note. Honors the user's
  // "Include estimates" checkboxes from the Review step.
  const regionMult = REGIONAL_MULTIPLIERS[basics.regionKey] ?? 1.0;
  async function exportHtml(
    visible: { low: boolean; mid: boolean; high: boolean } = { low: true, mid: true, high: true },
    opts: { autoPrint?: boolean } = {},
  ) {
    const autoPrint = opts.autoPrint ?? false;
    archiveCurrent();
    const isoDate = new Date().toISOString().slice(0, 10);
    const d = new Date();
    const dateStr = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
    const address = [basics.city, basics.stateOrCountry].filter(Boolean).join(", ");
    const regionLabel = `${basics.regionKey} (×${regionMult})`;

    // Defensive: at least one estimate must be visible.
    const visKeys = (["low", "mid", "high"] as const).filter((k) => visible[k]);
    const keys = visKeys.length === 0 ? (["mid"] as const) : visKeys;
    const selectedCount = keys.length;
    const cardLabel = (k: "low" | "mid" | "high") => {
      if (selectedCount === 1) return "ROM Estimate";
      return k === "low" ? "Low Estimate" : k === "mid" ? "Mid Estimate" : "High Estimate";
    };
    const subtitle = (() => {
      if (selectedCount === 1) return "ROM Estimate";
      if (selectedCount === 2) {
        const names = keys.map((k) => k[0].toUpperCase() + k.slice(1));
        return `ROM CAPEX Budget · ${names.join(" & ")} Estimate`;
      }
      return "ROM CAPEX Budget";
    })();

    // Split lines into Deferred Maintenance vs. Interior (same logic as
    // ReviewStep). FF&E adders inherit the parent area's category.
    const dmLines = lines.filter((l) => {
      const base = l.key.replace(/_ffe$/, "");
      return AREA_BY_KEY[base]?.category === "dm";
    });
    const interiorLines = lines.filter((l) => {
      const base = l.key.replace(/_ffe$/, "");
      return AREA_BY_KEY[base]?.category !== "dm";
    });
    const dmSubtotal = sumRange(dmLines);
    const interiorSubtotal = sumRange(interiorLines);

    // Dev fee broken out of the soft cost rollup.
    const devFeeRows = softsApplied.filter((s) => s.row.key === "development_fee");
    const otherSoftRows = softsApplied.filter((s) => s.row.key !== "development_fee");
    const devFeeRange = devFeeRows.reduce(
      (acc, s) => ({ low: acc.low + s.range.low, mid: acc.mid + s.range.mid, high: acc.high + s.range.high }),
      { low: 0, mid: 0, high: 0 } as Range,
    );
    const otherSoftsRange: Range = {
      low: softsRange.low - devFeeRange.low,
      mid: softsRange.mid - devFeeRange.mid,
      high: softsRange.high - devFeeRange.high,
    };

    const basisLabels: Record<SoftCostBasis, string> = {
      hard_design_only: "Hard cost (design-eligible)",
      hard_all: "Hard cost (all areas)",
      hard_plus_softs_no_dev: "Hard + prior softs",
      ffe_only: "FF&E only",
      hard_minus_ffe: "Hard cost excl. FF&E",
      flat: "Flat $ amount",
    };

    // ---- Cell helpers ------------------------------------------------
    // Column titles use bare "Low / Mid / High" — the per-card label
    // ("Mid Estimate", etc.) carries the qualifier already.
    const numTh = keys
      .map((k) => `<th class="num">${k[0].toUpperCase() + k.slice(1)}</th>`)
      .join("");
    const numTds = (r: Range, opts: { boldMid?: boolean } = {}) =>
      keys
        .map((k) => {
          const cls = k === "mid" && (opts.boldMid ?? true) ? "num strong" : "num";
          return `<td class="${cls}">${money(r[k])}</td>`;
        })
        .join("");
    const lineRow = (l: ComputedLine) => `
      <tr>
        <td>${escapeHtml(l.area)}</td>
        <td class="eyebrow">${escapeHtml(l.scope)}</td>
        ${numTds({ low: l.lowTotal, mid: l.midTotal, high: l.highTotal })}
      </tr>`;
    const softRow = (s: typeof softsApplied[number]) => `
      <tr class="${s.row.enabled ? "" : "dim"}">
        <td>${escapeHtml(s.row.label)}</td>
        <td class="num">${s.row.enabled ? (s.row.basis === "flat" ? "flat" : `${s.row.pct}%`) : "—"}</td>
        <td>${escapeHtml(basisLabels[s.row.basis] ?? s.row.basis)}</td>
        ${numTds(s.range)}
      </tr>`;

    // ---- Estimate cards ---------------------------------------------
    const cardData: Record<"low" | "mid" | "high", { total: number; hard: number; soft: number; devFee: number; perKey: number }> = {
      low: { total: grand.low, hard: hardRange.low, soft: otherSoftsRange.low, devFee: devFeeRange.low, perKey: perKey.low },
      mid: { total: grand.mid, hard: hardRange.mid, soft: otherSoftsRange.mid, devFee: devFeeRange.mid, perKey: perKey.mid },
      high: { total: grand.high, hard: hardRange.high, soft: otherSoftsRange.high, devFee: devFeeRange.high, perKey: perKey.high },
    };
    const cardsHtml = keys
      .map((k) => {
        const d = cardData[k];
        const highlight = selectedCount === 1 || k === "mid";
        return `
          <div class="card${highlight ? " highlight" : ""}">
            <div class="lbl">${escapeHtml(cardLabel(k))}</div>
            <div class="big">${money(d.total)}</div>
            <div class="bd">
              <div class="row"><span>Hard costs</span><span>${money(d.hard)}</span></div>
              <div class="row"><span>Soft costs</span><span>${money(d.soft)}</span></div>
              <div class="row"><span>Dev fee</span><span>${money(d.devFee)}</span></div>
            </div>
            <div class="pk"><span class="pk-l">per key</span><span class="pk-v">${money(d.perKey)}</span></div>
          </div>`;
      })
      .join("");

    // ---- Hard cost rows: sectioned ----------------------------------
    const colSpanText = 2; // Area + Scope
    const colSpanTotal = colSpanText + selectedCount;
    const dmRowsHtml = dmLines.length
      ? dmLines.map(lineRow).join("")
      : `<tr><td colspan="${colSpanTotal}" style="text-align:center;color:var(--stone);font-style:italic">— none —</td></tr>`;
    const interiorRowsHtml = interiorLines.length
      ? interiorLines.map(lineRow).join("")
      : `<tr><td colspan="${colSpanTotal}" style="text-align:center;color:var(--stone);font-style:italic">— none —</td></tr>`;

    // ---- Soft cost rows ---------------------------------------------
    const softRowsHtml = otherSoftRows.map(softRow).join("");
    const devFeeRowsHtml = devFeeRows.map(softRow).join("");

    // ---- Embed Gencom logo as data URL so the file is self-contained
    let logoSrc = "";
    try {
      const res = await fetch("/gencom-logo.png");
      if (res.ok) {
        const blob = await res.blob();
        logoSrc = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(typeof r.result === "string" ? r.result : "");
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      }
    } catch {
      logoSrc = ""; // graceful: hero just omits the mark
    }

    // ---- Compute column widths so tables look good at any selection -
    const valColPctHard = ((100 - 50 - 18) / selectedCount).toFixed(2); // Area 50, Scope 18
    const valColPctSoft = ((100 - 36 - 10 - 22) / selectedCount).toFixed(2); // Line 36, % 10, Basis 22
    const hardColgroup = `<col style="width:50%"><col style="width:18%">${keys.map(() => `<col style="width:${valColPctHard}%">`).join("")}`;
    const softColgroup = `<col style="width:36%"><col style="width:10%"><col style="width:22%">${keys.map(() => `<col style="width:${valColPctSoft}%">`).join("")}`;

    const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>${escapeHtml(basics.name || "Property")} — ${escapeHtml(subtitle)} — ${isoDate}</title>
<style>
  :root { --ink:#1a1d24; --stone:#6b6f78; --sand:#d9d4c8; --mist:#f5f3ee; --gold:#b89555; --emerald:#047857; }
  * { box-sizing: border-box; }
  body { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--mist); margin: 0; padding: 32px; font-size: 14px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: 960px; margin: 0 auto; background: #fff; border: 1px solid var(--sand); border-radius: 12px; padding: 28px; box-shadow: 0 1px 2px rgba(0,0,0,.05); }

  /* Hero — centered Gencom mark over property name + subtitle, date pinned top-right */
  .hero { position: relative; padding-bottom: 20px; border-bottom: 1px solid var(--sand); margin-bottom: 24px; text-align: center; }
  .hero .date { position: absolute; top: 0; right: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--stone); }
  .hero img.logo { width: 48px; height: 48px; border-radius: 999px; object-fit: contain; border: 1px solid var(--sand); display: block; margin: 0 auto 4px; }
  .hero .wordmark { font-family: "Playfair Display", "Cormorant Garamond", Garamond, Georgia, serif; font-size: 22px; line-height: 1; margin-bottom: 18px; }
  .hero h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .hero .eyebrow { color: var(--gold); font-size: 16px; text-transform: uppercase; letter-spacing: .22em; font-weight: 700; margin-top: 8px; }
  .hero .sub { color: var(--stone); font-size: 13px; margin-top: 8px; }
  .hero .sub .keys { color: var(--ink); font-weight: 600; }

  /* Estimate cards — replaces the prior "totals" row */
  .cards { display: grid; gap: 12px; margin-bottom: 24px; grid-template-columns: repeat(${selectedCount}, minmax(0, 1fr)); }
  .card { padding: 14px; border: 1px solid var(--sand); border-radius: 8px; background: linear-gradient(135deg, #fff, rgba(245,243,238,.5)); display: flex; flex-direction: column; }
  .card.highlight { background: linear-gradient(135deg, #ecfdf5, rgba(209,250,229,.4)); }
  .card .lbl { color: var(--stone); font-size: 11px; text-transform: uppercase; letter-spacing: .18em; font-weight: 600; }
  .card .big { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 4px; line-height: 1.1; }
  .card .bd { margin-top: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--stone); font-variant-numeric: tabular-nums; }
  .card .bd .row { display: flex; justify-content: space-between; gap: 8px; }
  .card .bd .row span:last-child { color: var(--ink); }
  .card .pk { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(217,212,200,.6); display: flex; justify-content: space-between; align-items: baseline; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
  .card .pk .pk-l { color: var(--stone); font-size: 11px; text-transform: uppercase; letter-spacing: .18em; font-weight: 600; }
  .card .pk .pk-v { font-size: 14px; font-weight: 600; }

  /* Sections + tables — each section is one bordered card with the label
     baked into a header bar, matching the rounded-corner look of the
     estimate cards above. */
  .section { margin-bottom: 24px; }
  .section-card { border: 1px solid var(--sand); border-radius: 8px; overflow: hidden; background: #fff; }
  .section-card .section-head-bar { padding: 10px 14px; background: linear-gradient(135deg, #fff, rgba(245,243,238,.7)); color: var(--stone); font-size: 11px; text-transform: uppercase; letter-spacing: .18em; font-weight: 600; border-bottom: 1px solid var(--sand); }
  table { width: 100%; border-collapse: collapse; border: 0; font-size: 12px; }
  th { background: rgba(245,243,238,.7); color: var(--stone); text-align: left; padding: 8px 12px; font-weight: 600; height: 36px; vertical-align: middle; }
  th.num, td.num { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
  td { padding: 8px 12px; border-top: 1px solid rgba(217,212,200,.6); height: 36px; vertical-align: middle; }
  td.strong { font-weight: 600; }
  td.eyebrow { color: var(--stone); font-size: 11px; text-transform: uppercase; letter-spacing: .18em; font-weight: 600; }
  tr.section-head td { background: rgba(245,243,238,.5); color: var(--stone); font-size: 11px; text-transform: uppercase; letter-spacing: .18em; font-weight: 600; height: 32px; padding: 6px 12px; }
  tr.subhead td { background: rgba(245,243,238,.45); font-weight: 600; }
  tr.grand-total td { background: rgba(245,243,238,.65); border-top: 2px solid var(--sand); font-weight: 600; height: 42px; }
  tr.dim { opacity: .4; }

  /* Confidence note — single line, subtle, matches on-screen */
  .note { font-size: 10px; line-height: 1.45; color: var(--stone); margin-top: 16px; }
  .note .label { font-weight: 600; color: var(--ink); }

  /* Landscape, tight margins so a typical ROM CAPEX summary fits on a
     single sheet when the user prints / saves to PDF. */
  @page { size: letter landscape; margin: 0.35in; }

  @media print {
    /* Force backgrounds, text colors, and border colors to print —
       Chrome/Edge strip them by default. */
    *, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { background: #fff; padding: 0; font-size: 9.5px; line-height: 1.35; }
    .wrap { border: none; box-shadow: none; padding: 0; max-width: none; }
    /* Tighten the hero for a single-page fit. */
    .hero { padding-bottom: 10px; margin-bottom: 12px; }
    .hero img.logo { width: 32px; height: 32px; margin-bottom: 2px; }
    .hero .wordmark { font-size: 14px; margin-bottom: 6px; }
    .hero h1 { font-size: 16px; }
    .hero .eyebrow { font-size: 12px; margin-top: 4px; }
    .hero .sub { font-size: 10px; margin-top: 4px; }
    /* Estimate cards: slightly tighter padding. */
    .cards { gap: 8px; margin-bottom: 12px; }
    .card { padding: 8px; }
    .card .big { font-size: 16px; }
    .card .bd { margin-top: 6px; font-size: 9.5px; }
    .card .pk { margin-top: 6px; padding-top: 6px; }
    .card .pk .pk-v { font-size: 11px; }
    /* Sections + tables — denser cells. */
    .section { margin-bottom: 12px; }
    .section-card .section-head-bar { padding: 6px 10px; font-size: 10px; }
    table { font-size: 9.5px; }
    th { padding: 4px 8px; height: 22px; }
    td { padding: 3px 8px; height: 22px; }
    tr.section-head td, tr.subhead td, tr.grand-total td { height: 24px; }
    /* Stronger borders so each section/table/card reads as a framed block
       on paper. The default sand at 60% alpha disappears on most printers. */
    .section-card, .card { border-color: #8c8676 !important; border-width: 1px !important; }
    th, td { border-color: #8c8676 !important; }
    td { border-top: 1px solid #c4beae !important; }
    tr.section-head td, tr.subhead td, tr.grand-total td { border-top: 1.5px solid #8c8676 !important; }
    .hero { border-bottom-color: #8c8676 !important; }
    .section-card .section-head-bar { border-bottom-color: #8c8676 !important; }
    .note { font-size: 8.5px; margin-top: 8px; }
    /* Don't slice rows or cards across pages */
    tr, .card, .section-card { page-break-inside: avoid; break-inside: avoid; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
  }
</style>
</head><body>
<div class="wrap">
  <div class="hero">
    <div class="date">${dateStr}</div>
    ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="Gencom" />` : ""}
    <div class="wordmark">Gencom</div>
    <h1>${escapeHtml(basics.name || "Untitled Property")}</h1>
    <div class="eyebrow">${escapeHtml(subtitle)}</div>
    <div class="sub">
      ${escapeHtml(address || "— address not set —")}
      ${basics.roomCount ? ` · <span class="keys">${nf.format(Number(basics.roomCount))}</span> keys` : ""}
      ${basics.brand ? ` · ${escapeHtml(basics.brand)}` : ""}
      ${basics.tier ? ` · ${escapeHtml(basics.tier)}` : ""}
    </div>
  </div>

  <div class="cards">
    ${cardsHtml}
  </div>

  <div class="section">
    <div class="section-card">
      <div class="section-head-bar">Hard Costs by Area</div>
      <table>
        <colgroup>${hardColgroup}</colgroup>
        <thead><tr>
          <th>Area</th><th>Scope</th>${numTh}
        </tr></thead>
        <tbody>
          <tr class="section-head"><td colspan="${colSpanTotal}">Deferred Maintenance &amp; Elevators</td></tr>
          ${dmRowsHtml}
          <tr class="subhead">
            <td colspan="${colSpanText}">Subtotal — Deferred Maintenance &amp; Elevators</td>
            ${numTds(dmSubtotal)}
          </tr>
          <tr class="section-head"><td colspan="${colSpanTotal}">Interior Renovation, IT, BOH &amp; Remaining Hard Costs</td></tr>
          ${interiorRowsHtml}
          <tr class="subhead">
            <td colspan="${colSpanText}">Subtotal — Interior &amp; Remaining Hard Costs</td>
            ${numTds(interiorSubtotal)}
          </tr>
          <tr class="grand-total">
            <td colspan="${colSpanText}">Hard Cost Subtotal</td>
            ${numTds(hardRange)}
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <div class="section-card">
      <div class="section-head-bar">Soft Costs</div>
      <table>
        <colgroup>${softColgroup}</colgroup>
        <thead><tr>
          <th>Line</th><th class="num">%</th><th>Basis</th>${numTh}
        </tr></thead>
        <tbody>
          ${softRowsHtml}
          <tr class="grand-total">
            <td colspan="3">Soft Cost Subtotal (ex. Development Fee)</td>
            ${numTds(otherSoftsRange)}
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  ${devFeeRows.length > 0 ? `
  <div class="section">
    <div class="section-card">
      <div class="section-head-bar">Development Fee</div>
      <table>
        <colgroup>${softColgroup}</colgroup>
        <thead><tr>
          <th>Line</th><th class="num">%</th><th>Basis</th>${numTh}
        </tr></thead>
        <tbody>
          ${devFeeRowsHtml}
          <tr class="grand-total">
            <td colspan="3">Development Fee Subtotal</td>
            ${numTds(devFeeRange)}
          </tr>
        </tbody>
      </table>
    </div>
  </div>` : ""}

  <div class="note">
    <span class="label">Confidence note.</span>
    ROM estimate based on high-level scope assumptions; ±25% accuracy typical at this stage. Detailed scope definition and contractor pricing required for firmer numbers.
    Benchmarks: ${escapeHtml(BENCHMARK_SOURCE)} · last updated ${BENCHMARK_LAST_UPDATED} · regional multiplier: ×${regionMult} (${escapeHtml(regionLabel)}).
  </div>
</div>
<script>
  // Auto-fire print dialog when the file is opened with #print in the URL
  // (the "Export to PDF" button uses this). When the file is opened
  // normally, it just renders without prompting.
  if (location.hash === "#print") {
    window.addEventListener("load", () => setTimeout(() => window.print(), 250));
  }
</script>
</body></html>`;

    const safeName = (basics.name || "property").replace(/[^\w\-]+/g, "_");
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    // Download the file for the user's records.
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}_ROM_CAPEX_${isoDate}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // For "Export to PDF": also open the blob in a new tab with #print so the
    // browser's print/save-as-PDF dialog opens automatically. Plain "Export
    // HTML" skips this and just downloads the file.
    if (autoPrint) {
      try {
        window.open(`${url}#print`, "_blank");
      } catch {
        // popup blocker — download is the fallback
      }
    }
    // Revoke later so the new window (if any) has time to load the URL.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---- Scope Description HTML export ---------------------------------
  // Mirrors the on-screen Scope Description page: same hero, then three
  // stacked cards (Low/Mid/High) each with a cost-breakdown header and
  // the AI-generated narrative. `autoPrint` controls whether the file
  // also opens with the print/save-as-PDF dialog (Export to PDF) or
  // just downloads (Export HTML).
  async function exportScopeDescriptionHtml(
    texts: { low: string; mid: string; high: string },
    opts: { autoPrint?: boolean } = {},
  ) {
    const autoPrint = opts.autoPrint ?? false;
    archiveCurrent();
    const isoDate = new Date().toISOString().slice(0, 10);
    const d = new Date();
    const dateStr = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`;
    const address = [basics.city, basics.stateOrCountry].filter(Boolean).join(", ");

    let logoSrc = "";
    try {
      const res = await fetch("/gencom-logo.png");
      if (res.ok) {
        const blob = await res.blob();
        logoSrc = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(typeof r.result === "string" ? r.result : "");
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
      }
    } catch {
      logoSrc = "";
    }

    const sections: Array<{ key: "low" | "mid" | "high"; label: string; total: number; hard: number; soft: number; perKey: number; text: string; highlight?: boolean }> = [
      { key: "low", label: "Low Estimate", total: grand.low, hard: hardRange.low, soft: softsRange.low, perKey: perKey.low, text: texts.low },
      { key: "mid", label: "Mid Estimate", total: grand.mid, hard: hardRange.mid, soft: softsRange.mid, perKey: perKey.mid, text: texts.mid, highlight: true },
      { key: "high", label: "High Estimate", total: grand.high, hard: hardRange.high, soft: softsRange.high, perKey: perKey.high, text: texts.high },
    ];

    const sectionsHtml = sections.map((s) => `
      <div class="scope-card${s.highlight ? " highlight" : ""}">
        <div class="scope-head">
          <div class="lbl">${escapeHtml(s.label)}</div>
          <div class="tot">${money(s.total)}</div>
        </div>
        <div class="scope-meta">
          <span>Hard ${money(s.hard)}</span>
          <span>Soft ${money(s.soft)}</span>
          <span>Per key <b>${money(s.perKey)}</b></span>
        </div>
        <div class="scope-body">${escapeHtml(s.text || "—").replace(/\n/g, "<br>")}</div>
      </div>`).join("");

    const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>${escapeHtml(basics.name || "Property")} — High-Level Scope Description — ${isoDate}</title>
<style>
  :root { --ink:#1a1d24; --stone:#6b6f78; --sand:#d9d4c8; --mist:#f5f3ee; --gold:#b89555; --emerald:#047857; }
  * { box-sizing: border-box; }
  body { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--mist); margin: 0; padding: 32px; font-size: 14px; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: 960px; margin: 0 auto; background: #fff; border: 1px solid var(--sand); border-radius: 12px; padding: 28px; box-shadow: 0 1px 2px rgba(0,0,0,.05); }

  .hero { position: relative; padding-bottom: 20px; border-bottom: 1px solid var(--sand); margin-bottom: 24px; text-align: center; }
  .hero .date { position: absolute; top: 0; right: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--stone); }
  .hero img.logo { width: 48px; height: 48px; border-radius: 999px; object-fit: contain; border: 1px solid var(--sand); display: block; margin: 0 auto 4px; }
  .hero .wordmark { font-family: "Playfair Display", "Cormorant Garamond", Garamond, Georgia, serif; font-size: 22px; line-height: 1; margin-bottom: 18px; }
  .hero h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .hero .eyebrow { color: var(--gold); font-size: 16px; text-transform: uppercase; letter-spacing: .22em; font-weight: 700; margin-top: 8px; }
  .hero .sub { color: var(--stone); font-size: 13px; margin-top: 8px; }
  .hero .sub .keys { color: var(--ink); font-weight: 600; }

  .scope-card { border: 1px solid var(--sand); border-radius: 8px; overflow: hidden; background: #fff; margin-bottom: 16px; }
  .scope-card.highlight { background: linear-gradient(135deg, #ecfdf5, rgba(209,250,229,.4)); }
  .scope-head { display: flex; align-items: baseline; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--sand); background: rgba(245,243,238,.4); }
  .scope-head .lbl { color: var(--stone); font-size: 11px; text-transform: uppercase; letter-spacing: .18em; font-weight: 600; }
  .scope-head .tot { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .scope-meta { padding: 4px 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--stone); font-variant-numeric: tabular-nums; display: flex; gap: 16px; flex-wrap: wrap; }
  .scope-meta b { color: var(--ink); font-weight: 600; }
  .scope-body { padding: 14px 16px; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }

  @page { size: letter; margin: 0.5in; }
  @media print {
    *, *::before, *::after { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { background: #fff; padding: 0; font-size: 12px; }
    .wrap { border: none; box-shadow: none; padding: 0; max-width: none; }
    .scope-card { page-break-inside: avoid; break-inside: avoid; border-color: #8c8676 !important; }
    .scope-head, .hero { border-color: #8c8676 !important; }
  }
</style>
</head><body>
<div class="wrap">
  <div class="hero">
    <div class="date">${dateStr}</div>
    ${logoSrc ? `<img class="logo" src="${logoSrc}" alt="Gencom" />` : ""}
    <div class="wordmark">Gencom</div>
    <h1>${escapeHtml(basics.name || "Untitled Property")}</h1>
    <div class="eyebrow">High-Level Scope Description</div>
    <div class="sub">
      ${escapeHtml(address || "— address not set —")}
      ${basics.roomCount ? ` · <span class="keys">${nf.format(Number(basics.roomCount))}</span> keys` : ""}
      ${basics.brand ? ` · ${escapeHtml(basics.brand)}` : ""}
      ${basics.tier ? ` · ${escapeHtml(basics.tier)}` : ""}
    </div>
  </div>
  ${sectionsHtml}
</div>
<script>
  if (location.hash === "#print") {
    window.addEventListener("load", () => setTimeout(() => window.print(), 250));
  }
</script>
</body></html>`;

    const safeName = (basics.name || "property").replace(/[^\w\-]+/g, "_");
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}_Scope_Description_${isoDate}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (autoPrint) {
      try { window.open(`${url}#print`, "_blank"); } catch { /* popup blocked */ }
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---- PPTX export (via backend; falls back to an auto-generated deck if
  //      no branded template is dropped in backend/templates/) ---------------
  async function exportPptx() {
    archiveCurrent();
    const today = new Date().toISOString().slice(0, 10);
    const safeName = (basics.name || "property").replace(/[^\w\-]+/g, "_");

    const devFeeLines = softsApplied.filter((s) => s.row.key === "development_fee");
    const otherSoftLines = softsApplied.filter((s) => s.row.key !== "development_fee");
    const sumOf = (rows: typeof softsApplied): Range =>
      rows.reduce(
        (a, s) => ({ low: a.low + s.range.low, mid: a.mid + s.range.mid, high: a.high + s.range.high }),
        { low: 0, mid: 0, high: 0 },
      );
    const devFeeRange = sumOf(devFeeLines);
    const otherSoftsRange = sumOf(otherSoftLines);
    const dmLines = lines.filter((l) => {
      const k = l.key.replace(/_ffe$/, "");
      return AREA_BY_KEY[k]?.category === "dm";
    });
    const interiorLines = lines.filter((l) => {
      const k = l.key.replace(/_ffe$/, "");
      return AREA_BY_KEY[k]?.category !== "dm";
    });

    const lineCategoryOf = (l: ComputedLine): "dm" | "interior" | "custom" => {
      if (l.key.startsWith("custom_")) return "custom";
      const k = l.key.replace(/_ffe$/, "");
      return AREA_BY_KEY[k]?.category === "dm" ? "dm" : "interior";
    };

    try {
      const blob = await api.fastBudgetExportPptx({
        name: basics.name,
        city: basics.city || null,
        state_or_country: basics.stateOrCountry || null,
        brand: basics.brand || null,
        tier: basics.tier || null,
        property_type: basics.propertyType || null,
        room_count: basics.roomCount === "" ? null : Number(basics.roomCount),
        suite_count: basics.suiteCount === "" ? null : Number(basics.suiteCount),
        year_built: basics.yearBuilt === "" ? null : Number(basics.yearBuilt),
        last_renovation: basics.lastRenovation === "" ? null : Number(basics.lastRenovation),
        region_key: basics.regionKey || null,
        hard_range: hardRange,
        softs_range: otherSoftsRange,
        dev_fee_range: devFeeRange,
        grand_range: grand,
        per_key_range: perKey,
        dm_subtotal: sumRange(dmLines),
        interior_subtotal: sumRange(interiorLines),
        lines: lines.map((l) => ({
          area: l.area,
          scope: l.scope,
          low: l.lowTotal,
          mid: l.midTotal,
          high: l.highTotal,
          category: lineCategoryOf(l),
        })),
        softs: otherSoftLines.map((s) => ({
          label: s.row.label,
          pct: s.row.enabled ? s.row.pct : null,
          basis: s.row.basis,
          low: s.range.low,
          mid: s.range.mid,
          high: s.range.high,
        })),
        dev_fee_rows: devFeeLines.map((s) => ({
          label: s.row.label,
          pct: s.row.enabled ? s.row.pct : null,
          basis: s.row.basis,
          low: s.range.low,
          mid: s.range.mid,
          high: s.range.high,
        })),
        scope_low: null,
        scope_mid: null,
        scope_high: null,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}_ROM_CAPEX_${today}.pptx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      window.alert(`PPT export failed: ${e?.message ?? e}`);
    }
  }

  // ---- render ---------------------------------------------------------
  return (
    <div className="-mt-4">
      {/* Full-bleed container: break out of the app shell's padding so the
          greyed-out peek panes extend all the way to the viewport edges.
          Viewport-relative padding keeps the current pane centered as the
          window resizes. */}
      <div
        className="relative overflow-hidden"
        style={{
          width: "100vw",
          left: "50%",
          marginLeft: "-50vw",
          paddingLeft: `max(1rem, calc(50vw - ${PANE_WIDTH / 2}px))`,
          paddingRight: `max(1rem, calc(50vw - ${PANE_WIDTH / 2}px))`,
        }}
      >
        <motion.div
          className="flex items-start touch-pan-y"
          style={{ gap: `${PANE_GAP}px` }}
          animate={{ x: -(step - 1) * PANE_SLOT }}
          transition={PAGE_TRANSITION}
          drag="x"
          dragConstraints={{
            left: -(totalSteps - 1) * PANE_SLOT,
            right: 0,
          }}
          dragElastic={0.15}
          onDragEnd={handleDragEnd}
        >
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => {
            const isCurrent = n === step;
            const isAdjacent = Math.abs(n - step) === 1;
            return (
              <div
                key={n}
                className={`flex-none transition-opacity duration-700 ${
                  isCurrent ? "opacity-100" : "opacity-60 hover:opacity-80"
                } ${isAdjacent ? "cursor-pointer" : ""}`}
                style={{ width: `${PANE_WIDTH}px` }}
                onClick={isAdjacent ? () => goToStep(n) : undefined}
                aria-hidden={!isCurrent}
              >
                <div className={isCurrent ? "" : "pointer-events-none select-none"}>
                  {renderPane(n)}
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>
    </div>
  );

  function renderPane(n: number) {
    const p = panes[n - 1];
    if (!p) return null;
    const paneIsBasics = p.kind === "basics";
    const paneIsReview = p.kind === "review";
    const paneTitle = titleFor(n);

    // The "regular" panes (basics, every area, custom areas, soft costs)
    // share a common min-height so their bottoms line up across the
    // wizard's horizontal track. Scope Picker, Review, and Scope
    // Description are exempted because their content runs much longer
    // and forcing a min-height would just leave awkward whitespace.
    const alignedKinds: Pane["kind"][] = ["basics", "area", "custom_areas", "soft_costs"];
    const alignBottom = alignedKinds.includes(p.kind);
    return (
      <div className="flex items-start justify-center">
        <div
          className={`bg-white rounded-xl border border-gencom-sand p-5 shadow-sm w-full flex flex-col ${
            alignBottom ? "h-[760px]" : ""
          }`}
        >
          <StepHeader
            step={n}
            total={totalSteps}
            title={paneTitle}
            titleFor={titleFor}
            onJump={goToStep}
          />
          {/* Inner scroll container — for aligned panes the card height is
              fixed at 760px, so any content longer than that scrolls inside
              while the nav row below stays pinned to the same Y on every
              page. Exempt panes flow naturally. */}
          <div className={alignBottom ? "flex-1 min-h-0 overflow-y-auto pr-1" : ""}>

          {p.kind === "basics" && (
            <PropertyBasicsStep
              basics={basics}
              setBasics={(b) => {
                setBasics(b);
                setInputs((prev) => {
                  const next = { ...prev };
                  const rc = Number(b.roomCount) || 0;
                  const sc = Number(b.suiteCount) || 0;
                  const floors = Number(b.floors) || 0;
                  for (const a of AREAS) {
                    const empty = !prev[a.key] || prev[a.key].sf === "";
                    // Per-floor areas always track the basics floor count —
                    // if the user enters or Claude pulls a value, the
                    // Guest Corridors step reflects it immediately.
                    if (a.unit === "per_floor" && floors > 0) {
                      next[a.key] = { ...prev[a.key], sf: floors };
                    } else if (a.sf_default && rc > 0 && empty) {
                      next[a.key] = { ...prev[a.key], sf: a.sf_default(rc, sc) };
                    }
                  }
                  return next;
                });
              }}
              enriching={enriching}
              enrichError={enrichError}
              enrichNote={enrichNote}
              onEnrich={runEnrich}
            />
          )}

          {p.kind === "scope_picker" && (
            <ScopePickerStep
              inputs={inputs}
              setInputs={setInputs}
              onPutInNewSpace={() => {
                const id = Math.random().toString(36).slice(2, 9);
                setCustomAreas([
                  ...customAreas,
                  { id, name: "New Space", low: 0, mid: 0, high: 0, notes: "", designBasis: true },
                ]);
                goToKind("custom_areas");
              }}
            />
          )}

          {p.kind === "area" && (
            <AreaStep
              area={p.area}
              basics={basics}
              input={inputs[p.area.key]}
              setInput={(next) => setInputs((prev) => ({ ...prev, [p.area.key]: next }))}
              onAdvance={goNext}
              scopePct={scopePct}
              onApplyToAll={(s) => {
                setInputs((prev) => {
                  const next = { ...prev };
                  for (const a of AREAS) {
                    if (next[a.key]?.include) next[a.key] = { ...next[a.key], scope: s };
                  }
                  return next;
                });
              }}
              onOverrideScopes={(next) => setScopePct(next)}
            />
          )}

          {p.kind === "custom_areas" && (
            <CustomAreasStep customAreas={customAreas} setCustomAreas={setCustomAreas} />
          )}

          {p.kind === "soft_costs" && (
            <SoftCostsStep softs={softs} setSofts={setSofts} hardRange={hardRange} />
          )}

          {p.kind === "review" && (
            <ReviewStep
              basics={basics}
              lines={lines}
              softsApplied={softsApplied}
              hardRange={hardRange}
              softsRange={softsRange}
              grand={grand}
              perKey={perKey}
              perSf={perSf}
              onExport={exportExcel}
              onExportHtml={exportHtml}
              onExportPptx={exportPptx}
            />
          )}

          {p.kind === "scope_description" && (
            <ScopeDescriptionStep
              basics={basics}
              includedAreaNames={AREAS.filter((a) => inputs[a.key]?.include).map((a) => a.name)}
              grand={grand}
              hardRange={hardRange}
              softsRange={softsRange}
              perKey={perKey}
              onExportHtml={exportScopeDescriptionHtml}
            />
          )}
          </div>

          <div className={`mt-8 flex items-center gap-3 ${alignBottom ? "mt-0 pt-4" : ""}`}>
            <div className="flex-1">
              <button
                onClick={goPrev}
                disabled={n === 1}
                className="t-body px-4 py-2 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 disabled:opacity-40"
              >
                ← Back
              </button>
            </div>
            <div className="flex items-center gap-2 justify-center">
              {p.kind !== "review" && p.kind !== "scope_description" && (
                <button
                  onClick={skipToReview}
                  className="t-eyebrow px-3 py-1.5 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white"
                  title="Skip remaining area steps and generate budget with current inputs"
                >
                  Skip to Review →
                </button>
              )}
              {/* Step 1 swaps Start Over for the Archive picker — recall a
                  prior project before doing anything else. Later steps keep
                  the Start Over button. */}
              {n === 1 ? (
                <ArchiveButton
                  archive={archive}
                  onLoad={(snap) => {
                    const ok = window.confirm(
                      `Load "${snap.name}"? This will replace everything currently entered.`,
                    );
                    if (ok) loadFromArchive(snap);
                  }}
                  onDelete={deleteFromArchive}
                />
              ) : (
                p.kind !== "review" && p.kind !== "scope_description" && (
                  <button
                    onClick={startOver}
                    className="t-eyebrow px-3 py-1.5 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white"
                    title="Reset inputs and return to Step 1"
                  >
                    ↺ Start Over
                  </button>
                )
              )}
              <button
                onClick={clearAll}
                className="t-eyebrow px-3 py-1.5 border border-red-300 bg-red-50 text-red-700 rounded-md hover:bg-red-100"
                title="Clear all information on this page"
              >
                Clear All
              </button>
            </div>
            <div className="flex-1 flex justify-end">
              {n < totalSteps && (
                <button
                  onClick={goNext}
                  disabled={paneIsBasics && !basicsDone}
                  className="t-body font-semibold px-4 py-2 bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-50"
                >
                  {panes[n]?.kind === "review"
                    ? "Review →"
                    : panes[n]?.kind === "scope_description"
                      ? "Scope Description →"
                      : "Next →"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

function OverrideMenu({
  current, onApply, open, onOpenChange,
}: {
  current: { minor: number; partial: number; full: number };
  onApply: (next: { minor: number; partial: number; full: number }) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [minor, setMinor] = useState(String(current.minor));
  const [partial, setPartial] = useState(String(current.partial));
  const [full, setFull] = useState(String(current.full));

  // Re-seed local state from props each time the menu opens.
  useEffect(() => {
    if (open) {
      setMinor(String(current.minor));
      setPartial(String(current.partial));
      setFull(String(current.full));
    }
  }, [open, current.minor, current.partial, current.full]);

  // Close when the user clicks anywhere outside the menu container.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        onOpenChange(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onOpenChange]);

  function apply() {
    const clamp = (s: string) => {
      const n = Number(s);
      if (!Number.isFinite(n)) return 100;
      return Math.max(25, Math.min(300, n));
    };
    onApply({ minor: clamp(minor), partial: clamp(partial), full: clamp(full) });
    onOpenChange(false);
  }
  function reset() {
    setMinor("100"); setPartial("100"); setFull("100");
    onApply({ minor: 100, partial: 100, full: 100 });
    onOpenChange(false);
  }
  const dirty = current.minor !== 100 || current.partial !== 100 || current.full !== 100;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`t-eyebrow px-3 py-1 rounded-md border transition ${
          dirty
            ? "border-emerald-700 bg-emerald-50 text-emerald-700"
            : "border-gencom-sand hover:border-emerald-700 hover:bg-emerald-50"
        }`}
        title="Override cost per scope level across every area"
      >
        Override ▾
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 w-64 p-3 bg-white border border-gencom-sand rounded-md shadow-lg">
          <div className="t-eyebrow mb-2">Cost Override (all areas)</div>
          <div className="t-micro mb-2">
            Enter a % of the benchmark to apply per scope level. 100 = no change.
          </div>
          <div className="space-y-1.5">
            <ScopePctInput label="Minor"   value={minor}   setValue={setMinor} />
            <ScopePctInput label="Partial" value={partial} setValue={setPartial} />
            <ScopePctInput label="Full"    value={full}    setValue={setFull} />
          </div>
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={reset}
              className="t-micro underline underline-offset-2 hover:text-gencom-ink"
            >
              reset
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="t-eyebrow px-2 py-1 rounded-md border border-gencom-sand hover:bg-gencom-mist/60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="t-eyebrow px-2 py-1 rounded-md border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScopePctInput({
  label, value, setValue,
}: { label: string; value: string; setValue: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="t-eyebrow w-16">{label}</span>
      <input
        type="number"
        min={25}
        max={300}
        step={5}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 px-2 py-1 text-xs border border-gencom-sand rounded-md bg-white focus:ring-2 focus:ring-gencom-gold/40"
      />
      <span className="t-micro">%</span>
    </label>
  );
}

// Per-area manual $ override. When a value is set, the benchmark × qty math
// is replaced by that fixed total for that scope level, for THIS area only.
// Auto-derive Minor/Partial/Full from any one entered value using the
// convention Partial = 100%, Minor = 80%, Full = 120%. Given one anchor
// field and its value, derive the other two.
function deriveFromAnchor(
  anchor: "minor" | "partial" | "full",
  val: number,
): { minor: number; partial: number; full: number } {
  if (!Number.isFinite(val) || val <= 0) return { minor: 0, partial: 0, full: 0 };
  let partial: number;
  if (anchor === "partial") partial = val;
  else if (anchor === "minor") partial = val / 0.8;
  else partial = val / 1.2;
  return {
    minor: Math.round(partial * 0.8),
    partial: Math.round(partial),
    full: Math.round(partial * 1.2),
  };
}

function ManualMenu({
  current, onApply, open, onOpenChange,
}: {
  current: AreaInput["manual"];
  onApply: (next: AreaInput["manual"]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [minor, setMinor] = useState(String(current?.minor ?? ""));
  const [partial, setPartial] = useState(String(current?.partial ?? ""));
  const [full, setFull] = useState(String(current?.full ?? ""));
  // When ON, typing in any one field auto-derives the other two using
  // Partial=100% / Minor=80% / Full=120%. Toggle off to enter each
  // independently (a "fixed number" per step, per the spec).
  const [autoLink, setAutoLink] = useState(true);

  // Re-seed local state from props each time the menu opens.
  useEffect(() => {
    if (open) {
      setMinor(String(current?.minor ?? ""));
      setPartial(String(current?.partial ?? ""));
      setFull(String(current?.full ?? ""));
    }
  }, [open, current?.minor, current?.partial, current?.full]);

  // Close when clicking anywhere outside.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        onOpenChange(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onOpenChange]);

  function onChangeField(which: "minor" | "partial" | "full", s: string) {
    if (which === "minor") setMinor(s);
    else if (which === "partial") setPartial(s);
    else setFull(s);

    if (!autoLink) return;

    const n = Number(s.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return;
    const derived = deriveFromAnchor(which, n);
    // Update only the non-anchor fields so the anchor stays exactly as typed.
    if (which !== "minor") setMinor(String(derived.minor));
    if (which !== "partial") setPartial(String(derived.partial));
    if (which !== "full") setFull(String(derived.full));
  }

  function apply() {
    const parse = (s: string): number | "" => {
      const t = s.trim();
      if (t === "") return "";
      const n = Number(t.replace(/[$,\s]/g, ""));
      return Number.isFinite(n) && n > 0 ? Math.round(n) : "";
    };
    onApply({ minor: parse(minor), partial: parse(partial), full: parse(full) });
    onOpenChange(false);
  }
  function clear() {
    setMinor(""); setPartial(""); setFull("");
    onApply(undefined);
    onOpenChange(false);
  }
  const dirty =
    (typeof current?.minor === "number" && current.minor > 0) ||
    (typeof current?.partial === "number" && current.partial > 0) ||
    (typeof current?.full === "number" && current.full > 0);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`t-eyebrow px-3 py-1 rounded-md border transition ${
          dirty
            ? "border-emerald-700 bg-emerald-50 text-emerald-700"
            : "border-gencom-sand hover:border-emerald-700 hover:bg-emerald-50"
        }`}
        title="Enter a fixed $ amount for each scope level on this area only"
      >
        Manual ▾
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 w-80 p-3 bg-white border border-gencom-sand rounded-md shadow-lg">
          <div className="t-eyebrow mb-2">Manual Cost (this area only)</div>
          <div className="t-micro mb-2">
            Enter a fixed total $ for any scope level. With auto-fill on, the other two derive at ±20% (Minor = ‑20%, Partial = 0%, Full = +20%). Leave all blank to use the benchmark.
          </div>
          <label className="flex items-center gap-2 t-micro mb-2 select-none">
            <input
              type="checkbox"
              checked={autoLink}
              onChange={(e) => setAutoLink(e.target.checked)}
              className="accent-emerald-700"
            />
            Auto-fill ±20% from the value I type
          </label>
          <div className="space-y-1.5">
            <ManualMoneyInput label="Minor"   value={minor}   setValue={(v) => onChangeField("minor", v)} />
            <ManualMoneyInput label="Partial" value={partial} setValue={(v) => onChangeField("partial", v)} />
            <ManualMoneyInput label="Full"    value={full}    setValue={(v) => onChangeField("full", v)} />
          </div>
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={clear}
              className="t-micro underline underline-offset-2 hover:text-gencom-ink"
            >
              clear
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="t-eyebrow px-2 py-1 rounded-md border border-gencom-sand hover:bg-gencom-mist/60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="t-eyebrow px-2 py-1 rounded-md border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Per-unit override — single $ input that replaces benchmark + scope
// selection for `per_key` and `per_floor` areas. The entered value is the
// PARTIAL baseline; Minor and Full are auto-derived at ±20%. When set,
// the area uses these numbers regardless of which scope card is active.
function PerUnitOverrideMenu({
  current, onApply, open, onOpenChange, unitLabel: unitName,
}: {
  current?: number | null;
  onApply: (next: number | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitLabel: string; // "key" or "floor"
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [val, setVal] = useState(String(current ?? ""));

  useEffect(() => {
    if (open) setVal(String(current ?? ""));
  }, [open, current]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        onOpenChange(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onOpenChange]);

  function apply() {
    const n = Number(val.replace(/[^\d]/g, ""));
    onApply(Number.isFinite(n) && n > 0 ? Math.round(n) : null);
    onOpenChange(false);
  }
  function clear() {
    setVal("");
    onApply(null);
    onOpenChange(false);
  }
  const dirty = typeof current === "number" && current > 0;
  const display = (() => {
    const digits = val.replace(/[^\d]/g, "");
    return digits ? Number(digits).toLocaleString("en-US") : "";
  })();
  const minor = Math.round(Number(val.replace(/[^\d]/g, "") || 0) * 0.8);
  const full = Math.round(Number(val.replace(/[^\d]/g, "") || 0) * 1.2);
  const labelTitle = `Per ${unitName} cost`;
  const buttonText = `Per ${unitName.toUpperCase()} ▾`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={`t-eyebrow px-3 py-1 rounded-md border transition ${
          dirty
            ? "border-emerald-700 bg-emerald-50 text-emerald-700"
            : "border-gencom-sand hover:border-emerald-700 hover:bg-emerald-50"
        }`}
        title={`Enter a single ${labelTitle.toLowerCase()}; Minor/Full auto-derive at ±20%`}
      >
        {buttonText}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 left-0 w-72 p-3 bg-white border border-gencom-sand rounded-md shadow-lg">
          <div className="t-eyebrow mb-2">{labelTitle} (this area only)</div>
          <div className="t-micro mb-2">
            Enter your $ per {unitName}. Minor and Full auto-derive at −20% / +20%.
            Replaces benchmark, manual, and scope selection.
          </div>
          <label className="flex items-center gap-2">
            <span className="t-micro">$</span>
            <input
              type="text"
              inputMode="numeric"
              value={display}
              onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="—"
              className="flex-1 px-2 py-1 text-xs font-mono border border-gencom-sand rounded-md bg-white focus:ring-2 focus:ring-gencom-gold/40"
            />
            <span className="t-micro">/ {unitName}</span>
          </label>
          {Number(val) > 0 && (
            <div className="mt-2 text-[11px] text-gencom-stone font-mono">
              Minor ${minor.toLocaleString()} · Partial ${Number(val.replace(/[^\d]/g, "") || 0).toLocaleString()} · Full ${full.toLocaleString()} (per {unitName})
            </div>
          )}
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={clear}
              className="t-micro underline underline-offset-2 hover:text-gencom-ink"
            >
              clear
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="t-eyebrow px-2 py-1 rounded-md border border-gencom-sand hover:bg-gencom-mist/60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="t-eyebrow px-2 py-1 rounded-md border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualMoneyInput({
  label, value, setValue,
}: { label: string; value: string; setValue: (v: string) => void }) {
  // Show grouped commas while typing so large dollar amounts are readable.
  // We keep the underlying state stripped of commas — callers parse it.
  const display = (() => {
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) return "";
    return Number(digits).toLocaleString("en-US");
  })();
  return (
    <label className="flex items-center gap-2">
      <span className="t-eyebrow w-16">{label}</span>
      <span className="t-micro">$</span>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
        placeholder="—"
        className="flex-1 px-2 py-1 text-xs font-mono border border-gencom-sand rounded-md bg-white focus:ring-2 focus:ring-gencom-gold/40"
      />
    </label>
  );
}

// ---------- Step: Scope Picker --------------------------------------------
function ScopePickerStep({
  inputs, setInputs, onPutInNewSpace,
}: {
  inputs: Record<string, AreaInput>;
  setInputs: (updater: (prev: Record<string, AreaInput>) => Record<string, AreaInput>) => void;
  onPutInNewSpace: () => void;
}) {
  function toggle(key: string) {
    setInputs((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? emptyAreaInput()), include: !prev[key]?.include },
    }));
  }
  function selectAll() {
    setInputs((prev) => {
      const next: Record<string, AreaInput> = { ...prev };
      for (const a of AREAS) {
        next[a.key] = { ...(next[a.key] ?? emptyAreaInput()), include: true };
      }
      return next;
    });
  }
  function deselectAll() {
    setInputs((prev) => {
      const next: Record<string, AreaInput> = { ...prev };
      for (const a of AREAS) {
        if (next[a.key]) next[a.key] = { ...next[a.key], include: false };
      }
      return next;
    });
  }
  const dm = AREAS.filter((a) => a.category === "dm");
  const interior = AREAS.filter((a) => a.category === "interior");
  const selectedCount = AREAS.filter((a) => inputs[a.key]?.include).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="t-body text-gencom-stone">
          Click each area to include it in the budget. Unselected areas are removed from the step list.
        </div>
        <div className="t-eyebrow whitespace-nowrap shrink-0">
          <span className="font-semibold text-gencom-ink">{selectedCount}</span> / {AREAS.length} selected
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={selectAll}
          className="t-eyebrow px-3 py-1.5 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={deselectAll}
          className="t-eyebrow px-3 py-1.5 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 bg-white"
        >
          Deselect all
        </button>
      </div>

      <div className="mb-4">
        <div className="t-eyebrow mb-2">Deferred Maintenance</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {dm.map((a) => (
            <ScopeTile
              key={a.key}
              area={a}
              selected={inputs[a.key]?.include ?? false}
              onClick={() => toggle(a.key)}
            />
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="t-eyebrow mb-2">Interior Renovation, Systems, IT & BOH</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {interior.map((a) => (
            <ScopeTile
              key={a.key}
              area={a}
              selected={inputs[a.key]?.include ?? false}
              onClick={() => toggle(a.key)}
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onPutInNewSpace}
        className="t-body font-semibold mt-2 px-4 py-2 border border-emerald-700 text-emerald-700 rounded-md hover:bg-emerald-50"
      >
        + Put in new space
      </button>
    </div>
  );
}

function ScopeTile({
  area, selected, onClick,
}: { area: AreaDef; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 border rounded-md transition ${
        selected
          ? "border-emerald-700 bg-emerald-50"
          : "border-gencom-sand bg-white hover:border-gencom-stone/60 hover:bg-gencom-mist/40"
      }`}
    >
      <div className="flex items-start gap-2">
        <div
          className={`mt-0.5 w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center text-[10px] font-bold ${
            selected ? "border-emerald-700 bg-emerald-700 text-white" : "border-gencom-sand bg-white"
          }`}
        >
          {selected ? "✓" : ""}
        </div>
        <div className="min-w-0">
          <div className="t-body font-semibold truncate">{area.name}</div>
          <div className="t-micro truncate">{area.description}</div>
        </div>
      </div>
    </button>
  );
}

// ---------- Step: Property Basics -----------------------------------------
function PropertyBasicsStep({
  basics, setBasics, enriching, enrichError, enrichNote, onEnrich,
}: {
  basics: PropertyBasics;
  setBasics: (b: PropertyBasics) => void;
  enriching: boolean;
  enrichError: string | null;
  enrichNote: string | null;
  onEnrich: () => void;
}) {
  const hasName = basics.name.trim().length > 0;
  // Start expanded if the user is returning with data already entered; else
  // stay collapsed until they pick AI or Manual fill.
  const hasAnyOtherField =
    basics.city.trim() !== "" ||
    basics.stateOrCountry.trim() !== "" ||
    basics.brand !== "" ||
    basics.roomCount !== "" ||
    basics.suiteCount !== "" ||
    basics.floors !== "" ||
    basics.yearBuilt !== "" ||
    basics.lastRenovation !== "" ||
    basics.grossSf !== "";
  const [expanded, setExpanded] = useState(hasAnyOtherField);
  // If the wizard clears everything (Start Over / Clear All), snap back to
  // the collapsed name-only state.
  useEffect(() => {
    if (!hasName && !hasAnyOtherField) setExpanded(false);
  }, [hasName, hasAnyOtherField]);

  function openAi() {
    if (!hasName || enriching) return;
    setExpanded(true);
    onEnrich();
  }
  function openManual() {
    if (!hasName) return;
    setExpanded(true);
  }

  return (
    <div>
      <div className="mb-4">
        <div className="t-eyebrow mb-1">Property Name</div>
        <div className="flex gap-2">
          <input
            className={`${inputCls} flex-1`}
            value={basics.name}
            onChange={(e) => setBasics({ ...basics, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !expanded && hasName) openManual();
            }}
            placeholder="e.g. Four Seasons Miami"
            autoFocus
          />
          <button
            type="button"
            onClick={openAi}
            disabled={!hasName || enriching}
            className="t-body font-semibold shrink-0 px-4 py-2 bg-gencom-gold text-gencom-ink rounded-md hover:bg-gencom-gold/80 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            title={hasName ? "Let Claude populate the remaining fields" : "Enter a hotel name first"}
          >
            {enriching ? "Looking up…" : "AI Auto Fill"}
          </button>
          <button
            type="button"
            onClick={openManual}
            disabled={!hasName}
            className="t-body font-semibold shrink-0 px-4 py-2 border border-gencom-sand bg-white rounded-md hover:bg-gencom-mist/60 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            title={hasName ? "Fill the remaining fields yourself" : "Enter a hotel name first"}
          >
            Manual Fill
          </button>
        </div>
      </div>

      {enrichNote && (
        <div className="mb-4 text-xs text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-md px-3 py-2">
          {enrichNote}
        </div>
      )}
      {enrichError && (
        <div className="mb-4 text-xs text-red-800 bg-red-50 border border-red-300 rounded-md px-3 py-2">
          AI lookup failed: {enrichError}
        </div>
      )}

      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="City">
            <input className={inputCls} value={basics.city}
              onChange={(e) => setBasics({ ...basics, city: e.target.value })} />
          </Field>
          <Field label="State / Country">
            <input className={inputCls} value={basics.stateOrCountry}
              onChange={(e) => setBasics({ ...basics, stateOrCountry: e.target.value })} />
          </Field>
          <Field label="Brand / Flag">
            <select className={inputCls} value={basics.brand}
              onChange={(e) => {
                const b = e.target.value;
                const t = BRAND_TIER_BY_BRAND[b] ?? basics.tier;
                setBasics({ ...basics, brand: b, tier: t });
              }}>
              <option value="">— Select —</option>
              {BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Brand Tier (editable)">
            <select className={inputCls} value={basics.tier}
              onChange={(e) => setBasics({ ...basics, tier: e.target.value as BrandTier })}>
              {BRAND_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Property Type">
            <select className={inputCls} value={basics.propertyType}
              onChange={(e) => setBasics({ ...basics, propertyType: e.target.value as PropertyBasics["propertyType"] })}>
              <option value="">— Select —</option>
              {["Urban High-Rise", "Resort", "Airport", "Suburban", "Conversion"].map((t) =>
                <option key={t} value={t}>{t}</option>
              )}
            </select>
          </Field>
          <Field label="Room Count">
            <input type="number" min={1} className={inputCls} value={basics.roomCount}
              onChange={(e) => setBasics({ ...basics, roomCount: e.target.value === "" ? "" : Number(e.target.value) })} />
          </Field>
          <Field label="Suite Count" hint="Subset of room count">
            <input type="number" min={0} className={inputCls} value={basics.suiteCount}
              onChange={(e) => setBasics({ ...basics, suiteCount: e.target.value === "" ? "" : Number(e.target.value) })} />
          </Field>
          <Field label="Floor Count">
            <input type="number" min={1} className={inputCls} value={basics.floors}
              onChange={(e) => setBasics({ ...basics, floors: e.target.value === "" ? "" : Number(e.target.value) })} />
          </Field>
          <Field label="Year Built">
            <input type="number" className={inputCls} value={basics.yearBuilt}
              onChange={(e) => setBasics({ ...basics, yearBuilt: e.target.value === "" ? "" : Number(e.target.value) })} />
          </Field>
          <Field label="Year of Last Major Renovation">
            <input type="number" className={inputCls} value={basics.lastRenovation}
              onChange={(e) => setBasics({ ...basics, lastRenovation: e.target.value === "" ? "" : Number(e.target.value) })} />
          </Field>
          <Field label="Gross Building SF" hint="Optional — estimated from room count if blank">
            <input type="number" className={inputCls} value={basics.grossSf}
              onChange={(e) => setBasics({ ...basics, grossSf: e.target.value === "" ? "" : Number(e.target.value) })} />
          </Field>
          <Field label="Region (cost multiplier)">
            <select className={inputCls} value={basics.regionKey}
              onChange={(e) => setBasics({ ...basics, regionKey: e.target.value })}>
              {Object.entries(REGIONAL_MULTIPLIERS).map(([k, v]) =>
                <option key={k} value={k}>{k} (×{v})</option>
              )}
            </select>
          </Field>
        </div>
      )}
    </div>
  );
}

// ---------- Step: Single Area ---------------------------------------------
function AreaStep({
  area, basics, input, setInput, onAdvance, onApplyToAll, onOverrideScopes, scopePct,
}: {
  area: AreaDef;
  basics: PropertyBasics;
  input: AreaInput;
  setInput: (i: AreaInput) => void;
  onAdvance?: () => void;
  onApplyToAll?: (s: Exclude<ScopeLevel, "none">) => void;
  onOverrideScopes?: (next: { minor: number; partial: number; full: number }) => void;
  scopePct: { minor: number; partial: number; full: number };
}) {
  const ranges = area.ranges[basics.tier];
  const rc = Number(basics.roomCount) || 0;
  const sc = Number(basics.suiteCount) || 0;
  const adj = input.adjust ?? 1;
  const ptMult = propertyTypeMultiplier(basics.propertyType, area.key);
  // Mutual-exclusion state for the menu strip — at most one popover open.
  const [openMenu, setOpenMenu] = useState<"override" | "manual" | "perUnit" | null>(null);
  const supportsPerUnitOverride = area.unit === "per_key" || area.unit === "per_floor";
  const perUnitName = area.unit === "per_floor" ? "floor" : "key";
  const qtyForScope = (s: Exclude<ScopeLevel, "none">) => {
    const base = ranges[s];
    const sMult = (scopePct[s] ?? 100) / 100;
    const combined = adj * sMult * ptMult;
    const r: Range = {
      low: Math.round(base.low * combined),
      mid: Math.round(base.mid * combined),
      high: Math.round(base.high * combined),
    };
    const q = computeQty(area, basics, input);

    // Per-unit override wins over manual and benchmark. Each scope card
    // gets a ±20% baseline from the entered value, plus a ±20% spread
    // within the card so low/mid/high still reads as a range.
    const perUnitOverride = input.perUnitOverride;
    if (typeof perUnitOverride === "number" && perUnitOverride > 0) {
      const scopeBaseline = s === "minor" ? perUnitOverride * 0.8
        : s === "full" ? perUnitOverride * 1.2
        : perUnitOverride;
      const perUnit: Range = {
        low: Math.round(scopeBaseline * 0.8),
        mid: Math.round(scopeBaseline),
        high: Math.round(scopeBaseline * 1.2),
      };
      const total: Range = {
        low: Math.round(perUnit.low * q),
        mid: Math.round(perUnit.mid * q),
        high: Math.round(perUnit.high * q),
      };
      return { perUnit, total, qty: q, manual: false as const };
    }

    // Manual override for this scope level wins if set.
    const manualVal = input.manual?.[s];
    if (typeof manualVal === "number" && manualVal > 0) {
      // The user types a *total* for each scope level. To still surface a
      // low/mid/high spread, scale by the benchmark's own low/high ratios
      // so the spread looks like the benchmark would for that scope level.
      const lowRatio = base.mid > 0 ? base.low / base.mid : 0.85;
      const highRatio = base.mid > 0 ? base.high / base.mid : 1.15;
      const total: Range = {
        low: Math.round(manualVal * lowRatio),
        mid: manualVal,
        high: Math.round(manualVal * highRatio),
      };
      // For multi-unit areas (per-key, per-floor, etc.) divide back to a
      // per-unit display so the top-right rate stays comparable to the
      // benchmark-mode RangePill instead of repeating the gross total.
      const perUnit: Range = q > 1
        ? {
            low: Math.round(total.low / q),
            mid: Math.round(total.mid / q),
            high: Math.round(total.high / q),
          }
        : total;
      return {
        perUnit,
        total,
        qty: q > 1 ? q : 1,
        manual: true as const,
      };
    }
    return {
      perUnit: r,
      total: { low: q * r.low, mid: q * r.mid, high: q * r.high },
      qty: q,
      manual: false as const,
    };
  };

  return (
    <div>
      <div className="mb-4 p-3 bg-gencom-mist/50 border border-gencom-sand rounded-md">
        <div className="t-body">{area.description}</div>
        <div className="t-meta mt-1">
          Priced in {unitLabel(area.unit)} · benchmarks for {basics.tier} tier
          {basics.propertyType && ptMult !== 1 && (
            <> · {basics.propertyType} ×{ptMult.toFixed(2)}</>
          )}
        </div>
      </div>

      {onApplyToAll && (
        <div className="mb-4 flex flex-wrap items-start gap-2">
          <div className="flex items-center gap-1.5 p-2 border border-gencom-stone/40 rounded-md bg-white">
            {(["minor", "partial", "full"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onApplyToAll(s)}
                className="t-eyebrow px-3 py-1 rounded-md border border-gencom-sand hover:border-emerald-700 hover:bg-emerald-50"
                title={`Apply ${SCOPE_LEVEL_BUNDLES[s].title} scope to every area`}
              >
                {SCOPE_LEVEL_BUNDLES[s].title}
              </button>
            ))}
          </div>
          {onOverrideScopes && (
            <div className="p-2 border border-gencom-stone/40 rounded-md bg-white">
              <OverrideMenu
                current={scopePct}
                onApply={onOverrideScopes}
                open={openMenu === "override"}
                onOpenChange={(o) => setOpenMenu(o ? "override" : null)}
              />
            </div>
          )}
          <div className="p-2 border border-gencom-stone/40 rounded-md bg-white">
            <ManualMenu
              current={input.manual}
              onApply={(next) => setInput({ ...input, manual: next })}
              open={openMenu === "manual"}
              onOpenChange={(o) => setOpenMenu(o ? "manual" : null)}
            />
          </div>
          {supportsPerUnitOverride && (
            <div className="p-2 border border-gencom-stone/40 rounded-md bg-white">
              <PerUnitOverrideMenu
                current={input.perUnitOverride}
                onApply={(next) => setInput({ ...input, perUnitOverride: next })}
                open={openMenu === "perUnit"}
                onOpenChange={(o) => setOpenMenu(o ? "perUnit" : null)}
                unitLabel={perUnitName}
              />
            </div>
          )}
        </div>
      )}

      {input.include && (
        <div className="mb-4 p-2.5 border border-gencom-stone/40 rounded-md bg-white">
          <div className="flex items-center justify-between mb-1.5">
            <span className="t-eyebrow">Cost Adjustment (applies to all three)</span>
            <span className="t-mono">
              {adj === 1 ? "baseline" : `${adj >= 1 ? "+" : ""}${Math.round((adj - 1) * 100)}%`}
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={adj}
            onChange={(e) => setInput({ ...input, adjust: Number(e.target.value) })}
            className="w-full accent-emerald-700"
          />
          <div className="t-micro flex justify-between mt-0.5">
            <span>−50%</span>
            <button
              type="button"
              onClick={() => setInput({ ...input, adjust: 1 })}
              className="underline underline-offset-2 hover:text-gencom-ink"
            >
              reset
            </button>
            <span>+50%</span>
          </div>
        </div>
      )}

      {input.include && (
        <>
          {area.unit !== "per_key" && (
            <Field label={`${unitQtyLabel(area.unit)} (quantity)`} hint="Default estimated from room count / typical layout">
              <input type="number" className={inputCls} value={input.sf}
                onChange={(e) => setInput({ ...input, sf: e.target.value === "" ? "" : Number(e.target.value) })} />
            </Field>
          )}

          <div className="mt-4">
            <div className="t-eyebrow mb-2">Scope Level</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-stretch">
              {(["minor", "partial", "full"] as const).map((s) => {
                const active = input.scope === s;
                const b = SCOPE_LEVEL_BUNDLES[s];
                const desc = scopeDescriptionFor(area.key, s);
                const q = qtyForScope(s);
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setInput({ ...input, scope: s });
                      onAdvance?.();
                    }}
                    className={`flex flex-col text-left p-2.5 rounded-md border transition h-full ${
                      active
                        ? "border-emerald-700 bg-emerald-50/40 ring-2 ring-emerald-700/20"
                        : "border-gencom-sand bg-white hover:border-gencom-stone/50"
                    }`}
                    title={desc}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-bold uppercase tracking-wider text-gencom-ink">{b.title}</div>
                      <RangePill r={q.perUnit} />
                    </div>
                    <div className="t-micro mt-1 leading-snug line-clamp-3">{desc}</div>
                    {/* Spacer pushes the Total row to the bottom so all three
                        cards line up regardless of description length. */}
                    <div className="flex-1" />
                    {q.qty > 0 && (
                      <div className="mt-2 pt-2 border-t border-gencom-sand/60 t-micro">
                        <span>Total ({q.qty} {unitQtyLabel(area.unit)}): </span>
                        <RangePill r={q.total} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

        </>
      )}

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={() => {
            // Toggling off removes this area's pane from the track; the step
            // index naturally lands on the next area, so no onAdvance here.
            setInput({ ...input, include: !input.include });
          }}
          className={`t-eyebrow px-4 py-1.5 rounded-md border transition ${
            input.include
              ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
              : "border-emerald-600 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}
        >
          {input.include ? "Remove Scope" : "Add Back to Scope"}
        </button>
      </div>
    </div>
  );
}

// ---------- Step: Custom Areas --------------------------------------------
function CustomAreasStep({
  customAreas, setCustomAreas,
}: { customAreas: CustomArea[]; setCustomAreas: (c: CustomArea[]) => void }) {
  function add() {
    setCustomAreas([...customAreas, {
      id: Math.random().toString(36).slice(2, 9),
      name: "", low: 0, mid: 0, high: 0, notes: "", designBasis: true,
    }]);
  }
  function patch(id: string, p: Partial<CustomArea>) {
    setCustomAreas(customAreas.map((c) => c.id === id ? { ...c, ...p } : c));
  }
  function remove(id: string) {
    setCustomAreas(customAreas.filter((c) => c.id !== id));
  }
  return (
    <div>
      <div className="t-body text-gencom-stone mb-4">
        Add any area not covered by the standard list. Enter lump-sum Low / Mid / High estimates.
      </div>
      {customAreas.length === 0 && (
        <div className="t-meta italic mb-4">No custom areas added.</div>
      )}
      <div className="space-y-3">
        {customAreas.map((c) => (
          <div key={c.id} className="p-3 border border-gencom-sand rounded-md">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <div className="md:col-span-2">
                <Field label="Area Name">
                  <input className={inputCls} value={c.name}
                    onChange={(e) => patch(c.id, { name: e.target.value })} />
                </Field>
              </div>
              <Field label="Low $">
                <input type="number" className={inputCls} value={c.low}
                  onChange={(e) => patch(c.id, { low: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Mid $">
                <input type="number" className={inputCls} value={c.mid}
                  onChange={(e) => patch(c.id, { mid: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="High $">
                <input type="number" className={inputCls} value={c.high}
                  onChange={(e) => patch(c.id, { high: Number(e.target.value) || 0 })} />
              </Field>
            </div>
            <Field label="Notes">
              <input className={inputCls} value={c.notes}
                onChange={(e) => patch(c.id, { notes: e.target.value })} />
            </Field>
            <div className="flex items-center justify-between mt-2">
              <label className="t-meta flex items-center gap-2">
                <input type="checkbox" checked={c.designBasis}
                  onChange={(e) => patch(c.id, { designBasis: e.target.checked })} />
                Include in design-fee basis
              </label>
              <button onClick={() => remove(c.id)}
                className="t-meta text-red-700 hover:text-red-900">Remove</button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={add}
        className="t-body mt-4 px-3 py-1.5 border border-emerald-700 text-emerald-700 rounded-md hover:bg-emerald-50">
        + Add custom area
      </button>
    </div>
  );
}

// ---------- Step: Soft Costs ---------------------------------------------
function SoftCostsStep({
  softs, setSofts, hardRange,
}: { softs: SoftCostRow[]; setSofts: (s: SoftCostRow[]) => void; hardRange: Range }) {
  function patch(key: SoftCostKey, p: Partial<SoftCostRow>) {
    setSofts(softs.map((s) => s.key === key ? { ...s, ...p } : s));
  }
  function remove(key: SoftCostKey) {
    setSofts(softs.filter((s) => s.key !== key));
  }
  function addCustom() {
    const id = `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    setSofts([
      ...softs,
      { key: id, label: "Custom soft cost", pct: 5, enabled: true, basis: "hard_all" },
    ]);
  }
  const basisOptions: { value: SoftCostBasis; label: string }[] = [
    { value: "hard_design_only", label: "Hard cost (design-eligible only — excl. DM, IT, MEP)" },
    { value: "hard_all", label: "Hard cost (all areas)" },
    { value: "hard_plus_softs_no_dev", label: "Hard + prior softs (ex. this line)" },
    { value: "ffe_only", label: "FF&E line items only" },
    { value: "hard_minus_ffe", label: "Hard cost excluding FF&E" },
    { value: "flat", label: "Flat $ amount (no percentage)" },
  ];
  // Single grid template shared by the header row and every data row so
  // they stay aligned. Compact one-line rows keep more soft costs in view.
  const rowGrid = "grid grid-cols-[28px_minmax(0,1fr)_72px_minmax(0,2fr)_36px] gap-2 items-center";
  return (
    <div>
      <div className="t-body text-gencom-stone mb-3">
        Hard cost subtotal (Mid): <span className="font-semibold text-gencom-ink">{money(hardRange.mid)}</span>.
        Adjust %, toggle on/off, edit labels, or remove lines.
      </div>
      <div className={`${rowGrid} px-2 pb-1 t-eyebrow text-gencom-stone`}>
        <div></div>
        <div>Line</div>
        <div className="text-right">% / $</div>
        <div>Basis</div>
        <div></div>
      </div>
      <div className="space-y-1">
        {softs.map((s) => (
          <div key={s.key} className={`${rowGrid} px-2 py-1 border border-gencom-sand rounded-md ${s.enabled ? "" : "opacity-60"}`}>
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => patch(s.key, { enabled: e.target.checked })}
              className="shrink-0 justify-self-center"
              title={s.enabled ? "Click to disable this line" : "Click to enable this line"}
            />
            <input
              className={inputCls}
              value={s.label}
              onChange={(e) => patch(s.key, { label: e.target.value })}
              placeholder="Line label"
            />
            {s.basis === "flat" ? (
              <input
                type="text"
                inputMode="numeric"
                className={`${inputCls} text-right font-mono`}
                value={typeof s.flatAmount === "number" && s.flatAmount > 0 ? s.flatAmount.toLocaleString("en-US") : ""}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, "");
                  patch(s.key, { flatAmount: digits ? Number(digits) : undefined });
                }}
                placeholder="$ amount"
                title="Flat dollar amount (no percentage)"
              />
            ) : (
              <input
                type="number"
                step={0.5}
                className={`${inputCls} text-right`}
                value={s.pct}
                onChange={(e) => patch(s.key, { pct: Number(e.target.value) || 0 })}
                title="Percent"
              />
            )}
            <select
              className={inputCls}
              value={s.basis}
              onChange={(e) => patch(s.key, { basis: e.target.value as SoftCostBasis })}
            >
              {basisOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              type="button"
              onClick={() => remove(s.key)}
              className="t-micro text-red-700 hover:text-red-900 hover:bg-red-50 rounded border border-transparent hover:border-red-300 justify-self-center w-7 h-7 flex items-center justify-center"
              title="Remove this soft cost line"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addCustom}
        className="t-body mt-3 px-3 py-1.5 border border-emerald-700 text-emerald-700 rounded-md hover:bg-emerald-50"
      >
        + Add custom soft cost
      </button>
    </div>
  );
}

// ---------- Step: Review --------------------------------------------------
function ReviewStep({
  basics, lines, softsApplied, hardRange, softsRange, grand, perKey, perSf,
  onExport, onExportHtml, onExportPptx,
}: {
  basics: PropertyBasics;
  lines: ComputedLine[];
  softsApplied: { row: SoftCostRow; basis: Range; range: Range }[];
  hardRange: Range;
  softsRange: Range;
  grand: Range;
  perKey: Range;
  perSf: Range;
  onExport: () => void;
  onExportHtml: (
    visible: { low: boolean; mid: boolean; high: boolean },
    opts?: { autoPrint?: boolean },
  ) => void;
  onExportPptx: () => void;
}) {
  const mult = REGIONAL_MULTIPLIERS[basics.regionKey] ?? 1.0;
  const address = [basics.city, basics.stateOrCountry].filter(Boolean).join(", ");

  // Which of the three estimates the user wants in the review + output.
  // Default all three. Checkbox UI at the top of this step. At least one
  // must stay checked — we re-enable Mid if everything gets unchecked.
  const [showLow, setShowLow] = useState(true);
  const [showMid, setShowMid] = useState(true);
  const [showHigh, setShowHigh] = useState(true);
  const visible = { low: showLow, mid: showMid, high: showHigh };
  const selectedCount = (visible.low ? 1 : 0) + (visible.mid ? 1 : 0) + (visible.high ? 1 : 0);
  const visibleKeys: ("low" | "mid" | "high")[] = [];
  if (visible.low) visibleKeys.push("low");
  if (visible.mid) visibleKeys.push("mid");
  if (visible.high) visibleKeys.push("high");

  // Subtitle logic per spec:
  //   3 selected → "ROM CAPEX Budget"
  //   2 selected → "ROM CAPEX Budget · High & Low Estimate" (or whichever two)
  //   1 selected → "ROM Estimate"  (single point — no range qualifier)
  const subtitle = (() => {
    if (selectedCount === 1) return "ROM Estimate";
    if (selectedCount === 2) {
      const names = visibleKeys.map((k) => k[0].toUpperCase() + k.slice(1));
      return `ROM CAPEX Budget · ${names.join(" & ")} Estimate`;
    }
    return "ROM CAPEX Budget";
  })();

  // When exactly one estimate is shown, the card label reads "ROM Estimate"
  // (not "Mid Estimate") so the output doesn't imply a range that isn't there.
  function cardLabel(k: "low" | "mid" | "high"): string {
    if (selectedCount === 1) return "ROM Estimate";
    return k === "low" ? "Low Estimate" : k === "mid" ? "Mid Estimate" : "High Estimate";
  }

  // Helper: render <td> cells for the visible estimates only. Preserves the
  // mid-highlighted styling when mid is still visible.
  function numCells(
    r: Range,
    opts?: { bold?: boolean; cls?: string },
  ) {
    const base = `px-3 align-middle text-right font-mono tabular-nums ${opts?.cls ?? ""}`;
    return (
      <>
        {visible.low && <td className={base}>{money(r.low)}</td>}
        {visible.mid && <td className={`${base} ${opts?.bold ?? true ? "font-semibold" : ""}`}>{money(r.mid)}</td>}
        {visible.high && <td className={base}>{money(r.high)}</td>}
      </>
    );
  }

  // Split lines into the two rollup buckets. The `category` on the AreaDef is
  // the authority; FF&E adders inherit their parent area's bucket; custom
  // areas fall into Interior.
  const dmLines = lines.filter((l) => {
    const base = l.key.replace(/_ffe$/, "");
    return AREA_BY_KEY[base]?.category === "dm";
  });
  const interiorLines = lines.filter((l) => {
    const base = l.key.replace(/_ffe$/, "");
    return AREA_BY_KEY[base]?.category !== "dm";
  });
  const dmSubtotal = sumRange(dmLines);
  const interiorSubtotal = sumRange(interiorLines);

  // MM/DD/YY — today.
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const yy = String(today.getFullYear()).slice(-2);
  const dateStr = `${mm}/${dd}/${yy}`;

  // Dev fee is broken out of the soft cost table into its own section.
  const devFeeRows = softsApplied.filter((s) => s.row.key === "development_fee");
  const otherSoftRows = softsApplied.filter((s) => s.row.key !== "development_fee");
  const devFeeRange = devFeeRows.reduce(
    (acc, s) => ({
      low: acc.low + s.range.low,
      mid: acc.mid + s.range.mid,
      high: acc.high + s.range.high,
    }),
    { low: 0, mid: 0, high: 0 } as Range,
  );
  const otherSoftsRange: Range = {
    low: softsRange.low - devFeeRange.low,
    mid: softsRange.mid - devFeeRange.mid,
    high: softsRange.high - devFeeRange.high,
  };

  // Basis codes → human-friendly labels (used in the Soft Costs table).
  const basisLabels: Record<SoftCostBasis, string> = {
    hard_design_only: "Hard cost (design-eligible)",
    hard_all: "Hard cost (all areas)",
    hard_plus_softs_no_dev: "Hard + prior softs",
    ffe_only: "FF&E only",
    hard_minus_ffe: "Hard cost excl. FF&E",
  };

  return (
    <div>
      {/* Print header — Gencom mark centered, property name + ROM CAPEX
          BUDGET and site data stacked directly underneath; today's date
          pinned top-right. */}
      <div className="relative mb-6 pb-5 border-b border-gencom-sand">
        <div className="absolute top-0 right-0 t-mono text-gencom-stone text-xs">{dateStr}</div>
        <div className="flex flex-col items-center text-center">
          <img
            src="/gencom-logo.png"
            alt="Gencom"
            className="h-12 w-12 rounded-full object-contain border border-gencom-sand"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div className="font-brand text-xl mt-1 leading-none">Gencom</div>
          <div className="t-h1 uppercase tracking-wider mt-4">{basics.name || "Untitled Property"}</div>
          <div className="t-eyebrow mt-1">{subtitle}</div>
          <div className="t-body text-gencom-stone mt-2">
            {address || "— address not set —"}
            {basics.roomCount ? <> · <span className="font-semibold text-gencom-ink">{nf.format(Number(basics.roomCount))}</span> keys</> : null}
            {basics.brand ? <> · {basics.brand}</> : null}
            {basics.tier ? <> · {basics.tier}</> : null}
          </div>
        </div>
      </div>

      {/* Estimate selector — which of Low / Mid / High to include in the
          output. Hides cards and table columns in sync. */}
      <div className="mb-4 p-3 bg-gencom-mist/50 border border-gencom-sand rounded-md flex items-center gap-4 flex-wrap print:hidden">
        <div className="t-eyebrow">Include estimates:</div>
        <EstimateCheckbox
          label="Low"
          checked={showLow}
          onChange={(v) => {
            if (!v && selectedCount === 1) return; // keep at least one
            setShowLow(v);
          }}
        />
        <EstimateCheckbox
          label="Mid"
          checked={showMid}
          onChange={(v) => {
            if (!v && selectedCount === 1) return;
            setShowMid(v);
          }}
        />
        <EstimateCheckbox
          label="High"
          checked={showHigh}
          onChange={(v) => {
            if (!v && selectedCount === 1) return;
            setShowHigh(v);
          }}
        />
        <div className="t-micro text-gencom-stone ml-auto">
          {selectedCount === 3 && "Showing all three estimates."}
          {selectedCount === 2 && "Showing two estimates. Title & exports update to match."}
          {selectedCount === 1 && "Single-point ROM. Label changes to \"ROM Estimate.\""}
        </div>
      </div>

      <div className={`grid gap-3 mb-6 ${selectedCount === 1 ? "grid-cols-1" : selectedCount === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3"}`}>
        {visible.low && (
          <EstimateCard
            label={cardLabel("low")}
            total={grand.low}
            hard={hardRange.low}
            soft={otherSoftsRange.low}
            devFee={devFeeRange.low}
            perKey={perKey.low}
            highlight={selectedCount === 1}
          />
        )}
        {visible.mid && (
          <EstimateCard
            label={cardLabel("mid")}
            total={grand.mid}
            hard={hardRange.mid}
            soft={otherSoftsRange.mid}
            devFee={devFeeRange.mid}
            perKey={perKey.mid}
            highlight
          />
        )}
        {visible.high && (
          <EstimateCard
            label={cardLabel("high")}
            total={grand.high}
            hard={hardRange.high}
            soft={otherSoftsRange.high}
            devFee={devFeeRange.high}
            perKey={perKey.high}
            highlight={selectedCount === 1}
          />
        )}
      </div>

      <div className="mb-6">
        <div className="t-eyebrow mb-2">Hard Costs by Area</div>
        <div className="overflow-x-auto border border-gencom-sand rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-gencom-mist/70 text-gencom-stone">
              <tr className="h-9">
                <th className="text-left px-3 align-middle">Area</th>
                <th className="text-left px-3 align-middle">Scope</th>
                {visible.low && <th className="text-right px-3 align-middle">Low</th>}
                {visible.mid && <th className="text-right px-3 align-middle">Mid</th>}
                {visible.high && <th className="text-right px-3 align-middle">High</th>}
              </tr>
            </thead>
            <tbody>
              {/* ---- Deferred Maintenance + Elevators -------------------- */}
              <tr className="h-8 bg-gencom-mist/40 border-t border-gencom-sand/60">
                <td colSpan={2 + selectedCount} className="px-3 align-middle t-eyebrow">
                  Deferred Maintenance &amp; Elevators
                </td>
              </tr>
              {dmLines.map((l) => (
                <tr key={l.key} className="h-9 border-t border-gencom-sand/60">
                  <td className="px-3 align-middle truncate" title={l.area}>{l.area}</td>
                  <td className="px-3 align-middle"><span className="t-eyebrow">{l.scope}</span></td>
                  {numCells({ low: l.lowTotal, mid: l.midTotal, high: l.highTotal })}
                </tr>
              ))}
              {dmLines.length === 0 && (
                <tr className="h-9"><td colSpan={2 + selectedCount} className="px-3 align-middle text-center text-gencom-stone italic">— none —</td></tr>
              )}
              <tr className="h-9 bg-gencom-mist/30 border-t border-gencom-sand/60">
                <td colSpan={2} className="px-3 align-middle font-semibold">Subtotal — Deferred Maintenance &amp; Elevators</td>
                {numCells(dmSubtotal)}
              </tr>

              {/* ---- Interior Renovation, IT, BOH & remainder ------------ */}
              <tr className="h-8 bg-gencom-mist/40 border-t border-gencom-sand/60">
                <td colSpan={2 + selectedCount} className="px-3 align-middle t-eyebrow">
                  Interior Renovation, IT, BOH &amp; Remaining Hard Costs
                </td>
              </tr>
              {interiorLines.map((l) => (
                <tr key={l.key} className="h-9 border-t border-gencom-sand/60">
                  <td className="px-3 align-middle truncate" title={l.area}>{l.area}</td>
                  <td className="px-3 align-middle"><span className="t-eyebrow">{l.scope}</span></td>
                  {numCells({ low: l.lowTotal, mid: l.midTotal, high: l.highTotal })}
                </tr>
              ))}
              {interiorLines.length === 0 && (
                <tr className="h-9"><td colSpan={2 + selectedCount} className="px-3 align-middle text-center text-gencom-stone italic">— none —</td></tr>
              )}
              <tr className="h-9 bg-gencom-mist/30 border-t border-gencom-sand/60">
                <td colSpan={2} className="px-3 align-middle font-semibold">Subtotal — Interior &amp; Remaining Hard Costs</td>
                {numCells(interiorSubtotal)}
              </tr>

              {/* ---- Overall hard cost ----------------------------------- */}
              <tr className="h-10 bg-gencom-mist/60 border-t-2 border-gencom-sand">
                <td colSpan={2} className="px-3 align-middle font-semibold">Hard Cost Subtotal</td>
                {numCells(hardRange)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-6">
        <div className="t-eyebrow mb-2">Soft Costs</div>
        <div className="overflow-x-auto border border-gencom-sand rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-gencom-mist/70 text-gencom-stone">
              <tr>
                <th className="text-left px-3 py-2">Line</th>
                <th className="text-right px-3 py-2">%</th>
                <th className="text-left px-3 py-2">Basis</th>
                {visible.low && <th className="text-right px-3 py-2">Low</th>}
                {visible.mid && <th className="text-right px-3 py-2">Mid</th>}
                {visible.high && <th className="text-right px-3 py-2">High</th>}
              </tr>
            </thead>
            <tbody>
              {otherSoftRows.map((s) => (
                <tr key={s.row.key} className={`border-t border-gencom-sand/60 ${!s.row.enabled ? "opacity-40" : ""}`}>
                  <td className="px-3 py-1.5">{s.row.label}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{s.row.enabled ? (s.row.basis === "flat" ? "flat" : `${s.row.pct}%`) : "—"}</td>
                  <td className="px-3 py-1.5">{basisLabels[s.row.basis]}</td>
                  {visible.low && <td className="px-3 py-1.5 text-right font-mono">{money(s.range.low)}</td>}
                  {visible.mid && <td className="px-3 py-1.5 text-right font-mono font-semibold">{money(s.range.mid)}</td>}
                  {visible.high && <td className="px-3 py-1.5 text-right font-mono">{money(s.range.high)}</td>}
                </tr>
              ))}
              <tr className="bg-gencom-mist/60 border-t-2 border-gencom-sand">
                <td colSpan={3} className="px-3 py-2 font-semibold">Soft Cost Subtotal (ex. Development Fee)</td>
                {visible.low && <td className="px-3 py-2 text-right font-mono">{money(otherSoftsRange.low)}</td>}
                {visible.mid && <td className="px-3 py-2 text-right font-mono font-semibold">{money(otherSoftsRange.mid)}</td>}
                {visible.high && <td className="px-3 py-2 text-right font-mono">{money(otherSoftsRange.high)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {devFeeRows.length > 0 && (
        <div className="mb-6">
          <div className="t-eyebrow mb-2">Development Fee</div>
          <div className="overflow-x-auto border border-gencom-sand rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-gencom-mist/70 text-gencom-stone">
                <tr>
                  <th className="text-left px-3 py-2">Line</th>
                  <th className="text-right px-3 py-2">%</th>
                  <th className="text-left px-3 py-2">Basis</th>
                  {visible.low && <th className="text-right px-3 py-2">Low</th>}
                  {visible.mid && <th className="text-right px-3 py-2">Mid</th>}
                  {visible.high && <th className="text-right px-3 py-2">High</th>}
                </tr>
              </thead>
              <tbody>
                {devFeeRows.map((s) => (
                  <tr key={s.row.key} className={`border-t border-gencom-sand/60 ${!s.row.enabled ? "opacity-40" : ""}`}>
                    <td className="px-3 py-1.5">{s.row.label}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{s.row.enabled ? (s.row.basis === "flat" ? "flat" : `${s.row.pct}%`) : "—"}</td>
                    <td className="px-3 py-1.5">{basisLabels[s.row.basis]}</td>
                    {visible.low && <td className="px-3 py-1.5 text-right font-mono">{money(s.range.low)}</td>}
                    {visible.mid && <td className="px-3 py-1.5 text-right font-mono font-semibold">{money(s.range.mid)}</td>}
                    {visible.high && <td className="px-3 py-1.5 text-right font-mono">{money(s.range.high)}</td>}
                  </tr>
                ))}
                <tr className="bg-gencom-mist/60 border-t-2 border-gencom-sand">
                  <td colSpan={3} className="px-3 py-2 font-semibold">Development Fee Subtotal</td>
                  {visible.low && <td className="px-3 py-2 text-right font-mono">{money(devFeeRange.low)}</td>}
                  {visible.mid && <td className="px-3 py-2 text-right font-mono font-semibold">{money(devFeeRange.mid)}</td>}
                  {visible.high && <td className="px-3 py-2 text-right font-mono">{money(devFeeRange.high)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-6 text-gencom-stone text-[10px] leading-snug">
        <span className="font-semibold">Confidence note.</span>{" "}
        ROM estimate based on high-level scope assumptions; ±25% accuracy typical at this stage.
        Detailed scope definition and contractor pricing required for firmer numbers.
        Benchmarks: {BENCHMARK_SOURCE} · last updated {BENCHMARK_LAST_UPDATED} · regional multiplier: ×{mult} ({basics.regionKey}).
      </div>

      <div className="flex flex-wrap justify-center gap-2 print:hidden">
        <button
          onClick={() => onExportHtml(visible)}
          className="t-body font-semibold px-4 py-2 border border-gencom-sand text-gencom-ink rounded-md hover:bg-gencom-mist/60"
          title="Download a self-contained HTML file"
        >
          Export HTML
        </button>
        <button
          onClick={() => onExportHtml(visible, { autoPrint: true })}
          className="t-body font-semibold px-4 py-2 border border-emerald-700 text-emerald-700 rounded-md hover:bg-emerald-50"
          title="Download a print-optimized HTML file and open the print/save-as-PDF dialog"
        >
          Export to PDF
        </button>
        <button
          onClick={onExport}
          className="t-body font-semibold px-4 py-2 bg-emerald-700 text-white rounded-md hover:bg-emerald-800"
        >
          Export Excel
        </button>
        <button
          onClick={onExportPptx}
          className="t-body font-semibold px-4 py-2 bg-gencom-ink text-white rounded-md hover:bg-black"
          title="Export a PowerPoint deck. Uses backend/templates/fast_budget_template.pptx if present, else an auto-generated deck."
        >
          Export to PPT
        </button>
      </div>
    </div>
  );
}

// ---------- Step: Scope Description --------------------------------------
// Final (optional) page — Claude narrates what each budget level buys.
function ScopeDescriptionStep({
  basics, includedAreaNames, grand, hardRange, softsRange, perKey, onExportHtml,
}: {
  basics: PropertyBasics;
  includedAreaNames: string[];
  grand: Range;
  hardRange: Range;
  softsRange: Range;
  perKey: Range;
  onExportHtml: (
    texts: { low: string; mid: string; high: string },
    opts?: { autoPrint?: boolean },
  ) => void;
}) {
  const [low, setLow] = useState("");
  const [mid, setMid] = useState("");
  const [high, setHigh] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // MM/DD/YY today — same format as the Review header.
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const yy = String(today.getFullYear()).slice(-2);
  const dateStr = `${mm}/${dd}/${yy}`;
  const address = [basics.city, basics.stateOrCountry].filter(Boolean).join(", ");

  async function fetchDescriptions() {
    if (!basics.name.trim()) {
      setErr("Set a property name on the Property Basics step first.");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const res = await api.fastBudgetScopeDescription({
        name: basics.name,
        city: basics.city || null,
        state_or_country: basics.stateOrCountry || null,
        brand: basics.brand || null,
        tier: basics.tier || null,
        property_type: basics.propertyType || null,
        room_count: basics.roomCount === "" ? null : Number(basics.roomCount),
        suite_count: basics.suiteCount === "" ? null : Number(basics.suiteCount),
        year_built: basics.yearBuilt === "" ? null : Number(basics.yearBuilt),
        last_renovation: basics.lastRenovation === "" ? null : Number(basics.lastRenovation),
        included_areas: includedAreaNames,
        budgets: {
          low: { total: grand.low, per_key: perKey.low, hard: hardRange.low, soft: softsRange.low },
          mid: { total: grand.mid, per_key: perKey.mid, hard: hardRange.mid, soft: softsRange.mid },
          high: { total: grand.high, per_key: perKey.high, hard: hardRange.high, soft: softsRange.high },
        },
      });
      setLow(res.low ?? "");
      setMid(res.mid ?? "");
      setHigh(res.high ?? "");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch on first mount once basics are present.
  useEffect(() => {
    if (!low && !mid && !high && !loading && !err && basics.name.trim()) {
      fetchDescriptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections: {
    key: "low" | "mid" | "high";
    label: string;
    total: number;
    hard: number;
    soft: number;
    perKey: number;
    text: string;
    setText: (v: string) => void;
    highlight?: boolean;
  }[] = [
    { key: "low", label: "Low Estimate", total: grand.low, hard: hardRange.low, soft: softsRange.low, perKey: perKey.low, text: low, setText: setLow },
    { key: "mid", label: "Mid Estimate", total: grand.mid, hard: hardRange.mid, soft: softsRange.mid, perKey: perKey.mid, text: mid, setText: setMid, highlight: true },
    { key: "high", label: "High Estimate", total: grand.high, hard: hardRange.high, soft: softsRange.high, perKey: perKey.high, text: high, setText: setHigh },
  ];

  return (
    <div>
      {/* Header — same shape as Review, only subtitle changes. */}
      <div className="relative mb-6 pb-5 border-b border-gencom-sand">
        <div className="absolute top-0 right-0 t-mono text-gencom-stone text-xs">{dateStr}</div>
        <div className="flex flex-col items-center text-center">
          <img
            src="/gencom-logo.png"
            alt="Gencom"
            className="h-12 w-12 rounded-full object-contain border border-gencom-sand"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div className="font-brand text-xl mt-1 leading-none">Gencom</div>
          <div className="t-h1 uppercase tracking-wider mt-4">{basics.name || "Untitled Property"}</div>
          <div className="t-eyebrow mt-1">High-Level Scope Description</div>
          <div className="t-body text-gencom-stone mt-2">
            {address || "— address not set —"}
            {basics.roomCount ? <> · <span className="font-semibold text-gencom-ink">{nf.format(Number(basics.roomCount))}</span> keys</> : null}
            {basics.brand ? <> · {basics.brand}</> : null}
            {basics.tier ? <> · {basics.tier}</> : null}
          </div>
        </div>
      </div>

      {loading && (
        <div className="t-body text-gencom-stone italic mb-4">
          Generating scope narratives — Claude is reading the budget and hotel context…
        </div>
      )}
      {err && (
        <div className="mb-4 text-xs text-red-800 bg-red-50 border border-red-300 rounded-md px-3 py-2 flex items-center justify-between gap-3">
          <span>Failed to generate scope: {err}</span>
          <button
            type="button"
            onClick={fetchDescriptions}
            className="t-eyebrow px-3 py-1 rounded-md border border-red-300 bg-white hover:bg-red-100"
          >
            Retry
          </button>
        </div>
      )}

      <div className="space-y-6">
        {sections.map((s) => (
          <div
            key={s.key}
            className={`rounded-md border border-gencom-sand overflow-hidden ${s.highlight ? "bg-emerald-50/40" : "bg-white"}`}
          >
            {/* Cost breakdown header */}
            <div className="p-4 border-b border-gencom-sand bg-gencom-mist/40">
              <div className="flex items-baseline justify-between gap-3">
                <div className="t-eyebrow">{s.label}</div>
                <div className="font-mono text-xl font-bold text-gencom-ink tabular-nums">
                  {money(s.total)}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 t-micro font-mono tabular-nums">
                <span>Hard {money(s.hard)}</span>
                <span>Soft {money(s.soft)}</span>
                <span>Per key <span className="font-semibold text-gencom-ink">{money(s.perKey)}</span></span>
              </div>
            </div>
            {/* Scope narrative */}
            <div className="p-4">
              {editing ? (
                <textarea
                  value={s.text}
                  onChange={(e) => s.setText(e.target.value)}
                  className="w-full min-h-[160px] px-3 py-2 text-sm border border-gencom-sand rounded-md bg-white focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold leading-relaxed"
                  placeholder="Describe what this budget buys…"
                />
              ) : s.text ? (
                <div className="t-body whitespace-pre-wrap leading-relaxed">{s.text}</div>
              ) : (
                <div className="t-meta italic">
                  {loading ? "…" : "No description yet. Click Regenerate to ask Claude."}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 justify-end">
        <button
          type="button"
          onClick={fetchDescriptions}
          disabled={loading}
          className="t-body px-4 py-2 border border-gencom-sand rounded-md hover:bg-gencom-mist/60 disabled:opacity-40"
          title="Ask Claude to regenerate all three narratives"
        >
          {loading ? "Generating…" : "↻ Regenerate"}
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className={`t-body px-4 py-2 border rounded-md ${
            editing
              ? "border-emerald-700 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "border-gencom-sand hover:bg-gencom-mist/60"
          }`}
        >
          {editing ? "Done editing" : "Edit manually"}
        </button>
        <button
          type="button"
          onClick={() => onExportHtml({ low, mid, high })}
          className="t-body font-semibold px-4 py-2 border border-gencom-sand text-gencom-ink rounded-md hover:bg-gencom-mist/60"
          title="Download a self-contained HTML file"
        >
          Export HTML
        </button>
        <button
          type="button"
          onClick={() => onExportHtml({ low, mid, high }, { autoPrint: true })}
          className="t-body font-semibold px-4 py-2 bg-emerald-700 text-white rounded-md hover:bg-emerald-800"
          title="Download a print-optimized HTML file and open the print/save-as-PDF dialog"
        >
          Export to PDF
        </button>
      </div>
    </div>
  );
}

function EstimateCheckbox({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 t-body select-none cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-emerald-700"
      />
      <span>{label}</span>
    </label>
  );
}

function EstimateCard({
  label, total, hard, soft, devFee, perKey, highlight,
}: {
  label: string;
  total: number;
  hard: number;
  soft: number;
  devFee: number;
  perKey: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex flex-col p-3 rounded-md border border-gencom-sand bg-gradient-to-br ${
        highlight ? "from-emerald-50 to-emerald-100/40" : "from-white to-gencom-mist/50"
      }`}
    >
      <div className="t-eyebrow">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold text-gencom-ink tabular-nums leading-tight">
        {money(total)}
      </div>
      <div className="mt-2 space-y-0.5 text-[11px] text-gencom-stone font-mono tabular-nums">
        <div className="flex justify-between gap-2">
          <span>Hard costs</span>
          <span className="text-gencom-ink">{money(hard)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Soft costs</span>
          <span className="text-gencom-ink">{money(soft)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Dev fee</span>
          <span className="text-gencom-ink">{money(devFee)}</span>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-gencom-sand/60 flex justify-between items-baseline font-mono tabular-nums">
        <span className="t-eyebrow text-gencom-stone">per key</span>
        <span className="text-sm font-semibold text-gencom-ink">{money(perKey)}</span>
      </div>
    </div>
  );
}
