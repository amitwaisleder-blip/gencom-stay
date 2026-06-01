import { useState } from "react";
import { capexApi } from "../lib/capexApi";
import type { HotelEnrichment } from "../lib/types";
import { FieldLabel, TextInput } from "./sharedWizardUI";

export type HotelDetails = {
  name: string;
} & HotelEnrichment;

export function emptyHotelDetails(): HotelDetails {
  return {
    name: "",
    address: null,
    city: null,
    state: null,
    country: null,
    keys: null,
    year_built: null,
    last_renovation: null,
    current_brand: null,
    current_flag: null,
    property_type: null,
    floors: null,
    notes: null,
    enrichment_confidence: null,
  };
}

export function HotelDetailsForm({
  details,
  onChange,
  cityHint,
  nameLabel = "Hotel name",
  namePlaceholder = "e.g. Rosewood Miami Beach",
  compact = false,
}: {
  details: HotelDetails;
  onChange: (next: HotelDetails) => void;
  /** Optional disambiguation hint for the AI lookup. */
  cityHint?: string;
  nameLabel?: string;
  namePlaceholder?: string;
  compact?: boolean;
}) {
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  function patch(p: Partial<HotelDetails>) {
    onChange({ ...details, ...p });
  }

  async function aiFill() {
    if (!details.name.trim()) {
      setLookupError("Type a hotel name first.");
      return;
    }
    setLookupError(null);
    setLooking(true);
    try {
      const r = await capexApi.lookupHotel(details.name.trim(), cityHint);
      onChange({
        ...details,
        // Don't overwrite name — keep what the user typed.
        address: r.address ?? null,
        city: r.city ?? null,
        state: r.state ?? null,
        country: r.country ?? null,
        keys: r.keys ?? null,
        year_built: r.year_built ?? null,
        last_renovation: r.last_renovation ?? null,
        current_brand: r.current_brand ?? null,
        current_flag: r.current_flag ?? null,
        property_type: r.property_type ?? null,
        floors: r.floors ?? null,
        notes: r.notes ?? null,
        enrichment_confidence: r.confidence ?? null,
      });
      setShowAdvanced(true);
    } catch (e) {
      setLookupError(String(e));
    } finally {
      setLooking(false);
    }
  }

  const conf = details.enrichment_confidence;

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-end justify-between gap-2 mb-1">
          <FieldLabel required>{nameLabel}</FieldLabel>
          <button
            type="button"
            onClick={aiFill}
            disabled={looking || !details.name.trim()}
            className="text-[11px] uppercase tracking-wider font-semibold text-gencom-gold hover:text-gencom-ink disabled:text-gencom-stone/50 disabled:cursor-not-allowed flex items-center gap-1"
            title="Use Claude to auto-fill address, keys, year built, and more"
          >
            {looking ? (
              <>
                <Spinner /> Looking up…
              </>
            ) : (
              <>✨ Auto-fill with AI</>
            )}
          </button>
        </div>
        <TextInput
          value={details.name}
          onChange={(v) => patch({ name: v })}
          placeholder={namePlaceholder}
        />
        {lookupError && (
          <div className="mt-1 text-[11px] text-red-700">{lookupError}</div>
        )}
        {conf && (
          <div className="mt-1 text-[11px] text-gencom-stone">
            AI confidence:{" "}
            <span
              className={
                conf === "high"
                  ? "text-emerald-700 font-semibold"
                  : conf === "medium"
                  ? "text-gencom-gold font-semibold"
                  : "text-red-700 font-semibold"
              }
            >
              {conf}
            </span>{" "}
            — verify the values below before saving.
          </div>
        )}
      </div>

      {(showAdvanced || hasAnyDetail(details)) && (
        <div className={compact ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 md:grid-cols-2 gap-3"}>
          <div className="md:col-span-2">
            <FieldLabel>Address</FieldLabel>
            <TextInput value={details.address ?? ""} onChange={(v) => patch({ address: v || null })} />
          </div>
          <div>
            <FieldLabel>City</FieldLabel>
            <TextInput value={details.city ?? ""} onChange={(v) => patch({ city: v || null })} />
          </div>
          <div>
            <FieldLabel>State</FieldLabel>
            <TextInput value={details.state ?? ""} onChange={(v) => patch({ state: v || null })} />
          </div>
          <div>
            <FieldLabel>Country</FieldLabel>
            <TextInput value={details.country ?? ""} onChange={(v) => patch({ country: v || null })} />
          </div>
          <div>
            <FieldLabel>Property type</FieldLabel>
            <TextInput
              value={details.property_type ?? ""}
              onChange={(v) => patch({ property_type: v || null })}
            />
          </div>
          <div>
            <FieldLabel>Total keys</FieldLabel>
            <TextInput
              type="number"
              value={details.keys ?? ""}
              onChange={(v) => patch({ keys: v === "" ? null : Number(v) })}
            />
          </div>
          <div>
            <FieldLabel>Floors</FieldLabel>
            <TextInput
              type="number"
              value={details.floors ?? ""}
              onChange={(v) => patch({ floors: v === "" ? null : Number(v) })}
            />
          </div>
          <div>
            <FieldLabel>Year built</FieldLabel>
            <TextInput
              type="number"
              value={details.year_built ?? ""}
              onChange={(v) => patch({ year_built: v === "" ? null : Number(v) })}
            />
          </div>
          <div>
            <FieldLabel>Last renovation</FieldLabel>
            <TextInput
              type="number"
              value={details.last_renovation ?? ""}
              onChange={(v) => patch({ last_renovation: v === "" ? null : Number(v) })}
            />
          </div>
          <div>
            <FieldLabel>Current brand</FieldLabel>
            <TextInput
              value={details.current_brand ?? ""}
              onChange={(v) => patch({ current_brand: v || null })}
            />
          </div>
          <div>
            <FieldLabel>Operator / flag</FieldLabel>
            <TextInput
              value={details.current_flag ?? ""}
              onChange={(v) => patch({ current_flag: v || null })}
            />
          </div>
          <div className="md:col-span-2">
            <FieldLabel>Notes</FieldLabel>
            <textarea
              value={details.notes ?? ""}
              onChange={(e) => patch({ notes: e.target.value || null })}
              rows={2}
              className="w-full px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold resize-y"
            />
          </div>
        </div>
      )}

      {!showAdvanced && !hasAnyDetail(details) && (
        <button
          type="button"
          onClick={() => setShowAdvanced(true)}
          className="text-[11px] uppercase tracking-wider text-gencom-stone hover:text-gencom-ink"
        >
          + Add property details manually
        </button>
      )}
    </div>
  );
}


function hasAnyDetail(d: HotelDetails): boolean {
  return Boolean(
    d.address || d.city || d.state || d.country || d.keys || d.year_built ||
    d.last_renovation || d.current_brand || d.current_flag || d.property_type ||
    d.floors || d.notes,
  );
}


function Spinner() {
  return (
    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
