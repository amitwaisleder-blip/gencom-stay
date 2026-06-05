import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { capexApi } from "../lib/capexApi";
import {
  BudgetSourcePlaceholder,
  defaultYearRange,
  FieldLabel,
  GhostButton,
  ImageDropzone,
  PrimaryButton,
  TextInput,
  WizardShell,
  YearRangeFields,
} from "./sharedWizardUI";
import { emptyHotelDetails, HotelDetailsForm, type HotelDetails } from "./HotelDetailsForm";

type DraftHotel = {
  tempId: string;
  details: HotelDetails;
  imageFile: File | null;
  imagePreview: string | null;
  expanded: boolean;
};

function newDraftHotel(): DraftHotel {
  return {
    tempId: Math.random().toString(36).slice(2),
    details: emptyHotelDetails(),
    imageFile: null,
    imagePreview: null,
    expanded: true,
  };
}

export default function PortfolioWizard() {
  const navigate = useNavigate();
  const def = defaultYearRange();
  const [step, setStep] = useState(1);

  // Step 1: portfolio meta
  const [name, setName] = useState("");
  const [yearStart, setYearStart] = useState(def.start);
  const [yearEnd, setYearEnd] = useState(def.end);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Step 2: hotels in the portfolio
  const [hotels, setHotels] = useState<DraftHotel[]>([newDraftHotel()]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickPortfolioImage(file: File) {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function updateHotel(idx: number, patch: Partial<DraftHotel>) {
    setHotels((prev) => prev.map((h, i) => (i === idx ? { ...h, ...patch } : h)));
  }

  function patchHotelDetails(idx: number, details: HotelDetails) {
    updateHotel(idx, { details });
  }

  function pickHotelImage(idx: number, file: File) {
    updateHotel(idx, { imageFile: file, imagePreview: URL.createObjectURL(file) });
  }

  function addHotel() {
    setHotels((prev) => [...prev, newDraftHotel()]);
  }

  function removeHotel(idx: number) {
    setHotels((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function goToHotels() {
    if (!name.trim()) {
      setError("Portfolio name is required.");
      return;
    }
    if (yearEnd < yearStart) {
      setError("Year end must be on or after year start.");
      return;
    }
    setError(null);
    setStep(2);
  }

  async function submit() {
    const validHotels = hotels.filter((h) => h.details.name.trim().length > 0);
    if (validHotels.length === 0) {
      setError("Add at least one hotel to the portfolio.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const project = await capexApi.createProject({
        kind: "portfolio",
        name: name.trim(),
        year_start: yearStart,
        year_end: yearEnd,
        hotels: validHotels.map((h, i) => ({
          name: h.details.name.trim(),
          sort_order: i,
          address: h.details.address,
          city: h.details.city,
          state: h.details.state,
          country: h.details.country,
          keys: h.details.keys,
          year_built: h.details.year_built,
          last_renovation: h.details.last_renovation,
          current_brand: h.details.current_brand,
          current_flag: h.details.current_flag,
          property_type: h.details.property_type,
          floors: h.details.floors,
          notes: h.details.notes,
          enrichment_confidence: h.details.enrichment_confidence,
        })),
      });
      if (imageFile) {
        await capexApi.uploadProjectImage(project.id, imageFile);
      }
      // Per-hotel images: the create response has hotels in the same order we sent.
      for (let i = 0; i < project.hotels.length; i++) {
        const draft = validHotels[i];
        if (draft?.imageFile) {
          await capexApi.uploadHotelImage(project.hotels[i].id, draft.imageFile);
        }
      }
      navigate(`/capex-tracker/projects/${project.id}`);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }

  return (
    <WizardShell
      title={step === 1 ? "New portfolio" : `Hotels in ${name || "portfolio"}`}
      subtitle="Capex Tracker · Portfolio"
      step={step}
      totalSteps={2}
    >
      {step === 1 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <ImageDropzone
                imagePath={imagePreview}
                onPick={pickPortfolioImage}
                onClear={() => {
                  setImageFile(null);
                  setImagePreview(null);
                }}
                label="Portfolio cover image (optional)"
              />
              <p className="text-[11px] text-gencom-stone mt-2">
                Leave empty to fall back to a hotel icon on the tile.
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <FieldLabel required>Portfolio name</FieldLabel>
                <TextInput
                  value={name}
                  onChange={setName}
                  placeholder="e.g. Gencom Caribbean Portfolio"
                />
              </div>
              <YearRangeFields
                yearStart={yearStart}
                yearEnd={yearEnd}
                onChange={(s, e) => {
                  setYearStart(s);
                  setYearEnd(e);
                }}
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <GhostButton onClick={() => navigate("/capex-tracker")}>Cancel</GhostButton>
            <PrimaryButton onClick={goToHotels}>Next: add hotels →</PrimaryButton>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="text-sm text-gencom-stone mb-4">
            Add each hotel in the portfolio. Use ✨ Auto-fill on each hotel to pre-populate address, key count, and brand.
          </p>

          <div className="space-y-4">
            {hotels.map((h, idx) => (
              <div
                key={h.tempId}
                className="rounded-lg border border-gencom-sand bg-gencom-mist/30 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs text-gencom-stone uppercase tracking-wider font-semibold">
                    Hotel {idx + 1}
                    {h.details.name.trim() && (
                      <span className="ml-2 text-gencom-ink normal-case tracking-normal">
                        — {h.details.name}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => updateHotel(idx, { expanded: !h.expanded })}
                      className="text-xs text-gencom-stone hover:text-gencom-ink"
                    >
                      {h.expanded ? "Collapse" : "Expand"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeHotel(idx)}
                      disabled={hotels.length === 1}
                      className="text-xs text-red-600 hover:text-red-800 disabled:text-gencom-stone/50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {h.expanded && (
                  <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
                    <div>
                      <ImageDropzone
                        imagePath={h.imagePreview}
                        onPick={(f) => pickHotelImage(idx, f)}
                        onClear={() => updateHotel(idx, { imageFile: null, imagePreview: null })}
                        label="Hotel image"
                      />
                    </div>
                    <HotelDetailsForm
                      details={h.details}
                      onChange={(d) => patchHotelDetails(idx, d)}
                      cityHint={h.details.city ?? undefined}
                      compact
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addHotel}
            className="mt-3 text-sm text-gencom-ink hover:text-gencom-gold font-semibold"
          >
            + Add another hotel
          </button>

          <div className="mt-6">
            <BudgetSourcePlaceholder />
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <GhostButton onClick={() => setStep(1)}>← Back</GhostButton>
            <PrimaryButton onClick={submit} disabled={submitting}>
              {submitting ? "Creating…" : "Create portfolio"}
            </PrimaryButton>
          </div>
        </>
      )}
    </WizardShell>
  );
}
