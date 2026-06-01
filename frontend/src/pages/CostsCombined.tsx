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
    <div>
      <div className="mb-3 text-sm text-gencom-stone">
        <Link to="/" className="hover:text-gencom-ink">Home</Link>
        {" / "}<span>Cost Database</span>
      </div>

      {/* Top tab bar — matches the green-pill style used elsewhere. */}
      <nav className="mb-6 flex gap-2 flex-wrap items-center">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={t.hint}
              className={`px-5 py-3 text-sm uppercase tracking-wider whitespace-nowrap rounded-md font-semibold transition shadow-sm ${
                active
                  ? "bg-emerald-700 text-white ring-2 ring-emerald-700/30"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
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
