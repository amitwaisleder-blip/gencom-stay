import { Fragment, useEffect, useState } from "react";
import { api, formatMoney, type CostItem } from "../lib/api";

export default function CostDatabase() {
  const [items, setItems] = useState<CostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [source, setSource] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const rows = await api.listCostDb({
        q: q || undefined,
        tier: tier || undefined,
        source: source || undefined,
      });
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [q, tier, source]);

  async function patch(id: string, payload: Partial<CostItem>) {
    const updated = await api.updateCostItem(id, payload);
    setItems((xs) => xs.map((i) => (i.id === id ? updated : i)));
  }

  async function add() {
    const created = await api.createCostItem({
      item_name: "New item", unit: "each", brand_tier: tier || "upper_upscale", suggested_cost: 0,
      source: "user_seeded",
    });
    setItems((xs) => [created, ...xs]);
    setEditing(created.id);
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side duplicate guard against currently-loaded items. The
    // server still performs the authoritative upsert, but warning here
    // lets the user choose whether to overwrite existing rows or skip
    // duplicates before bytes leave the browser.
    let fileToSend: File = file;
    let skippedCount = 0;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length > 1) {
        const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const nameIdx = headers.indexOf("item_name");
        const tierIdx = headers.indexOf("brand_tier");
        const unitIdx = headers.indexOf("unit");
        if (nameIdx >= 0 && tierIdx >= 0 && unitIdx >= 0) {
          const cellOf = (line: string, idx: number) => {
            const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
            return (cols[idx] ?? "").toLowerCase();
          };
          const existingKeys = new Set(
            items.map((i) => `${i.item_name.toLowerCase()}||${i.brand_tier.toLowerCase()}||${i.unit.toLowerCase()}`),
          );
          const parsedRows = lines.slice(1).map((l) => ({
            raw: l,
            key: `${cellOf(l, nameIdx)}||${cellOf(l, tierIdx)}||${cellOf(l, unitIdx)}`,
          }));
          const dupes = parsedRows.filter((r) => existingKeys.has(r.key));
          if (dupes.length > 0) {
            const choice = window.confirm(
              `${dupes.length} row(s) already exist with the same name/tier/unit. Click OK to overwrite them, or Cancel to skip duplicates.`,
            );
            if (!choice) {
              const dupeKeys = new Set(dupes.map((r) => r.key));
              const kept = parsedRows.filter((r) => !dupeKeys.has(r.key));
              const filteredText = [lines[0], ...kept.map((r) => r.raw)].join("\n");
              fileToSend = new File([filteredText], file.name, { type: file.type || "text/csv" });
              skippedCount = dupes.length;
            }
          }
        }
      }
    } catch {
      // If the pre-parse fails for any reason, fall through and let the
      // server handle the file unchanged.
    }

    setImportMsg("Importing…");
    try {
      const r = await api.importCostCsv(fileToSend);
      const skipNote = skippedCount > 0 ? `, ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"} skipped` : "";
      setImportMsg(`Imported ${r.imported} rows${skipNote}${r.errors.length ? `, ${r.errors.length} errors` : ""}`);
      await refresh();
    } catch (err) {
      setImportMsg(`Import failed: ${err}`);
    } finally {
      // Reset so re-selecting the same file fires onChange again.
      e.target.value = "";
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    await api.deleteCostItem(id);
    setItems((xs) => xs.filter((i) => i.id !== id));
  }

  // UI-layer guard against duplicate rows surfacing in the table — the
  // backend doesn't yet enforce uniqueness on (item_name, brand_tier,
  // unit), so dedupe here before render to keep the list clean.
  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    const key = `${item.item_name}||${item.brand_tier}||${item.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-end gap-2 text-sm">
        <label className="px-3 py-1.5 border border-gencom-sand rounded-md bg-white hover:bg-gencom-mist cursor-pointer">
          Import CSV
          <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
        </label>
        <button onClick={add} className="px-3 py-1.5 bg-gencom-ink text-gencom-mist rounded-md hover:bg-gencom-ink/90">
          + Add Item
        </button>
      </div>

      {importMsg && (
        <div className="mb-3 text-sm p-2 rounded border border-gencom-sand bg-white">{importMsg}</div>
      )}

      <div className="mb-3 flex gap-2 items-center bg-white border border-gencom-sand rounded-md p-2 text-sm">
        <input
          type="search"
          placeholder="Search item name or notes…"
          className="border border-gencom-sand rounded px-2 py-1 flex-1 min-w-[240px]"
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        <select value={tier} onChange={(e) => setTier(e.target.value)} className="border border-gencom-sand rounded px-2 py-1">
          <option value="">All tiers</option>
          <option value="luxury">Luxury</option>
          <option value="upper_upscale">Upper-upscale</option>
          <option value="upscale">Upscale</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)} className="border border-gencom-sand rounded px-2 py-1">
          <option value="">All sources</option>
          <option value="actual_project">Actual project</option>
          <option value="benchmark">Benchmark</option>
          <option value="ai_estimate">AI estimate</option>
          <option value="user_seeded">User seeded</option>
        </select>
      </div>

      <div className="bg-white border border-gencom-sand rounded-lg overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col />
            <col className="w-16" />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-40" />
            <col className="w-24" />
            <col className="w-40" />
            <col className="w-8" />
          </colgroup>
          <thead className="bg-gencom-mist border-b border-gencom-sand text-left text-xs uppercase text-gencom-stone">
            <tr>
              <th className="p-2">Item name</th>
              <th className="p-2">Unit</th>
              <th className="p-2">Tier</th>
              <th className="p-2 text-right">Suggested</th>
              <th className="p-2 text-right">Range</th>
              <th className="p-2">Source</th>
              <th className="p-2">Project</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-8 text-center text-gencom-stone">Loading…</td></tr>
            ) : deduped.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-gencom-stone">No cost items match the current filters.</td></tr>
            ) : deduped.map((i) => {
              const isExpanded = expanded === i.id;
              return (
                <Fragment key={i.id}>
                  <tr
                    onClick={() => setExpanded(isExpanded ? null : i.id)}
                    className={`border-b border-gencom-sand/50 hover:bg-gencom-mist/30 cursor-pointer ${
                      isExpanded ? "bg-gencom-mist/40" : ""
                    }`}
                  >
                    <td className="p-2">
                      <input
                        className="w-full bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1 py-0.5 truncate"
                        defaultValue={i.item_name}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => e.target.value !== i.item_name && patch(i.id, { item_name: e.target.value })}
                      />
                    </td>
                    <td className="p-2 text-xs text-gencom-stone truncate">{i.unit}</td>
                    <td className="p-2">
                      <select
                        defaultValue={i.brand_tier}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patch(i.id, { brand_tier: e.target.value })}
                        className="bg-transparent border-0 text-xs"
                      >
                        <option value="luxury">luxury</option>
                        <option value="upper_upscale">upper_upscale</option>
                        <option value="upscale">upscale</option>
                      </select>
                    </td>
                    <td className="p-2 text-right">
                      <input
                        type="number"
                        step="any"
                        className="w-full text-right bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1 py-0.5"
                        defaultValue={i.suggested_cost}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => Number(e.target.value) !== i.suggested_cost && patch(i.id, { suggested_cost: Number(e.target.value) })}
                      />
                    </td>
                    <td
                      className="p-2 text-right text-xs text-gencom-stone whitespace-nowrap truncate"
                      title={i.historical_range_low != null
                        ? `${formatMoney(i.historical_range_low)} – ${formatMoney(i.historical_range_high ?? 0)}`
                        : ""}
                    >
                      {i.historical_range_low != null
                        ? `${formatMoney(i.historical_range_low)}–${formatMoney(i.historical_range_high ?? 0)}`
                        : "—"}
                    </td>
                    <td className="p-2 text-xs">
                      <span className={`px-1.5 py-0.5 rounded whitespace-nowrap ${
                        i.source === "actual_project" ? "bg-gencom-gold/20" :
                        i.source === "benchmark" ? "bg-blue-100 text-blue-800" :
                        i.source === "user_seeded" ? "bg-gencom-sand" :
                        "bg-gray-100 text-gray-700"
                      }`}>{i.source.replace("_", " ")}</span>
                    </td>
                    <td className="p-2 text-xs text-gencom-stone truncate" title={i.last_used_property_name ?? ""}>
                      {i.source === "actual_project"
                        ? (i.last_used_property_name || <span className="italic text-gencom-stone/70">—</span>)
                        : <span className="text-gencom-stone/50">—</span>}
                    </td>
                    <td className="p-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(i.id, i.item_name); }}
                        className="text-gencom-stone hover:text-red-700"
                      >×</button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gencom-mist/30 border-b border-gencom-sand/50">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="text-xs text-gencom-stone uppercase tracking-wide mb-1">Notes</div>
                        <textarea
                          defaultValue={i.notes ?? ""}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => e.target.value !== (i.notes ?? "") && patch(i.id, { notes: e.target.value || null })}
                          placeholder="Add notes…"
                          rows={3}
                          className="w-full text-sm border border-gencom-sand rounded px-2 py-1 bg-white"
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
