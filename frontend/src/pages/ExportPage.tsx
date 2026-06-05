import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PropertyNav from "../components/PropertyNav";
import { api, formatMoney, type ExportRecord, type Property, type Scenario, type ScenarioTotals } from "../lib/api";

export default function ExportPage() {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [scenarioCounts, setScenarioCounts] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [filename, setFilename] = useState("");
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [preview, setPreview] = useState<ScenarioTotals | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function refresh() {
    if (!propertyId) return;
    const [p, sc, hist] = await Promise.all([
      api.getProperty(propertyId),
      api.listScenarios(propertyId),
      api.listExports(propertyId),
    ]);
    setProperty(p);
    setScenarios(sc);
    setHistory(hist);
    setSelected(new Set(sc.map((s) => s.id)));
    // Default primary = scenario with the most items (usually the "Full Scope"
    // one), so users don't silently export a filtered subset.
    setFilename(suggestName(p));

    // Item count per scenario — approximated client-side from auto_filter +
    // the property's full scope. Close enough for UI guidance; the server is
    // the source of truth when the export actually runs.
    const scope = await api.listScope(propertyId);
    const counts: Record<string, number> = {};
    for (const s of sc) {
      const filt = s.auto_filter as { priority_in?: string[] } | null;
      const matching = scope.filter((i) => {
        if (i.deleted || !i.included_in_budget) return false;
        if (filt && filt.priority_in) return filt.priority_in.includes(i.priority);
        return true;
      });
      counts[s.id] = matching.length;
    }
    setScenarioCounts(counts);

    // Pick the scenario with the most items as the default primary. Fall back
    // to the existing default scenario if tied.
    const sorted = [...sc].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
    setPrimaryId((sorted[0] ?? sc.find((s) => s.is_default) ?? sc[0])?.id ?? null);
  }

  useEffect(() => { refresh(); }, [propertyId]);

  useEffect(() => {
    let cancelled = false;
    if (!propertyId || !primaryId) { setPreview(null); return; }
    setPreviewLoading(true);
    api.scenarioTotals(propertyId, primaryId)
      .then((t) => { if (!cancelled) setPreview(t); })
      .catch(() => { if (!cancelled) setPreview(null); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [propertyId, primaryId]);

  function suggestName(p: Property) {
    // No underscores. Replace any in the source name with spaces, then strip
    // characters that aren't safe for a filename and collapse whitespace.
    const base = (p.name ?? "Property")
      .replace(/_/g, " ")
      .replace(/[^A-Za-z0-9\s\-.()]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Property";
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    const date = `${mm}.${dd}.${yy}`;
    const v = 1 + history.length;
    return `${base} Budget ${date} v${v}.xlsx`;
  }

  async function doExport() {
    if (!propertyId) return;
    if (selected.size === 0) { setError("Select at least one scenario."); return; }
    setBusy(true); setError(null);
    try {
      // Put the primary scenario first so the exporter populates the main
      // sheet from it (exporter uses `scenarios[0]` as primary).
      const ordered = [
        ...(primaryId && selected.has(primaryId) ? [primaryId] : []),
        ...Array.from(selected).filter((id) => id !== primaryId),
      ];
      const res = await api.createExport(propertyId, {
        scenarios: ordered,
        note: note || undefined,
        filename: filename || undefined,
      });
      setLastResult(res);
      await refresh();
      // Trigger a download.
      if (res.download_url) {
        const a = document.createElement("a");
        a.href = res.download_url;
        a.download = res.filename;
        document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!property) return <div className="text-gencom-stone">Loading…</div>;

  return (
    <div>
      <PropertyNav />
      <h1 className="font-display text-3xl mb-6">Export</h1>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-4 mb-6">
        <div className="bg-white border border-gencom-sand rounded-lg p-5 space-y-4">
          <div>
            <div className="text-sm text-gencom-stone mb-1">Filename</div>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="w-full border border-gencom-sand rounded-md px-3 py-2"
            />
          </div>
          <div>
            <div className="text-sm text-gencom-stone mb-1">Scenarios to include</div>
            <div className="space-y-1">
              {scenarios.map((s) => {
                const count = scenarioCounts[s.id];
                const isPrimary = primaryId === s.id;
                const included = selected.has(s.id);
                const filterHint = (s.auto_filter as any)?.priority_in?.join(" + ") ?? "all priorities";
                return (
                  <div key={s.id} className={`flex items-center gap-2 text-sm py-1 px-2 rounded ${isPrimary ? "bg-gencom-greensoft border border-gencom-green/30" : ""}`}>
                    <input
                      type="radio"
                      name="primary-scenario"
                      checked={isPrimary}
                      onChange={() => { setPrimaryId(s.id); if (!included) setSelected(new Set([...selected, s.id])); }}
                      title="Use this scenario to populate the main budget sheet"
                    />
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) => {
                        const next = new Set(selected);
                        e.target.checked ? next.add(s.id) : next.delete(s.id);
                        setSelected(next);
                        if (!e.target.checked && isPrimary) {
                          // Picked a different primary if we just unchecked this one.
                          const firstRemaining = Array.from(next)[0] ?? null;
                          setPrimaryId(firstRemaining);
                        }
                      }}
                    />
                    <span className="flex-1">
                      {s.name}
                      {s.is_default && <span className="ml-2 text-[10px] text-gencom-gold uppercase">(default)</span>}
                      {isPrimary && <span className="ml-2 text-[10px] text-gencom-green font-semibold uppercase">· PRIMARY</span>}
                    </span>
                    <span className="text-xs text-gencom-stone whitespace-nowrap" title={`Filter: ${filterHint}`}>
                      {count != null ? `${count} items` : "…"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="text-xs text-gencom-stone mt-2">
              The <b className="text-gencom-green">PRIMARY</b> scenario populates the main budget sheet. All selected scenarios appear in the "Scope Detail" tab.
              If items are missing from your export, pick the scenario with the most items (often "Full Scope") as primary.
            </div>
          </div>
          <div>
            <div className="text-sm text-gencom-stone mb-1">Label (optional)</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Pre-IC, Final, Revision after walk #2…"
              className="w-full border border-gencom-sand rounded-md px-3 py-2"
            />
          </div>
          <button
            onClick={doExport}
            disabled={busy}
            className="w-full bg-gencom-ink text-gencom-mist px-4 py-3 rounded-md hover:bg-gencom-ink/90 disabled:opacity-50"
          >
            {busy ? "Exporting…" : "Export Excel"}
          </button>
          {error && (
            <div className="p-3 text-sm bg-red-50 text-red-800 border border-red-200 rounded">{error}</div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-gencom-sand rounded-lg p-5 text-sm">
            <div className="flex items-baseline justify-between mb-3">
              <div className="font-medium">Preview</div>
              <div className="text-xs text-gencom-stone">
                {previewLoading ? "Calculating…" : preview ? preview.scenario_name : "—"}
              </div>
            </div>
            {preview ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <div className="text-[10px] uppercase text-gencom-stone">Grand total</div>
                    <div className="text-xl font-semibold">{formatMoney(preview.grand_total)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-gencom-stone">$ / Key</div>
                    <div className="text-xl font-semibold">{formatMoney(preview.dollars_per_key)}</div>
                  </div>
                </div>
                {Object.keys(preview.division_subtotals).length > 0 && (
                  <div className="mb-3">
                    <div className="text-[10px] uppercase text-gencom-stone mb-1">Divisions</div>
                    <div className="space-y-0.5">
                      {Object.entries(preview.division_subtotals)
                        .sort((a, b) => b[1] - a[1])
                        .map(([div, amt]) => (
                          <div key={div} className="flex justify-between text-xs">
                            <span className="truncate pr-2">{div}</span>
                            <span className="text-gencom-stone whitespace-nowrap">{formatMoney(amt)}</span>
                          </div>
                        ))}
                      <div className="flex justify-between text-xs border-t border-gencom-sand pt-1 mt-1 font-medium">
                        <span>Hard subtotal</span>
                        <span>{formatMoney(preview.base_total)}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase text-gencom-stone mb-1">Soft costs & adders</div>
                  <div className="space-y-0.5 text-xs">
                    {[
                      ["Soft costs", preview.soft_costs],
                      ["Contingency", preview.contingency],
                      ["Dev fee", preview.dev_fee],
                      ["Escalation", preview.escalation],
                      ["FF&E", preview.ffe],
                      ["OS&E", preview.ose],
                      ["Tech", preview.tech],
                    ]
                      .filter(([, v]) => (v as number) > 0)
                      .map(([label, v]) => (
                        <div key={label as string} className="flex justify-between">
                          <span>{label as string}</span>
                          <span className="text-gencom-stone whitespace-nowrap">{formatMoney(v as number)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-xs text-gencom-stone">Pick a primary scenario to see totals.</div>
            )}
          </div>

          {lastResult && (
            <div className="bg-white border border-gencom-sand rounded-lg p-5 text-sm">
              <div className="font-medium mb-2">Export summary</div>
              <div className="text-xs text-gencom-stone mb-3">{lastResult.filename}</div>
              <div className="space-y-1">
                {(lastResult.divisions_log ?? []).map((d: any, i: number) => {
                  const name = d.section ?? d.division ?? "?";
                  const count = d.count ?? d.written ?? 0;
                  return (
                    <div key={i} className={count > 0 ? "" : "text-gencom-stone"}>
                      {count > 0 ? "✓" : "·"} {name} — {count} item{count === 1 ? "" : "s"}
                      {d.row ? ` (subtotal row ${d.row})` : ""}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <h2 className="font-display text-xl mb-2">Version history</h2>
      <div className="bg-white border border-gencom-sand rounded-lg overflow-hidden">
        {history.length === 0 ? (
          <div className="p-6 text-center text-sm text-gencom-stone">No prior exports yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gencom-mist text-left text-xs uppercase text-gencom-stone">
              <tr>
                <th className="p-2">Date</th>
                <th className="p-2">Filename</th>
                <th className="p-2">Label</th>
                <th className="p-2">Scenarios</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-gencom-sand">
                  <td className="p-2 text-xs text-gencom-stone">{new Date(h.exported_at).toLocaleString()}</td>
                  <td className="p-2">{h.filename}</td>
                  <td className="p-2 text-xs">{h.note}</td>
                  <td className="p-2 text-xs text-gencom-stone">{h.scenarios_included.length}</td>
                  <td className="p-2">
                    <a
                      href={h.download_url}
                      download={h.filename}
                      className="text-gencom-gold hover:underline"
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
