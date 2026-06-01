import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PropertyNav from "../components/PropertyNav";
import BackToTop from "../components/BackToTop";
import SummaryCharts from "../components/SummaryCharts";
import TotalsBar from "../components/TotalsBar";
import {
  api, formatMoney, SOFT_COST_BASIS_CATEGORIES,
  type Property, type Scenario, type ScenarioTotals, type SoftCostLine,
} from "../lib/api";
import {
  loadPresets, savePresets, resetPresetsToDefault,
  type SoftCostPreset,
} from "../lib/presets";

type Group = "soft" | "contingency" | "dev_fee";

const GROUP_LABEL: Record<Group, string> = {
  soft: "Soft costs",
  contingency: "Contingency",
  dev_fee: "Developer fee",
};

export default function BudgetSummary() {
  const { id: propertyId } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [totals, setTotals] = useState<Record<string, ScenarioTotals>>({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Presets — kept in localStorage and editable in a modal.
  const [presets, setPresets] = useState<SoftCostPreset[]>(() => loadPresets());
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);

  // Tracks which scenario's "add from preset" menu is open.
  const [presetMenuFor, setPresetMenuFor] = useState<string | null>(null);
  // Tracks which scenario/line's basis editor is open.
  const [basisEditorFor, setBasisEditorFor] = useState<string | null>(null);

  // Per-property set of hidden scenario IDs (localStorage-backed).
  const HIDDEN_KEY = `pipbudget.summaryHiddenScenarios.${propertyId ?? ""}`;
  const [hiddenScenarios, setHiddenScenarios] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(Array.from(hiddenScenarios))); } catch {}
  }, [hiddenScenarios, HIDDEN_KEY]);

  function toggleScenarioHidden(id: string) {
    setHiddenScenarios((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function refresh() {
    if (!propertyId) return;
    setLoading(true);
    try {
      const [p, sc] = await Promise.all([api.getProperty(propertyId), api.listScenarios(propertyId)]);
      setProperty(p);
      setScenarios(sc);

      // First-visit auto-apply: if this property has scenarios with no soft
      // cost breakdown AND the user has a remembered last-used config from a
      // prior project, seed the default scenario with that config. Only runs
      // when breakdowns are genuinely empty — never overwrites existing work.
      const defaultScenario = sc.find((s) => s.is_default) ?? sc[0];
      const hasAnyBreakdown = sc.some((s) => (s.soft_cost_breakdown ?? []).length > 0);
      if (!hasAnyBreakdown && defaultScenario) {
        const lastUsed = loadLastUsedBreakdown();
        if (lastUsed && lastUsed.length > 0) {
          try {
            await api.updateScenario(propertyId, defaultScenario.id, { soft_cost_breakdown: lastUsed } as any);
            // Re-fetch scenarios so the UI picks up the new breakdown.
            const refreshed = await api.listScenarios(propertyId);
            setScenarios(refreshed);
          } catch { /* ignore — user can apply manually */ }
        }
      }

      const t: Record<string, ScenarioTotals> = {};
      await Promise.all(sc.map(async (s) => { t[s.id] = await api.scenarioTotals(propertyId, s.id); }));
      setTotals(t);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [propertyId]);

  // Global Escape closes whichever menu is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPresetMenuFor(null);
        setBasisEditorFor(null);
        setPresetEditorOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function patchScenario(scenarioId: string, payload: Partial<Scenario>) {
    if (!propertyId) return;
    // Optimistic: apply the patch locally FIRST so the UI responds instantly.
    setScenarios((scs) => scs.map((s) => (s.id === scenarioId ? { ...s, ...payload } : s)));
    try {
      const updated = await api.updateScenario(propertyId, scenarioId, payload as any);
      setScenarios((scs) => scs.map((s) => (s.id === scenarioId ? updated : s)));
      // Refresh totals for just this scenario, not the whole page.
      const t = await api.scenarioTotals(propertyId, scenarioId);
      setTotals((ts) => ({ ...ts, [scenarioId]: t }));
    } catch (e) {
      // On failure, reload from source so local state doesn't drift.
      await refresh();
    }
  }

  // Persist the most recently saved soft cost breakdown globally so new
  // properties can start with the same shape you used last time. Keyed by a
  // single localStorage slot — independent of property ID.
  const LAST_USED_KEY = "pipbudget.lastUsedSoftCostBreakdown";
  function rememberLastUsedBreakdown(lines: SoftCostLine[]) {
    try {
      if (lines && lines.length > 0) {
        localStorage.setItem(LAST_USED_KEY, JSON.stringify(lines));
      }
    } catch { /* ignore quota errors */ }
  }
  function loadLastUsedBreakdown(): SoftCostLine[] | null {
    try {
      const raw = localStorage.getItem(LAST_USED_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async function updateBreakdown(scenario: Scenario, next: SoftCostLine[]) {
    if (!propertyId) return;
    // Save this breakdown as the user's "last used" shape for new projects.
    rememberLastUsedBreakdown(next);
    // If the property is in "synced" mode, mirror locally across all
    // scenarios so the UI is consistent before the backend replies.
    const synced = property?.soft_costs_synced ?? true;
    setScenarios((scs) =>
      scs.map((s) => {
        if (s.id === scenario.id || synced) {
          return { ...s, soft_cost_breakdown: next };
        }
        return s;
      })
    );
    try {
      const updated = await api.updateScenario(propertyId, scenario.id, { soft_cost_breakdown: next } as any);
      setScenarios((scs) =>
        scs.map((s) => {
          if (s.id === scenario.id) return updated;
          // Backend also synced siblings — keep our optimistic values.
          return s;
        })
      );
      // Re-compute totals for every scenario whose breakdown may have changed.
      const targets = synced ? scenarios.map((s) => s.id) : [scenario.id];
      const fresh = await Promise.all(targets.map((id) => api.scenarioTotals(propertyId, id)));
      setTotals((ts) => {
        const next = { ...ts };
        targets.forEach((id, i) => { next[id] = fresh[i]; });
        return next;
      });
    } catch (_) {
      await refresh();
    }
  }

  async function toggleSync(on: boolean) {
    if (!propertyId) return;
    setProperty((p) => (p ? { ...p, soft_costs_synced: on } : p));
    try {
      const updated = await api.updateProperty(propertyId, { soft_costs_synced: on });
      setProperty(updated);
      // If turning sync back on, propagate the default scenario's breakdown
      // to all siblings immediately so they realign visually.
      if (on) {
        const defaultScenario = scenarios.find((s) => s.is_default) ?? scenarios[0];
        if (defaultScenario && defaultScenario.soft_cost_breakdown) {
          await updateBreakdown(defaultScenario, defaultScenario.soft_cost_breakdown);
        }
      }
    } catch (_) {
      await refresh();
    }
  }

  function addFromPreset(scenario: Scenario, p: SoftCostPreset) {
    const next = [...(scenario.soft_cost_breakdown ?? [])];
    if (next.some((l) => l.name === p.name)) return; // already present
    next.push({
      name: p.name,
      pct: p.defaultPct,
      fixed: p.defaultFixed,
      group: p.group ?? "soft",
    });
    updateBreakdown(scenario, next);
    setPresetMenuFor(null);
  }

  function addBlankLine(scenario: Scenario, group: Group) {
    updateBreakdown(scenario, [
      ...(scenario.soft_cost_breakdown ?? []),
      { name: "New line", pct: 0, group },
    ]);
  }

  function removeLine(scenario: Scenario, idx: number) {
    const next = [...(scenario.soft_cost_breakdown ?? [])];
    next.splice(idx, 1);
    updateBreakdown(scenario, next);
  }

  if (loading && !property) return <div className="text-gencom-stone">Loading…</div>;
  if (!property) return <div>Property not found.</div>;

  const allDivisions = Array.from(new Set(
    scenarios.flatMap((s) => Object.keys(totals[s.id]?.division_subtotals ?? {}))
  )).sort();

  return (
    <div>
      <PropertyNav />

      <TotalsBar propertyId={propertyId!} keys={property.keys} />

      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Budget Summary</h1>
          <div className="text-sm text-gencom-stone">
            {property.keys ?? 0} keys · {property.target_brand_tier ?? "—"} tier · <kbd className="px-1 border border-gencom-sand rounded text-[10px]">Esc</kbd> closes menus
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 border border-gencom-sand rounded-md hover:bg-white"
                 title="When on, any edit to soft costs mirrors to all three scenarios.">
            <input
              type="checkbox"
              checked={property.soft_costs_synced !== false}
              onChange={(e) => toggleSync(e.target.checked)}
            />
            <span>Match soft costs across scenarios</span>
          </label>
          <button
            onClick={() => setPresetEditorOpen(true)}
            className="px-4 py-2 border border-gencom-sand rounded-md hover:bg-white text-sm"
          >
            Edit presets
          </button>
          <button
            onClick={() => navigate(`/properties/${propertyId}/export`)}
            className="px-4 py-2 bg-gencom-ink text-gencom-mist rounded-md hover:bg-gencom-ink/90"
          >
            Continue to Export →
          </button>
        </div>
      </div>
      {property.soft_costs_synced !== false && (
        <div className="mb-4 text-xs text-emerald-800 bg-emerald-50 border border-emerald-600/40 rounded px-3 py-1.5">
          Soft costs are <b>synced</b> across Required Only / Required + Recommended / Full Scope. Any edit you make on one scenario updates the others. Uncheck the box above to edit each scenario independently.
        </div>
      )}

      {hiddenScenarios.size > 0 && (
        <div className="mb-3 text-xs text-gencom-stone">
          {hiddenScenarios.size} budget version{hiddenScenarios.size !== 1 ? "s" : ""} greyed out ·
          {" "}
          <button onClick={() => setHiddenScenarios(new Set())} className="text-emerald-700 hover:underline">
            reset all
          </button>
        </div>
      )}

      {scenarios.length === 0 ? (
        <div className="p-8 text-center text-gencom-stone bg-white border border-dashed border-gencom-sand rounded-lg">
          No scenarios yet.
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 ${
          scenarios.length >= 3 ? "lg:grid-cols-3"
            : scenarios.length === 2 ? "lg:grid-cols-2"
            : "lg:grid-cols-1"
        }`}>
          {scenarios.map((s) => {
            const t = totals[s.id];
            if (!t) return <div key={s.id} className="bg-white rounded-lg p-4">Loading…</div>;
            const isHidden = hiddenScenarios.has(s.id);
            const breakdown = s.soft_cost_breakdown ?? [];
            const dmTotal = Object.entries(t.division_subtotals)
              .filter(([k]) => k.toUpperCase().includes("DEFERRED"))
              .reduce((sum, [, v]) => sum + v, 0);

            return (
              <div
                key={s.id}
                className={`bg-white border rounded-lg p-5 transition ${
                  isHidden ? "border-gencom-sand/60" : "border-gencom-sand"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  {/* Header stays fully visible even when the card body is
                   *  greyed — so the checkbox is always clickable to unhide. */}
                  <div className={isHidden ? "opacity-60" : ""}>
                    <div className="font-display text-xl">{s.name}</div>
                    {/* Always reserve a line for the default badge so all
                     *  cards align row-for-row in the grid. Non-default cards
                     *  show an invisible placeholder of the same height. */}
                    <div
                      className={`text-xs font-semibold uppercase tracking-wider ${
                        s.is_default ? "text-red-600" : "invisible select-none"
                      }`}
                      aria-hidden={!s.is_default}
                    >
                      default
                    </div>
                  </div>
                  <label
                    className="flex items-center gap-1.5 text-xs text-gencom-stone cursor-pointer select-none"
                    title={isHidden ? "Click to bring this budget version back to full color" : "Uncheck to grey out this budget version"}
                  >
                    <span>show</span>
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => toggleScenarioHidden(s.id)}
                    />
                  </label>
                </div>

                {/* Wrapper around the card body — this is what gets greyed out.
                 *  Pointer-events are still enabled so users can pan / inspect,
                 *  but the muted look makes it obvious this version is "off." */}
                <div className={isHidden ? "opacity-40 grayscale" : ""}>

                {/* Hard cost division subtotals */}
                <div className="space-y-1 text-sm border-b border-gencom-sand pb-3 mb-3">
                  {allDivisions.map((d) => (
                    <div key={d} className="flex justify-between">
                      <span className="text-gencom-stone truncate pr-2">{d}</span>
                      <span className="font-mono">{formatMoney(t.division_subtotals[d] ?? 0)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 border-t border-gencom-sand mt-2">
                    <span>Hard cost subtotal</span>
                    <b className="font-mono">{formatMoney(t.base_total)}</b>
                  </div>
                  {dmTotal > 0 && (
                    <div className="flex justify-between text-xs text-gencom-stone">
                      <span>Base ex-DM (default basis)</span>
                      <span className="font-mono">{formatMoney(t.base_total - dmTotal)}</span>
                    </div>
                  )}
                </div>

                {/* Three groups — soft, contingency, dev fee */}
                {(["soft", "contingency", "dev_fee"] as const).map((group) => {
                  const groupLines = breakdown
                    .map((line, idx) => ({ line, idx }))
                    .filter(({ line }) => (line.group ?? "soft") === group);
                  const groupTotal =
                    group === "soft" ? t.soft_costs
                    : group === "contingency" ? t.contingency
                    : t.dev_fee;
                  return (
                    <div key={group} className="mb-3 border-t border-gencom-sand pt-3 first:border-t-0 first:pt-0">
                      <div className="flex justify-between items-baseline mb-1.5">
                        <div className="text-sm font-medium">{GROUP_LABEL[group]}</div>
                        <div className="text-sm font-mono">{formatMoney(groupTotal)}</div>
                      </div>
                      <div className="space-y-1.5 text-xs">
                        {groupLines.length === 0 && (
                          <div className="text-gencom-stone italic">No lines in this group.</div>
                        )}
                        {groupLines.map(({ line, idx }) => (
                          <SoftCostRow
                            key={`${s.id}:${idx}:${line.name}`}
                            line={line}
                            group={group}
                            breakdown={breakdown}
                            totals={t}
                            allDivisions={allDivisions}
                            amount={t.soft_cost_line_amounts[line.name] ?? 0}
                            basisOpen={basisEditorFor === `${s.id}:${idx}`}
                            onToggleBasis={() =>
                              setBasisEditorFor(basisEditorFor === `${s.id}:${idx}` ? null : `${s.id}:${idx}`)
                            }
                            onChange={(patch) => {
                              const next = [...breakdown];
                              next[idx] = { ...line, ...patch };
                              updateBreakdown(s, next);
                            }}
                            onRemove={() => removeLine(s, idx)}
                            radioGroupId={`basis-${s.id}-${idx}`}
                          />
                        ))}
                      </div>
                      <div className="mt-2 flex gap-3 text-xs items-center relative">
                        <button
                          onClick={() => addBlankLine(s, group)}
                          className="text-emerald-700 hover:underline"
                        >
                          + Blank line
                        </button>
                        <button
                          onClick={() => setPresetMenuFor(presetMenuFor === `${s.id}:${group}` ? null : `${s.id}:${group}`)}
                          className="text-emerald-700 hover:underline"
                        >
                          + From presets
                        </button>
                        {presetMenuFor === `${s.id}:${group}` && (
                          <PresetMenu
                            presets={presets.filter((p) => (p.group ?? "soft") === group)}
                            breakdown={breakdown}
                            onPick={(p) => addFromPreset(s, p)}
                            onClose={() => setPresetMenuFor(null)}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="border-t border-gencom-sand pt-3 mt-4">
                  <div className="flex justify-between font-display text-xl">
                    <span>Total</span>
                    <span>{formatMoney(t.grand_total)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gencom-stone mt-1">
                    <span>{formatMoney(t.dollars_per_key)}/key</span>
                    {t.dollars_per_gsf > 0 && <span>{formatMoney(t.dollars_per_gsf)}/GSF</span>}
                  </div>
                </div>

                <div className="mt-4 border-t border-gencom-sand pt-3">
                  <div className="text-xs text-gencom-stone uppercase mb-1">Priority breakdown</div>
                  {Object.entries(t.priority_breakdown).map(([p, v]) => (
                    <div key={p} className="flex items-center gap-2 text-xs mb-1">
                      <span className="w-20 capitalize">{p}</span>
                      <div className="flex-1 bg-gencom-mist rounded-full h-1.5">
                        <div className="bg-gencom-gold h-1.5 rounded-full"
                          style={{ width: `${t.base_total > 0 ? (v / t.base_total) * 100 : 0}%` }}></div>
                      </div>
                      <span className="font-mono w-20 text-right">{formatMoney(v)}</span>
                    </div>
                  ))}
                </div>
                </div>{/* end greyable wrapper */}
              </div>
            );
          })}
        </div>
      )}

      {/* Charts below the three scenario cards */}
      {scenarios.length > 0 && (
        <SummaryCharts scenarios={scenarios} totals={totals} />
      )}

      {/* Preset editor modal */}
      {presetEditorOpen && (
        <PresetEditor
          presets={presets}
          onSave={(p) => { savePresets(p); setPresets(p); }}
          onReset={() => setPresets(resetPresetsToDefault())}
          onClose={() => setPresetEditorOpen(false)}
        />
      )}
      <BackToTop />
    </div>
  );
}

// ─── Soft cost row with basis editor ───────────────────────────────────
function SoftCostRow({
  line, group, breakdown, totals, allDivisions, amount,
  basisOpen, onToggleBasis, onChange, onRemove, radioGroupId,
}: {
  line: SoftCostLine;
  group: Group;
  breakdown: SoftCostLine[];
  totals: ScenarioTotals;
  allDivisions: string[];
  amount: number;
  basisOpen: boolean;
  onToggleBasis: () => void;
  onChange: (patch: Partial<SoftCostLine>) => void;
  onRemove: () => void;
  radioGroupId: string;
}) {
  const mode: "pct" | "fixed" =
    line.fixed != null && (line.pct == null || line.pct === 0) ? "fixed" : "pct";

  // Describe the basis in a compact label.
  const basisLabel = describeBasis(line, allDivisions);

  // Which lines are available to compound on for this group?
  const compoundableLines = breakdown
    .filter((l) => {
      if (l.name === line.name) return false;
      const g = l.group ?? "soft";
      if (group === "contingency") return g === "soft";
      if (group === "dev_fee") return g === "soft" || g === "contingency";
      return false;
    });

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <input
          className="flex-1 min-w-0 border border-gencom-sand rounded px-2 py-1 bg-white"
          defaultValue={line.name}
          onBlur={(e) => e.target.value !== line.name && onChange({ name: e.target.value })}
        />
        <select
          value={mode}
          onChange={(e) => {
            const m = e.target.value as "pct" | "fixed";
            if (m === "pct") onChange({ fixed: undefined, pct: line.pct ?? 0.01 });
            else onChange({ pct: undefined, fixed: line.fixed ?? 10000 });
          }}
          className="border border-gencom-sand rounded px-1 py-1 bg-white text-xs"
        >
          <option value="pct">%</option>
          <option value="fixed">$</option>
        </select>
        {mode === "pct" ? (
          <input
            type="number"
            step="0.001"
            className="w-16 border border-gencom-sand rounded px-1 py-1 text-right"
            defaultValue={line.pct ?? ""}
            onBlur={(e) => {
              const n = e.target.value === "" ? undefined : Number(e.target.value);
              if (n !== line.pct) onChange({ pct: n, fixed: undefined });
            }}
          />
        ) : (
          <input
            type="number"
            step="1000"
            className="w-24 border border-gencom-sand rounded px-1 py-1 text-right"
            defaultValue={line.fixed ?? ""}
            onBlur={(e) => {
              const n = e.target.value === "" ? undefined : Number(e.target.value);
              if (n !== line.fixed) onChange({ pct: undefined, fixed: n });
            }}
          />
        )}
        <span className="font-mono w-20 text-right text-gencom-stone">
          {amount > 0 ? formatMoney(amount) : "—"}
        </span>
        {mode === "pct" ? (
          <button
            type="button"
            onClick={onToggleBasis}
            className={`flex-shrink-0 text-[10px] underline decoration-dotted ${basisOpen ? "text-emerald-700" : "text-gencom-stone hover:text-emerald-700"}`}
            title="Edit what this line is a percentage of"
          >
            basis
          </button>
        ) : (
          <span
            className="flex-shrink-0 text-[10px] text-gencom-stone/40"
            title="Basis only applies to percentage lines — switch to % first"
          >
            fixed
          </span>
        )}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
          className="flex-shrink-0 text-gencom-stone hover:text-red-700 px-1"
          title="Remove this line"
          aria-label="Remove line"
        >×</button>
      </div>

      {/* Basis summary line */}
      {mode === "pct" && (
        <div className="text-[10px] text-gencom-stone mt-0.5 pl-1">
          × {basisLabel}
        </div>
      )}

      {/* Basis editor */}
      {basisOpen && mode === "pct" && (
        <div className="mt-1 p-2 bg-gencom-mist/60 border border-gencom-sand rounded text-[11px] space-y-2">
          <div>
            <div className="font-medium mb-1">Hard cost divisions in base</div>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name={radioGroupId}
                checked={line.basis_divisions == null && !line.basis_categories}
                onChange={() => onChange({ basis_divisions: null, basis_categories: null })}
              />
              <span>
                All divisions{" "}
                <span className="text-gencom-stone">
                  {line.basis_exclude_dm !== false ? "(ex-DM)" : "(incl. DM)"}
                  {line.basis_exclude_it_boh ? " · ex-IT/BOH" : ""}
                </span>
              </span>
            </label>
            {line.basis_divisions == null && !line.basis_categories && (
              <div className="pl-5 mt-0.5 space-y-0.5 text-gencom-stone">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={line.basis_exclude_dm !== false}
                    onChange={(e) => onChange({ basis_exclude_dm: e.target.checked })}
                  />
                  Exclude Deferred Maintenance
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={!!line.basis_exclude_it_boh}
                    onChange={(e) => onChange({ basis_exclude_it_boh: e.target.checked })}
                  />
                  Exclude IT &amp; BOH scope
                </label>
              </div>
            )}
            <label className="flex items-center gap-1.5 mt-1">
              <input
                type="radio"
                name={radioGroupId}
                checked={Array.isArray(line.basis_categories)}
                onChange={() => onChange({ basis_divisions: null, basis_categories: [] })}
              />
              <span>Select specific categories</span>
            </label>
            {Array.isArray(line.basis_categories) && (
              <div className="pl-5 mt-1 flex flex-wrap gap-1.5">
                {SOFT_COST_BASIS_CATEGORIES.map((cat) => {
                  const on = (line.basis_categories ?? []).includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        const set = new Set(line.basis_categories ?? []);
                        on ? set.delete(cat) : set.add(cat);
                        onChange({ basis_categories: Array.from(set) });
                      }}
                      className={`px-2 py-0.5 rounded-md border transition ${
                        on
                          ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                          : "border-gencom-sand bg-white hover:border-gencom-ink/40"
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            )}
            <label className="flex items-center gap-1.5 mt-1">
              <input
                type="radio"
                name={radioGroupId}
                checked={Array.isArray(line.basis_divisions)}
                onChange={() => onChange({ basis_divisions: [], basis_categories: null })}
              />
              <span>Select specific divisions</span>
            </label>
            {Array.isArray(line.basis_divisions) && (
              <>
                <div className="pl-5 mt-1 grid grid-cols-1 gap-0.5">
                  {allDivisions.map((d) => {
                    const on = line.basis_divisions!.includes(d);
                    return (
                      <label key={d} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const set = new Set(line.basis_divisions ?? []);
                            on ? set.delete(d) : set.add(d);
                            onChange({ basis_divisions: Array.from(set) });
                          }}
                        />
                        <span>{d}</span>
                        <span className="ml-auto text-gencom-stone font-mono">
                          {formatMoney(totals.division_subtotals[d] ?? 0)}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="pl-5 flex gap-2 mt-1">
                  <button
                    type="button"
                    className="text-emerald-700 hover:underline"
                    onClick={() => onChange({ basis_divisions: allDivisions })}
                  >
                    all
                  </button>
                  <button
                    type="button"
                    className="text-emerald-700 hover:underline"
                    onClick={() => onChange({ basis_divisions: allDivisions.filter((d) => !d.toUpperCase().includes("DEFERRED")) })}
                  >
                    all ex-DM
                  </button>
                  <button
                    type="button"
                    className="text-gencom-stone hover:text-gencom-ink"
                    onClick={() => onChange({ basis_divisions: [] })}
                  >
                    clear
                  </button>
                </div>
              </>
            )}
          </div>

          {(group === "contingency" || group === "dev_fee") && compoundableLines.length > 0 && (
            <div>
              <div className="font-medium mb-1">Compound on these lines</div>
              <div className="grid grid-cols-1 gap-0.5">
                {compoundableLines.map((l) => {
                  const on = (line.basis_soft_lines ?? []).includes(l.name);
                  return (
                    <label key={l.name} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const set = new Set(line.basis_soft_lines ?? []);
                          on ? set.delete(l.name) : set.add(l.name);
                          onChange({ basis_soft_lines: Array.from(set) });
                        }}
                      />
                      <span>{l.name}</span>
                      <span className="ml-auto text-gencom-stone font-mono">
                        {formatMoney(totals.soft_cost_line_amounts[l.name] ?? 0)}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  className="text-emerald-700 hover:underline"
                  onClick={() => onChange({ basis_soft_lines: compoundableLines.map((l) => l.name) })}
                >
                  select all
                </button>
                <button
                  className="text-gencom-stone hover:text-gencom-ink"
                  onClick={() => onChange({ basis_soft_lines: [] })}
                >
                  clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function describeBasis(line: SoftCostLine, allDivisions: string[]): string {
  const parts: string[] = [];
  if (Array.isArray(line.basis_categories)) {
    const count = line.basis_categories.length;
    parts.push(count === 0 ? "No categories" : `${count} categor${count === 1 ? "y" : "ies"}`);
  } else if (line.basis_divisions == null) {
    const extras: string[] = [];
    if (line.basis_exclude_dm !== false) extras.push("ex-DM");
    if (line.basis_exclude_it_boh) extras.push("ex-IT/BOH");
    parts.push(extras.length > 0 ? `Hard ${extras.join(" ")}` : "All hard");
  } else {
    const count = line.basis_divisions.length;
    if (count === allDivisions.length) parts.push("All hard");
    else if (count === 0) parts.push("No hard");
    else parts.push(`${count} division${count > 1 ? "s" : ""}`);
  }
  const compound = line.basis_soft_lines ?? [];
  if (compound.length > 0) {
    parts.push(`+ ${compound.length} other line${compound.length > 1 ? "s" : ""}`);
  }
  return parts.join(" ");
}

// ─── Preset menu ────────────────────────────────────────────────────────
function PresetMenu({
  presets, breakdown, onPick, onClose,
}: {
  presets: SoftCostPreset[];
  breakdown: SoftCostLine[];
  onPick: (p: SoftCostPreset) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-6 z-20 max-h-[360px] overflow-auto bg-white border border-gencom-sand rounded-md shadow-lg p-2 w-[320px]"
    >
      <div className="flex justify-between items-center text-xs text-gencom-stone mb-1 px-1">
        <span>Click to add · Esc to close</span>
        <button onClick={onClose} className="hover:text-gencom-ink">×</button>
      </div>
      {presets.length === 0 ? (
        <div className="text-xs text-gencom-stone italic p-2">No presets in this group. Edit presets to add more.</div>
      ) : (
        presets.map((p, i) => {
          const exists = breakdown.some((l) => l.name === p.name);
          return (
            <button
              key={i}
              disabled={exists}
              onClick={() => onPick(p)}
              className={`w-full text-left px-2 py-1 rounded hover:bg-gencom-mist text-xs flex justify-between ${
                exists ? "opacity-40 cursor-not-allowed" : ""
              }`}
            >
              <span>{p.label}</span>
              <span className="text-gencom-stone font-mono">
                {p.defaultPct ? `${(p.defaultPct * 100).toFixed(1)}%` : p.defaultFixed ? formatMoney(p.defaultFixed) : "—"}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

// ─── Preset editor modal ───────────────────────────────────────────────
function PresetEditor({
  presets: initial, onSave, onReset, onClose,
}: {
  presets: SoftCostPreset[];
  onSave: (p: SoftCostPreset[]) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SoftCostPreset[]>(initial);

  function save() {
    onSave(draft);
    onClose();
  }

  function addNew() {
    setDraft((d) => [...d, { label: "New preset", name: "New preset", defaultPct: 0.01, group: "soft" }]);
  }

  function removeAt(idx: number) {
    setDraft((d) => d.filter((_, i) => i !== idx));
  }

  function updateAt(idx: number, patch: Partial<SoftCostPreset>) {
    setDraft((d) => d.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gencom-sand flex items-center justify-between">
          <div>
            <div className="font-display text-xl">Edit soft cost presets</div>
            <div className="text-xs text-gencom-stone">Stored locally — shared across all properties on this computer.</div>
          </div>
          <div className="flex gap-2 text-sm">
            <button onClick={onReset} className="px-3 py-1.5 border border-gencom-sand rounded hover:bg-gencom-mist">
              Reset to defaults
            </button>
            <button onClick={onClose} className="px-3 py-1.5 border border-gencom-sand rounded hover:bg-gencom-mist">
              Cancel
            </button>
            <button onClick={save} className="px-3 py-1.5 bg-emerald-700 text-white rounded hover:bg-emerald-800">
              Save
            </button>
          </div>
        </div>
        <div className="p-4 overflow-auto flex-1 space-y-1.5 text-sm">
          {draft.map((p, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <input
                value={p.label}
                onChange={(e) => updateAt(idx, { label: e.target.value })}
                placeholder="UI label"
                className="flex-1 min-w-0 border border-gencom-sand rounded px-2 py-1"
              />
              <input
                value={p.name}
                onChange={(e) => updateAt(idx, { name: e.target.value })}
                placeholder="Line-item name"
                className="flex-1 min-w-0 border border-gencom-sand rounded px-2 py-1"
              />
              <select
                value={p.group ?? "soft"}
                onChange={(e) => updateAt(idx, { group: e.target.value as Group })}
                className="border border-gencom-sand rounded px-1 py-1 text-xs"
              >
                <option value="soft">Soft</option>
                <option value="contingency">Contingency</option>
                <option value="dev_fee">Dev fee</option>
              </select>
              <div className="flex items-center gap-1 text-xs">
                <input
                  type="number"
                  step="0.001"
                  placeholder="pct"
                  value={p.defaultPct ?? ""}
                  onChange={(e) => updateAt(idx, {
                    defaultPct: e.target.value === "" ? undefined : Number(e.target.value),
                  })}
                  className="w-16 border border-gencom-sand rounded px-1 py-1 text-right"
                />
                <input
                  type="number"
                  step="1000"
                  placeholder="fixed $"
                  value={p.defaultFixed ?? ""}
                  onChange={(e) => updateAt(idx, {
                    defaultFixed: e.target.value === "" ? undefined : Number(e.target.value),
                  })}
                  className="w-24 border border-gencom-sand rounded px-1 py-1 text-right"
                />
              </div>
              <button
                onClick={() => removeAt(idx)}
                className="text-gencom-stone hover:text-red-700"
                title="Remove"
              >×</button>
            </div>
          ))}
          <button
            onClick={addNew}
            className="mt-2 w-full px-3 py-1.5 border border-dashed border-gencom-sand rounded text-emerald-700 hover:bg-gencom-mist"
          >
            + Add new preset
          </button>
        </div>
      </div>
    </div>
  );
}
