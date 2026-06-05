import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatMoney, type CostItem } from "../lib/api";

type TabKey = "algorithm" | "benchmarks" | "actual" | "tier_mult" | "user";

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: "algorithm", label: "Matching algorithm", hint: "How the app picks a price" },
  { key: "benchmarks", label: "Benchmarks (Nehmer & HVS)", hint: "Industry per-key averages" },
  { key: "actual", label: "Actual projects", hint: "Real vendor prices from past work" },
  { key: "tier_mult", label: "Tier multipliers", hint: "Cross-tier pricing adjustments" },
  { key: "user", label: "My additions", hint: "User-seeded rows" },
];

// Category keyword rules, mirrored from Scope Overview, for grouping the DB.
const DB_CATEGORIES: { label: string; rx: RegExp }[] = [
  { label: "Soft goods", rx: /carpet|pad|drapery|sheer|bedding|pillow|upholst|wallcover|window treatment|curtain|rug|linen/i },
  { label: "Casegoods", rx: /bed frame|headboard|nightstand|dresser|desk|credenza|armoire|coffee table|side table|dining table|millwork|cabinet|bench|vanity/i },
  { label: "Seating", rx: /chair|sofa|ottoman|stool|sectional|banquette/i },
  { label: "Lighting", rx: /lamp|chandelier|sconce|pendant|light|fixture/i },
  { label: "Art & accessories", rx: /art|mirror|sculpture|accessor|vase|tray/i },
  { label: "Finishes", rx: /paint|tile|stone|floor|ceiling|vinyl|marble|wallpaper/i },
  { label: "Bath", rx: /bath|shower|toilet|faucet|sink|towel|robe hook/i },
  { label: "Technology / AV", rx: /tv|television|thermostat|wifi|data|door lock|phone|usb/i },
  { label: "HVAC", rx: /chiller|boiler|HVAC|fan coil|PTAC|air handler|cooling tower/i },
  { label: "Electrical", rx: /switchgear|generator|transformer|panel|lighting controls|VFD/i },
  { label: "Plumbing", rx: /pump|plumb|pipe|valve|backflow|grease trap/i },
  { label: "Other", rx: /.^/ },
];

function categorize(item: CostItem): string {
  const hay = `${item.item_name} ${item.notes ?? ""}`;
  for (const c of DB_CATEGORIES) if (c.rx.test(hay)) return c.label;
  return "Other";
}

export default function PricingMethodology() {
  const [tab, setTab] = useState<TabKey>("algorithm");
  const [items, setItems] = useState<CostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const rows = await api.listCostDb({ q: q || undefined, tier: tier || undefined });
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(refresh, 200);
    return () => clearTimeout(t);
  }, [q, tier]);

  const grouped = useMemo(() => {
    const bucket: Record<string, CostItem[]> = {};
    for (const i of items) (bucket[categorize(i)] ||= []).push(i);
    return bucket;
  }, [items]);

  async function updateItem(id: string, payload: Partial<CostItem>) {
    const updated = await api.updateCostItem(id, payload);
    setItems((xs) => xs.map((i) => (i.id === id ? updated : i)));
  }

  async function addItem(source: CostItem["source"]) {
    const created = await api.createCostItem({
      item_name: "New item", unit: "each", brand_tier: tier || "upper_upscale",
      suggested_cost: 0, source,
    });
    setItems((xs) => [created, ...xs]);
  }

  async function removeItem(id: string) {
    if (!confirm("Delete this item?")) return;
    await api.deleteCostItem(id);
    setItems((xs) => xs.filter((i) => i.id !== id));
  }

  return (
    <div>
      {/* Top-level tabs — green pills */}
      <div className="mb-6 flex gap-2 flex-wrap">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-xs uppercase tracking-wider whitespace-nowrap rounded-xl font-semibold transition ${
                active
                  ? "bg-gencom-green text-white shadow-card"
                  : "bg-white border border-gencom-sand text-gencom-stone hover:text-gencom-ink hover:bg-gencom-cloud"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Algorithm tab */}
      {tab === "algorithm" && (
        <div className="bg-white border border-gencom-sand rounded-lg p-6 space-y-4 text-sm max-w-3xl">
          <h2 className="font-display text-2xl">How a unit cost gets chosen</h2>
          <p>When a scope item is created, the app walks this priority list to suggest its unit cost:</p>
          <ol className="list-decimal list-inside space-y-2">
            <li>
              <b>Exact match</b> — line item's name matches a Cost DB row in the property's brand tier.
              <span className="text-xs text-gencom-stone"> — Confidence: High</span>
            </li>
            <li>
              <b>Fuzzy match</b> — string similarity ≥85% against items in the same tier.
              <span className="text-xs text-gencom-stone"> — Confidence: Medium</span>
            </li>
            <li>
              <b>Cross-tier match</b> — if nothing in the target tier, borrow from an adjacent tier and
              apply a multiplier (see <button onClick={() => setTab("tier_mult")} className="text-gencom-green font-semibold hover:underline">Tier multipliers</button>).
              <span className="text-xs text-gencom-stone"> — Confidence: Low</span>
            </li>
            <li>
              <b>AI fallback</b> — Claude estimates a price using the scope item + similar DB rows + property context.
              <span className="text-xs text-gencom-stone"> — Confidence: Low</span>
            </li>
          </ol>
          <div className="border-t border-gencom-sand pt-3 text-xs text-gencom-stone">
            <b>Override write-back:</b> any time you enter an Override $ on a scope row, that value
            becomes the new "suggested" cost for that (item, tier) pair — most-recent wins. The
            historical range is preserved in the DB so trends stay visible.
          </div>
        </div>
      )}

      {/* DB-backed tabs */}
      {(tab === "benchmarks" || tab === "actual" || tab === "user") && (
        <>
          <div className="mb-4 flex gap-2 items-center bg-white border border-gencom-sand rounded-md p-2 text-sm max-w-3xl">
            <input
              type="search"
              placeholder="Search item name or notes…"
              className="border border-gencom-sand rounded px-2 py-1 flex-1"
              value={q} onChange={(e) => setQ(e.target.value)}
            />
            <select value={tier} onChange={(e) => setTier(e.target.value)} className="border border-gencom-sand rounded px-2 py-1">
              <option value="">All tiers</option>
              <option value="luxury">Luxury</option>
              <option value="upper_upscale">Upper-upscale</option>
              <option value="upscale">Upscale</option>
            </select>
            <button
              onClick={() => addItem(tab === "benchmarks" ? "benchmark" : tab === "actual" ? "actual_project" : "user_seeded")}
              className="btn-primary px-3 py-1.5"
            >
              + Add
            </button>
          </div>

          {loading ? (
            <div className="text-center text-gencom-stone py-10">Loading…</div>
          ) : (
            <SourcePanel
              source={tab === "benchmarks" ? "benchmark" : tab === "actual" ? "actual_project" : "user_seeded"}
              grouped={grouped}
              onUpdate={updateItem}
              onRemove={removeItem}
            />
          )}
        </>
      )}

      {/* Tier multipliers */}
      {tab === "tier_mult" && <TierMultipliers />}
    </div>
  );
}

function SourcePanel({
  source, grouped, onUpdate, onRemove,
}: {
  source: CostItem["source"];
  grouped: Record<string, CostItem[]>;
  onUpdate: (id: string, payload: Partial<CostItem>) => void;
  onRemove: (id: string) => void;
}) {
  const cats = Object.keys(grouped).sort();
  const totals: Record<string, { count: number; sources: Record<string, number> }> = {};
  for (const cat of cats) {
    totals[cat] = { count: 0, sources: {} };
    for (const i of grouped[cat]) {
      if (i.source !== source) continue;
      totals[cat].count += 1;
      totals[cat].sources[i.brand_tier] = (totals[cat].sources[i.brand_tier] ?? 0) + 1;
    }
  }

  const filteredCats = cats.filter((c) => totals[c].count > 0);

  if (filteredCats.length === 0) {
    return (
      <div className="text-center text-gencom-stone py-10 bg-white border border-dashed border-gencom-sand rounded-lg">
        No items in this source yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filteredCats.map((cat) => {
        const rows = grouped[cat].filter((i) => i.source === source);
        return (
          <details key={cat} open className="bg-white border border-gencom-sand rounded-lg">
            <summary className="cursor-pointer px-4 py-2.5 flex items-center justify-between hover:bg-gencom-mist/40">
              <div>
                <span className="font-display">{cat}</span>
                <span className="ml-2 text-xs text-gencom-stone">{rows.length} items</span>
              </div>
            </summary>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-gencom-stone bg-gencom-mist border-y border-gencom-sand">
                <tr>
                  <th className="p-2 text-left min-w-[240px]">Item name</th>
                  <th className="p-2 w-24">Tier</th>
                  <th className="p-2 w-20">Unit</th>
                  <th className="p-2 text-right w-28">Cost</th>
                  <th className="p-2 text-right w-32">Range</th>
                  <th className="p-2 text-left">Notes</th>
                  <th className="p-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="border-b border-gencom-sand/50 last:border-0 hover:bg-gencom-mist/30">
                    <td className="p-2">
                      <input
                        className="w-full bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1"
                        defaultValue={i.item_name}
                        onBlur={(e) => e.target.value !== i.item_name && onUpdate(i.id, { item_name: e.target.value })}
                      />
                    </td>
                    <td className="p-2">
                      <select
                        defaultValue={i.brand_tier}
                        onChange={(e) => onUpdate(i.id, { brand_tier: e.target.value })}
                        className="bg-transparent text-xs"
                      >
                        <option value="luxury">luxury</option>
                        <option value="upper_upscale">upper_upscale</option>
                        <option value="upscale">upscale</option>
                      </select>
                    </td>
                    <td className="p-2 text-xs text-gencom-stone">{i.unit}</td>
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        step="any"
                        defaultValue={i.suggested_cost}
                        onBlur={(e) => Number(e.target.value) !== i.suggested_cost && onUpdate(i.id, { suggested_cost: Number(e.target.value) })}
                        className="w-full text-right bg-transparent focus:ring-1 focus:ring-gencom-gold/40 rounded px-1"
                      />
                    </td>
                    <td className="p-2 text-right text-xs text-gencom-stone">
                      {i.historical_range_low != null
                        ? `${formatMoney(i.historical_range_low)}–${formatMoney(i.historical_range_high ?? 0)}`
                        : "—"}
                    </td>
                    <td className="p-2 text-xs text-gencom-stone truncate max-w-[360px]" title={i.notes ?? ""}>
                      {i.notes}
                    </td>
                    <td className="p-2">
                      <button onClick={() => onRemove(i.id)} className="text-gencom-stone hover:text-red-700">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        );
      })}
    </div>
  );
}

function TierMultipliers() {
  // Matches the backend defaults in services/cost_engine.py.
  const DEFAULTS = { upscale: 1.0, upper_upscale: 1.25, luxury: 1.6 };
  const [mults, setMults] = useState(DEFAULTS);

  return (
    <div className="bg-white border border-gencom-sand rounded-lg p-6 max-w-2xl text-sm space-y-4">
      <h2 className="font-display text-2xl">Cross-tier multipliers</h2>
      <p>
        When a scope item has no match in the target tier, the app borrows from another tier and
        applies a multiplier. Multipliers are relative to <b>upscale</b>:
      </p>
      <div className="space-y-2 max-w-md">
        {(["upscale", "upper_upscale", "luxury"] as const).map((tier) => (
          <div key={tier} className="flex items-center gap-3">
            <label className="w-40 capitalize">{tier.replace("_", "-")}</label>
            <input
              type="number"
              step="0.05"
              value={mults[tier]}
              onChange={(e) => setMults((m) => ({ ...m, [tier]: Number(e.target.value) }))}
              className="border border-gencom-sand rounded px-2 py-1 w-24 text-right"
            />
            <span className="text-xs text-gencom-stone">× upscale</span>
          </div>
        ))}
      </div>
      <div className="text-xs text-gencom-stone border-t border-gencom-sand pt-3">
        These values currently live in the backend code (<code>services/cost_engine.py</code>).
        Expose an API to persist per-user overrides in a future update.
      </div>
      <div className="text-xs text-gencom-stone">
        <b>Example:</b> Upper-upscale FF&E item comes back as <code>$1.25×</code> its upscale-tier price
        when no Upper-upscale match exists.
      </div>
    </div>
  );
}
