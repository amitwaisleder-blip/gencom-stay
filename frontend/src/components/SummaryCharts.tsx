import { formatMoney, type Scenario, type ScenarioTotals } from "../lib/api";

const PALETTE = [
  "#047857", "#0891b2", "#b45309", "#7c3aed", "#be123c",
  "#365314", "#115e59", "#9a3412", "#4338ca", "#86198f",
  "#78350f", "#0f766e",
];

function color(i: number) { return PALETTE[i % PALETTE.length]; }

type Props = {
  scenarios: Scenario[];
  totals: Record<string, ScenarioTotals>;
};

export default function SummaryCharts({ scenarios, totals }: Props) {
  // Compute the full set of divisions + per-scenario subtotals
  const allDivisions = Array.from(
    new Set(scenarios.flatMap((s) => Object.keys(totals[s.id]?.division_subtotals ?? {})))
  ).sort();

  const primary = scenarios.find((s) => s.is_default) ?? scenarios[0];
  const primaryTotals = primary ? totals[primary.id] : null;

  if (!primary || !primaryTotals) return null;

  return (
    <div className="mt-8 space-y-6">
      <div>
        <h2 className="font-display text-2xl mb-1">Visual breakdown</h2>
        <div className="text-xs text-gencom-stone">Based on <b>{primary.name}</b> scenario</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DivisionBarChart totals={primaryTotals} allDivisions={allDivisions} />
        <CostTypeDonut totals={primaryTotals} />
      </div>

      <ScenarioComparison scenarios={scenarios} totals={totals} />

      <PriorityBreakdown totals={primaryTotals} />
    </div>
  );
}

// ─── Horizontal bar chart — division subtotals ─────────────────────────
function DivisionBarChart({
  totals, allDivisions,
}: { totals: ScenarioTotals; allDivisions: string[] }) {
  const data = allDivisions
    .map((d) => ({ name: d, value: totals.division_subtotals[d] ?? 0 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="bg-white border border-gencom-sand rounded-lg p-5">
      <div className="font-display text-lg mb-3">Hard cost by division</div>
      {data.length === 0 ? (
        <div className="text-sm text-gencom-stone italic">No scope items added yet.</div>
      ) : (
        <div className="space-y-2">
          {data.map((d, i) => (
            <div key={d.name}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="text-gencom-stone truncate pr-2">{d.name}</span>
                <span className="font-mono">{formatMoney(d.value)}</span>
              </div>
              <div className="w-full h-3 bg-gencom-mist rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${(d.value / max) * 100}%`, background: color(i) }}
                  title={`${d.name}: ${formatMoney(d.value)} · ${((d.value / totals.base_total) * 100).toFixed(1)}% of hard cost`}
                />
              </div>
            </div>
          ))}
          <div className="pt-2 border-t border-gencom-sand mt-3 flex justify-between text-sm">
            <span>Total hard cost</span>
            <b className="font-mono">{formatMoney(totals.base_total)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Donut chart — cost type breakdown ────────────────────────────────
function CostTypeDonut({ totals }: { totals: ScenarioTotals }) {
  const segments = [
    { label: "Hard costs", value: totals.base_total, color: "#1a1d24" },
    { label: "Soft costs", value: totals.soft_costs, color: "#047857" },
    { label: "Contingency", value: totals.contingency, color: "#b45309" },
    { label: "Developer fee", value: totals.dev_fee, color: "#7c3aed" },
  ].filter((s) => s.value > 0);

  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) {
    return (
      <div className="bg-white border border-gencom-sand rounded-lg p-5">
        <div className="font-display text-lg mb-3">Cost mix</div>
        <div className="text-sm text-gencom-stone italic">No totals yet.</div>
      </div>
    );
  }

  // Build donut segments as SVG arcs
  const cx = 100;
  const cy = 100;
  const r = 80;
  const inner = 48;
  let angle = -Math.PI / 2;
  const arcs = segments.map((s) => {
    const portion = s.value / total;
    const start = angle;
    const end = angle + portion * 2 * Math.PI;
    angle = end;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const xi1 = cx + inner * Math.cos(end);
    const yi1 = cy + inner * Math.sin(end);
    const xi2 = cx + inner * Math.cos(start);
    const yi2 = cy + inner * Math.sin(start);
    const d = [
      `M ${x1} ${y1}`,
      `A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`,
      `L ${xi1} ${yi1}`,
      `A ${inner} ${inner} 0 ${large} 0 ${xi2} ${yi2}`,
      "Z",
    ].join(" ");
    return { ...s, d, portion };
  });

  return (
    <div className="bg-white border border-gencom-sand rounded-lg p-5">
      <div className="font-display text-lg mb-3">Cost mix</div>
      <div className="grid grid-cols-[200px_1fr] gap-4 items-center">
        <svg viewBox="0 0 200 200" className="w-full h-auto">
          {arcs.map((a, i) => (
            <path key={i} d={a.d} fill={a.color}>
              <title>{a.label}: {formatMoney(a.value)}</title>
            </path>
          ))}
          <text x="100" y="97" textAnchor="middle" fontSize="11" fill="#6b6f78">Grand total</text>
          <text x="100" y="114" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#1a1d24">
            {formatMoney(total)}
          </text>
        </svg>
        <div className="space-y-1.5 text-sm">
          {arcs.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: a.color }} />
              <span className="text-gencom-stone flex-1">{a.label}</span>
              <span className="font-mono text-xs">{formatMoney(a.value)}</span>
              <span className="font-mono text-xs text-gencom-stone w-10 text-right">
                {(a.portion * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Grouped bar chart — scenario comparison ──────────────────────────
function ScenarioComparison({
  scenarios, totals,
}: { scenarios: Scenario[]; totals: Record<string, ScenarioTotals> }) {
  const rows = scenarios.map((s) => {
    const t = totals[s.id];
    return {
      name: s.name,
      hard: t?.base_total ?? 0,
      soft: t?.soft_costs ?? 0,
      contingency: t?.contingency ?? 0,
      dev_fee: t?.dev_fee ?? 0,
      grand: t?.grand_total ?? 0,
    };
  });
  const max = Math.max(...rows.map((r) => r.grand), 1);

  return (
    <div className="bg-white border border-gencom-sand rounded-lg p-5">
      <div className="font-display text-lg mb-3">Scenario comparison</div>
      <div className="space-y-4">
        {rows.map((r) => {
          const hardPct = (r.hard / max) * 100;
          const softPct = (r.soft / max) * 100;
          const contPct = (r.contingency / max) * 100;
          const devPct = (r.dev_fee / max) * 100;
          return (
            <div key={r.name}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{r.name}</span>
                <span className="font-mono">{formatMoney(r.grand)}</span>
              </div>
              <div className="w-full h-6 bg-gencom-mist rounded overflow-hidden flex">
                <div style={{ width: `${hardPct}%`, background: "#1a1d24" }} title={`Hard: ${formatMoney(r.hard)}`} />
                <div style={{ width: `${softPct}%`, background: "#047857" }} title={`Soft: ${formatMoney(r.soft)}`} />
                <div style={{ width: `${contPct}%`, background: "#b45309" }} title={`Contingency: ${formatMoney(r.contingency)}`} />
                <div style={{ width: `${devPct}%`, background: "#7c3aed" }} title={`Dev fee: ${formatMoney(r.dev_fee)}`} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-gencom-stone flex-wrap">
        <Legend color="#1a1d24" label="Hard" />
        <Legend color="#047857" label="Soft" />
        <Legend color="#b45309" label="Contingency" />
        <Legend color="#7c3aed" label="Dev fee" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

// ─── Priority breakdown (Required / Recommended / Optional) ───────────
function PriorityBreakdown({ totals }: { totals: ScenarioTotals }) {
  const entries = Object.entries(totals.priority_breakdown).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const colors: Record<string, string> = {
    required: "#be123c",
    recommended: "#b45309",
    optional: "#0891b2",
    na: "#6b6f78",
  };
  return (
    <div className="bg-white border border-gencom-sand rounded-lg p-5">
      <div className="font-display text-lg mb-3">Scope by priority</div>
      <div className="w-full h-8 bg-gencom-mist rounded overflow-hidden flex mb-3">
        {entries.map(([p, v]) => (
          <div
            key={p}
            style={{ width: `${(v / total) * 100}%`, background: colors[p] ?? "#6b6f78" }}
            title={`${p}: ${formatMoney(v)}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {entries.map(([p, v]) => (
          <div key={p} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ background: colors[p] ?? "#6b6f78" }} />
            <span className="capitalize text-gencom-stone">{p}</span>
            <span className="ml-auto font-mono">{formatMoney(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
