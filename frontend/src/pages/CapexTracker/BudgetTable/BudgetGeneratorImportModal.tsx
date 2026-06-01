import { useEffect, useMemo, useState } from "react";
import { api as bgApi, type PropertyCard, type ScopeItem } from "../../../lib/api";
import { capexApi, fmtMoney } from "../lib/capexApi";
import type { CapexLine } from "../lib/types";
import { GhostButton, PrimaryButton } from "../wizards/sharedWizardUI";

type Stage = "pick-property" | "review" | "saving" | "done";

type DraftLine = {
  scopeItemId: string;
  included: boolean;
  group: string;
  category: string;
  project_name: string;
  description: string;
  vendor: string;
  total: number;
};

export function BudgetGeneratorImportModal({
  hotelId,
  onClose,
  onImported,
}: {
  hotelId: string;
  onClose: () => void;
  onImported: (created: CapexLine[]) => void;
}) {
  const [stage, setStage] = useState<Stage>("pick-property");
  const [error, setError] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyCard[] | null>(null);
  const [propertyId, setPropertyId] = useState<string>("");
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    bgApi
      .listProperties()
      .then((rows) => {
        if (!cancelled) setProperties(rows.filter((p) => !p.archived));
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pickProperty() {
    if (!propertyId) {
      setError("Pick a property to import from.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const items = await bgApi.listScope(propertyId);
      const built = items.map(scopeItemToDraft);
      setDrafts(built);
      setStage("review");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function patchDraft(id: string, patch: Partial<DraftLine>) {
    setDrafts((prev) => prev.map((d) => (d.scopeItemId === id ? { ...d, ...patch } : d)));
  }

  function toggleAll(included: boolean) {
    setDrafts((prev) => prev.map((d) => ({ ...d, included })));
  }

  async function importSelected() {
    const toCreate = drafts.filter((d) => d.included);
    if (toCreate.length === 0) {
      setError("Select at least one line to import.");
      return;
    }
    setStage("saving");
    setError(null);
    try {
      const payload = toCreate.map((d, idx) => ({
        code: null,
        group: d.group || null,
        category: d.category || null,
        project_name: d.project_name || null,
        description: d.description || null,
        vendor: d.vendor || null,
        original_total_budget: d.total,
        forecast_total_budget: d.total,
        sort_order: idx,
      }));
      const created = await capexApi.bulkCreateLines(hotelId, payload);
      onImported(created);
      setStage("done");
    } catch (e) {
      setError(String(e));
      setStage("review");
    }
  }

  const property = properties?.find((p) => p.id === propertyId) ?? null;
  const totalIncluded = drafts.filter((d) => d.included).reduce((acc, d) => acc + d.total, 0);
  const includedCount = drafts.filter((d) => d.included).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="t-eyebrow">Budget Generator</div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-gencom-ink">
              {stage === "pick-property" && "Pick a property to import"}
              {stage === "review" && `Review lines from ${property?.name ?? "property"}`}
              {stage === "saving" && "Importing…"}
              {stage === "done" && "Imported"}
            </h2>
            <p className="text-xs text-gencom-stone mt-1">
              Snapshot a Budget Generator property's scope items into this hotel as Capex Tracker lines. One-time copy — they won't track changes after import.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gencom-stone hover:text-gencom-ink text-xl w-8 h-8 rounded-md hover:bg-gencom-mist"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {stage === "pick-property" && (
          <PropertyPicker
            properties={properties}
            selected={propertyId}
            setSelected={setPropertyId}
            loading={loading}
          />
        )}

        {stage === "review" && (
          <ReviewStage
            drafts={drafts}
            patchDraft={patchDraft}
            toggleAll={toggleAll}
          />
        )}

        {stage === "saving" && (
          <div className="py-16 text-center text-sm text-gencom-stone">Importing {includedCount} lines…</div>
        )}

        {stage === "done" && (
          <div className="py-12 text-center">
            <div className="text-5xl mb-2">✓</div>
            <div className="font-display text-lg uppercase tracking-wide text-gencom-ink">
              {includedCount} lines imported
            </div>
            <p className="text-sm text-gencom-stone mt-2">
              Total budget added: {fmtMoney(totalIncluded)}.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="text-xs text-gencom-stone">
            {stage === "review" && (
              <>
                {includedCount} of {drafts.length} selected · {fmtMoney(totalIncluded)}
              </>
            )}
          </div>
          <div className="flex gap-3">
            {stage === "pick-property" && (
              <>
                <GhostButton onClick={onClose}>Cancel</GhostButton>
                <PrimaryButton onClick={pickProperty} disabled={!propertyId || loading}>
                  {loading ? "Loading scope…" : "Next →"}
                </PrimaryButton>
              </>
            )}
            {stage === "review" && (
              <>
                <GhostButton onClick={() => setStage("pick-property")}>← Back</GhostButton>
                <PrimaryButton onClick={importSelected} disabled={includedCount === 0}>
                  Import {includedCount} lines
                </PrimaryButton>
              </>
            )}
            {stage === "done" && <PrimaryButton onClick={onClose}>Done</PrimaryButton>}
          </div>
        </div>
      </div>
    </div>
  );
}


function scopeItemToDraft(s: ScopeItem): DraftLine {
  // Budget Generator divisions tend to be already capitalized hard-cost categories
  // (e.g. "GUESTROOMS", "PUBLIC AREAS", "MEP"). We park them under "Hard Costs"
  // by default since BG's own scope is hard-cost-only; the user can re-classify.
  const division = (s.division ?? "").trim();
  return {
    scopeItemId: s.id,
    included: s.included_in_budget && !s.deleted,
    group: "Hard Costs",
    category: prettify(division || "Uncategorized"),
    project_name: s.line_item,
    description: s.description ?? "",
    vendor: "",
    total: Number(s.line_total ?? 0),
  };
}

function prettify(s: string): string {
  // Convert ALL CAPS → Title Case for nicer display.
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}


function PropertyPicker({
  properties,
  selected,
  setSelected,
  loading,
}: {
  properties: PropertyCard[] | null;
  selected: string;
  setSelected: (id: string) => void;
  loading: boolean;
}) {
  if (properties === null) {
    return <div className="py-12 text-center text-sm text-gencom-stone">Loading properties…</div>;
  }
  if (properties.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gencom-stone">
        No Budget Generator properties found. Build one in the Full Budget Generator first.
      </div>
    );
  }
  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
      {properties.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setSelected(p.id)}
          disabled={loading}
          className={`w-full text-left px-4 py-3 rounded-md border transition flex items-center gap-3 ${
            selected === p.id
              ? "border-gencom-gold bg-gencom-gold/5 ring-1 ring-gencom-gold"
              : "border-gencom-sand bg-white hover:border-gencom-stone"
          }`}
        >
          <div className="w-12 h-12 rounded-md bg-gencom-mist border border-gencom-sand overflow-hidden flex-shrink-0">
            {p.thumbnail_path ? (
              <img src={p.thumbnail_path} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gencom-stone/50 text-xl">🏛</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gencom-ink truncate">{p.name ?? "Untitled property"}</div>
            <div className="text-[11px] text-gencom-stone">
              {[p.target_brand, [p.city, p.state].filter(Boolean).join(", "), p.keys ? `${p.keys} keys` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-sm font-semibold text-gencom-ink">{fmtMoney(p.full_scope_total)}</div>
            <div className="text-[10px] uppercase tracking-wider text-gencom-stone">full scope</div>
          </div>
        </button>
      ))}
    </div>
  );
}


function ReviewStage({
  drafts,
  patchDraft,
  toggleAll,
}: {
  drafts: DraftLine[];
  patchDraft: (id: string, patch: Partial<DraftLine>) => void;
  toggleAll: (included: boolean) => void;
}) {
  if (drafts.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gencom-stone">
        This property has no scope items. Add some in the Full Budget Generator first.
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => toggleAll(true)}
          className="text-[11px] uppercase tracking-wider text-gencom-stone hover:text-gencom-ink"
        >
          Select all
        </button>
        <span className="text-gencom-stone/40">·</span>
        <button
          type="button"
          onClick={() => toggleAll(false)}
          className="text-[11px] uppercase tracking-wider text-gencom-stone hover:text-gencom-ink"
        >
          Deselect all
        </button>
      </div>
      <div className="rounded-md border border-gencom-sand overflow-hidden max-h-[60vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gencom-mist/60 text-[10px] uppercase tracking-wider text-gencom-stone sticky top-0">
            <tr>
              <th className="w-8 px-2 py-2 text-center"></th>
              <th className="px-2 py-2 text-left">Group</th>
              <th className="px-2 py-2 text-left">Category</th>
              <th className="px-2 py-2 text-left">Project name</th>
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr
                key={d.scopeItemId}
                className={`border-t border-gencom-sand/60 ${d.included ? "" : "opacity-40"}`}
              >
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={d.included}
                    onChange={(e) => patchDraft(d.scopeItemId, { included: e.target.checked })}
                    className="accent-gencom-gold"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <CellInput value={d.group} onChange={(v) => patchDraft(d.scopeItemId, { group: v })} />
                </td>
                <td className="px-2 py-1.5">
                  <CellInput value={d.category} onChange={(v) => patchDraft(d.scopeItemId, { category: v })} />
                </td>
                <td className="px-2 py-1.5">
                  <CellInput
                    value={d.project_name}
                    onChange={(v) => patchDraft(d.scopeItemId, { project_name: v })}
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    value={d.total}
                    onChange={(e) => patchDraft(d.scopeItemId, { total: Number(e.target.value) || 0 })}
                    className="w-28 px-1.5 py-0.5 border border-transparent hover:border-gencom-sand focus:border-gencom-gold focus:bg-white rounded text-xs text-right bg-transparent"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-1.5 py-0.5 border border-transparent hover:border-gencom-sand focus:border-gencom-gold focus:bg-white rounded text-xs bg-transparent"
    />
  );
}
