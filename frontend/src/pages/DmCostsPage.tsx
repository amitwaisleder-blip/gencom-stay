import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatMoney, type DmCostItem, type DmExtractResult } from "../lib/api";

export default function DmCostsPage() {
  const [categories, setCategories] = useState<Record<string, string[]>>({});
  const [items, setItems] = useState<DmCostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sub, setSub] = useState("");

  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<DmExtractResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [overrides, setOverrides] = useState<{
    contractor: string; hotel_name: string; city: string; state: string; year: string;
  }>({ contractor: "", hotel_name: "", city: "", state: "", year: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.listDmCostCategories();
        setCategories(r.categories);
      } catch { /* ignore — UI still works without taxonomy */ }
    })();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      const rows = await api.listDmCosts({ q: q || undefined, category: cat || undefined, subcategory: sub || undefined });
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [q, cat, sub]);

  // Clear subcategory when category changes to something that doesn't include it.
  useEffect(() => {
    if (!cat) { setSub(""); return; }
    const subs = categories[cat] ?? [];
    if (sub && !subs.includes(sub)) setSub("");
  }, [cat, categories]);

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const result = await api.extractDmCosts(file, {
        contractor: overrides.contractor || undefined,
        hotel_name: overrides.hotel_name || undefined,
        city: overrides.city || undefined,
        state: overrides.state || undefined,
        year: overrides.year ? Number(overrides.year) : undefined,
      });
      setUploadResult(result);
      await refresh();
    } catch (e) {
      setUploadError(String(e));
    } finally {
      setUploading(false);
    }
  }

  async function patch(id: string, payload: Partial<DmCostItem>) {
    const updated = await api.updateDmCost(id, payload);
    setItems((xs) => xs.map((i) => (i.id === id ? updated : i)));
  }

  async function addRow() {
    const created = await api.createDmCost({
      scope: "New item",
      category: cat || null,
      subcategory: sub || null,
    });
    setItems((xs) => [created, ...xs]);
  }

  async function handleDelete(id: string, scope: string) {
    if (!confirm(`Delete "${scope.slice(0, 60)}"?`)) return;
    await api.deleteDmCost(id);
    setItems((xs) => xs.filter((i) => i.id !== id));
  }

  const catList = useMemo(() => Object.keys(categories), [categories]);
  const subList = cat ? categories[cat] ?? [] : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl text-gencom-ink">Deferred-Maintenance Cost DB</h2>
        <div className="text-xs text-gencom-stone">
          Drop in a contractor proposal, budget, or estimate (PDF or image). Claude extracts the
          line items and saves them with contractor, date, city, and hotel context attached.
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition ${
          dragActive
            ? "border-gencom-gold bg-gencom-gold/10"
            : "border-gencom-sand bg-white hover:border-gencom-ink/40"
        }`}
      >
        <div className="text-4xl mb-2">📄</div>
        <div className="text-sm">
          <b>Drop a proposal, estimate, or budget here</b> — or{" "}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-gencom-gold underline-offset-2 hover:underline font-medium"
          >
            browse
          </button>
          . PDF or image.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />

        {/* Optional overrides — applied to every row the AI extracts. */}
        <details className="mt-3 text-left max-w-xl mx-auto">
          <summary className="cursor-pointer text-xs text-gencom-stone hover:text-gencom-ink">
            Override context (optional) — applied to all extracted rows
          </summary>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <input
              className="border border-gencom-sand rounded px-2 py-1"
              placeholder="Contractor"
              value={overrides.contractor}
              onChange={(e) => setOverrides({ ...overrides, contractor: e.target.value })}
            />
            <input
              className="border border-gencom-sand rounded px-2 py-1"
              placeholder="Hotel name"
              value={overrides.hotel_name}
              onChange={(e) => setOverrides({ ...overrides, hotel_name: e.target.value })}
            />
            <input
              className="border border-gencom-sand rounded px-2 py-1"
              placeholder="City"
              value={overrides.city}
              onChange={(e) => setOverrides({ ...overrides, city: e.target.value })}
            />
            <input
              className="border border-gencom-sand rounded px-2 py-1"
              placeholder="ST"
              value={overrides.state}
              onChange={(e) => setOverrides({ ...overrides, state: e.target.value })}
            />
            <input
              className="border border-gencom-sand rounded px-2 py-1"
              placeholder="Year"
              type="number"
              value={overrides.year}
              onChange={(e) => setOverrides({ ...overrides, year: e.target.value })}
            />
          </div>
        </details>
      </div>

      {uploading && (
        <div className="text-sm p-3 rounded border border-gencom-sand bg-white">
          Claude is reading the document — this takes 20–60s depending on length…
        </div>
      )}
      {uploadError && (
        <div className="text-sm p-3 rounded border border-red-300 bg-red-50 text-red-800">
          {uploadError}
        </div>
      )}
      {uploadResult && (
        <div className="text-sm p-3 rounded border border-emerald-300 bg-emerald-50 text-emerald-900">
          ✓ Extracted <b>{uploadResult.created}</b> row{uploadResult.created !== 1 ? "s" : ""}.
          {uploadResult.warnings.length > 0 && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer">{uploadResult.warnings.length} warning(s)</summary>
              <ul className="list-disc list-inside mt-1">
                {uploadResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center bg-white border border-gencom-sand rounded-md p-2 text-sm">
        <input
          type="search"
          placeholder="Search scope, contractor, hotel, city…"
          className="border border-gencom-sand rounded px-2 py-1 flex-1 min-w-[240px]"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="border border-gencom-sand rounded px-2 py-1"
        >
          <option value="">All categories</option>
          {catList.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={sub}
          onChange={(e) => setSub(e.target.value)}
          className="border border-gencom-sand rounded px-2 py-1"
          disabled={!cat || subList.length === 0}
        >
          <option value="">
            {cat ? (subList.length === 0 ? "(no subcategories)" : "All subcategories") : "Pick a category first"}
          </option>
          {subList.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          onClick={addRow}
          className="px-3 py-1 bg-gencom-ink text-gencom-mist rounded-md text-xs hover:bg-gencom-ink/90 ml-auto"
        >
          + Add manually
        </button>
      </div>

      {/* Results table */}
      <div className="bg-white border border-gencom-sand rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gencom-mist border-b border-gencom-sand text-left text-xs uppercase text-gencom-stone">
            <tr>
              <th className="p-2 min-w-[200px]">Scope</th>
              <th className="p-2 w-36">Category</th>
              <th className="p-2 w-36">Subcategory</th>
              <th className="p-2 text-right w-24">Qty</th>
              <th className="p-2 w-16">Unit</th>
              <th className="p-2 text-right w-24">Unit cost</th>
              <th className="p-2 text-right w-28">Total</th>
              <th className="p-2 w-32">Contractor</th>
              <th className="p-2 w-20">Year</th>
              <th className="p-2 w-36">Hotel</th>
              <th className="p-2 w-32">City, ST</th>
              <th className="p-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="p-8 text-center text-gencom-stone">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={12} className="p-8 text-center text-gencom-stone">
                No DM cost rows yet. Drop a proposal above to seed the DB.
              </td></tr>
            ) : items.map((i) => (
              <tr key={i.id} className="border-b border-gencom-sand/50 hover:bg-gencom-mist/30 align-top">
                <td className="p-2">
                  <textarea
                    className="w-full bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1 py-0.5 resize-none text-sm"
                    rows={Math.max(1, Math.ceil((i.scope?.length ?? 0) / 40))}
                    defaultValue={i.scope}
                    onBlur={(e) => e.target.value !== i.scope && patch(i.id, { scope: e.target.value })}
                  />
                  {i.source_excerpt && (
                    <div className="text-[10px] text-gencom-stone italic mt-0.5 line-clamp-2" title={i.source_excerpt}>
                      "{i.source_excerpt}"
                    </div>
                  )}
                </td>
                <td className="p-2">
                  <select
                    value={i.category ?? ""}
                    onChange={(e) => patch(i.id, { category: e.target.value || null, subcategory: null })}
                    className="w-full bg-transparent border-0 text-xs"
                  >
                    <option value="">—</option>
                    {catList.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <select
                    value={i.subcategory ?? ""}
                    onChange={(e) => patch(i.id, { subcategory: e.target.value || null })}
                    className="w-full bg-transparent border-0 text-xs"
                    disabled={!i.category || (categories[i.category ?? ""] ?? []).length === 0}
                  >
                    <option value="">—</option>
                    {(categories[i.category ?? ""] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="p-2 text-right">
                  <input
                    type="number"
                    step="any"
                    className="w-full text-right bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1 py-0.5"
                    defaultValue={i.quantity ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== i.quantity) patch(i.id, { quantity: v });
                    }}
                  />
                </td>
                <td className="p-2">
                  <input
                    className="w-full bg-transparent border-0 text-xs text-gencom-stone"
                    defaultValue={i.unit ?? ""}
                    onBlur={(e) => e.target.value !== (i.unit ?? "") && patch(i.id, { unit: e.target.value || null })}
                  />
                </td>
                <td className="p-2 text-right">
                  <input
                    type="number"
                    step="any"
                    className="w-full text-right bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1 py-0.5"
                    defaultValue={i.unit_cost ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== i.unit_cost) patch(i.id, { unit_cost: v });
                    }}
                  />
                </td>
                <td className="p-2 text-right">
                  <input
                    type="number"
                    step="any"
                    className="w-full text-right bg-transparent border-0 focus:ring-1 focus:ring-gencom-gold/40 rounded px-1 py-0.5 font-medium"
                    defaultValue={i.cost ?? ""}
                    placeholder={
                      i.quantity != null && i.unit_cost != null
                        ? formatMoney(i.quantity * i.unit_cost)
                        : "—"
                    }
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== i.cost) patch(i.id, { cost: v });
                    }}
                  />
                </td>
                <td className="p-2 text-xs">
                  <input
                    className="w-full bg-transparent border-0"
                    defaultValue={i.contractor ?? ""}
                    onBlur={(e) => e.target.value !== (i.contractor ?? "") && patch(i.id, { contractor: e.target.value || null })}
                  />
                  {i.estimate_date && (
                    <div className="text-[10px] text-gencom-stone">{i.estimate_date}</div>
                  )}
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    className="w-full bg-transparent border-0 text-xs"
                    defaultValue={i.year ?? ""}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      if (v !== i.year) patch(i.id, { year: v });
                    }}
                  />
                </td>
                <td className="p-2 text-xs">
                  <input
                    className="w-full bg-transparent border-0"
                    defaultValue={i.hotel_name ?? ""}
                    onBlur={(e) => e.target.value !== (i.hotel_name ?? "") && patch(i.id, { hotel_name: e.target.value || null })}
                  />
                </td>
                <td className="p-2 text-xs text-gencom-stone">
                  <input
                    className="w-full bg-transparent border-0"
                    defaultValue={[i.city, i.state].filter(Boolean).join(", ")}
                    onBlur={(e) => {
                      const parts = e.target.value.split(",").map((p) => p.trim());
                      const city = parts[0] || null;
                      const state = parts[1] || null;
                      if (city !== i.city || state !== i.state) patch(i.id, { city, state });
                    }}
                  />
                </td>
                <td className="p-2">
                  <button
                    onClick={() => handleDelete(i.id, i.scope)}
                    className="text-gencom-stone hover:text-red-700"
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
