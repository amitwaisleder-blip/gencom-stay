import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { capexApi } from "../lib/capexApi";
import {
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

type BudgetSource = "upload" | "import" | "from-invoices";

export default function ProjectWizard() {
  const navigate = useNavigate();
  const def = defaultYearRange();
  const [name, setName] = useState("");
  // Parent hotel details — same form/AI-fill the other wizards use, but the
  // hotel name here represents the host hotel, not the project itself.
  const [parentHotel, setParentHotel] = useState<HotelDetails>(emptyHotelDetails());
  const [yearStart, setYearStart] = useState(def.start);
  const [yearEnd, setYearEnd] = useState(def.end);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [budgetSource, setBudgetSource] = useState<BudgetSource>("from-invoices");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickImage(file: File) {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function submit() {
    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    if (!parentHotel.name.trim()) {
      setError("Parent hotel name is required.");
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
        kind: "project",
        name: name.trim(),
        parent_hotel_name: parentHotel.name.trim(),
        year_start: yearStart,
        year_end: yearEnd,
        // The implicit hotel for a Project carries the parent-hotel details so
        // that any property-context lookups (invoice matching, etc.) have the
        // right info.
        hotels: [
          {
            name: parentHotel.name.trim(),
            address: parentHotel.address,
            city: parentHotel.city,
            state: parentHotel.state,
            country: parentHotel.country,
            keys: parentHotel.keys,
            year_built: parentHotel.year_built,
            last_renovation: parentHotel.last_renovation,
            current_brand: parentHotel.current_brand,
            current_flag: parentHotel.current_flag,
            property_type: parentHotel.property_type,
            floors: parentHotel.floors,
            notes: parentHotel.notes,
            enrichment_confidence: parentHotel.enrichment_confidence,
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
    <WizardShell title="New project" subtitle="Capex Tracker · Project" step={1} totalSteps={1}>
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6">
        <div>
          <ImageDropzone
            imagePath={imagePreview}
            onPick={pickImage}
            onClear={() => {
              setImageFile(null);
              setImagePreview(null);
            }}
            label="Project image (optional)"
          />
        </div>
        <div className="space-y-4">
          <div>
            <FieldLabel required>Project name</FieldLabel>
            <TextInput
              value={name}
              onChange={setName}
              placeholder="e.g. Elevator Modernization"
            />
            <p className="mt-1 text-[11px] text-gencom-stone">
              The discrete scope you're tracking — not the host hotel.
            </p>
          </div>
          <YearRangeFields
            yearStart={yearStart}
            yearEnd={yearEnd}
            onChange={(s, e) => {
              setYearStart(s);
              setYearEnd(e);
            }}
          />
          <div className="rounded-lg border border-gencom-sand bg-gencom-mist/30 p-4">
            <HotelDetailsForm
              details={parentHotel}
              onChange={setParentHotel}
              nameLabel="Parent hotel"
              namePlaceholder="e.g. Capella Cabo San Lucas"
              cityHint={parentHotel.city ?? undefined}
              compact
            />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <FieldLabel>How will the budget be built?</FieldLabel>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SourceCard
            active={budgetSource === "upload"}
            onClick={() => setBudgetSource("upload")}
            title="Upload existing"
            blurb="Upload an existing PDF or Excel budget. Coming next round."
            disabled
          />
          <SourceCard
            active={budgetSource === "import"}
            onClick={() => setBudgetSource("import")}
            title="Import from Budget Generator"
            blurb="Snapshot a Budget Generator property's scope into this project. Coming next round."
            disabled
          />
          <SourceCard
            active={budgetSource === "from-invoices"}
            onClick={() => setBudgetSource("from-invoices")}
            title="Build from invoices"
            blurb="Skip the budget upload — line items get created as you upload invoices and categorize them."
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
        <PrimaryButton onClick={submit} disabled={submitting}>
          {submitting ? "Creating…" : "Create project"}
        </PrimaryButton>
      </div>
    </WizardShell>
  );
}


function SourceCard({
  active,
  onClick,
  title,
  blurb,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  blurb: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className={`text-left p-4 rounded-lg border-2 transition ${
        active
          ? "border-emerald-700 bg-emerald-50"
          : "border-gencom-sand bg-white hover:border-emerald-700 hover:bg-emerald-50"
      } ${disabled ? "opacity-60 cursor-not-allowed hover:border-gencom-sand hover:bg-white" : "cursor-pointer"}`}
    >
      <div className={`t-body font-semibold ${active ? "text-emerald-700" : ""}`}>{title}</div>
      <div className="t-micro mt-1 leading-snug">{blurb}</div>
      {disabled && (
        <div className="mt-2 t-eyebrow text-gencom-gold">Round B/C</div>
      )}
    </button>
  );
}
