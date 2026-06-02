import { useState } from "react";
import { Link } from "react-router-dom";
import PricingMethodology from "./PricingMethodology";
import CostDatabase from "./CostDatabase";
import DmCostsPage from "./DmCostsPage";

type Tab = "db" | "methodology" | "dm_costs";

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "db", label: "Cost Database", hint: "Browse and edit unit-cost rows" },
  { key: "methodology", label: "Pricing Methodology", hint: "Matching algorithm, benchmarks, tier rules" },
  { key: "dm_costs", label: "Def. Maint. Costs", hint: "Deferred-maintenance unit costs (coming soon)" },
];

export default function CostsCombined() {
  const [tab, setTab] = useState<Tab>("db");

  return (
    <div className="animate-fade-in">
      <div className="mb-1 text-sm text-gencom-stone">
        <Link to="/" className="hover:text-gencom-ink">Home</Link>
        {" / "}<span>Cost Database</span>
      </div>
      <h1 className="font-display text-2xl font-bold text-gencom-ink mb-5">Cost Database</h1>

      {/* Top tab bar — solid green for the active tab, quiet for the rest. */}
      <nav className="mb-6 flex gap-2 flex-wrap items-center">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={t.hint}
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
      </nav>

      {tab === "db" && <CostDatabase />}
      {tab === "methodology" && <PricingMethodology />}
      {tab === "dm_costs" && <DmCostsPage />}
    </div>
  );
}
