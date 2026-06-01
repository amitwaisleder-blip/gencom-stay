import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PropertyNav from "../components/PropertyNav";
import BackToTop from "../components/BackToTop";
import TotalsBar from "../components/TotalsBar";
import { api, formatMoney, type Property, type ScopeItem, type ScopeReviewSuggestion } from "../lib/api";
import {
  SCOPE_CATALOG, isAlreadyAdded,
  type ScopeCatalogEntry, type ScopeCategory,
} from "../lib/scopeCatalog";
import { totalKeys, type GuestroomMix } from "../lib/guestroomTemplates";

type Mode = "catalog" | "added";
type SortMode = "default" | "alpha";

// Order categories we want to surface first.
const FFE_CATEGORIES: ScopeCategory[] = [
  "Soft goods",
  "Casegoods",
  "Seating",
  "Lighting",
  "Art & accessories",
  "Window treatment hardware",
  "Wall/floor/ceiling finishes",
  "Bath FF&E",
  "OS&E",
  "Technology/AV",
  "Signage & wayfinding",
  "Corridor-specific",
  "Common area-specific",
];

const FNB_CATEGORIES: ScopeCategory[] = [
  "Restaurant/Bar",
  "Kitchen & F&B equipment",
];

const DM_CATEGORIES: ScopeCategory[] = [
  "DM — Roof",
  "DM — Exterior envelope",
  "DM — Structural",
  "DM — HVAC",
  "DM — Electrical",
  "DM — Plumbing",
  "DM — Fire & life safety",
  "DM — Vertical transportation",
  "DM — Pool & water features",
  "DM — Laundry",
  "DM — IT / low voltage",
  "DM — Site & hardscape",
  "DM — Landscape & irrigation",
  "DM — Parking garage",
  "DM — Life safety & code",
  "DM — Guestroom MEP & finishes",
  "DM — Back of house",
];

const SECTIONS: { title: string; categories: ScopeCategory[] }[] = [
  { title: "FF&E", categories: FFE_CATEGORIES },
  { title: "F&B", categories: FNB_CATEGORIES },
  { title: "Deferred Maintenance", categories: DM_CATEGORIES },
];

export default function ScopeOverview() {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [items, setItems] = useState<ScopeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("added");
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  // Sections collapsed by default so the page opens compact — user expands
  // whichever section they want to focus on.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(SECTIONS.map((s) => s.title)),
  );
  // Per-category expansion within a section — click to open and see items.
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<ScopeReviewSuggestion[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  function toggleSection(title: string) {
    setCollapsedSections((s) => {
      const next = new Set(s);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });
  }
  function toggleCategory(cat: string) {
    setExpandedCategories((s) => {
      const next = new Set(s);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  async function runSuggestions() {
    if (!propertyId) return;
    setSuggestionsOpen(true);
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    setSuggestions(null);
    try {
      const r = await api.scopeSuggestions(propertyId);
      setSuggestions(r.suggestions || []);
    } catch (e) {
      setSuggestionsError(String(e));
    } finally {
      setSuggestionsLoading(false);
    }
  }

  async function refresh() {
    if (!propertyId) return;
    setLoading(true);
    try {
      const [p, s] = await Promise.all([api.getProperty(propertyId), api.listScope(propertyId)]);
      setProperty(p);
      setItems(s);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [propertyId]);

  const mix: GuestroomMix = (property?.guestroom_mix as GuestroomMix) ?? {};
  const keys = totalKeys(mix, property?.keys ?? 0);

  const includedItems = useMemo(() => items.filter((i) => !i.deleted), [items]);

  async function addFromCatalog(entry: ScopeCatalogEntry) {
    if (!propertyId) return;
    setAdding((s) => new Set(s).add(entry.key));
    try {
      const qty = entry.quantity(mix, keys);
      const basis = entry.quantity.__basis ?? null;
      // Per-basis items (perKey/perFloor) need a positive basis value. Absolute
      // items need positive qty. Storing multiplier_basis lets the backend
      // scale the qty with the property's keys/floors so unit-price × effective
      // quantity gives the right total.
      if (basis === "keys" && keys <= 0) {
        alert(`Can't add "${entry.label}" — property has 0 keys. Fill the guestroom matrix on Setup first.`);
        return;
      }
      if (!basis && qty <= 0) {
        alert(`Computed qty is 0 for "${entry.label}". Fill in the guestroom matrix on Setup first.`);
        return;
      }
      const created = await api.createScope(propertyId, {
        division: entry.division,
        line_item: entry.label,
        description: entry.description,
        quantity: qty,
        unit: entry.unit,
        source: "manual",
        priority: "recommended",
        multiplier_basis: basis,
      });
      setItems((xs) => [...xs, created]);
    } finally {
      setAdding((s) => { const next = new Set(s); next.delete(entry.key); return next; });
    }
  }

  if (loading && !property) return <div className="text-gencom-stone">Loading…</div>;
  if (!property) return <div>Property not found.</div>;

  const byCategory: Record<string, ScopeCatalogEntry[]> = {};
  for (const e of SCOPE_CATALOG) (byCategory[e.category] ||= []).push(e);

  // Per-category counts for added items.
  const addedCount: Record<string, number> = {};
  for (const e of SCOPE_CATALOG) {
    if (isAlreadyAdded(e, includedItems)) addedCount[e.category] = (addedCount[e.category] ?? 0) + 1;
  }

  const visibleCats = new Set<ScopeCategory>(Object.keys(byCategory) as ScopeCategory[]);

  return (
    <div>
      <PropertyNav />

      <TotalsBar propertyId={propertyId!} keys={property.keys} />

      <div className="mb-6">
        <h1 className="font-display text-3xl">Overview</h1>
        <div className="text-sm text-gencom-stone">
          Click items below to add them to your scope. Qty is auto-computed from the guestroom matrix.
          {keys === 0 && (
            <>
              {" "}<Link to={`/properties/${propertyId}/setup`} className="text-gencom-gold hover:underline">
                Fill in the matrix on Setup →
              </Link>
            </>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search categories or line items…"
            className="flex-1 max-w-md border border-gencom-sand rounded-md px-3 py-1.5 text-sm bg-white"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-xs text-gencom-stone hover:text-gencom-ink"
            >
              clear
            </button>
          )}
          <div className="flex gap-1 bg-white border border-gencom-sand rounded-md p-0.5 text-xs">
            <button
              onClick={() => setSortMode("default")}
              className={`px-2 py-1 rounded ${sortMode === "default" ? "bg-gencom-ink text-gencom-mist" : "text-gencom-stone hover:text-gencom-ink"}`}
              title="Default section order"
            >
              Default
            </button>
            <button
              onClick={() => setSortMode("alpha")}
              className={`px-2 py-1 rounded ${sortMode === "alpha" ? "bg-gencom-ink text-gencom-mist" : "text-gencom-stone hover:text-gencom-ink"}`}
              title="Sort categories alphabetically within each section"
            >
              A→Z
            </button>
          </div>
          <button
            onClick={() => setCollapsedSections(
              collapsedSections.size === SECTIONS.length
                ? new Set()
                : new Set(SECTIONS.map((s) => s.title)),
            )}
            className="text-xs border border-gencom-sand rounded px-2 py-1 hover:border-gencom-ink bg-white"
          >
            {collapsedSections.size === SECTIONS.length ? "Expand all" : "Collapse all"}
          </button>
          <button
            onClick={runSuggestions}
            disabled={suggestionsLoading}
            className="text-xs bg-gencom-gold text-gencom-ink font-semibold px-3 py-1 rounded border border-gencom-gold hover:bg-gencom-gold/80 disabled:opacity-60"
            title="Review the full scope with AI — flags items missing, mis-counted, or that don't fit the property"
          >
            {suggestionsLoading ? "Running…" : "💡 Suggestions"}
          </button>
        </div>
      </div>

      {/* View mode switch */}
      <div className="mb-4 flex gap-1 bg-white border border-gencom-sand rounded-md p-1 text-sm w-fit">
        <button
          onClick={() => setMode("catalog")}
          className={`px-3 py-1.5 rounded-md ${mode === "catalog" ? "bg-gencom-ink text-gencom-mist" : "text-gencom-stone"}`}
        >
          Browse catalog
        </button>
        <button
          onClick={() => setMode("added")}
          className={`px-3 py-1.5 rounded-md ${mode === "added" ? "bg-gencom-ink text-gencom-mist" : "text-gencom-stone"}`}
        >
          Already added ({includedItems.length})
        </button>
      </div>

      {mode === "catalog" ? (
        <>
          {SECTIONS.map((section) => {
            const needle = search.trim().toLowerCase();
            // Filter categories by search: match on category name OR any entry label.
            let sectionCats = section.categories.filter((c) => {
              if (!visibleCats.has(c)) return false;
              if (!needle) return true;
              if (c.toLowerCase().includes(needle)) return true;
              return (byCategory[c] ?? []).some((e) =>
                e.label.toLowerCase().includes(needle)
                || (e.description ?? "").toLowerCase().includes(needle),
              );
            });
            if (sortMode === "alpha") {
              sectionCats = [...sectionCats].sort((a, b) =>
                a.replace(/^DM — /, "").localeCompare(b.replace(/^DM — /, "")),
              );
            }
            if (needle && sectionCats.length === 0) return null;
            // When searching, auto-expand so results are visible without extra clicks.
            const isCollapsed = !needle && collapsedSections.has(section.title);
            const sectionTotal = sectionCats.reduce(
              (s, c) => s + (byCategory[c]?.length ?? 0), 0,
            );
            const sectionAdded = sectionCats.reduce(
              (s, c) => s + (addedCount[c] ?? 0), 0,
            );
            return (
              <div key={section.title} className="mb-4 border border-gencom-sand rounded-lg bg-white overflow-hidden">
                <button
                  onClick={() => toggleSection(section.title)}
                  className="w-full flex items-center justify-between px-4 py-2 bg-gencom-mist hover:bg-gencom-mist/70 border-b border-gencom-sand"
                  aria-expanded={!isCollapsed}
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 text-sm leading-none font-bold rounded border border-gencom-sand bg-white text-gencom-ink">
                      {isCollapsed ? "+" : "−"}
                    </span>
                    <h2 className="font-display text-xl">{section.title}</h2>
                  </div>
                  <div className="text-xs text-gencom-stone">
                    {sectionAdded > 0 ? `${sectionAdded}/${sectionTotal} added` : `${sectionTotal} categories`}
                  </div>
                </button>

                {!isCollapsed && (
                  <div className="p-3 space-y-2">
                    {sectionCats.map((cat) => {
                      const entries = byCategory[cat] ?? [];
                      const total = entries.length;
                      const added = addedCount[cat] ?? 0;
                      // Auto-expand categories when searching so matches are visible.
                      const isExpanded = needle !== "" || expandedCategories.has(cat);
                      const filteredEntries = entries.filter((entry) => {
                        if (!needle) return true;
                        return entry.label.toLowerCase().includes(needle)
                          || (entry.description ?? "").toLowerCase().includes(needle)
                          || cat.toLowerCase().includes(needle);
                      });
                      const sortedEntries = sortMode === "alpha"
                        ? [...filteredEntries].sort((a, b) => a.label.localeCompare(b.label))
                        : filteredEntries;
                      return (
                        <div key={cat} className="border border-gencom-sand rounded-md overflow-hidden">
                          <button
                            onClick={() => toggleCategory(cat)}
                            className={`w-full flex items-center justify-between px-3 py-1.5 text-sm transition ${
                              isExpanded ? "bg-white border-b border-gencom-sand" : "bg-gencom-mist/40 hover:bg-gencom-mist/70"
                            }`}
                            aria-expanded={isExpanded}
                          >
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center justify-center w-4 h-4 text-[11px] leading-none font-bold rounded border border-gencom-sand bg-white text-gencom-ink">
                                {isExpanded ? "−" : "+"}
                              </span>
                              <span className="font-medium">{cat.replace(/^DM — /, "")}</span>
                            </div>
                            <span className="text-xs text-gencom-stone">
                              {added > 0 ? `${added}/${total} added` : `${total} items`}
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {sortedEntries.map((entry) => {
                                const already = isAlreadyAdded(entry, includedItems);
                                if (already) return null;
                                const qty = entry.quantity(mix, keys);
                                const isAdding = adding.has(entry.key);
                                const disabled = qty <= 0;
                                return (
                                  <button
                                    key={entry.key}
                                    disabled={disabled || isAdding}
                                    onClick={() => addFromCatalog(entry)}
                                    title={entry.description}
                                    className={`text-left p-2.5 rounded-md border transition ${
                                      disabled
                                        ? "border-gencom-sand/50 bg-gencom-mist/30 opacity-50 cursor-not-allowed"
                                        : "border-gencom-sand bg-white hover:border-gencom-gold hover:shadow-sm"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate">{entry.label}</div>
                                        <div className="text-[11px] text-gencom-stone">
                                          {entry.division} · {entry.unit}
                                        </div>
                                      </div>
                                      <div className="text-right flex-shrink-0">
                                        <div className="text-xs font-mono text-gencom-ink">
                                          {qty > 0 ? qty.toLocaleString() : "—"}
                                        </div>
                                        <div className="text-[10px] text-gencom-gold">{isAdding ? "adding…" : "+ add"}</div>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                              {sortedEntries.every((e) => isAlreadyAdded(e, includedItems)) && (
                                <div className="col-span-full text-xs text-gencom-stone text-center py-4">
                                  All items in this category have been added.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </>
      ) : (
        <AddedItemsView items={includedItems} propertyId={propertyId!} />
      )}
      {suggestionsOpen && (
        <SuggestionsModal
          loading={suggestionsLoading}
          error={suggestionsError}
          suggestions={suggestions}
          onClose={() => setSuggestionsOpen(false)}
          onRerun={runSuggestions}
          onScopeChanged={refresh}
          propertyId={propertyId!}
        />
      )}
      <BackToTop />
    </div>
  );
}

// ─── "Already added" view — grouped by material category or by space ─────
type AddedGroupBy = "category" | "space";
type AddedSortBy = "name" | "unit_cost_desc" | "total_desc" | "total_asc";

function AddedItemsView({ items, propertyId }: { items: ScopeItem[]; propertyId: string }) {
  const [groupBy, setGroupBy] = useState<AddedGroupBy>("category");
  const [sortBy, setSortBy] = useState<AddedSortBy>("name");

  // Match each item to a catalog entry for category inference.
  const byName: Map<string, ScopeCatalogEntry> = useMemo(() => new Map(
    SCOPE_CATALOG.map((e) => [e.label.trim().toLowerCase(), e]),
  ), []);

  const groups = useMemo(() => {
    const m: Record<string, ScopeItem[]> = {};
    for (const item of items) {
      let key: string;
      if (groupBy === "category") {
        const match = byName.get(item.line_item.trim().toLowerCase());
        key = match?.category ?? fallbackCategory(item);
      } else {
        key = item.division || "Uncategorized";
      }
      (m[key] ||= []).push(item);
    }
    // Sort items within each group per the current sort mode.
    const cmp: Record<AddedSortBy, (a: ScopeItem, b: ScopeItem) => number> = {
      name: (a, b) => a.line_item.localeCompare(b.line_item),
      unit_cost_desc: (a, b) => (b.effective_unit_cost ?? 0) - (a.effective_unit_cost ?? 0),
      total_desc: (a, b) => (b.line_total ?? 0) - (a.line_total ?? 0),
      total_asc: (a, b) => (a.line_total ?? 0) - (b.line_total ?? 0),
    };
    for (const k of Object.keys(m)) m[k].sort(cmp[sortBy]);
    return m;
  }, [items, groupBy, byName, sortBy]);

  // Group ordering: alphabetical by default; when sorting by total, sort
  // groups themselves by total (highest first) so biggest buckets show first.
  const sortedKeys = useMemo(() => {
    const keys = Object.keys(groups);
    if (sortBy === "total_desc" || sortBy === "unit_cost_desc") {
      return keys.sort((a, b) => {
        const aTotal = groups[a].reduce((s, i) => s + i.line_total, 0);
        const bTotal = groups[b].reduce((s, i) => s + i.line_total, 0);
        return bTotal - aTotal;
      });
    }
    if (sortBy === "total_asc") {
      return keys.sort((a, b) => {
        const aTotal = groups[a].reduce((s, i) => s + i.line_total, 0);
        const bTotal = groups[b].reduce((s, i) => s + i.line_total, 0);
        return aTotal - bTotal;
      });
    }
    return keys.sort();
  }, [groups, sortBy]);
  const grandTotal = items.reduce((s, i) => s + (i.included_in_budget ? i.line_total : 0), 0);

  if (items.length === 0) {
    return (
      <div className="text-center text-gencom-stone py-12 border border-dashed border-gencom-sand rounded-lg bg-white">
        No items added yet. Switch to <b>Browse catalog</b> to add some.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="text-sm text-gencom-stone">
          {items.length} items · <b className="text-gencom-ink">{formatMoney(grandTotal)}</b>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-white border border-gencom-sand rounded-md p-1 text-xs">
            <button
              onClick={() => setGroupBy("category")}
              className={`px-3 py-1 rounded ${groupBy === "category" ? "bg-gencom-ink text-gencom-mist" : "text-gencom-stone hover:text-gencom-ink"}`}
            >
              By category
            </button>
            <button
              onClick={() => setGroupBy("space")}
              className={`px-3 py-1 rounded ${groupBy === "space" ? "bg-gencom-ink text-gencom-mist" : "text-gencom-stone hover:text-gencom-ink"}`}
            >
              By space
            </button>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-gencom-stone">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as AddedSortBy)}
              className="border border-gencom-sand rounded px-2 py-1 text-xs bg-white"
            >
              <option value="name">Name (A–Z)</option>
              <option value="unit_cost_desc">Unit price (high → low)</option>
              <option value="total_desc">Total (high → low)</option>
              <option value="total_asc">Total (low → high)</option>
            </select>
          </div>
        </div>
      </div>
      {sortedKeys.map((key) => {
        const list = groups[key];
        const total = list.reduce((s, i) => s + i.line_total, 0);
        // Secondary column shows the OPPOSITE dimension (if grouping by
        // category, show division as the secondary, and vice versa).
        const secondaryLabel = groupBy === "category" ? "Space" : "Category";
        return (
          <div key={key} className="mb-3 bg-white border border-gencom-sand rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-gencom-mist border-b border-gencom-sand flex items-center justify-between">
              <div className="font-display">{key}</div>
              <div className="text-sm text-gencom-stone">
                {list.length} · <b className="text-gencom-ink">{formatMoney(total)}</b>
              </div>
            </div>
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-auto" />
                <col className="w-[150px]" />
                <col className="w-[88px]" />
                <col className="w-[88px]" />
                <col className="w-[112px]" />
                <col className="w-[120px]" />
              </colgroup>
              <thead className="text-xs uppercase text-gencom-stone bg-white border-b border-gencom-sand">
                <tr>
                  <th className="p-2 text-left">Line item</th>
                  <th className="p-2 text-left">{secondaryLabel}</th>
                  <th className="p-2 text-right">Qty</th>
                  <th className="p-2 text-left">Unit</th>
                  <th className="p-2 text-right">Unit $</th>
                  <th className="p-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {list.map((item) => {
                  const match = byName.get(item.line_item.trim().toLowerCase());
                  const itemCategory = match?.category ?? fallbackCategory(item);
                  const secondaryValue = groupBy === "category" ? (item.division || "—") : itemCategory;
                  return (
                    <tr key={item.id} className="border-b border-gencom-sand/50 last:border-0">
                      <td className="p-2 truncate">
                        <Link to={`/properties/${propertyId}/scope#item-${item.id}`} className="hover:underline" title={item.line_item}>
                          {item.line_item}
                        </Link>
                      </td>
                      <td className="p-2 text-xs text-gencom-stone truncate" title={secondaryValue}>{secondaryValue}</td>
                      <td className="p-2 text-right font-mono">
                        {item.multiplier_basis ? (
                          <span title={`${item.quantity} × ${item.multiplier_basis}`}>
                            {item.effective_quantity.toLocaleString()}
                          </span>
                        ) : item.quantity.toLocaleString()}
                      </td>
                      <td className="p-2 text-xs text-gencom-stone truncate">{item.unit}</td>
                      <td className="p-2 text-right font-mono">{formatMoney(item.effective_unit_cost)}</td>
                      <td className="p-2 text-right font-medium">{formatMoney(item.line_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function SuggestionsModal({
  loading, error, suggestions, onClose, onRerun, onScopeChanged, propertyId,
}: {
  loading: boolean;
  error: string | null;
  suggestions: ScopeReviewSuggestion[] | null;
  onClose: () => void;
  onRerun: () => void;
  onScopeChanged: () => void | Promise<void>;
  propertyId: string;
}) {
  const KIND_STYLES: Record<ScopeReviewSuggestion["kind"], string> = {
    missing: "border-amber-400 bg-amber-50 text-amber-900",
    quantity: "border-blue-400 bg-blue-50 text-blue-900",
    nonsense: "border-red-400 bg-red-50 text-red-900",
  };
  const KIND_LABELS: Record<ScopeReviewSuggestion["kind"], string> = {
    missing: "Possibly missing",
    quantity: "Quantity check",
    nonsense: "Doesn't fit",
  };
  const KIND_ICONS: Record<ScopeReviewSuggestion["kind"], string> = {
    missing: "＋",
    quantity: "#",
    nonsense: "⚠",
  };
  const FIX_LABELS: Record<ScopeReviewSuggestion["kind"], string> = {
    missing: "Add to scope",
    quantity: "Apply qty",
    nonsense: "Remove",
  };
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [fixAllRunning, setFixAllRunning] = useState(false);
  const [appliedIdxs, setAppliedIdxs] = useState<Set<number>>(new Set());
  const [opError, setOpError] = useState<string | null>(null);

  const ALLOWED_BASIS = new Set(["keys", "floors", "keys_pct", "doubles", "suites", "kings_only", "double_double_only", "non_suite"]);

  function canFix(s: ScopeReviewSuggestion): boolean {
    if (s.kind === "missing") return !!s.suggested_line_item;
    if (s.kind === "quantity") return !!s.related_item_id && typeof s.suggested_quantity === "number";
    if (s.kind === "nonsense") return !!s.related_item_id;
    return false;
  }

  async function applyOne(s: ScopeReviewSuggestion): Promise<void> {
    if (s.kind === "missing") {
      if (!s.suggested_line_item) throw new Error("Suggestion has no line item to add");
      const basis = s.suggested_multiplier_basis && ALLOWED_BASIS.has(s.suggested_multiplier_basis)
        ? s.suggested_multiplier_basis as any : null;
      await api.createScope(propertyId, {
        division: s.suggested_division || "MISC. ITEMS",
        line_item: s.suggested_line_item,
        description: s.detail || null,
        quantity: typeof s.suggested_quantity === "number" && s.suggested_quantity > 0 ? s.suggested_quantity : 1,
        unit: (s.suggested_unit || "each") as any,
        source: "manual",
        priority: (s.suggested_priority || "recommended") as any,
        multiplier_basis: basis,
      });
    } else if (s.kind === "quantity") {
      if (!s.related_item_id || typeof s.suggested_quantity !== "number") {
        throw new Error("Quantity suggestion is missing target item or value");
      }
      await api.updateScope(propertyId, s.related_item_id, { quantity: s.suggested_quantity });
    } else if (s.kind === "nonsense") {
      if (!s.related_item_id) throw new Error("Nonsense suggestion has no target item");
      await api.deleteScope(propertyId, s.related_item_id);
    }
  }

  async function handleFix(idx: number) {
    if (!suggestions) return;
    const s = suggestions[idx];
    setOpError(null);
    setBusyIdx(idx);
    try {
      await applyOne(s);
      setAppliedIdxs((a) => new Set(a).add(idx));
      await onScopeChanged();
    } catch (e) {
      setOpError(`Failed: ${e}`);
    } finally {
      setBusyIdx(null);
    }
  }

  async function handleFixAll() {
    if (!suggestions) return;
    setOpError(null);
    setFixAllRunning(true);
    const nextApplied = new Set(appliedIdxs);
    const errors: string[] = [];
    for (let i = 0; i < suggestions.length; i++) {
      if (nextApplied.has(i)) continue;
      const s = suggestions[i];
      if (!canFix(s)) continue;
      try {
        await applyOne(s);
        nextApplied.add(i);
      } catch (e) {
        errors.push(`${s.title}: ${e}`);
      }
    }
    setAppliedIdxs(nextApplied);
    if (errors.length) setOpError(errors.join(" | "));
    await onScopeChanged();
    setFixAllRunning(false);
  }

  const fixableCount = (suggestions ?? []).filter((s, i) => canFix(s) && !appliedIdxs.has(i)).length;

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-start justify-center p-6 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl my-12">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gencom-sand">
          <div>
            <div className="font-display text-xl">💡 Scope Suggestions</div>
            <div className="text-xs text-gencom-stone">
              AI review of your scope vs. the property profile. Fix items one-by-one or all at once.
            </div>
          </div>
          <div className="flex gap-2">
            {fixableCount > 0 && (
              <button
                onClick={handleFixAll}
                disabled={fixAllRunning || busyIdx !== null}
                className="text-xs px-3 py-1 rounded bg-emerald-700 text-white font-semibold hover:bg-emerald-800 disabled:opacity-60"
                title="Apply every suggestion that has enough data to act on"
              >
                {fixAllRunning ? "Fixing…" : `Fix all (${fixableCount})`}
              </button>
            )}
            <button
              onClick={onRerun}
              disabled={loading}
              className="text-xs px-2 py-1 border border-gencom-sand rounded hover:bg-gencom-mist disabled:opacity-60"
            >
              ↻ Re-run
            </button>
            <button onClick={onClose} className="text-gencom-stone hover:text-gencom-ink text-xl leading-none">×</button>
          </div>
        </div>
        <div className="p-5">
          {loading && (
            <div className="text-sm text-gencom-stone text-center py-8">
              Claude is reviewing the scope — this takes 10–30s.
            </div>
          )}
          {error && (
            <div className="text-sm text-red-700 border border-red-300 bg-red-50 rounded p-3">
              {error}
            </div>
          )}
          {opError && (
            <div className="mb-3 text-sm text-red-700 border border-red-300 bg-red-50 rounded p-3">
              {opError}
            </div>
          )}
          {!loading && !error && suggestions && suggestions.length === 0 && (
            <div className="text-sm text-emerald-800 border border-emerald-300 bg-emerald-50 rounded p-3">
              ✓ No suggestions — your scope looks complete and consistent for this property.
            </div>
          )}
          {!loading && !error && suggestions && suggestions.length > 0 && (
            <div className="space-y-2">
              {suggestions.map((s, i) => {
                const applied = appliedIdxs.has(i);
                const fixable = canFix(s);
                return (
                  <div key={i} className={`border rounded p-3 text-sm ${KIND_STYLES[s.kind] ?? ""} ${applied ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs uppercase tracking-wider font-semibold">
                            {KIND_ICONS[s.kind]} {KIND_LABELS[s.kind] ?? s.kind}
                          </span>
                          <span className="font-medium">{s.title}</span>
                          {applied && <span className="text-[10px] uppercase tracking-wider text-emerald-800">✓ Applied</span>}
                        </div>
                        <div className="mt-1 text-gencom-ink/90">{s.detail}</div>
                        {(s.suggested_line_item || s.suggested_division || s.suggested_quantity) && (
                          <div className="mt-1 text-xs text-gencom-stone">
                            {s.suggested_line_item && <>Suggested item: <b>{s.suggested_line_item}</b></>}
                            {s.suggested_line_item && s.suggested_division && <> · </>}
                            {s.suggested_division && <>Division: <b>{s.suggested_division}</b></>}
                            {typeof s.suggested_quantity === "number" && (
                              <> · Qty: <b>{s.suggested_quantity}</b>{s.suggested_unit ? ` ${s.suggested_unit}` : ""}</>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {!applied && fixable && (
                          <button
                            onClick={() => handleFix(i)}
                            disabled={busyIdx === i || fixAllRunning}
                            className="text-[11px] px-2 py-1 rounded bg-emerald-700 text-white font-semibold hover:bg-emerald-800 disabled:opacity-60"
                          >
                            {busyIdx === i ? "…" : FIX_LABELS[s.kind]}
                          </button>
                        )}
                        {s.related_item_id && (
                          <Link
                            to={`/properties/${propertyId}/scope#item-${s.related_item_id}`}
                            onClick={onClose}
                            className="text-[10px] px-2 py-1 rounded border border-current/40 bg-white/60 hover:bg-white whitespace-nowrap"
                          >
                            open row →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fallbackCategory(item: ScopeItem): string {
  const hay = `${item.line_item} ${item.description ?? ""}`.toLowerCase();
  if (/carpet|rug|drapery|pillow|bedding|wallcover|upholst/.test(hay)) return "Soft goods";
  if (/bed|nightstand|dresser|desk|table|chair|sofa|ottoman|millwork|cabinet|bench/.test(hay)) return "Casegoods";
  if (/lamp|chandelier|sconce|light|fixture/.test(hay)) return "Lighting";
  if (/art|mirror|accessor/.test(hay)) return "Art & accessories";
  if (/paint|tile|stone|floor|ceiling/.test(hay)) return "Wall/floor/ceiling finishes";
  if (/bath|shower|toilet|faucet|sink|vanity/.test(hay)) return "Bath FF&E";
  if (/tv|television|thermostat|wifi|usb/.test(hay)) return "Technology/AV";
  if (/hvac|chiller|boiler|elevator|roof|exterior|envelope|plumbing|sprinkler/.test(hay)) return "Deferred Maintenance";
  return "Other";
}
