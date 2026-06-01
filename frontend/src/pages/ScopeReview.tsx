import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import PropertyNav from "../components/PropertyNav";
import TotalsBar from "../components/TotalsBar";
import BackToTop from "../components/BackToTop";
import { api, formatMoney, type Property, type ScopeItem, type ExtractionResult, type DocumentRow, type BreakdownSuggestion, type CostMatchRow, type AiCostResult } from "../lib/api";
import { type GuestroomMix, totalKeys } from "../lib/guestroomTemplates";
import { SCOPE_CATALOG, findDuplicateInSameArea, type ScopeCatalogEntry } from "../lib/scopeCatalog";
import { subAreaGroupsForDivision, subAreasForDivision } from "../lib/subAreas";
import { checkCostSanity, loadAcknowledgedIds, saveAcknowledgedIds } from "../lib/costSanity";
import { checkBudgetSanity } from "../lib/budgetSanity";

const PRIORITIES = ["required", "recommended", "optional", "na"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;
const UNITS = [
  "each", "sf", "sy", "lf", "rooms", "floors", "ls", "allowance", "lot",
  "per key", "% of keys", "doubles only", "suites only",
] as const;

type Filters = {
  division: string;
  source: string;
  priority: string;
  search: string;
  flagged_only: boolean;
};

export default function ScopeReview() {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [items, setItems] = useState<ScopeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>({ division: "", source: "", priority: "", search: "", flagged_only: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [expandedDivisions, setExpandedDivisions] = useState<Set<string>>(new Set());
  // Collapsed sub-areas within each division. Key format: "DIVISION::sub_area".
  // Default = expanded; membership in this set means collapsed.
  const [collapsedSubAreas, setCollapsedSubAreas] = useState<Set<string>>(new Set());
  const [divisions, setDivisions] = useState<string[]>([]);
  // Quick-add panel stays collapsed by default — it's a heavy section that
  // shouldn't dominate the scope page on every visit. Click the header to
  // expand when actively browsing the catalog.
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddArea, setQuickAddArea] = useState<string>("GUESTROOMS");
  const [extractState, setExtractState] = useState<{
    running: boolean;
    phaseIdx: number;
    result: ExtractionResult | null;
    error: string | null;
    documents: DocumentRow[];
  }>({ running: false, phaseIdx: 0, result: null, error: null, documents: [] });
  const [breakdown, setBreakdown] = useState<{
    itemId: string;
    loading: boolean;
    suggestions: BreakdownSuggestion[];
    accepted: Set<number>;
    error: string | null;
  } | null>(null);
  const [batchCostOpen, setBatchCostOpen] = useState(false);
  const [pipImportOpen, setPipImportOpen] = useState(false);
  // Combined Issues bar collapses sanity warnings + duplicates into one slim
  // chip that the user can expand. Persisted per-property so the choice
  // survives navigation.
  const ISSUES_OPEN_KEY = `pipbudget.issuesOpen.${propertyId ?? ""}`;
  const [issuesOpen, setIssuesOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(ISSUES_OPEN_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(ISSUES_OPEN_KEY, issuesOpen ? "1" : "0"); } catch {}
  }, [issuesOpen, ISSUES_OPEN_KEY]);
  // Actions menu — replaces the row of 4 buttons with a single dropdown.
  const [actionsOpen, setActionsOpen] = useState(false);
  // Per-row hover for compact-by-default rows that expand on click or
  // sustained hover (>2s). Short hovers shouldn't trigger expansion — users
  // sweeping the mouse across the list should not see rows flicker open.
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sanityExpanded, setSanityExpanded] = useState(false);
  // Filter the scope table down to the duplicate groups detected by
  // findDuplicateInSameArea. Toggled from the issues banner.
  const [dupeFilterActive, setDupeFilterActive] = useState(false);
  // Minimized collapses the whole banner down to a small chip. Persisted so
  // it survives page reloads — users who've already reviewed flags shouldn't
  // see the big banner re-open every time they refresh.
  const SANITY_MIN_KEY = `pipbudget.sanityMinimized.${propertyId ?? ""}`;
  const [sanityMinimized, setSanityMinimized] = useState<boolean>(() => {
    try { return localStorage.getItem(SANITY_MIN_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SANITY_MIN_KEY, sanityMinimized ? "1" : "0"); } catch {}
  }, [sanityMinimized, SANITY_MIN_KEY]);
  // Detailed = full inline editor with multiplier dropdowns, source badges,
  // sub-area pickers. Compact = Excel-style table with the same edits but a
  // distilled layout. Persisted per-property so each user keeps their pick.
  const VIEW_MODE_KEY = `pipbudget.scopeViewMode.${propertyId ?? ""}`;
  const [viewMode, setViewMode] = useState<"detailed" | "compact">(() => {
    try {
      const v = localStorage.getItem(VIEW_MODE_KEY);
      return v === "compact" ? "compact" : "detailed";
    } catch { return "detailed"; }
  });
  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch {}
  }, [viewMode, VIEW_MODE_KEY]);
  // Per-column widths for the compact view, adjusted via the toolbar above
  // the table. Persisted per-property so each user keeps their layout.
  const COL_WIDTHS_KEY = `pipbudget.scopeColWidths.${propertyId ?? ""}`;
  const DEFAULT_COL_WIDTHS = {
    area: 120, item: 200, description: 240, count: 78,
    unitType: 110, unitCost: 130, budget: 120, notes: 180,
  };
  type ColKey = keyof typeof DEFAULT_COL_WIDTHS;
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(() => {
    try {
      const raw = localStorage.getItem(COL_WIDTHS_KEY);
      if (raw) return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(raw) };
    } catch {}
    return DEFAULT_COL_WIDTHS;
  });
  useEffect(() => {
    try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidths)); } catch {}
  }, [colWidths, COL_WIDTHS_KEY]);
  function adjustCol(key: ColKey, delta: number) {
    setColWidths((prev) => ({
      ...prev,
      [key]: Math.max(60, Math.min(700, prev[key] + delta)),
    }));
  }
  const [ackFlags, setAckFlags] = useState<Set<string>>(() =>
    propertyId ? loadAcknowledgedIds(propertyId) : new Set(),
  );

  // Track which items have had the "break down" action triggered. Per-property,
  // localStorage-backed — once the button has been clicked on a given item,
  // it disappears from that row permanently (the user got the menu once).
  const BROKEN_DOWN_KEY = `pipbudget.brokenDownItems.${propertyId ?? ""}`;
  const [brokenDownIds, setBrokenDownIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(BROKEN_DOWN_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  function markBrokenDown(itemId: string) {
    setBrokenDownIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      try { localStorage.setItem(BROKEN_DOWN_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  }

  function acknowledgeCostFlag(itemId: string) {
    if (!propertyId) return;
    setAckFlags((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      saveAcknowledgedIds(propertyId, next);
      return next;
    });
  }
  const navigate = useNavigate();
  const location = useLocation();
  const scrolledToHashRef = useRef<string | null>(null);

  const EXTRACT_PHASES = [
    "Reading documents…",
    "Extracting property metadata…",
    "Identifying scope items…",
    "Matching to cost database…",
    "Consolidating…",
  ];

  async function importFromPip() {
    if (!propertyId) return;
    // First check what documents exist.
    const docs = await api.listDocuments(propertyId);
    const extractable = docs.filter((d) =>
      ["pip", "om", "walk_notes", "walk_photo", "brochure"].includes(d.document_type)
    );
    if (extractable.length === 0) {
      alert(
        "No PIP, OM, or walk notes have been uploaded yet.\n\n" +
        "Go to the Setup tab and upload a PIP using the Upload & Extract panel at the top, then come back here and try again."
      );
      return;
    }
    const confirmed = confirm(
      `Extract scope from ${extractable.length} uploaded document${extractable.length > 1 ? "s" : ""}?\n\n` +
      `This will add new scope items to your existing scope (duplicates will be kept — you can delete them afterward).`
    );
    if (!confirmed) return;

    setExtractState({ running: true, phaseIdx: 0, result: null, error: null, documents: docs });
    const phaseTimer = setInterval(() => {
      setExtractState((s) => ({ ...s, phaseIdx: Math.min(s.phaseIdx + 1, EXTRACT_PHASES.length - 1) }));
    }, 8000);
    try {
      const result = await api.runExtraction(propertyId);
      setExtractState((s) => ({ ...s, running: false, result, error: null }));
      await refresh();
    } catch (e) {
      setExtractState((s) => ({ ...s, running: false, error: String(e) }));
    } finally {
      clearInterval(phaseTimer);
    }
  }

  async function refresh() {
    if (!propertyId) return;
    setLoading(true);
    try {
      const [p, scope, divs] = await Promise.all([
        api.getProperty(propertyId),
        api.listScope(propertyId),
        api.listDivisions(),
      ]);
      setProperty(p);
      setItems(scope);
      setDivisions(divs.divisions);
      if (expandedDivisions.size === 0) {
        setExpandedDivisions(new Set(Array.from(new Set(scope.map((i) => i.division)))));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [propertyId]);

  // Handle #item-<id> hash from Scope Overview links: expand the division that
  // contains the target item, select it, and scroll it into view. We only run
  // this once per hash (ref-guarded) so re-renders don't keep re-selecting.
  useEffect(() => {
    const hash = location.hash;
    if (!hash.startsWith("#item-")) return;
    if (items.length === 0) return;
    if (scrolledToHashRef.current === hash) return;

    const itemId = hash.slice("#item-".length);
    const target = items.find((i) => i.id === itemId);
    if (!target) return;

    scrolledToHashRef.current = hash;
    setSelected(itemId);
    setExpandedDivisions((s) => new Set([...s, target.division]));

    // Wait a tick for the division expansion + render, then scroll.
    setTimeout(() => {
      const el = document.getElementById(`item-${itemId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-emerald-500");
        setTimeout(() => el.classList.remove("ring-2", "ring-emerald-500"), 2500);
      }
    }, 150);
  }, [location.hash, items]);

  // IDs of items that participate in any same-area duplicate group.
  // Mirrors the bucket logic used to compute `duplicateGroups` further
  // down — kept in sync because the issues banner's "dup" filter needs
  // ID-level info that findDuplicateInSameArea doesn't expose.
  const duplicateItemIds = useMemo(() => {
    const norm = (s: string) =>
      s.toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/[^\w\s&/-]/g, "").replace(/\s+/g, " ").trim();
    const buckets = new Map<string, ScopeItem[]>();
    for (const it of items) {
      if (it.deleted) continue;
      const key = `${it.division}::${it.sub_area ?? ""}::${norm(it.line_item)}`;
      const arr = buckets.get(key) ?? [];
      arr.push(it);
      buckets.set(key, arr);
    }
    const ids = new Set<string>();
    for (const group of buckets.values()) {
      if (group.length > 1) {
        for (const it of group) ids.add(it.id);
      }
    }
    return ids;
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (filters.division && i.division !== filters.division) return false;
      if (filters.source && i.source !== filters.source) return false;
      if (filters.priority && i.priority !== filters.priority) return false;
      if (filters.search) {
        const s = filters.search.toLowerCase();
        if (
          !i.line_item.toLowerCase().includes(s) &&
          !(i.description?.toLowerCase().includes(s) ?? false) &&
          !i.division.toLowerCase().includes(s) &&
          !(i.sub_area?.toLowerCase().includes(s) ?? false)
        ) return false;
      }
      if (filters.flagged_only) {
        if (checkCostSanity(i, ackFlags).level === "none") return false;
      }
      if (dupeFilterActive && !duplicateItemIds.has(i.id)) return false;
      return true;
    });
  }, [items, filters, ackFlags, dupeFilterActive, duplicateItemIds]);

  const grouped = useMemo(() => {
    const g: Record<string, ScopeItem[]> = {};
    for (const i of filtered) (g[i.division] ||= []).push(i);
    return g;
  }, [filtered]);

  // Two-level grouping: division → sub_area → items. Items without a sub_area
  // fall into "(unassigned)" at the top of the division block.
  const groupedWithSubAreas = useMemo(() => {
    const out: Record<string, Record<string, ScopeItem[]>> = {};
    for (const i of filtered) {
      const sub = (i.sub_area || "").trim() || "(unassigned)";
      (out[i.division] ||= {});
      (out[i.division][sub] ||= []).push(i);
    }
    // Sort items within each sub-area alphabetically
    for (const div of Object.keys(out)) {
      for (const sub of Object.keys(out[div])) {
        out[div][sub].sort((a, b) => a.line_item.localeCompare(b.line_item));
      }
    }
    // Pin DEFERRED MAINTENANCE to the top — it's the section users review
    // first when sequencing renovation work, so it should never sort below
    // the alphabetical body.
    const ordered: typeof out = {};
    const dmKey = Object.keys(out).find((k) => k.toUpperCase() === "DEFERRED MAINTENANCE");
    if (dmKey) ordered[dmKey] = out[dmKey];
    for (const k of Object.keys(out)) {
      if (k !== dmKey) ordered[k] = out[k];
    }
    return ordered;
  }, [filtered]);

  async function addRow(divisionHint?: string) {
    if (!propertyId) return;
    const division = divisionHint || filters.division || divisions[0] || "Miscellaneous";
    const created = await api.createScope(propertyId, {
      division, line_item: "New item", quantity: 1, unit: "each", source: "manual", priority: "na",
    });
    setItems((xs) => [...xs, created]);
    setExpandedDivisions((s) => new Set([...s, division]));
    setSelected(created.id);
  }

  async function applyCatalogEntry(entry: ScopeCatalogEntry, overrideDivision?: string) {
    if (!propertyId || !property) return;
    const mix: GuestroomMix = (property.guestroom_mix as GuestroomMix) ?? {};
    const keys = totalKeys(mix, property.keys ?? 0);
    const qty = entry.quantity(mix, keys);
    const basis = entry.quantity.__basis ?? null;
    // Validate: per-basis items need a positive basis value; absolute items need positive qty.
    if (basis === "keys" && keys <= 0) {
      alert(`Can't add "${entry.label}" — the property has 0 keys. Fill in the guestroom matrix on Setup first.`);
      return;
    }
    if (basis === "floors" && (property.floors ?? 0) <= 0) {
      alert(`Can't add "${entry.label}" — the property has 0 floors. Set floors on Setup first.`);
      return;
    }
    if (!basis && qty <= 0) {
      alert(`Computed quantity is 0 for "${entry.label}". Fill in the guestroom matrix on Setup first.`);
      return;
    }
    const division = overrideDivision ?? entry.division;
    const dup = findDuplicateInSameArea(entry.label, division, items);
    if (dup) {
      const ok = confirm(
        `"${entry.label}" is already included in ${dup.division}. Add another one anyway?`,
      );
      if (!ok) return;
    }
    const created = await api.createScope(propertyId, {
      division,
      line_item: entry.label,
      description: entry.description,
      quantity: qty,
      unit: entry.unit,
      source: "manual",
      priority: "required",
      multiplier_basis: basis,
    });
    setItems((xs) => [...xs, created]);
    setExpandedDivisions((s) => new Set([...s, division]));
    setSelected(created.id);
  }

  async function patch(itemId: string, payload: Partial<ScopeItem>) {
    if (!propertyId) return;
    const updated = await api.updateScope(propertyId, itemId, payload);
    setItems((xs) => xs.map((i) => (i.id === itemId ? updated : i)));
  }

  async function handleDelete(item: ScopeItem) {
    if (!propertyId) return;
    if (item.source === "manual" && !confirm(`Delete "${item.line_item}"?`)) return;
    await api.deleteScope(propertyId, item.id);
    await refresh();
  }

  async function openBreakdown(item: ScopeItem) {
    if (!propertyId) return;
    // Mark the item as "broken down once" so the row-level button disappears
    // even if the user cancels the modal — the intent was expressed.
    markBrokenDown(item.id);
    setBreakdown({ itemId: item.id, loading: true, suggestions: [], accepted: new Set(), error: null });
    try {
      const { suggestions } = await api.scopeBreakdown(propertyId, item.id);
      setBreakdown({
        itemId: item.id,
        loading: false,
        suggestions,
        accepted: new Set(suggestions.map((_, i) => i)), // default all-accepted
        error: null,
      });
    } catch (e) {
      setBreakdown((b) => b ? { ...b, loading: false, error: String(e) } : null);
    }
  }

  async function confirmBreakdown() {
    if (!propertyId || !breakdown) return;
    const chosen = breakdown.suggestions.filter((_, i) => breakdown.accepted.has(i));
    if (chosen.length === 0) {
      setBreakdown(null);
      return;
    }
    try {
      await api.applyScopeBreakdown(propertyId, breakdown.itemId, chosen);
      setBreakdown(null);
      await refresh();
    } catch (e) {
      setBreakdown((b) => b ? { ...b, error: String(e) } : null);
    }
  }

  async function rematch(item: ScopeItem) {
    if (!propertyId) return;
    const r = await api.rematchScope(propertyId, item.id);
    alert(`${r.match_type} match (${r.confidence}): ${r.explanation ?? "no match"}`);
    await refresh();
  }

  const toggleDivision = (d: string) =>
    setExpandedDivisions((s) => {
      const next = new Set(s);
      next.has(d) ? next.delete(d) : next.add(d);
      return next;
    });

  if (loading && !property) return <div className="text-gencom-stone">Loading…</div>;
  if (!property) return <div>Property not found.</div>;

  const grandTotal = filtered.reduce((sum, i) => sum + (i.included_in_budget ? i.line_total : 0), 0);
  const selectedItem = items.find((i) => i.id === selected);
  const mix: GuestroomMix = (property.guestroom_mix as GuestroomMix) ?? {};
  const mixTotal = totalKeys(mix);
  const doublesCount = (mix.double_queen ?? 0) + (mix.double_double ?? 0);
  const suitesCount = (mix.junior_suite ?? 0) + (mix.suite_1br ?? 0) + (mix.suite_2br ?? 0) + (mix.signature_suite ?? 0);

  // ─── Duplicate detection ─────────────────────────────────────────────
  // Group by normalized (line_item × division × sub_area) — flags identical
  // items showing up more than once so the user can merge or delete. This
  // happens often when pulling from PIP, then adding from the catalog, then
  // importing from the PIP Generator.
  const duplicateGroups = (() => {
    const norm = (s: string) =>
      s.toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/[^\w\s&/-]/g, "").replace(/\s+/g, " ").trim();
    const buckets = new Map<string, ScopeItem[]>();
    for (const it of items) {
      if (it.deleted) continue;
      const key = `${it.division}::${it.sub_area ?? ""}::${norm(it.line_item)}`;
      const arr = buckets.get(key) ?? [];
      arr.push(it);
      buckets.set(key, arr);
    }
    return Array.from(buckets.values()).filter((g) => g.length > 1);
  })();

  return (
    <div>
      <PropertyNav />

      <TotalsBar
        propertyId={propertyId!}
        keys={property.keys}
        extra={(() => {
          const activeTotal = items
            .filter((i) => !i.deleted && i.included_in_budget)
            .reduce((s, i) => s + (i.line_total || 0), 0);
          const verdict = checkBudgetSanity(activeTotal, property.keys ?? 0, property.target_brand_tier);
          const flaggedItems = items.filter(
            (i) => !i.deleted && i.included_in_budget && checkCostSanity(i, ackFlags).level !== "none",
          );
          const issueCount = duplicateGroups.length + flaggedItems.length + (verdict.level !== "ok" ? 1 : 0);
          if (issueCount === 0) return null;
          return (
            <div className="inline-flex items-center gap-2 border border-amber-400 bg-amber-50 text-amber-900 rounded-md px-2.5 py-1 text-xs font-medium">
              <span title="Flagged items have a missing or $0 unit cost.">⚠</span>
              <span>{issueCount} issue{issueCount !== 1 ? "s" : ""}</span>
              {duplicateGroups.length > 0 && (
                <button
                  onClick={() => setDupeFilterActive(true)}
                  className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-semibold underline hover:text-amber-700"
                  title="Click to show only duplicate rows"
                >{duplicateGroups.length} dup{duplicateGroups.length !== 1 ? "s" : ""}</button>
              )}
              {flaggedItems.length > 0 && (
                <button
                  onClick={() => setFilters((f) => ({ ...f, flagged_only: true }))}
                  className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-semibold underline hover:text-amber-700"
                  title="Click to show only flagged rows"
                >{flaggedItems.length} flagged</button>
              )}
              {verdict.level !== "ok" && (
                <span className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-semibold">{verdict.tier_label}</span>
              )}
              {(filters.flagged_only || dupeFilterActive) && (
                <button
                  className="ml-1 text-xs text-gencom-stone hover:text-gencom-ink underline"
                  onClick={() => { setFilters((f) => ({ ...f, flagged_only: false })); setDupeFilterActive(false); }}
                >✕ clear filter</button>
              )}
              <button
                onClick={() => setIssuesOpen((v) => !v)}
                className="text-amber-700 hover:text-amber-900"
                title={issuesOpen ? "Collapse" : "Expand"}
              >{issuesOpen ? "▾ collapse" : "▸ expand"}</button>
            </div>
          );
        })()}
      />

      {/* Expanded issues detail (below the totals row when ▸ expand is clicked) */}
      {issuesOpen && duplicateGroups.length > 0 && (
        <div className="mb-2 border border-amber-400 bg-amber-50 rounded-md px-3 py-2 text-sm text-amber-900">
          <div className="font-semibold">
            {duplicateGroups.length} duplicate group{duplicateGroups.length !== 1 ? "s" : ""} detected
          </div>
          <ul className="mt-1 text-xs space-y-0.5">
            {duplicateGroups.slice(0, 6).map((g, idx) => {
              const head = g[0];
              const loc = head.sub_area ? `${head.division} · ${head.sub_area}` : head.division;
              return (
                <li key={idx}>
                  <b>{head.line_item}</b> <span className="text-amber-700">in {loc}</span> — appears {g.length}× ·
                  {g.map((it) => (
                    <a key={it.id} href={`#item-${it.id}`} className="ml-1 underline hover:no-underline">open</a>
                  ))}
                </li>
              );
            })}
            {duplicateGroups.length > 6 && (
              <li className="text-amber-700 italic">…and {duplicateGroups.length - 6} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Budget sanity check — compares total vs tier-typical per-key band */}
      {issuesOpen && (() => {
        const activeTotal = items
          .filter((i) => !i.deleted && i.included_in_budget)
          .reduce((s, i) => s + (i.line_total || 0), 0);
        const verdict = checkBudgetSanity(activeTotal, property.keys ?? 0, property.target_brand_tier);
        const flaggedItems = items.filter(
          (i) => !i.deleted && i.included_in_budget && checkCostSanity(i, ackFlags).level !== "none",
        );
        const flaggedCount = flaggedItems.length;
        // Hide the banner entirely when everything is clean: budget total is
        // in the typical per-key range for the tier AND no per-item flags
        // remain. Keeps the header lighter once the user has worked through
        // the warnings.
        if (verdict.level === "ok" && flaggedCount === 0) return null;
        const styles = {
          ok: "bg-emerald-50 border-emerald-600/40 text-emerald-900",
          info: "bg-gencom-mist/50 border-gencom-sand text-gencom-ink",
          warn: "bg-amber-50 border-amber-400 text-amber-900",
          alert: "bg-red-50 border-red-400 text-red-900",
        }[verdict.level];
        const icon = verdict.level === "ok" ? "✓" : "⚠";
        if (sanityMinimized) {
          return (
            <button
              onClick={() => setSanityMinimized(false)}
              className={`mb-4 inline-flex items-center gap-2 border rounded-md px-2 py-1 text-xs font-medium hover:shadow-sm ${styles}`}
              title="Expand budget sanity check"
            >
              <span>{icon}</span>
              <span>Sanity check — {verdict.tier_label}</span>
              {flaggedCount > 0 && (
                <span className="rounded bg-white/60 px-1.5 py-0.5 text-[10px] font-semibold">
                  {flaggedCount} flagged
                </span>
              )}
              <span className="text-gencom-stone">▸ expand</span>
            </button>
          );
        }
        return (
          <div className={`mb-4 border rounded-md p-3 text-sm ${styles}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="font-medium">
                  {verdict.level === "ok" && "✓ "}
                  {verdict.level === "warn" && "⚠ "}
                  {verdict.level === "alert" && "⚠ "}
                  Budget sanity check — {verdict.tier_label}
                </div>
                <div className="text-xs mt-0.5">{verdict.message}</div>
                {flaggedCount > 0 && (
                  <button
                    onClick={() => setSanityExpanded((v) => !v)}
                    className="text-xs mt-1 font-medium underline-offset-2 hover:underline"
                  >
                    {sanityExpanded ? "▾" : "▸"} <b>{flaggedCount}</b> item{flaggedCount !== 1 ? "s" : ""} flagged with unusual unit cost — click to review & edit
                  </button>
                )}
              </div>
              <button
                onClick={() => setSanityMinimized(true)}
                className="shrink-0 rounded border border-current/30 bg-white/50 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-white/80"
                title="Minimize this banner"
              >
                − min
              </button>
            </div>
            {sanityExpanded && flaggedCount > 0 && (
              <div className="mt-2 pt-2 border-t border-current/20 space-y-1 max-h-[420px] overflow-y-auto">
                {flaggedItems.map((it) => {
                  const warn = checkCostSanity(it, ackFlags);
                  const cls = warn.level === "alert"
                    ? "border-red-400 bg-red-50/70"
                    : "border-amber-400 bg-amber-50/70";
                  return (
                    <div key={it.id} className={`p-2 rounded border ${cls} text-gencom-ink`}>
                      {/* Row 1: editable fields + actions */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input
                          type="text"
                          defaultValue={it.line_item}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            const v = e.currentTarget.value.trim();
                            if (v && v !== it.line_item) patch(it.id, { line_item: v });
                          }}
                          className="flex-1 min-w-[200px] font-medium text-xs px-1.5 py-0.5 border border-gencom-sand rounded bg-white"
                          title="Line item (edit + tab/click away to save)"
                        />
                        <input
                          type="number"
                          step="any"
                          defaultValue={it.quantity}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            const n = Number(e.currentTarget.value);
                            if (!Number.isNaN(n) && n !== it.quantity) patch(it.id, { quantity: n });
                          }}
                          className="w-14 text-right text-xs font-mono border border-gencom-sand rounded px-1 py-0.5 bg-white"
                          title="Quantity"
                        />
                        <select
                          value={it.unit}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => patch(it.id, { unit: e.target.value })}
                          className="text-xs border border-gencom-sand rounded px-1 py-0.5 bg-white w-[90px]"
                          title="Unit"
                        >
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                        <select
                          value={it.multiplier_basis ?? ""}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => patch(it.id, { multiplier_basis: (e.target.value || null) as ScopeItem["multiplier_basis"] })}
                          className="text-[10px] border border-gencom-sand rounded px-1 py-0.5 bg-white w-[88px]"
                          title="Multiplier basis"
                        >
                          <option value="">× 1</option>
                          <option value="keys">× keys</option>
                          <option value="keys_pct">% of keys</option>
                          <option value="doubles">× doubles</option>
                          <option value="suites">× suites</option>
                          <option value="floors">× floors</option>
                          <option value="kings_only">× kings only</option>
                          <option value="double_double_only">× double-double only</option>
                          <option value="non_suite">× non-suite</option>
                        </select>
                        <div className="flex items-center gap-0.5">
                          <span className="text-[9px] text-gencom-stone">$</span>
                          <input
                            type="number"
                            step="any"
                            defaultValue={it.override_unit_cost ?? it.suggested_unit_cost ?? ""}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                              const raw = e.currentTarget.value;
                              const n = raw === "" ? null : Number(raw);
                              if (n !== it.override_unit_cost) patch(it.id, { override_unit_cost: n });
                            }}
                            className="w-24 text-right font-mono text-xs border border-gencom-sand rounded px-1 py-0.5 bg-white"
                            title="Unit cost (override)"
                          />
                        </div>
                        <button
                          onClick={() => {
                            setSelected(it.id);
                            setExpandedDivisions((s) => new Set([...s, it.division]));
                            setTimeout(() => {
                              const el = document.getElementById(`item-${it.id}`);
                              if (el) {
                                el.scrollIntoView({ behavior: "smooth", block: "center" });
                                el.classList.add("ring-2", "ring-emerald-500");
                                setTimeout(() => el.classList.remove("ring-2", "ring-emerald-500"), 2500);
                              }
                            }, 100);
                          }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-gencom-sand text-gencom-stone hover:border-gencom-ink hover:text-gencom-ink whitespace-nowrap"
                          title="Jump to this row in the main table"
                        >
                          ✎ open
                        </button>
                        <button
                          onClick={() => acknowledgeCostFlag(it.id)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-600 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap"
                          title="Accept this cost — dismisses the warning but keeps the item unchanged. Stored per-device."
                        >
                          ✓ accept
                        </button>
                        <button
                          onClick={() => {
                            if (it.source === "manual" && !confirm(`Delete "${it.line_item}"?`)) return;
                            handleDelete(it);
                          }}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-red-400 bg-red-50 text-red-700 hover:bg-red-100 whitespace-nowrap"
                          title={it.source === "manual" ? "Delete permanently" : "Soft-delete (restorable)"}
                        >
                          × remove
                        </button>
                      </div>
                      {/* Row 2: context (warning + division/sub-area) */}
                      <div className="mt-1 flex items-center gap-2 text-[10px]">
                        <span className="uppercase text-gencom-stone tracking-wide whitespace-nowrap">
                          {it.division}{it.sub_area ? ` · ${it.sub_area}` : ""}
                        </span>
                        <span className="text-gencom-stone">·</span>
                        <span className="text-gencom-stone italic flex-1">{warn.message}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Extraction result banner */}
      {extractState.result && !extractState.running && (
        <div className="mb-4 bg-emerald-50 border border-emerald-600/40 rounded-md p-3 text-sm flex items-start justify-between gap-3">
          <div>
            <div className="font-medium">
              ✓ Extraction complete · {extractState.result.duration_seconds.toFixed(1)}s
            </div>
            <div className="text-xs text-gencom-stone mt-0.5">
              {extractState.result.documents_processed} document(s) processed ·{" "}
              <b className="text-gencom-ink">{extractState.result.scope_items_created} scope items created</b>
              {extractState.result.property_fields_updated.length > 0 && (
                <> · {extractState.result.property_fields_updated.length} property field(s) updated</>
              )}
            </div>
            {extractState.result.warnings.length > 0 && (
              <details className="text-xs text-amber-800 mt-1">
                <summary className="cursor-pointer">{extractState.result.warnings.length} warning(s)</summary>
                <ul className="mt-1 list-disc list-inside">
                  {extractState.result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
          </div>
          <button
            onClick={() => setExtractState((s) => ({ ...s, result: null }))}
            className="text-gencom-stone hover:text-gencom-ink text-lg leading-none"
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      {extractState.error && (
        <div className="mb-4 bg-red-50 border border-red-300 rounded-md p-3 text-sm flex items-start justify-between gap-3">
          <div>
            <div className="font-medium text-red-800">Extraction failed</div>
            <div className="text-xs text-red-700 mt-0.5 break-words">{extractState.error}</div>
          </div>
          <button
            onClick={() => setExtractState((s) => ({ ...s, error: null }))}
            className="text-red-700 hover:text-red-900 text-lg leading-none"
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      {/* Quick-add — tabs per area, driven by the full scope catalog.
          Opened from the Actions menu; clicking the panel header collapses it. */}
      {showQuickAdd && (
        <QuickAddPanel
          show={showQuickAdd}
          toggle={() => setShowQuickAdd((v) => !v)}
          mixTotal={mixTotal}
          mix={mix}
          totalKeysVal={totalKeys(mix, property.keys ?? 0)}
          items={items}
          divisions={divisions}
          activeArea={quickAddArea}
          setActiveArea={setQuickAddArea}
          onApply={applyCatalogEntry}
        />
      )}

      {/* Filter bar — tight against the totals row */}
      <div className="mb-2 flex flex-wrap gap-2 items-center bg-white border border-gencom-sand rounded-md p-2 text-sm">
          <select
            className="border border-gencom-sand rounded px-2 py-1"
            value={filters.division}
            onChange={(e) => setFilters({ ...filters, division: e.target.value })}
          >
            <option value="">All divisions</option>
            {divisions.map((d, i) => <option key={`${d}-${i}`} value={d}>{d}</option>)}
            {Array.from(new Set(items.map((i) => i.division))).filter((d) => !divisions.includes(d)).map((d) => (
              <option key={d} value={d}>{d} (unmapped)</option>
            ))}
          </select>
          <select
            className="border border-gencom-sand rounded px-2 py-1"
            value={filters.source}
            onChange={(e) => setFilters({ ...filters, source: e.target.value })}
          >
            <option value="">All sources</option>
            <option value="pip">PIP</option>
            <option value="walk_notes">Walk notes</option>
            <option value="om">OM</option>
            <option value="manual">Manual</option>
          </select>
          <select
            className="border border-gencom-sand rounded px-2 py-1"
            value={filters.priority}
            onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            type="search"
            className="border border-gencom-sand rounded px-2 py-1 flex-1 min-w-[240px]"
            placeholder="Search line items, descriptions, sub-areas…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <label
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border cursor-pointer whitespace-nowrap ${
              filters.flagged_only
                ? "border-amber-500 bg-amber-50 text-amber-800"
                : "border-gencom-sand hover:border-amber-400"
            }`}
            title="Show only items with a cost sanity warning (⚠ icon)"
          >
            <input
              type="checkbox"
              checked={filters.flagged_only}
              onChange={(e) => setFilters({ ...filters, flagged_only: e.target.checked })}
            />
            ⚠ Flagged only
          </label>
          <button
            onClick={() => addRow()}
            className="px-3 py-1.5 bg-white text-gencom-ink border border-gencom-sand rounded-md hover:bg-gencom-mist text-xs font-medium"
          >
            + Add Row
          </button>
          <div className="ml-auto flex gap-2 items-center relative">
            <div className="inline-flex border border-gencom-sand rounded overflow-hidden">
              <button
                onClick={() => setViewMode("detailed")}
                className={`px-2.5 py-1 text-xs font-medium ${viewMode === "detailed" ? "bg-gencom-ink text-white" : "bg-white text-gencom-stone hover:bg-gencom-mist"}`}
                title="Full editor — multipliers, sub-areas, source badges"
              >Detailed</button>
              <button
                onClick={() => setViewMode("compact")}
                className={`px-2.5 py-1 text-xs font-medium border-l border-gencom-sand ${viewMode === "compact" ? "bg-gencom-ink text-white" : "bg-white text-gencom-stone hover:bg-gencom-mist"}`}
                title="Excel-style — same edits, distilled layout"
              >Compact</button>
            </div>
            <button
              onClick={() => navigate(`/properties/${propertyId}/summary`)}
              className="px-3 py-1.5 bg-emerald-700 text-white rounded-md font-semibold uppercase tracking-wider text-xs hover:bg-emerald-800"
            >Summary →</button>
            <button
              onClick={() => setActionsOpen((v) => !v)}
              className="px-3 py-1.5 bg-white text-gencom-ink border border-gencom-sand rounded-md font-medium text-xs hover:bg-gencom-mist"
            >Actions ▾</button>
            {actionsOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setActionsOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 w-60 bg-white border border-gencom-sand rounded-md shadow-lg py-1 text-left text-sm">
                  <button
                    onClick={() => { setActionsOpen(false); setShowQuickAdd(true); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gencom-mist"
                  >Quick-add from catalog</button>
                  <div className="border-t border-gencom-sand my-1" />
                  <button
                    onClick={() => { setActionsOpen(false); importFromPip(); }}
                    disabled={extractState.running}
                    className="w-full text-left px-3 py-1.5 hover:bg-gencom-mist disabled:opacity-60"
                  >{extractState.running ? EXTRACT_PHASES[extractState.phaseIdx] : "Import scope from PIP"}</button>
                  <button
                    onClick={() => { setActionsOpen(false); setPipImportOpen(true); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gencom-mist"
                  >Import from PIP Generator</button>
                  <button
                    onClick={() => { setActionsOpen(false); setBatchCostOpen(true); }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gencom-mist"
                  >Auto-populate costs</button>
                  <div className="border-t border-gencom-sand my-1" />
                  <button
                    onClick={async () => {
                      setActionsOpen(false);
                      if (!propertyId) return;
                      if (!confirm(
                        "Are you sure you want to erase ALL scope items for this property?\n\nThis cannot be undone."
                      )) return;
                      try {
                        await api.deleteAllScope(propertyId);
                        await refresh();
                      } catch (e) {
                        alert(`Failed to clear scope: ${e}`);
                      }
                    }}
                    disabled={items.length === 0}
                    className="w-full text-left px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-40"
                  >Start from scratch…</button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Detail panel — full-width horizontal block above the table.
            Shows the selected row's editable details in a 4-column layout. */}
        {selectedItem ? (
          <div className="mb-2 grid grid-cols-12 gap-3 bg-white border border-gencom-sand rounded-lg p-3">
            {/* Col 1: Selected item + Description */}
            <div className="col-span-3 space-y-2 border-r border-gencom-sand pr-3">
              <div>
                <div className="text-[10px] text-gencom-stone uppercase tracking-wider">Selected item</div>
                <div className="font-medium text-sm leading-tight mt-0.5">{selectedItem.line_item}</div>
              </div>
              <div>
                <div className="text-[10px] text-gencom-stone uppercase tracking-wider mb-1">Description</div>
                <textarea
                  key={`desc-${selectedItem.id}`}
                  className="w-full text-xs border border-gencom-sand rounded p-1.5"
                  rows={3}
                  defaultValue={selectedItem.description ?? ""}
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== (selectedItem.description ?? "")) {
                      patch(selectedItem.id, { description: v });
                    }
                  }}
                  placeholder="Add description…"
                />
              </div>
            </div>

            {/* Col 2: Division + Sub-area + Multiplier + Cost */}
            <div className="col-span-4 space-y-2 border-r border-gencom-sand pr-3">
              <div>
                <div className="text-[10px] text-gencom-stone uppercase tracking-wider mb-1">Division (move to…)</div>
                <select
                  value={selectedItem.division}
                  onChange={(e) => {
                    const newDiv = e.target.value;
                    const validSubs = subAreasForDivision(newDiv);
                    const keepSub = selectedItem.sub_area && validSubs.includes(selectedItem.sub_area)
                      ? selectedItem.sub_area : null;
                    patch(selectedItem.id, { division: newDiv, sub_area: keepSub });
                  }}
                  className="w-full text-xs border border-gencom-sand rounded px-2 py-1"
                >
                  {Array.from(new Set([
                    "DEFERRED MAINTENANCE", "COMMON AREA", "F&B", "CORRIDORS", "GUESTROOMS",
                    "SUITES", "SIGNATURE SUITES", "MEETING SPACE", "MISC. ITEMS",
                    ...divisions,
                    selectedItem.division,
                  ])).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[10px] text-gencom-stone uppercase tracking-wider mb-1">Sub-area</div>
                <SubAreaPicker
                  division={selectedItem.division}
                  value={selectedItem.sub_area}
                  onSave={(v) => patch(selectedItem.id, { sub_area: v })}
                />
              </div>
              <div>
                <div className="text-[10px] text-gencom-stone uppercase tracking-wider mb-1">Quantity multiplier</div>
                <select
                  value={selectedItem.multiplier_basis ?? ""}
                  onChange={(e) => patch(selectedItem.id, { multiplier_basis: (e.target.value || null) as ScopeItem["multiplier_basis"] })}
                  className="w-full text-xs border border-gencom-sand rounded px-2 py-1"
                >
                  <option value="">(none — use raw quantity)</option>
                  <option value="keys">× keys ({(property.keys ?? 0).toLocaleString()})</option>
                  <option value="keys_pct">% of keys (qty = percentage)</option>
                  <option value="doubles">× doubles only ({doublesCount.toLocaleString()})</option>
                  <option value="suites">× suites only ({suitesCount.toLocaleString()})</option>
                  <option value="floors">× floors ({(property.floors ?? 0).toLocaleString()})</option>
                  <option value="kings_only">× kings only ({(((property.guestroom_mix as GuestroomMix | null)?.king) ?? 0).toLocaleString()})</option>
                  <option value="double_double_only">× double-double only ({(((property.guestroom_mix as GuestroomMix | null)?.double_double) ?? 0).toLocaleString()})</option>
                  <option value="non_suite">× non-suite ({(
                    (((property.guestroom_mix as GuestroomMix | null)?.king) ?? 0)
                    + (((property.guestroom_mix as GuestroomMix | null)?.double_queen) ?? 0)
                    + (((property.guestroom_mix as GuestroomMix | null)?.double_double) ?? 0)
                  ).toLocaleString()})</option>
                </select>
                {selectedItem.multiplier_basis && (
                  <div className="text-[10px] text-gencom-stone mt-1">
                    Eff qty: <b className="font-mono">{selectedItem.effective_quantity.toLocaleString()}</b>
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] text-gencom-stone uppercase tracking-wider mb-1">Cost</div>
                <div className="text-xs">Effective: <b>{formatMoney(selectedItem.effective_unit_cost)}</b> / {selectedItem.unit}</div>
                {selectedItem.suggested_unit_cost != null && (
                  <div className="text-[10px] text-gencom-stone">Suggested from DB: {formatMoney(selectedItem.suggested_unit_cost)}</div>
                )}
                <div className="text-[10px] text-gencom-stone">Confidence: <b className="capitalize">{selectedItem.confidence}</b></div>
                <button
                  onClick={() => rematch(selectedItem)}
                  className="mt-1 text-[10px] text-gencom-gold hover:underline"
                >Rematch against cost DB</button>
              </div>
              {(() => {
                const warn = checkCostSanity(selectedItem, ackFlags);
                if (warn.level === "none") return null;
                const cls = warn.level === "alert"
                  ? "bg-red-50 text-red-800 border-red-400"
                  : "bg-amber-50 text-amber-800 border-amber-400";
                return (
                  <div className={`border ${cls} rounded p-2 text-[11px]`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium mb-0.5">⚠ Cost sanity — {warn.level === "alert" ? "review before export" : "review"}</div>
                        <div>{warn.message}</div>
                      </div>
                      <button
                        onClick={() => acknowledgeCostFlag(selectedItem.id)}
                        className="shrink-0 text-[10px] px-2 py-0.5 rounded border border-emerald-600 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 whitespace-nowrap self-start"
                        title="Accept this cost"
                      >✓ accept</button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Col 3: Notes */}
            <div className="col-span-2 border-r border-gencom-sand pr-3">
              <div className="text-[10px] text-gencom-stone uppercase tracking-wider mb-1">Notes</div>
              <textarea
                key={`notes-${selectedItem.id}`}
                className="w-full text-xs border border-gencom-sand rounded p-1.5"
                rows={6}
                defaultValue={selectedItem.notes ?? ""}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (selectedItem.notes ?? "")) {
                    patch(selectedItem.id, { notes: v });
                  }
                }}
              />
            </div>

            {/* Col 4: Source */}
            <div className="col-span-3">
              <div className="text-[10px] text-gencom-stone uppercase tracking-wider mb-1">Source</div>
              {selectedItem.source !== "manual" ? (
                <>
                  <div className="text-xs">{selectedItem.source.toUpperCase()}{selectedItem.source_page != null ? ` · p.${selectedItem.source_page}` : ""}</div>
                  {selectedItem.source_excerpt && (
                    <blockquote className="mt-1 text-[11px] text-gencom-stone italic border-l-2 border-gencom-sand pl-2 leading-snug">
                      "{selectedItem.source_excerpt}"
                    </blockquote>
                  )}
                </>
              ) : (
                <div className="text-xs text-gencom-stone">Manual entry</div>
              )}
            </div>
          </div>
        ) : (
          <div className="mb-2 bg-white border border-gencom-sand rounded-lg px-3 py-2 text-xs text-gencom-stone">
            Click a row to see source, confidence, and cost details.
          </div>
        )}

        {/* Table */}
        {viewMode === "compact" ? (
          <div>
            <div className="mb-2 flex justify-end">
              <button
                onClick={() => setColWidths(DEFAULT_COL_WIDTHS)}
                className="text-[10px] text-gencom-stone underline hover:text-gencom-ink"
                title="Reset all column widths"
              >Reset column widths</button>
            </div>
            <CompactTable
              property={property}
              propertyId={propertyId!}
              groupedWithSubAreas={groupedWithSubAreas}
              expandedDivisions={expandedDivisions}
              toggleDivision={toggleDivision}
              selected={selected}
              setSelected={setSelected}
              patch={patch}
              handleDelete={handleDelete}
              rematch={rematch}
              openBreakdown={openBreakdown}
              brokenDownIds={brokenDownIds}
              ackFlags={ackFlags}
              acknowledgeCostFlag={acknowledgeCostFlag}
              filtered={filtered}
              addRow={addRow}
              colWidths={colWidths}
              setColWidth={(key, value) => setColWidths((prev) => ({
                ...prev,
                [key]: Math.max(60, Math.min(700, value)),
              }))}
            />
          </div>
        ) : (
        <div className="overflow-x-auto w-full">
        <div className="bg-white border border-gencom-sand rounded-lg overflow-hidden min-w-0">
          <table className="w-full text-sm">
            <thead className="bg-gencom-mist border-b border-gencom-sand text-left text-[10px] uppercase text-gencom-stone">
              <tr>
                <th className="px-2 py-1.5 w-8"></th>
                <th className="px-2 py-1.5 min-w-0 truncate max-w-[320px]">Line item</th>
                <th className="px-2 py-1.5 text-right w-24">Qty</th>
                <th className="px-2 py-1.5 w-[96px]">Unit</th>
                <th className="px-2 py-1.5 text-right w-28">Unit cost</th>
                <th className="px-2 py-1.5 text-right w-32 whitespace-nowrap min-w-[110px]">Total</th>
                <th className="px-2 py-1.5 w-[100px]">Priority</th>
                <th className="px-2 py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedWithSubAreas).map(([division, subMap]) => {
                const expanded = expandedDivisions.has(division);
                const allRows = Object.values(subMap).flat();
                const divTotal = allRows.reduce((s, i) => s + (i.included_in_budget ? i.line_total : 0), 0);
                // Order sub-areas: preset order first (per SUB_AREAS_BY_DIVISION),
                // then any extras alphabetically, then "(unassigned)" last.
                const preset = subAreasForDivision(division);
                const subOrder = [
                  ...preset.filter((s) => s in subMap),
                  ...Object.keys(subMap)
                    .filter((s) => s !== "(unassigned)" && !preset.includes(s))
                    .sort(),
                  ...(subMap["(unassigned)"] ? ["(unassigned)"] : []),
                ];
                return (
                  <>
                    <tr key={`div-${division}`} className="bg-gencom-sand/40 font-medium border-y border-gencom-sand">
                      <td className="p-2" colSpan={5}>
                        <button
                          onClick={() => toggleDivision(division)}
                          className="mr-2 inline-flex items-center justify-center w-5 h-5 text-sm leading-none font-bold rounded border border-gencom-sand bg-white text-gencom-ink hover:bg-gencom-mist"
                          title={expanded ? "Collapse this division" : "Expand this division"}
                          aria-label={expanded ? "Collapse" : "Expand"}
                        >
                          {expanded ? "−" : "+"}
                        </button>
                        <span className="font-display text-base">{division}</span>
                        <span className="ml-2 text-xs text-gencom-stone">({allRows.length})</span>
                      </td>
                      <td className="p-2 text-right font-medium">{formatMoney(divTotal)}</td>
                      <td className="p-2" colSpan={2}>
                        <button
                          onClick={() => addRow(division)}
                          className="text-xs text-gencom-stone hover:text-gencom-ink"
                        >
                          + row
                        </button>
                      </td>
                    </tr>
                    {expanded && subOrder.flatMap((subArea) => {
                      const rows = subMap[subArea];
                      if (!rows || rows.length === 0) return [];
                      const subTotal = rows.reduce((s, i) => s + (i.included_in_budget ? i.line_total : 0), 0);
                      const subKey = `${division}::${subArea}`;
                      const subCollapsed = collapsedSubAreas.has(subKey);
                      const toggleSubArea = () => setCollapsedSubAreas((s) => {
                        const next = new Set(s);
                        next.has(subKey) ? next.delete(subKey) : next.add(subKey);
                        return next;
                      });
                      const els: JSX.Element[] = [
                        <tr
                          key={`sub-${subKey}`}
                          className="bg-gencom-mist/70 border-b border-gencom-sand/60 cursor-pointer hover:bg-gencom-mist"
                          onClick={toggleSubArea}
                        >
                          <td className="pl-6 py-1.5" colSpan={5}>
                            <span
                              className="inline-flex items-center justify-center w-4 h-4 text-[11px] leading-none font-bold rounded border border-gencom-sand bg-white text-gencom-ink mr-1.5 align-middle"
                              aria-label={subCollapsed ? "Expand" : "Collapse"}
                            >
                              {subCollapsed ? "+" : "−"}
                            </span>
                            <span className="text-xs uppercase tracking-wide text-gencom-stone">
                              ↳ {subArea}
                            </span>
                            <span className="ml-2 text-[10px] text-gencom-stone/80">({rows.length})</span>
                          </td>
                          <td className="py-1.5 text-right text-xs font-medium text-gencom-stone">{formatMoney(subTotal)}</td>
                          <td className="py-1.5" colSpan={2}></td>
                        </tr>,
                      ];
                      if (subCollapsed) return els;
                      return [...els,
                        ...rows.map((item) => {
                      const expanded = hoveredRowId === item.id || selected === item.id;
                      return (
                      <tr
                        key={item.id}
                        id={`item-${item.id}`}
                        onClick={() => setSelected(item.id)}
                        onMouseEnter={() => {
                          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                          hoverTimerRef.current = setTimeout(() => {
                            setHoveredRowId(item.id);
                            hoverTimerRef.current = null;
                          }, 2000);
                        }}
                        onMouseLeave={() => {
                          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                          hoverTimerRef.current = setTimeout(() => {
                            setHoveredRowId((v) => v === item.id ? null : v);
                            hoverTimerRef.current = null;
                          }, 2000);
                        }}
                        className={`border-b border-gencom-sand/40 hover:bg-gencom-mist/40 cursor-pointer transition-[box-shadow] ${
                          selected === item.id ? "bg-gencom-mist/70" : ""
                        } ${!item.included_in_budget ? "opacity-50" : ""}`}
                      >
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={item.included_in_budget}
                            onChange={(e) => { e.stopPropagation(); patch(item.id, { included_in_budget: e.target.checked }); }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-2 py-1 min-w-0 truncate max-w-[320px]">
                          {expanded ? (
                            <>
                              <InlineText
                                value={item.line_item}
                                onSave={(v) => patch(item.id, { line_item: v })}
                                className="font-medium"
                              />
                              <div className="flex items-center gap-2 mt-1">
                                <SourceBadge item={item} />
                                <DivisionPicker
                                  value={item.division}
                                  divisions={divisions}
                                  onSave={(newDiv) => {
                                    const validSubs = subAreasForDivision(newDiv);
                                    const keepSub = item.sub_area && validSubs.includes(item.sub_area)
                                      ? item.sub_area : null;
                                    patch(item.id, { division: newDiv, sub_area: keepSub });
                                  }}
                                />
                                <SubAreaPicker
                                  division={item.division}
                                  value={item.sub_area}
                                  onSave={(v) => patch(item.id, { sub_area: v })}
                                />
                                <InlineText
                                  value={item.description ?? ""}
                                  placeholder="Add description…"
                                  onSave={(v) => patch(item.id, { description: v })}
                                  className="text-xs text-gencom-stone flex-1"
                                />
                              </div>
                            </>
                          ) : (
                            <div className="font-medium truncate" title={item.line_item}>
                              {item.line_item}
                              {item.sub_area && (
                                <span className="ml-2 text-[10px] uppercase tracking-wide text-gencom-stone">
                                  {item.sub_area}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {expanded ? (
                            <>
                              <div className="flex items-center justify-end gap-0.5">
                                <InlineNumber
                                  value={item.quantity}
                                  onSave={(v) => patch(item.id, { quantity: v ?? 0 })}
                                  className="font-mono"
                                />
                                {item.multiplier_basis === "keys_pct" && (
                                  <span className="text-gencom-stone font-mono">%</span>
                                )}
                              </div>
                              <select
                                value={item.multiplier_basis ?? ""}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  patch(item.id, { multiplier_basis: (e.target.value || null) as ScopeItem["multiplier_basis"] });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="mt-0.5 w-full text-[10px] text-gencom-stone bg-transparent border border-transparent hover:border-gencom-sand rounded px-1 py-0 text-right focus:ring-1 focus:ring-gencom-gold/40"
                                title="Quantity multiplier basis"
                              >
                                <option value="">× 1 (none)</option>
                                <option value="keys">× keys</option>
                                <option value="keys_pct">% of keys</option>
                                <option value="doubles">× doubles</option>
                                <option value="suites">× suites</option>
                                <option value="floors">× floors</option>
                                <option value="kings_only">× kings only</option>
                                <option value="double_double_only">× double-double only</option>
                                <option value="non_suite">× non-suite</option>
                              </select>
                              {item.multiplier_basis && (
                                <div className="text-[10px] text-gencom-stone font-mono">
                                  {item.multiplier_basis === "keys_pct"
                                    ? `${item.quantity}% of ${(property.keys ?? 0).toLocaleString()}`
                                    : `× ${basisLabel(item.multiplier_basis, property, doublesCount, suitesCount)}`
                                  } = {item.effective_quantity.toLocaleString()}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="font-mono">
                              {item.effective_quantity.toLocaleString()}
                              {item.multiplier_basis && (
                                <span className="text-[10px] text-gencom-stone ml-0.5">
                                  ({item.quantity}×)
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {expanded ? (
                            <InlineSelect
                              value={item.unit}
                              options={UNITS}
                              onSave={(v) => {
                                const autoBasis: ScopeItem["multiplier_basis"] =
                                  v === "per key" ? "keys" :
                                  v === "% of keys" ? "keys_pct" :
                                  v === "doubles only" ? "doubles" :
                                  v === "suites only" ? "suites" :
                                  null;
                                const payload: Partial<ScopeItem> = { unit: v };
                                if (autoBasis && !item.multiplier_basis) payload.multiplier_basis = autoBasis;
                                patch(item.id, payload);
                              }}
                            />
                          ) : (
                            <span className="text-xs text-gencom-stone">{item.unit}</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {expanded ? (
                            <UnitCostCell
                              item={item}
                              propertyId={propertyId!}
                              onOverride={(v) => patch(item.id, { override_unit_cost: v })}
                              onRematch={() => rematch(item)}
                            />
                          ) : (
                            <span className="font-mono">{formatMoney(item.override_unit_cost ?? item.suggested_unit_cost ?? 0)}</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right font-medium font-mono whitespace-nowrap min-w-[110px]">
                          <div className="flex items-center justify-end gap-1.5">
                            {(() => {
                              const warn = checkCostSanity(item, ackFlags);
                              if (warn.level === "none") return null;
                              const cls = warn.level === "alert"
                                ? "bg-red-100 text-red-800 border-red-400 hover:bg-red-200"
                                : "bg-amber-100 text-amber-800 border-amber-400 hover:bg-amber-200";
                              return (
                                <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                  <span
                                    className={`px-1 border rounded text-[10px] leading-none cursor-help ${cls}`}
                                    title={warn.message}
                                  >
                                    ⚠
                                  </span>
                                  {expanded && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); acknowledgeCostFlag(item.id); }}
                                      className="text-[9px] leading-none px-1 py-[1px] border border-emerald-500 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100"
                                      title="Accept this cost — dismisses the warning on this row"
                                    >
                                      ✓
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                            <span>{formatMoney(item.line_total)}</span>
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          {expanded ? (
                            <>
                              <PrioritySelect
                                value={item.priority}
                                onChange={(v) => patch(item.id, { priority: v })}
                              />
                              {item.source !== "manual"
                                && (item.description?.length ?? 0) < 80
                                && !brokenDownIds.has(item.id) && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); openBreakdown(item); }}
                                  title="Break this down into specific items using AI"
                                  className="mt-1 w-full text-[10px] px-1.5 py-0.5 border border-gencom-sand rounded hover:bg-gencom-mist/60 text-gencom-stone hover:text-gencom-ink"
                                >
                                  🪄 break down
                                </button>
                              )}
                            </>
                          ) : (
                            <span className={`inline-block rounded px-1.5 text-[10px] uppercase tracking-wide ${
                              item.priority === "required" ? "bg-red-100 text-red-800" :
                              item.priority === "recommended" ? "bg-amber-100 text-amber-800" :
                              item.priority === "optional" ? "bg-blue-100 text-blue-800" :
                              "bg-gray-100 text-gray-600"
                            }`}>{item.priority}</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                            className="text-gencom-stone hover:text-red-700"
                            title={item.source === "manual" ? "Delete" : "Soft delete"}
                          >×</button>
                        </td>
                      </tr>
                      );
                        }),
                      ];
                    })}
                  </>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-gencom-stone">
                    No scope items yet.
                    <div className="mt-3">
                      <button onClick={() => addRow()} className="px-3 py-1.5 bg-gencom-ink text-gencom-mist rounded-md">
                        + Add your first line item
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
        )}

      {batchCostOpen && (
        <BatchCostModal
          propertyId={propertyId!}
          activeItems={items.filter((i) => !i.deleted && i.included_in_budget)}
          divisions={divisions}
          onClose={() => setBatchCostOpen(false)}
          onDone={async () => { setBatchCostOpen(false); await refresh(); }}
        />
      )}

      {breakdown && (
        <BreakdownModal
          state={breakdown}
          originalItem={items.find((i) => i.id === breakdown.itemId)}
          onToggle={(idx) => setBreakdown((b) => {
            if (!b) return b;
            const next = new Set(b.accepted);
            next.has(idx) ? next.delete(idx) : next.add(idx);
            return { ...b, accepted: next };
          })}
          onConfirm={confirmBreakdown}
          onCancel={() => setBreakdown(null)}
        />
      )}
      {pipImportOpen && (
        <PipGeneratorImportModal
          propertyId={propertyId!}
          mix={mix}
          keys={totalKeys(mix, property.keys ?? 0)}
          existingItems={items.filter((i) => !i.deleted)}
          onClose={() => setPipImportOpen(false)}
          onImported={(created) => {
            setItems((xs) => [...xs, ...created]);
            setPipImportOpen(false);
          }}
        />
      )}
      <BackToTop />
    </div>
  );
}

function BatchCostModal({
  propertyId, activeItems, divisions, onClose, onDone,
}: {
  propertyId: string;
  activeItems: ScopeItem[];
  divisions: string[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  type Source = "ai_or_db" | "db" | "ai";
  const [source, setSource] = useState<Source>("ai_or_db");
  const [onlyUncosted, setOnlyUncosted] = useState(true);
  const [threshold, setThreshold] = useState<"high" | "medium" | "low">("medium");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ updated: number; skipped: number; errors: string[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pull the distinct divisions that actually have items to cost.
  const availableDivisions = useMemo(() => {
    const set = new Set<string>();
    for (const i of activeItems) {
      if (onlyUncosted && (i.override_unit_cost != null || i.suggested_unit_cost != null)) continue;
      set.add(i.division);
    }
    return Array.from(set).sort();
  }, [activeItems, onlyUncosted]);

  const [selectedDivs, setSelectedDivs] = useState<Set<string>>(() => new Set(availableDivisions));
  useEffect(() => setSelectedDivs(new Set(availableDivisions)), [availableDivisions.join("|")]);

  const candidateCount = activeItems.filter((i) => {
    if (onlyUncosted && (i.override_unit_cost != null || i.suggested_unit_cost != null)) return false;
    return selectedDivs.has(i.division);
  }).length;

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.scopeBatchCost(propertyId, {
        source,
        divisions: selectedDivs.size === availableDivisions.length ? null : Array.from(selectedDivs),
        only_uncosted: onlyUncosted,
        confidence_threshold: threshold,
      });
      setResult({ updated: r.updated, skipped: r.skipped, errors: r.errors, total: r.total_candidates });
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gencom-sand">
          <div className="font-display text-xl">Auto-populate costs</div>
          <div className="text-xs text-gencom-stone mt-0.5">
            Assign unit costs to scope items in bulk. Manual overrides are never touched.
          </div>
        </div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Source */}
          <div>
            <div className="font-medium mb-1.5 text-sm">Source</div>
            <div className="space-y-1">
              {([
                { v: "ai_or_db", label: "Cost DB first, fall back to AI", hint: "Recommended — uses your DB when available, asks Claude otherwise" },
                { v: "db", label: "Cost DB only", hint: "Skip items with no DB match" },
                { v: "ai", label: "AI only", hint: "Ask Claude for every item (slower, uses API tokens)" },
              ] as const).map((opt) => (
                <label key={opt.v} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="batch-cost-source"
                    checked={source === opt.v}
                    onChange={() => setSource(opt.v)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-xs text-gencom-stone">{opt.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Confidence threshold (only relevant for DB matching) */}
          {(source === "db" || source === "ai_or_db") && (
            <div>
              <div className="font-medium mb-1.5 text-sm">Accept DB matches at</div>
              <select
                value={threshold}
                onChange={(e) => setThreshold(e.target.value as "high" | "medium" | "low")}
                className="border border-gencom-sand rounded px-2 py-1 text-sm"
              >
                <option value="high">High confidence only (exact name, same tier)</option>
                <option value="medium">Medium or better (fuzzy matches too)</option>
                <option value="low">Any match (incl. cross-tier — noisier)</option>
              </select>
              <div className="text-xs text-gencom-stone mt-1">
                Tighter = safer but more items stay uncosted. Looser = more coverage, higher risk of bad matches.
              </div>
            </div>
          )}

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-medium text-sm">Sections</div>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => setSelectedDivs(new Set(availableDivisions))}
                  className="text-emerald-700 hover:underline"
                >
                  all
                </button>
                <button
                  onClick={() => setSelectedDivs(new Set())}
                  className="text-gencom-stone hover:text-gencom-ink"
                >
                  none
                </button>
              </div>
            </div>
            {availableDivisions.length === 0 ? (
              <div className="text-sm text-gencom-stone italic">
                {onlyUncosted
                  ? "No uncosted items found — every active item already has a cost."
                  : "No active scope items yet."}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1 text-sm">
                {availableDivisions.map((d) => {
                  const count = activeItems.filter((i) => {
                    if (onlyUncosted && (i.override_unit_cost != null || i.suggested_unit_cost != null)) return false;
                    return i.division === d;
                  }).length;
                  return (
                    <label key={d} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedDivs.has(d)}
                        onChange={() => {
                          const next = new Set(selectedDivs);
                          next.has(d) ? next.delete(d) : next.add(d);
                          setSelectedDivs(next);
                        }}
                      />
                      <span className="flex-1 truncate">{d}</span>
                      <span className="text-xs text-gencom-stone">{count}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Overwrite toggle */}
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyUncosted}
                onChange={(e) => setOnlyUncosted(e.target.checked)}
              />
              <span>Only populate uncosted items (skip items that already have a cost)</span>
            </label>
          </div>

          {result && (
            <div className="p-3 bg-emerald-50 border border-emerald-600/40 rounded text-sm">
              <div className="font-medium">✓ Updated {result.updated} of {result.total} items</div>
              {result.skipped > 0 && (
                <div className="text-xs text-gencom-stone mt-0.5">{result.skipped} items couldn't be costed (no match and/or AI failed).</div>
              )}
              {result.errors.length > 0 && (
                <details className="text-xs text-amber-800 mt-1">
                  <summary>{result.errors.length} error(s)</summary>
                  <ul className="mt-1 list-disc list-inside max-h-40 overflow-auto">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {error && <div className="p-3 bg-red-50 border border-red-300 rounded text-sm text-red-800">{error}</div>}
        </div>

        <div className="px-5 py-3 border-t border-gencom-sand flex items-center justify-between gap-3">
          <div className="text-xs text-gencom-stone">
            {candidateCount} item{candidateCount !== 1 ? "s" : ""} will be processed.
            {source === "ai" || source === "ai_or_db"
              ? " AI calls can take ~1–2 seconds per item."
              : ""}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-gencom-sand rounded hover:bg-gencom-mist/60"
            >
              {result ? "Close" : "Cancel"}
            </button>
            {!result && (
              <button
                onClick={run}
                disabled={running || candidateCount === 0}
                className="px-4 py-1.5 text-sm bg-emerald-700 text-white rounded font-semibold hover:bg-emerald-800 disabled:opacity-50"
              >
                {running ? "Running…" : `Auto-populate ${candidateCount}`}
              </button>
            )}
            {result && (
              <button
                onClick={() => onDone()}
                className="px-4 py-1.5 text-sm bg-emerald-700 text-white rounded font-semibold hover:bg-emerald-800"
              >
                Done · reload scope
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function BreakdownModal({
  state, originalItem, onToggle, onConfirm, onCancel,
}: {
  state: { itemId: string; loading: boolean; suggestions: BreakdownSuggestion[]; accepted: Set<number>; error: string | null };
  originalItem: ScopeItem | undefined;
  onToggle: (idx: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gencom-sand">
          <div className="font-display text-xl">Break this down</div>
          {originalItem && (
            <div className="text-xs text-gencom-stone mt-0.5">
              Replacing: <b>{originalItem.line_item}</b> · {originalItem.division}
            </div>
          )}
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {state.loading && <div className="text-sm text-gencom-stone">Asking Claude…</div>}
          {state.error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{state.error}</div>}
          {!state.loading && !state.error && state.suggestions.length === 0 && (
            <div className="text-sm text-gencom-stone">Claude returned no suggestions.</div>
          )}
          {!state.loading && state.suggestions.length > 0 && (
            <>
              <div className="text-xs text-gencom-stone mb-3">
                {state.accepted.size} of {state.suggestions.length} selected. Uncheck items you don't want.
              </div>
              <div className="space-y-2">
                {state.suggestions.map((s, idx) => {
                  const checked = state.accepted.has(idx);
                  return (
                    <label
                      key={idx}
                      className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition ${
                        checked ? "border-emerald-700 bg-emerald-50/40" : "border-gencom-sand hover:border-gencom-stone/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(idx)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{s.label}</span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gencom-mist text-gencom-stone">
                            {s.division}
                          </span>
                          {s.priority && s.priority !== "na" && (
                            <span className="text-[11px] text-gencom-stone">{s.priority}</span>
                          )}
                        </div>
                        {s.description && <div className="text-xs text-gencom-stone mt-0.5">{s.description}</div>}
                        <div className="text-[11px] text-gencom-stone mt-1 font-mono">
                          {s.quantity} {s.unit}
                          {s.multiplier_basis && <span> · × {s.multiplier_basis}</span>}
                        </div>
                        {s.rationale && (
                          <div className="text-[11px] italic text-gencom-stone/80 mt-1">{s.rationale}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gencom-sand flex justify-between gap-3">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-gencom-sand rounded-md hover:bg-gencom-mist/60"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={state.loading || state.accepted.size === 0}
            className="px-4 py-1.5 text-sm bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-50"
          >
            Replace with {state.accepted.size} item{state.accepted.size !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

const STANDARD_DIVISIONS = [
  "DEFERRED MAINTENANCE",
  "COMMON AREA",
  "MEETING SPACE",
  "F&B",
  "CORRIDORS",
  "GUESTROOMS",
  "SUITES",
  "SIGNATURE SUITES",
  "MISC. ITEMS",
];

// Compact labels shown inside the row-level DivisionPicker so the chip is
// narrower and doesn't push neighbouring controls around. Actual value
// stored is still the full division name; this is display-only.
const DIV_SHORT_LABELS: Record<string, string> = {
  "DEFERRED MAINTENANCE": "DEF. MAINT",
  "COMMON AREA": "COMMON",
  "MEETING SPACE": "MEETING",
  "F&B": "F&B",
  "CORRIDORS": "CORR.",
  "GUESTROOMS": "GUEST",
  "SUITES": "SUITES",
  "SIGNATURE SUITES": "SIG. STE",
  "MISC. ITEMS": "MISC.",
};


function DivisionPicker({
  value, divisions, onSave,
}: {
  value: string;
  divisions: string[];
  onSave: (v: string) => void;
}) {
  // Merge the template's divisions with the standard list; current value is
  // always included so moves to unusual divisions still render.
  const options = Array.from(new Set([
    ...STANDARD_DIVISIONS,
    ...divisions,
    value,
  ])).filter(Boolean);

  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onSave(e.target.value)}
      title={`Category: ${value} — click to move this item to a different category`}
      className="shrink-0 text-[9px] px-1 py-0.5 border rounded border-gencom-ink/30 bg-white uppercase tracking-tight cursor-pointer hover:border-emerald-700 max-w-[96px]"
    >
      {options.map((d) => (
        <option key={d} value={d}>{DIV_SHORT_LABELS[d] ?? d}</option>
      ))}
    </select>
  );
}


function SubAreaPicker({
  division, value, onSave,
}: {
  division: string;
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  const groups = subAreaGroupsForDivision(division);
  const flatPresets = subAreasForDivision(division);
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState("");

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => {
          onSave(custom.trim() || null);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setCustom(""); setEditing(false); }
        }}
        placeholder="Sub-area"
        className="shrink-0 text-[9px] px-1 py-0.5 border border-gencom-gold rounded max-w-[96px]"
      />
    );
  }

  const label = value || "set sub-area";
  return (
    <select
      value={value ?? ""}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__custom__") {
          setCustom(value ?? "");
          setEditing(true);
        } else {
          onSave(v || null);
        }
      }}
      title={value ? `Sub-area: ${value} — click to change` : "Sub-area — click to pick or type a custom value"}
      className={`shrink-0 text-[9px] px-1 py-0.5 border rounded cursor-pointer max-w-[96px] uppercase tracking-tight ${
        value
          ? "border-emerald-700/60 bg-emerald-50/60 text-emerald-800"
          : "border-gencom-sand bg-white text-gencom-stone hover:border-gencom-stone/50"
      }`}
    >
      <option value="">{label}</option>
      {groups.map((g, i) => (
        g.label ? (
          <optgroup key={`g${i}`} label={g.label}>
            {/* Group title is itself a selectable sub-area value — lets users
             *  tag items at the group level when a specific sub-area doesn't
             *  apply (e.g. "Meeting, Event, Pre-Function (General)"). */}
            <option value={g.label}>{g.label}</option>
            {g.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </optgroup>
        ) : (
          g.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)
        )
      ))}
      {value && !flatPresets.includes(value) && <option value={value}>{value}</option>}
      <option value="__custom__">+ Custom…</option>
    </select>
  );
}


function basisLabel(
  basis: ScopeItem["multiplier_basis"],
  property: Property,
  doublesCount: number,
  suitesCount: number,
): string {
  const mix: GuestroomMix = (property.guestroom_mix as GuestroomMix) ?? {};
  const kingsOnly = mix.king ?? 0;
  const doubleDoubleOnly = mix.double_double ?? 0;
  const nonSuite = (mix.king ?? 0) + (mix.double_queen ?? 0) + (mix.double_double ?? 0);
  switch (basis) {
    case "keys": return `${(property.keys ?? 0).toLocaleString()} keys`;
    case "floors": return `${(property.floors ?? 0).toLocaleString()} floors`;
    case "doubles": return `${doublesCount.toLocaleString()} doubles`;
    case "suites": return `${suitesCount.toLocaleString()} suites`;
    case "keys_pct": return `${(property.keys ?? 0).toLocaleString()} keys`;
    case "kings_only": return `${kingsOnly.toLocaleString()} kings`;
    case "double_double_only": return `${doubleDoubleOnly.toLocaleString()} double-doubles`;
    case "non_suite": return `${nonSuite.toLocaleString()} non-suite`;
    default: return "";
  }
}

// ─── Inline editors ──────────────────────────────────────────────────────
function InlineText({
  value, onSave, placeholder, className = "",
}: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      type="text"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(value);
      }}
      className={`w-full bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1 py-0.5 ${className}`}
    />
  );
}

function InlineNumber({
  value, onSave, className = "", allowNull = false,
}: {
  value: number | string;
  onSave: (v: number | null) => void;
  className?: string;
  allowNull?: boolean;
}) {
  const [v, setV] = useState(String(value ?? ""));
  useEffect(() => setV(value === null || value === undefined ? "" : String(value)), [value]);
  return (
    <input
      type="number"
      value={v}
      step="any"
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        const n = v === "" ? (allowNull ? null : 0) : Number(v);
        if (n !== value) onSave(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`w-full bg-transparent border-0 text-right focus:ring-1 focus:ring-gencom-gold/40 rounded px-1 py-0.5 ${className}`}
    />
  );
}

function InlineSelect<T extends string>({
  value, options, onSave,
}: { value: T; options: readonly T[]; onSave: (v: T) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onSave(e.target.value as T)}
      onClick={(e) => e.stopPropagation()}
      className="w-full text-[10px] px-1 py-0.5 border rounded border-gencom-ink/30 bg-white uppercase tracking-tight cursor-pointer hover:border-emerald-700"
      title={`Unit: ${value}`}
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function SourceBadge({ item }: { item: ScopeItem }) {
  const label =
    item.source === "manual" ? "Manual" :
    item.source === "pip" ? `PIP${item.source_page ? ` p.${item.source_page}` : ""}` :
    item.source === "om" ? `OM${item.source_page ? ` p.${item.source_page}` : ""}` :
    "Walk";
  const color =
    item.source === "manual" ? "bg-gencom-sand text-gencom-ink" :
    item.source === "pip" ? "bg-gencom-gold/20 text-gencom-ink" :
    item.source === "om" ? "bg-blue-100 text-blue-800" :
    "bg-green-100 text-green-800";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0 ${color}`}>
      {label}
    </span>
  );
}

function UnitCostCell({
  item, propertyId, onOverride, onRematch,
}: {
  item: ScopeItem;
  propertyId: string;
  onOverride: (v: number | null) => void;
  onRematch: () => void;
}) {
  const hasOverride = item.override_unit_cost != null;
  const [v, setV] = useState(hasOverride ? String(item.override_unit_cost) : "");
  const [popover, setPopover] = useState<null | "db" | "ai">(null);
  const [dbMatches, setDbMatches] = useState<CostMatchRow[] | null>(null);
  const [aiResult, setAiResult] = useState<AiCostResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [popoverErr, setPopoverErr] = useState<string | null>(null);
  useEffect(() => setV(hasOverride ? String(item.override_unit_cost) : ""), [hasOverride, item.override_unit_cost]);

  async function openDb() {
    setPopover("db");
    setLoading(true);
    setDbMatches(null);
    setPopoverErr(null);
    try {
      const { matches } = await api.scopeCostMatches(propertyId, item.id);
      setDbMatches(matches);
    } catch (e) {
      setPopoverErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openAi() {
    setPopover("ai");
    setLoading(true);
    setAiResult(null);
    setPopoverErr(null);
    try {
      const r = await api.scopeAiCost(propertyId, item.id);
      setAiResult(r);
    } catch (e) {
      setPopoverErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        step="any"
        value={v}
        placeholder={item.suggested_unit_cost != null ? formatMoney(item.suggested_unit_cost) : "—"}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = v === "" ? null : Number(v);
          if (n !== item.override_unit_cost) onOverride(n);
        }}
        className={`w-full text-center font-mono px-1 py-0.5 border border-transparent hover:border-gencom-sand rounded ${
          hasOverride ? "text-gencom-gold font-medium" : "text-gencom-stone"
        }`}
        title={hasOverride ? "Override — click to change" : "Suggested from cost DB — type to override"}
      />
      <div className="flex items-center justify-center gap-1 mt-0.5 text-[10px] text-gencom-stone leading-none whitespace-nowrap">
        <button
          type="button"
          onClick={openAi}
          className="px-1 py-0.5 rounded border border-gencom-sand hover:border-gencom-gold hover:text-gencom-gold"
          title="Ask Claude to estimate a unit cost"
        >
          AI
        </button>
        <button
          type="button"
          onClick={openDb}
          className="px-1 py-0.5 rounded border border-gencom-sand hover:border-gencom-ink hover:text-gencom-ink"
          title="See top matches in the cost database"
        >
          DB
        </button>
        {item.suggested_unit_cost != null && !hasOverride && (
          <button
            type="button"
            onClick={onRematch}
            className="px-1 py-0.5 rounded border border-gencom-sand hover:border-gencom-ink hover:text-gencom-ink"
            title="Rematch against cost DB"
          >
            ↻
          </button>
        )}
      </div>

      {popover && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gencom-sand rounded-md shadow-lg z-10 p-3 text-left">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-gencom-ink">
              {popover === "db" ? "Top cost-DB matches" : "AI cost estimate"}
            </div>
            <button onClick={() => setPopover(null)} className="text-gencom-stone hover:text-gencom-ink">×</button>
          </div>
          {loading && <div className="text-xs text-gencom-stone">Loading…</div>}
          {popoverErr && <div className="text-xs text-red-700">{popoverErr}</div>}
          {popover === "db" && dbMatches && dbMatches.length === 0 && (
            <div className="text-xs text-gencom-stone">No close matches in the cost DB.</div>
          )}
          {popover === "db" && dbMatches && dbMatches.length > 0 && (
            <div className="space-y-1.5">
              {dbMatches.map((m) => (
                <button
                  key={m.cost_db_item_id}
                  onClick={() => { onOverride(m.suggested_cost); setPopover(null); }}
                  className="w-full text-left p-2 border border-gencom-sand rounded hover:border-emerald-700 hover:bg-emerald-50/40 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium truncate">{m.item_name}</div>
                    <div className="text-xs font-mono text-gencom-ink">{formatMoney(m.suggested_cost)}</div>
                  </div>
                  <div className="text-[10px] text-gencom-stone">
                    {m.brand_tier} · {m.unit} · {m.score}% match
                    {m.tier_adjusted && m.original_cost != null && (
                      <> · tier-adjusted from {formatMoney(m.original_cost)}</>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
          {popover === "ai" && aiResult && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <div className="font-mono text-xl text-gencom-ink">{formatMoney(aiResult.suggested_cost)}</div>
                <div className="text-xs text-gencom-stone capitalize">{aiResult.confidence} confidence</div>
              </div>
              {aiResult.range_low != null && aiResult.range_high != null && (
                <div className="text-xs text-gencom-stone">
                  Range: {formatMoney(aiResult.range_low)} – {formatMoney(aiResult.range_high)}
                </div>
              )}
              <div className="text-xs text-gencom-stone">{aiResult.explanation}</div>
              <button
                onClick={() => { onOverride(aiResult.suggested_cost); setPopover(null); }}
                className="w-full mt-1 px-3 py-1.5 bg-emerald-700 text-white rounded text-xs hover:bg-emerald-800"
              >
                Use this estimate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PrioritySelect({
  value, onChange,
}: { value: ScopeItem["priority"]; onChange: (v: ScopeItem["priority"]) => void }) {
  const colors: Record<string, string> = {
    required: "bg-red-100 text-red-800 border-red-300",
    recommended: "bg-gencom-gold/20 text-gencom-ink border-gencom-gold/50",
    optional: "bg-blue-100 text-blue-800 border-blue-300",
    na: "bg-gencom-sand text-gencom-ink border-gencom-sand",
  };
  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as ScopeItem["priority"])}
      className={`shrink-0 text-[9px] px-1 py-0.5 border rounded uppercase tracking-tight cursor-pointer max-w-[96px] ${colors[value] ?? ""}`}
      title={`Priority: ${value}`}
    >
      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  );
}

// ─── Quick-add panel ──────────────────────────────────────────────────
function QuickAddPanel(props: {
  show: boolean;
  toggle: () => void;
  mixTotal: number;
  mix: GuestroomMix;
  totalKeysVal: number;
  items: ScopeItem[];
  divisions: string[];
  activeArea: string;
  setActiveArea: (d: string) => void;
  onApply: (entry: ScopeCatalogEntry, overrideDivision?: string) => void;
}) {
  const { show, toggle, mixTotal, mix, totalKeysVal, items, divisions, activeArea, setActiveArea, onApply } = props;

  const knownDivisions = Array.from(new Set([
    "GUESTROOMS", "SUITES", "COMMON AREA", "MEETING SPACE", "F&B", "CORRIDORS",
    "SIGNATURE SUITES", "DEFERRED MAINTENANCE", "MISC. ITEMS",
    ...divisions,
  ]));

  // SUITES tab shows both suite-specific items AND all GUESTROOMS items (since
  // suites typically include everything in a guestroom plus additions). When
  // a GUESTROOMS entry is applied from the SUITES tab, it's filed under SUITES.
  const forArea = activeArea === "SUITES"
    ? SCOPE_CATALOG.filter((e) => e.division === "SUITES" || e.division === "GUESTROOMS")
    : SCOPE_CATALOG.filter((e) => e.division === activeArea);
  const byCategory: Record<string, ScopeCatalogEntry[]> = {};
  for (const e of forArea) (byCategory[e.category] ||= []).push(e);
  const categories = Object.keys(byCategory).sort();

  const existingInArea = new Set(
    items
      .filter((i) => !i.deleted && i.division === activeArea)
      .map((i) => i.line_item.trim().toLowerCase())
  );
  const guestroomAreas = new Set(["GUESTROOMS", "SUITES", "SIGNATURE SUITES"]);
  const needsMatrix = guestroomAreas.has(activeArea) && mixTotal === 0;

  return (
    <div className="mb-4 bg-white border border-gencom-sand rounded-lg overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gencom-mist/40"
      >
        <span className="font-medium">Quick-add from catalog</span>
        <span className="text-xs text-gencom-stone">
          {needsMatrix ? "Fill in the guestroom matrix on Setup to enable" : "Click items to auto-populate qty & cost"}
          {" "}{show ? "▾" : "▸"}
        </span>
      </button>
      {show && (
        <div className="px-4 pb-4 pt-1 border-t border-gencom-sand">
          {/* Area tabs */}
          <div className="flex flex-wrap gap-1 mb-3">
            {knownDivisions.map((d) => {
              const count = SCOPE_CATALOG.filter((e) => e.division === d).length;
              if (count === 0 && !items.some((i) => i.division === d)) return null;
              const isActive = d === activeArea;
              return (
                <button
                  key={d}
                  onClick={() => setActiveArea(d)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition ${
                    isActive
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-gencom-sand bg-white hover:border-emerald-700/40"
                  }`}
                >
                  {d} <span className="opacity-60">({count})</span>
                </button>
              );
            })}
          </div>

          {forArea.length === 0 ? (
            <div className="text-sm text-gencom-stone italic py-2">
              No catalog presets for {activeArea} yet. Use "+ Add Row" below to enter items manually.
            </div>
          ) : (
            categories.map((cat) => {
              const list = byCategory[cat];
              const available = list.filter((e) => !existingInArea.has(e.label.trim().toLowerCase()));
              if (available.length === 0) {
                return (
                  <div key={cat} className="mt-2">
                    <div className="text-xs uppercase text-gencom-stone mb-1 tracking-wide">
                      {cat} <span className="normal-case">— all {list.length} added ✓</span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={cat} className="mt-3">
                  <div className="text-xs uppercase text-gencom-stone mb-1.5 tracking-wide">
                    {cat}
                    {list.length - available.length > 0 && (
                      <span className="text-[10px] normal-case ml-2 text-gencom-stone/70">
                        ({list.length - available.length} added)
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {available.map((e) => {
                      const qty = e.quantity(mix, totalKeysVal);
                      const basis = e.quantity.__basis;
                      // Disable if the scaling basis is unavailable. Per-basis
                      // items with basis=0 can't compute a meaningful total yet.
                      const disabled =
                        (basis === "keys" && totalKeysVal <= 0) ||
                        (!basis && qty <= 0 && guestroomAreas.has(e.division));
                      const qtyLabel = basis === "keys"
                        ? `${qty.toLocaleString()} per key × ${totalKeysVal.toLocaleString()} keys`
                        : `${qty.toLocaleString()} ${e.unit}`;
                      // When browsing the SUITES tab but adding a GUESTROOMS
                      // catalog entry, file it under SUITES division.
                      const applyDivision = activeArea === "SUITES" && e.division === "GUESTROOMS"
                        ? "SUITES"
                        : undefined;
                      return (
                        <button
                          key={e.key}
                          disabled={disabled}
                          onClick={() => onApply(e, applyDivision)}
                          title={e.description}
                          className={`group px-3 py-1.5 text-xs rounded-md border transition text-left ${
                            disabled
                              ? "border-gencom-sand/50 bg-gencom-mist/30 text-gencom-stone cursor-not-allowed"
                              : "border-gencom-sand bg-white hover:border-emerald-700 hover:shadow-sm"
                          }`}
                        >
                          <div className="font-medium">{e.label}</div>
                          <div className="text-[10px] text-gencom-stone">qty: {qtyLabel}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
          <div className="mt-3 text-xs text-gencom-stone">
            Full catalog lives on the Scope Overview tab.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PIP Generator → Scope import ────────────────────────────────────────
// Pulls candidate scope items from PIP answers (stored in localStorage by
// the PIP Generator page), matches them to catalog entries where possible,
// and batch-creates scope items for the ones the user keeps checked.

const PIP_LS_KEY = "pipbudget.pipGeneratorAnswers";

type PipCandidate = {
  label: string;
  qid: string;
  source_key: string;
  default_division: string;
  catalog: ScopeCatalogEntry | null;
  already_added: boolean;
};

type PipGroup = { title: string; qid: string; candidates: PipCandidate[] };

const PIP_SOURCES: {
  qid: string;
  title: string;
  division: string;
  sub_keys?: string[];
}[] = [
  { qid: "q13", title: "Guestroom FF&E", division: "GUESTROOMS",
    sub_keys: ["soft_goods_detail", "case_goods_detail", "lighting_detail", "tech_detail", "full_scope_items"] },
  { qid: "q14", title: "Guest bathroom", division: "GUESTROOMS",
    sub_keys: ["bath_casegoods_detail", "bath_softgoods_detail", "bath_plumbing_detail",
               "bath_finishes_detail", "bath_lighting_detail", "bath_fixtures_detail", "full_scope_items"] },
  { qid: "q15", title: "In-room MEP", division: "GUESTROOMS" },
  { qid: "q16", title: "Corridors", division: "CORRIDORS" },
  { qid: "q17", title: "Public areas", division: "COMMON AREA" },
  { qid: "q18", title: "F&B outlets", division: "F&B" },
  { qid: "q20", title: "Amenities & recreation", division: "COMMON AREA" },
  { qid: "q21", title: "Vertical transportation", division: "DEFERRED MAINTENANCE" },
  { qid: "q22", title: "Back of house", division: "MISC. ITEMS" },
  { qid: "q23", title: "Building envelope", division: "DEFERRED MAINTENANCE" },
  { qid: "q24", title: "MEP systems", division: "DEFERRED MAINTENANCE" },
];

const PIP_SKIP_VALUES = new Set([
  "none", "not in scope", "refresh only", "cosmetic refresh",
  "full gut", "other",
]);

function pipNormalizeLabel(s: string): string {
  return s.toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/[^\w\s&/-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectPipCandidates(
  answers: Record<string, unknown>,
  existingItems: ScopeItem[],
): PipGroup[] {
  const catalogByLabel = new Map<string, ScopeCatalogEntry>();
  for (const e of SCOPE_CATALOG) catalogByLabel.set(pipNormalizeLabel(e.label), e);

  const existingLabels = new Set(
    existingItems.map((i) => pipNormalizeLabel(i.line_item)),
  );

  const groups: PipGroup[] = [];
  for (const src of PIP_SOURCES) {
    const ans = answers[src.qid];
    const raw: { value: string; source_key: string }[] = [];

    const primary = (() => {
      if (ans == null) return null;
      if (typeof ans === "string") return ans;
      if (Array.isArray(ans)) return ans;
      if (typeof ans === "object" && "primary" in (ans as any)) return (ans as any).primary;
      return null;
    })();
    if (Array.isArray(primary)) {
      for (const v of primary) if (typeof v === "string") raw.push({ value: v, source_key: "primary" });
    } else if (typeof primary === "string" && primary.trim()) {
      raw.push({ value: primary, source_key: "primary" });
    }

    if (src.sub_keys && ans && typeof ans === "object" && !Array.isArray(ans)) {
      for (const k of src.sub_keys) {
        const sub = (ans as Record<string, unknown>)[k];
        if (Array.isArray(sub)) {
          for (const v of sub) if (typeof v === "string") raw.push({ value: v, source_key: k });
        }
      }
    }

    const seen = new Set<string>();
    const candidates: PipCandidate[] = [];
    for (const { value, source_key } of raw) {
      const norm = pipNormalizeLabel(value);
      if (!norm || PIP_SKIP_VALUES.has(norm)) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      const catalog = catalogByLabel.get(norm) ?? null;
      candidates.push({
        label: catalog ? catalog.label : value.trim(),
        qid: src.qid,
        source_key,
        default_division: src.division,
        catalog,
        already_added: existingLabels.has(catalog ? pipNormalizeLabel(catalog.label) : norm),
      });
    }
    if (candidates.length > 0) groups.push({ title: src.title, qid: src.qid, candidates });
  }
  return groups;
}

function pipPropertyName(answers: Record<string, unknown>): string | null {
  const q1 = answers.q1;
  if (!q1) return null;
  if (typeof q1 === "string") return q1;
  if (typeof q1 === "object" && !Array.isArray(q1)) {
    const name = (q1 as any).property_name;
    if (typeof name === "string" && name.trim()) return name.trim();
    const prim = (q1 as any).primary;
    return typeof prim === "string" ? prim : null;
  }
  return null;
}

function PipGeneratorImportModal({
  propertyId, mix, keys, existingItems, onClose, onImported,
}: {
  propertyId: string;
  mix: GuestroomMix;
  keys: number;
  existingItems: ScopeItem[];
  onClose: () => void;
  onImported: (created: ScopeItem[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIP_LS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      setAnswers(parsed || {});
    } catch {
      setAnswers({});
    }
  }, []);

  const groups = useMemo(
    () => answers ? collectPipCandidates(answers, existingItems) : [],
    [answers, existingItems],
  );
  const totalCandidates = groups.reduce((s, g) => s + g.candidates.length, 0);
  const availableCount = groups.reduce(
    (s, g) => s + g.candidates.filter((c) => !c.already_added).length, 0);

  function keyOf(c: PipCandidate): string {
    return `${c.qid}::${c.source_key}::${pipNormalizeLabel(c.label)}`;
  }

  useEffect(() => {
    if (!answers) return;
    const next = new Set<string>();
    for (const g of groups) {
      for (const c of g.candidates) if (!c.already_added) next.add(keyOf(c));
    }
    setSelected(next);
  }, [answers, groups]);

  function toggle(c: PipCandidate) {
    setSelected((s) => {
      const n = new Set(s);
      const k = keyOf(c);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  }

  function selectAll(on: boolean) {
    if (!on) { setSelected(new Set()); return; }
    const next = new Set<string>();
    for (const g of groups) {
      for (const c of g.candidates) if (!c.already_added) next.add(keyOf(c));
    }
    setSelected(next);
  }

  async function apply() {
    setApplying(true);
    setError(null);
    const created: ScopeItem[] = [];
    try {
      for (const g of groups) {
        for (const c of g.candidates) {
          if (!selected.has(keyOf(c)) || c.already_added) continue;
          const payload = c.catalog
            ? {
                division: c.catalog.division,
                line_item: c.catalog.label,
                description: c.catalog.description,
                quantity: Math.max(1, c.catalog.quantity(mix, keys) || 1),
                unit: c.catalog.unit,
                source: "pip" as const,
                priority: "recommended" as const,
                multiplier_basis: c.catalog.quantity.__basis ?? null,
              }
            : {
                division: c.default_division,
                line_item: c.label,
                quantity: 1,
                unit: "allowance",
                source: "pip" as const,
                priority: "recommended" as const,
              };
          const row = await api.createScope(propertyId, payload);
          created.push(row);
        }
      }
      onImported(created);
    } catch (e) {
      setError(String(e));
    } finally {
      setApplying(false);
    }
  }

  const pipName = answers ? pipPropertyName(answers) : null;

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl my-8">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gencom-sand">
          <div>
            <div className="font-display text-xl">Import from PIP Generator</div>
            <div className="text-xs text-gencom-stone">
              {pipName
                ? <>Pulling scope from PIP answers for <b>{pipName}</b>. Uncheck anything you don't want to add.</>
                : "Pulling scope from saved PIP Generator answers."}
            </div>
          </div>
          <button onClick={onClose} className="text-gencom-stone hover:text-gencom-ink text-xl leading-none">×</button>
        </div>
        <div className="p-5 max-h-[65vh] overflow-y-auto">
          {!answers && <div className="text-sm text-gencom-stone">Loading…</div>}
          {answers && totalCandidates === 0 && (
            <div className="text-sm text-gencom-stone border border-dashed border-gencom-sand rounded p-4 text-center">
              No PIP scope data found on this device.
              {" "}<Link to="/pip-generator" className="text-gencom-gold hover:underline">
                Open the PIP Generator →
              </Link>
            </div>
          )}
          {answers && totalCandidates > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between text-xs text-gencom-stone">
                <div>
                  {selected.size} of {availableCount} importable
                  {availableCount !== totalCandidates && <> · {totalCandidates - availableCount} already in scope</>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => selectAll(true)} className="hover:text-gencom-ink underline underline-offset-2">Select all</button>
                  <button onClick={() => selectAll(false)} className="hover:text-gencom-ink underline underline-offset-2">Clear</button>
                </div>
              </div>
              <div className="space-y-3">
                {groups.map((g) => (
                  <div key={g.qid} className="border border-gencom-sand rounded-md overflow-hidden">
                    <div className="px-3 py-1.5 bg-gencom-mist/60 text-sm font-medium flex items-center justify-between">
                      <span>{g.title}</span>
                      <span className="text-xs text-gencom-stone">{g.candidates.length} items</span>
                    </div>
                    <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {g.candidates.map((c) => {
                        const k = keyOf(c);
                        const on = selected.has(k);
                        return (
                          <label
                            key={k}
                            className={`flex items-start gap-2 text-sm rounded px-2 py-1 border ${
                              c.already_added ? "border-transparent opacity-50 cursor-not-allowed" :
                              on ? "border-gencom-gold bg-gencom-gold/5 cursor-pointer" :
                                   "border-transparent hover:bg-gencom-mist/40 cursor-pointer"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={c.already_added}
                              onChange={() => toggle(c)}
                              className="mt-0.5"
                            />
                            <span className="flex-1 leading-snug">
                              {c.label}
                              {c.catalog && (
                                <span className="ml-1.5 text-[10px] uppercase tracking-wider text-emerald-700">
                                  · catalog
                                </span>
                              )}
                              {c.already_added && (
                                <span className="ml-1.5 text-[10px] uppercase tracking-wider text-gencom-stone">
                                  · already added
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {error && (
                <div className="mt-3 text-sm text-red-700 border border-red-300 bg-red-50 rounded p-2">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gencom-sand flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm border border-gencom-sand rounded bg-white hover:bg-gencom-mist"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={applying || selected.size === 0}
            className="px-3 py-1.5 text-sm bg-gencom-ink text-gencom-mist rounded hover:bg-gencom-ink/90 disabled:opacity-50"
          >
            {applying ? "Importing…" : `Import ${selected.size} item${selected.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Compact (Excel-style) view ──────────────────────────────────────────
// Same edits as the detailed view — same patch handlers, same AI / DB
// buttons, same multiplier basis selector — distilled into a clean tabular
// layout with section banners and per-division subtotals (incl. $/Key).
type CompactColKey = "area" | "item" | "description" | "count" | "unitType" | "unitCost" | "budget" | "notes";

type CompactTableProps = {
  property: Property;
  propertyId: string;
  groupedWithSubAreas: Record<string, Record<string, ScopeItem[]>>;
  expandedDivisions: Set<string>;
  toggleDivision: (d: string) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  patch: (id: string, payload: Partial<ScopeItem>) => Promise<void>;
  handleDelete: (item: ScopeItem) => Promise<void>;
  rematch: (item: ScopeItem) => Promise<void>;
  openBreakdown: (item: ScopeItem) => Promise<void>;
  brokenDownIds: Set<string>;
  ackFlags: Set<string>;
  acknowledgeCostFlag: (id: string) => void;
  filtered: ScopeItem[];
  addRow: (divisionHint?: string) => Promise<void>;
  colWidths: Record<CompactColKey, number>;
  setColWidth: (key: CompactColKey, value: number) => void;
};

// Column header that lets the user drag its right edge to resize. We do the
// drag with global mousemove/mouseup listeners (not React state) so we don't
// re-render the entire table on every mouse step.
function ResizableTh({
  width, onResize, align = "left", children,
}: {
  width: number;
  onResize: (newWidth: number) => void;
  align?: "left" | "right" | "center";
  children: React.ReactNode;
}) {
  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      onResize(startW + dx);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
  return (
    <th
      className={`px-2 py-1.5 font-semibold ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`}
      style={{ width, position: "relative" }}
    >
      {children}
      {/* Two small grip lines, visible only on the green header — they mark
          where the column boundary is and act as the drag handle. The body
          rows stay clean (no separator line continues down the table). */}
      <span
        onMouseDown={handleMouseDown}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-0 right-0 h-full w-3 flex items-center justify-center cursor-col-resize group"
        style={{ userSelect: "none" }}
        title="Drag to resize column"
      >
        <span className="flex gap-[2px]">
          <span className="block w-px h-3 bg-white/70 group-hover:bg-emerald-200" />
          <span className="block w-px h-3 bg-white/70 group-hover:bg-emerald-200" />
        </span>
      </span>
    </th>
  );
}

function CompactTable(props: CompactTableProps) {
  const {
    property, propertyId, groupedWithSubAreas, expandedDivisions, toggleDivision,
    selected, setSelected, patch, handleDelete, rematch, openBreakdown,
    brokenDownIds, ackFlags, acknowledgeCostFlag, filtered, addRow,
    colWidths, setColWidth,
  } = props;
  const totalK = property.keys ?? 0;
  const tableWidth = 24 + 24 + colWidths.area + colWidths.item + colWidths.description
    + colWidths.count + colWidths.unitType + colWidths.unitCost + colWidths.budget + colWidths.notes;

  return (
    <div className="overflow-x-auto w-full">
      <div className="bg-white border border-gencom-sand rounded-lg overflow-hidden min-w-0">
        {/* Table fills the container at minimum (no right-side gap) and grows
            past it when the user widens columns beyond the container. */}
        <table className="text-xs border-collapse table-fixed w-full" style={{ minWidth: tableWidth }}>
          <thead className="bg-emerald-800 text-white text-[10px] uppercase tracking-wider">
            <tr>
              <th className="px-1 py-1.5 w-6"></th>
              <ResizableTh width={colWidths.area} onResize={(w) => setColWidth("area", w)}>Area</ResizableTh>
              <ResizableTh width={colWidths.item} onResize={(w) => setColWidth("item", w)}>Item</ResizableTh>
              <ResizableTh width={colWidths.description} onResize={(w) => setColWidth("description", w)}>Description</ResizableTh>
              <ResizableTh width={colWidths.count} onResize={(w) => setColWidth("count", w)} align="right">Count</ResizableTh>
              <ResizableTh width={colWidths.unitType} onResize={(w) => setColWidth("unitType", w)}>Unit Type</ResizableTh>
              <ResizableTh width={colWidths.unitCost} onResize={(w) => setColWidth("unitCost", w)} align="center">Unit Cost</ResizableTh>
              <ResizableTh width={colWidths.budget} onResize={(w) => setColWidth("budget", w)} align="right">Budget</ResizableTh>
              <ResizableTh width={colWidths.notes} onResize={(w) => setColWidth("notes", w)}>Notes</ResizableTh>
              <th className="px-1 py-1.5 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(groupedWithSubAreas).map(([division, subMap]) => {
              const expanded = expandedDivisions.has(division);
              const allRows = Object.values(subMap).flat();
              const divTotal = allRows.reduce((s, i) => s + (i.included_in_budget ? i.line_total : 0), 0);
              const perKey = totalK > 0 ? divTotal / totalK : 0;
              const preset = subAreasForDivision(division);
              const subOrder = [
                ...preset.filter((s) => s in subMap),
                ...Object.keys(subMap).filter((s) => s !== "(unassigned)" && !preset.includes(s)).sort(),
                ...(subMap["(unassigned)"] ? ["(unassigned)"] : []),
              ];
              const flatRows = subOrder.flatMap((s) => subMap[s] ?? []);

              return (
                <Fragment key={division}>
                  <tr className="bg-emerald-50 border-y border-emerald-200 text-[11px] uppercase tracking-wider text-emerald-900">
                    <td className="px-1 py-1 align-middle">
                      <button
                        onClick={() => toggleDivision(division)}
                        className="inline-flex items-center justify-center w-4 h-4 text-[11px] leading-none font-bold rounded border border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100"
                        aria-label={expanded ? "Collapse" : "Expand"}
                        title={expanded ? "Collapse division" : "Expand division"}
                      >{expanded ? "−" : "+"}</button>
                    </td>
                    <td className="px-2 py-1 font-semibold">
                      {division}
                      <span className="ml-2 font-medium text-emerald-700">({allRows.length})</span>
                    </td>
                    <td className="px-2 py-1 font-semibold">Item</td>
                    <td colSpan={6} className="px-2 py-1 text-right">
                      <button
                        onClick={() => addRow(division)}
                        className="text-emerald-700 hover:text-emerald-900 underline"
                      >+ row</button>
                    </td>
                    <td className="px-2 py-1"></td>
                  </tr>

                  {expanded && flatRows.map((item, idx) => (
                    <CompactRow
                      key={item.id}
                      item={item}
                      altRow={idx % 2 === 1}
                      propertyId={propertyId}
                      isSelected={selected === item.id}
                      onSelect={() => setSelected(item.id)}
                      patch={patch}
                      handleDelete={handleDelete}
                      rematch={rematch}
                      openBreakdown={openBreakdown}
                      brokenDownIds={brokenDownIds}
                      ackFlags={ackFlags}
                      acknowledgeCostFlag={acknowledgeCostFlag}
                    />
                  ))}

                  {expanded && (
                    <tr className="bg-emerald-100/70 border-t border-emerald-300 font-bold text-emerald-900">
                      <td colSpan={7} className="px-2 py-1.5 text-right uppercase text-[10px] tracking-wider">
                        {division} Subtotal
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{formatMoney(divTotal)}</td>
                      <td colSpan={2} className="px-2 py-1.5 text-right text-[10px] italic text-emerald-700 font-medium">
                        {totalK > 0 ? `${formatMoney(perKey)}/Key` : ""}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="p-12 text-center text-gencom-stone">
                  No scope items yet.
                  <div className="mt-3">
                    <button onClick={() => addRow()} className="px-3 py-1.5 bg-gencom-ink text-gencom-mist rounded-md">
                      + Add your first line item
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompactRow({
  item, altRow, propertyId, isSelected, onSelect,
  patch, handleDelete, rematch, openBreakdown, brokenDownIds,
  ackFlags, acknowledgeCostFlag,
}: {
  item: ScopeItem;
  altRow: boolean;
  propertyId: string;
  isSelected: boolean;
  onSelect: () => void;
  patch: (id: string, payload: Partial<ScopeItem>) => Promise<void>;
  handleDelete: (item: ScopeItem) => Promise<void>;
  rematch: (item: ScopeItem) => Promise<void>;
  openBreakdown: (item: ScopeItem) => Promise<void>;
  brokenDownIds: Set<string>;
  ackFlags: Set<string>;
  acknowledgeCostFlag: (id: string) => void;
}) {
  const warn = checkCostSanity(item, ackFlags);
  const priorityColor =
    item.priority === "required" ? "bg-red-500" :
    item.priority === "recommended" ? "bg-amber-500" :
    item.priority === "optional" ? "bg-blue-500" :
    "bg-gray-300";
  const rowBg = isSelected
    ? "bg-emerald-50/60"
    : altRow ? "bg-gencom-sand/15" : "bg-white";

  // No body-cell separators — the resize-handle grip on the green header
  // is the only visual indicator of column boundaries.
  const cellSep = "";
  return (
    <tr
      onClick={onSelect}
      className={`border-b border-gencom-sand/30 hover:bg-emerald-50/40 cursor-pointer align-top ${rowBg} ${!item.included_in_budget ? "opacity-50" : ""}`}
    >
      <td className={`px-1 py-1 text-center ${cellSep}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center gap-0.5">
          <input
            type="checkbox"
            checked={item.included_in_budget}
            onChange={(e) => patch(item.id, { included_in_budget: e.target.checked })}
            title={item.included_in_budget ? "Included — uncheck to exclude from budget" : "Excluded — check to include"}
          />
          <span className={`w-1.5 h-1.5 rounded-full ${priorityColor}`} title={`Priority: ${item.priority}`} />
        </div>
      </td>

      <td className={`px-2 py-1 ${cellSep}`} onClick={(e) => e.stopPropagation()}>
        <SubAreaPicker
          division={item.division}
          value={item.sub_area}
          onSave={(v) => patch(item.id, { sub_area: v })}
        />
      </td>

      <td className={`px-2 py-1 ${cellSep}`}>
        <InlineText
          value={item.line_item}
          onSave={(v) => patch(item.id, { line_item: v })}
          className="font-medium"
        />
      </td>

      <td className={`px-2 py-1 align-middle ${cellSep}`}>
        <div
          className="text-[11px] leading-snug text-gencom-stone overflow-hidden"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
          title={item.description ?? ""}
        >
          {item.description?.trim() || <span className="text-gencom-stone/50">—</span>}
        </div>
      </td>

      <td className={`px-2 py-1 text-right ${cellSep}`} onClick={(e) => e.stopPropagation()}>
        <InlineNumber
          value={item.quantity}
          onSave={(v) => patch(item.id, { quantity: v ?? 0 })}
          className="font-mono text-xs"
        />
        <select
          value={item.multiplier_basis ?? ""}
          onChange={(e) => patch(item.id, { multiplier_basis: (e.target.value || null) as ScopeItem["multiplier_basis"] })}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 w-full text-[9px] text-gencom-stone bg-transparent border border-transparent hover:border-gencom-sand rounded px-0.5 py-0 text-right"
          title="Quantity multiplier basis"
        >
          <option value="">× 1</option>
          <option value="keys">× keys</option>
          <option value="keys_pct">% of keys</option>
          <option value="doubles">× doubles</option>
          <option value="suites">× suites</option>
          <option value="floors">× floors</option>
          <option value="kings_only">× kings only</option>
          <option value="double_double_only">× double-double only</option>
          <option value="non_suite">× non-suite</option>
        </select>
        {item.multiplier_basis && (
          <div className="text-[9px] text-gencom-stone font-mono leading-tight">
            = {item.effective_quantity.toLocaleString()}
          </div>
        )}
      </td>

      <td className={`px-2 py-1 ${cellSep}`} onClick={(e) => e.stopPropagation()}>
        <InlineSelect
          value={item.unit}
          options={UNITS}
          onSave={(v) => {
            const autoBasis: ScopeItem["multiplier_basis"] =
              v === "per key" ? "keys" :
              v === "% of keys" ? "keys_pct" :
              v === "doubles only" ? "doubles" :
              v === "suites only" ? "suites" : null;
            const payload: Partial<ScopeItem> = { unit: v };
            if (autoBasis && !item.multiplier_basis) payload.multiplier_basis = autoBasis;
            patch(item.id, payload);
          }}
        />
      </td>

      <td className={`px-2 py-1 text-center ${cellSep}`} onClick={(e) => e.stopPropagation()}>
        <UnitCostCell
          item={item}
          propertyId={propertyId}
          onOverride={(v) => patch(item.id, { override_unit_cost: v })}
          onRematch={() => rematch(item)}
        />
      </td>

      <td className={`px-2 py-1 text-right font-mono whitespace-nowrap ${cellSep}`}>
        <div className="flex items-center justify-end gap-1">
          {warn.level !== "none" && (
            <span
              onClick={(e) => { e.stopPropagation(); acknowledgeCostFlag(item.id); }}
              className={`px-1 border rounded text-[9px] leading-none cursor-pointer ${
                warn.level === "alert"
                  ? "bg-red-100 text-red-800 border-red-400 hover:bg-red-200"
                  : "bg-amber-100 text-amber-800 border-amber-400 hover:bg-amber-200"
              }`}
              title={`${warn.message} — click to acknowledge`}
            >⚠</span>
          )}
          <span>{formatMoney(item.line_total)}</span>
        </div>
      </td>

      <td className={`px-2 py-1 ${cellSep}`}>
        <div className="flex items-center gap-1">
          <InlineText
            value={item.notes ?? ""}
            placeholder="—"
            onSave={(v) => patch(item.id, { notes: v })}
            className="text-xs italic text-gencom-stone"
          />
          {item.source !== "manual"
            && (item.description?.length ?? 0) < 80
            && !brokenDownIds.has(item.id) && (
            <button
              onClick={(e) => { e.stopPropagation(); openBreakdown(item); }}
              title="Break this down into specific items using AI"
              className="shrink-0 text-[10px] px-1 py-0 border border-gencom-sand rounded hover:bg-gencom-mist/60 text-gencom-stone hover:text-gencom-ink"
            >🪄</button>
          )}
        </div>
      </td>

      <td className="px-1 py-1 text-right">
        <button
          onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
          className="text-gencom-stone hover:text-red-700 text-base leading-none"
          title={item.source === "manual" ? "Delete" : "Soft delete"}
        >×</button>
      </td>
    </tr>
  );
}
