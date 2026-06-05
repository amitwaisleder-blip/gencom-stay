import { useEffect, useState, type ReactNode } from "react";
import { api, formatMoney, type ScenarioTotals } from "../lib/api";

type Props = { propertyId: string; keys?: number | null; extra?: ReactNode };

export default function TotalsBar({ propertyId, keys, extra }: Props) {
  const [totals, setTotals] = useState<ScenarioTotals | null>(null);
  const [scenarioName, setScenarioName] = useState<string>("Required Only");

  async function refresh() {
    const scenarios = await api.listScenarios(propertyId);
    const def = scenarios.find((s) => s.is_default) ?? scenarios[0];
    if (!def) return;
    setScenarioName(def.name);
    const t = await api.scenarioTotals(propertyId, def.id);
    setTotals(t);
  }

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [propertyId]);

  if (!totals) {
    return (
      <div className="mb-3 px-3 py-1.5 bg-white border border-gencom-sand rounded-md text-xs text-gencom-stone">
        Loading totals…
      </div>
    );
  }

  const hard = totals.base_total;
  // Include dev_fee so Hard + Soft reconciles with Grand and the Summary page.
  const soft = totals.soft_costs + totals.contingency + totals.escalation
    + totals.ffe + totals.ose + totals.tech + (totals.dev_fee ?? 0);
  const grand = totals.grand_total;
  void keys;

  return (
    <div className="mb-2 px-3 py-2 bg-white border border-gencom-sand rounded-md flex items-center gap-4 flex-wrap">
      <span className="text-[10px] uppercase tracking-wide text-gencom-stone">
        <b className="text-gencom-ink">{scenarioName}</b>
      </span>
      <Stat label="Hard" value={hard} />
      <Stat label="Soft" value={soft} />
      <Stat label="Grand total" value={grand} />
      <div className="ml-auto flex items-center gap-2">
        {extra}
        <button
          onClick={refresh}
          className="text-[11px] text-gencom-stone hover:text-gencom-ink"
        >↻</button>
      </div>
    </div>
  );
}

function Stat({
  label, value,
}: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-2 rounded px-2 py-1 bg-white border border-gencom-sand text-gencom-ink">
      <span className="text-[10px] uppercase tracking-wide text-gencom-stone">{label}</span>
      <span className="font-display leading-tight text-2xl">
        {formatMoney(value)}
      </span>
    </div>
  );
}
