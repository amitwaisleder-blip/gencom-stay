// New-project modal — captures hotel metadata, photo, structure, and
// theme so the editor opens into a chart that already reflects the
// property. Hotel name is required; the rest is optional. AI auto-fill
// reuses the CapexTracker /lookup-hotel endpoint (Claude).

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, Trash2, X } from "lucide-react";

import { fileToResizedDataUrl } from "../lib/image";
import {
  STRUCTURE_OPTIONS, buildChart,
} from "../lib/structures";
import type { StructureKey } from "../lib/structures";
import type { HotelMeta } from "../lib/storage";
import { THEMES } from "../lib/themes";
import type { ChartState, ThemeKey } from "../lib/types";

type LookupResult = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  keys?: number | null;
  year_built?: number | null;
  current_brand?: string | null;
  confidence?: string | null;
};

export function NewProjectModal({
  onCancel, onCreate, mode = "create", initialName, initialHotel,
}: {
  onCancel: () => void;
  /** The parent persists this — modal just hands back the assembled
   *  hotel meta + initial chart state. In edit mode the chart is
   *  always the existing one, so the parent should ignore that field. */
  onCreate: (args: { name: string; hotel: HotelMeta; chart: ChartState }) => void;
  /** "create" (default) shows structure / theme pickers; "edit" hides
   *  them and only lets the user tweak hotel metadata + photo. */
  mode?: "create" | "edit";
  initialName?: string;
  initialHotel?: HotelMeta;
}) {
  const isEdit = mode === "edit";
  const [hotelName, setHotelName] = useState(initialHotel?.hotelName ?? initialName ?? "");
  const [address, setAddress] = useState(initialHotel?.address ?? "");
  const [city, setCity] = useState(initialHotel?.city ?? "");
  const [state, setState] = useState(initialHotel?.state ?? "");
  const [keyCount, setKeyCount] = useState<string>(initialHotel?.keyCount != null ? String(initialHotel.keyCount) : "");
  const [yearBuilt, setYearBuilt] = useState<string>(initialHotel?.yearBuilt != null ? String(initialHotel.yearBuilt) : "");
  const [purchaseYear, setPurchaseYear] = useState<string>(initialHotel?.purchaseYear != null ? String(initialHotel.purchaseYear) : "");
  const [brand, setBrand] = useState(initialHotel?.brand ?? "");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(initialHotel?.photoDataUrl ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [structure, setStructure] = useState<StructureKey>("single-llc");
  const [themeKey, setThemeKey] = useState<ThemeKey>("hyatt-blue");
  const [confidence, setConfidence] = useState<string | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Esc closes. Outside click handled by the backdrop.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function handleLookup() {
    if (!hotelName.trim()) {
      setLookupError("Type a hotel name first.");
      return;
    }
    setLookupBusy(true);
    setLookupError(null);
    try {
      const res = await fetch("/api/capex-tracker/lookup-hotel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: hotelName.trim(), city_hint: city || null }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `${res.status}`);
      }
      const r = (await res.json()) as LookupResult;
      // Only fill empty fields — don't blow away the user's edits.
      if (!address && r.address) setAddress(r.address);
      if (!city && r.city) setCity(r.city);
      if (!state && r.state) setState(r.state);
      if (!keyCount && r.keys != null) setKeyCount(String(r.keys));
      if (!yearBuilt && r.year_built != null) setYearBuilt(String(r.year_built));
      if (!brand && r.current_brand) setBrand(r.current_brand);
      setConfidence(r.confidence ?? null);
    } catch (e) {
      const msg = (e as Error).message;
      setLookupError(/api key/i.test(msg)
        ? "Claude API key isn't configured on the backend (set ANTHROPIC_API_KEY in pip-budget-app/backend/.env)."
        : `Lookup failed: ${msg}`);
    } finally {
      setLookupBusy(false);
    }
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const url = await fileToResizedDataUrl(file);
      setPhotoDataUrl(url);
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = hotelName.trim();
    if (!trimmedName) return;
    const hotel: HotelMeta = {
      hotelName: trimmedName,
      address: address.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      country: null,
      keyCount: keyCount === "" ? null : Number(keyCount),
      yearBuilt: yearBuilt === "" ? null : Number(yearBuilt),
      purchaseYear: purchaseYear === "" ? null : Number(purchaseYear),
      brand: brand.trim() || null,
      photoDataUrl,
    };
    const chart = buildChart({
      structure,
      themeKey,
      hotelName: trimmedName,
      title: trimmedName,
    });
    onCreate({ name: trimmedName, hotel, chart });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="orgchart-newproject-title"
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-4"
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl border border-gencom-sand w-full max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="px-5 py-3 border-b border-gencom-sand flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="t-eyebrow">{isEdit ? "Edit project" : "New project"}</div>
            <h2 id="orgchart-newproject-title" className="t-h2 mt-0.5">
              {isEdit ? "Edit hotel details" : "Build an org chart for…"}
            </h2>
            <p className="text-[12px] text-gencom-stone mt-0.5">
              {isEdit
                ? "Update the hotel name, address, photo or use AI auto-fill. Chart stays as-is."
                : "Type the hotel name and let AI fill the rest."}
            </p>
          </div>
          {photoDataUrl ? (
            <div className="relative shrink-0">
              <img
                src={photoDataUrl}
                alt="Property"
                className="h-12 w-16 object-cover rounded border border-gencom-sand"
              />
              <button
                type="button"
                onClick={() => setPhotoDataUrl(null)}
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-white border border-gencom-sand grid place-items-center text-red-700 shadow-sm hover:bg-red-50"
                title="Remove photo"
              >
                <Trash2 className="h-2 w-2" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoBusy}
              className="h-12 w-16 shrink-0 rounded border border-dashed border-gencom-sand grid place-items-center text-gencom-stone hover:border-emerald-700 hover:text-emerald-700 transition disabled:opacity-50"
              title="Add property photo"
            >
              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            </button>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handlePhoto(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={onCancel}
            className="text-gencom-stone hover:text-gencom-ink p-1 -mt-1 shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-3 grid grid-cols-12 gap-x-3 gap-y-3">
          <div className="col-span-12 sm:col-span-4">
            <div className="flex items-end justify-between gap-2 mb-1 min-h-[16px]">
              <Label required>Hotel name</Label>
              <button
                type="button"
                onClick={handleLookup}
                disabled={lookupBusy || !hotelName.trim()}
                className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 hover:text-emerald-800 disabled:text-gencom-stone/50 disabled:cursor-not-allowed inline-flex items-center gap-1 whitespace-nowrap"
                title="Use Claude to auto-fill address, keys, year built"
              >
                {lookupBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {lookupBusy ? "Looking up…" : "Auto-fill with AI"}
              </button>
            </div>
            <Input
              autoFocus
              value={hotelName}
              onChange={setHotelName}
              placeholder="e.g. Ritz-Carlton, Naples"
            />
          </div>
          <div className="col-span-12 sm:col-span-4">
            <Label>Address</Label>
            <Input value={address} onChange={setAddress} placeholder="Street address" />
          </div>
          <div className="col-span-6 sm:col-span-2">
            <Label>City</Label>
            <Input value={city} onChange={setCity} />
          </div>
          <div className="col-span-6 sm:col-span-2">
            <Label>State</Label>
            <Input value={state} onChange={setState} />
          </div>

          {(lookupError || (confidence && !lookupError)) && (
            <div className="col-span-12 -mt-1">
              {lookupError && <p className="text-[11px] text-red-700">{lookupError}</p>}
              {confidence && !lookupError && (
                <p className="text-[11px] text-gencom-stone">
                  AI confidence:{" "}
                  <span className={
                    confidence === "high"   ? "text-emerald-700 font-semibold" :
                    confidence === "medium" ? "text-amber-700 font-semibold"   :
                                              "text-red-700 font-semibold"
                  }>
                    {confidence}
                  </span>{" "}
                  — verify the values below.
                </p>
              )}
            </div>
          )}

          <div className="col-span-6 sm:col-span-3">
            <Label>Key count</Label>
            <Input value={keyCount} onChange={setKeyCount} type="number" placeholder="e.g. 250" />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Label>Year built</Label>
            <Input value={yearBuilt} onChange={setYearBuilt} type="number" placeholder="e.g. 1985" />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Label>Brand / flag</Label>
            <Input value={brand} onChange={setBrand} placeholder="e.g. Ritz-Carlton" />
          </div>
          <div className="col-span-6 sm:col-span-3">
            <Label>Purchase year</Label>
            <Input value={purchaseYear} onChange={setPurchaseYear} type="number" placeholder="optional" />
          </div>
        </div>

        {/* Structure / theme — only shown for new projects. Edit
            mode keeps the existing chart and only edits hotel meta. */}
        {!isEdit && (
          <div className="px-5 pb-3 border-t border-gencom-sand pt-3">
            <Label>Initial structure</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {STRUCTURE_OPTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStructure(s.key)}
                  className={
                    "text-left px-3 py-1.5 rounded border transition " +
                    (structure === s.key
                      ? "border-emerald-700 bg-emerald-50/60 ring-1 ring-emerald-700"
                      : "border-gencom-sand hover:border-emerald-700/40")
                  }
                >
                  <div className="text-[12.5px] font-semibold text-gencom-ink leading-tight">{s.label}</div>
                  <div className="text-[11px] text-gencom-stone leading-snug">{s.description}</div>
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="t-eyebrow shrink-0">Theme</span>
              {(Object.keys(THEMES) as Array<keyof typeof THEMES>).map((k) => {
                const t = THEMES[k];
                const active = themeKey === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setThemeKey(k)}
                    title={`${t.label} — ${t.description}`}
                    className={
                      "h-6 w-6 rounded transition " +
                      (active ? "ring-2 ring-emerald-700 ring-offset-1" : "hover:ring-1 hover:ring-emerald-700/40")
                    }
                    style={{
                      background: t.defaults.fillColor,
                      border: `2px solid ${t.defaults.borderColor}`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}

        <div className="px-5 py-2.5 border-t border-gencom-sand flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="ib-button-ghost text-xs h-8 px-3"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!hotelName.trim()}
            className="ib-button-primary text-xs h-8 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isEdit ? "Save changes" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block t-eyebrow mb-1">
      {children}
      {required && <span className="text-red-600 ml-0.5">*</span>}
    </span>
  );
}

function Input({
  value, onChange, placeholder, type, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  autoFocus?: boolean;
}) {
  return (
    <input
      autoFocus={autoFocus}
      type={type ?? "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="ib-input w-full"
    />
  );
}
