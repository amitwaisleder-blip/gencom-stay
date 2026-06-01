import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { capexApi } from "../lib/capexApi";
import {
  BudgetSourcePlaceholder,
  defaultYearRange,
  GhostButton,
  ImageDropzone,
  PrimaryButton,
  WizardShell,
  YearRangeFields,
} from "./sharedWizardUI";
import { emptyHotelDetails, HotelDetailsForm, type HotelDetails } from "./HotelDetailsForm";

export default function SingleHotelWizard() {
  const navigate = useNavigate();
  const def = defaultYearRange();
  const [details, setDetails] = useState<HotelDetails>(emptyHotelDetails());
  const [yearStart, setYearStart] = useState(def.start);
  const [yearEnd, setYearEnd] = useState(def.end);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickImage(file: File) {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function submit() {
    if (!details.name.trim()) {
      setError("Hotel name is required.");
      return;
    }
    if (yearEnd < yearStart) {
      setError("Year end must be on or after year start.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const project = await capexApi.createProject({
        kind: "single",
        name: details.name.trim(),
        year_start: yearStart,
        year_end: yearEnd,
        hotels: [
          {
            name: details.name.trim(),
            address: details.address,
            city: details.city,
            state: details.state,
            country: details.country,
            keys: details.keys,
            year_built: details.year_built,
            last_renovation: details.last_renovation,
            current_brand: details.current_brand,
            current_flag: details.current_flag,
            property_type: details.property_type,
            floors: details.floors,
            notes: details.notes,
            enrichment_confidence: details.enrichment_confidence,
          },
        ],
      });
      if (imageFile) {
        await capexApi.uploadProjectImage(project.id, imageFile);
        if (project.hotels[0]) {
          await capexApi.uploadHotelImage(project.hotels[0].id, imageFile);
        }
      }
      navigate(`/capex-tracker/projects/${project.id}`);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }

  return (
    <WizardShell title="New single hotel" subtitle="Capex Tracker · Single Hotel" step={1} totalSteps={1}>
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        <div>
          <ImageDropzone
            imagePath={imagePreview}
            onPick={pickImage}
            onClear={() => {
              setImageFile(null);
              setImagePreview(null);
            }}
            label="Hotel image"
          />
        </div>
        <div className="space-y-4">
          <HotelDetailsForm
            details={details}
            onChange={setDetails}
            cityHint={details.city ?? undefined}
          />
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

      <div className="mt-6">
        <BudgetSourcePlaceholder />
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        <GhostButton onClick={() => navigate("/capex-tracker")}>Cancel</GhostButton>
        <PrimaryButton onClick={submit} disabled={submitting}>
          {submitting ? "Creating…" : "Create"}
        </PrimaryButton>
      </div>
    </WizardShell>
  );
}
