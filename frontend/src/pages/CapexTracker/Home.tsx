import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Breadcrumb } from "./Breadcrumb";
import { capexApi, fmtDateShort, fmtMoney } from "./lib/capexApi";
import { KIND_LABEL, type CapexKind, type CapexProjectCard } from "./lib/types";
import { FieldLabel, GhostButton, PrimaryButton, TextInput } from "./wizards/sharedWizardUI";

export default function CapexTrackerHome() {
  const [cards, setCards] = useState<CapexProjectCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    capexApi
      .listProjects()
      .then((r) => {
        if (!cancelled) setCards(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const editingCard = cards?.find((c) => c.id === editingProjectId) ?? null;
  function handleProjectUpdated(updated: {
    id: string;
    name: string;
    year_start: number;
    year_end: number;
    month_start: number | null;
    month_end: number | null;
    image_path: string | null;
  }) {
    // Patch the card in place so the tile re-renders with new metadata
    // immediately, no full refetch needed.
    setCards((prev) =>
      (prev ?? []).map((c) =>
        c.id === updated.id
          ? {
              ...c,
              name: updated.name,
              year_start: updated.year_start,
              year_end: updated.year_end,
              month_start: updated.month_start,
              month_end: updated.month_end,
              image_path: updated.image_path,
            }
          : c,
      ),
    );
    setEditingProjectId(null);
  }

  return (
    <div>
      <Breadcrumb items={[{ label: "Capex Tracker" }]} />
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="t-eyebrow">Budget · Invoice · Forecast tracking</div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-gencom-ink">
            Capex Tracker
          </h1>
          <p className="text-sm text-gencom-stone mt-1">
            Track capital expenditure budgets and invoices across single hotels, portfolios, and discrete projects.
          </p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-gencom-green text-white font-semibold hover:bg-gencom-green shadow-sm"
        >
          <span className="text-lg leading-none">+</span> New
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 mb-6">
          {error}
        </div>
      )}

      {cards === null && !error && (
        <div className="text-sm text-gencom-stone">Loading…</div>
      )}

      {cards && cards.length === 0 && (
        <EmptyState onNew={() => setPickerOpen(true)} />
      )}

      {cards && cards.length > 0 && (
        <div className="flex flex-wrap justify-center gap-4">
          {cards.map((c) => (
            <ProjectTile
              key={c.id}
              card={c}
              onEdit={() => setEditingProjectId(c.id)}
            />
          ))}
        </div>
      )}

      {pickerOpen && <NewProjectPicker onClose={() => setPickerOpen(false)} />}
      {editingCard && (
        <EditProjectModal
          card={editingCard}
          onClose={() => setEditingProjectId(null)}
          onSaved={handleProjectUpdated}
        />
      )}
    </div>
  );
}


function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-gencom-sand bg-gencom-mist/40 p-12 text-center">
      <div className="font-display text-xl font-semibold text-gencom-ink uppercase tracking-wide">
        No projects yet
      </div>
      <p className="text-sm text-gencom-stone mt-2 max-w-md mx-auto">
        Start by adding a single hotel, an entire portfolio, or a discrete renovation project.
      </p>
      <button
        onClick={onNew}
        className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-gencom-green text-white font-semibold hover:bg-gencom-green"
      >
        <span className="text-lg leading-none">+</span> New
      </button>
    </div>
  );
}


function ProjectTile({
  card,
  onEdit,
}: {
  card: CapexProjectCard;
  onEdit: () => void;
}) {
  const yearRange = card.year_start === card.year_end
    ? `${card.year_start}`
    : `${card.year_start}–${card.year_end}`;
  const currentYear = new Date().getFullYear();
  return (
    <Link
      to={`/capex-tracker/projects/${card.id}`}
      className="group flex flex-col bg-white border-2 border-gencom-sand rounded-xl overflow-hidden shadow-sm transition-all duration-300 hover:shadow-2xl hover:-translate-y-1 hover:border-gencom-green w-[260px]"
    >
      <div className="relative aspect-[16/10] bg-gencom-mist border-b border-gencom-sand overflow-hidden">
        {card.image_path ? (
          <img
            src={card.image_path}
            alt={card.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gencom-stone/60 text-4xl">
            {card.kind === "portfolio" ? "🏨" : card.kind === "project" ? "🛠" : "🏛"}
          </div>
        )}
        {/* Hover-only edit affordance — sits absolute over the image's top-right
            corner. preventDefault on the click stops the parent <Link> from
            navigating into the project view. */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEdit();
          }}
          className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/95 border border-gencom-sand text-[11px] uppercase tracking-wider font-semibold text-gencom-stone shadow opacity-0 group-hover:opacity-100 transition hover:text-gencom-green hover:border-gencom-green"
          title="Edit project details"
          aria-label="Edit project details"
        >
          ✎ Edit
        </button>
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className={`t-eyebrow ${KIND_BADGE_COLOR[card.kind]}`}>
            {KIND_LABEL[card.kind]}
          </span>
          <span className="text-[11px] text-gencom-stone">{yearRange}</span>
        </div>
        <div className="mt-1.5 font-display text-lg font-bold text-gencom-ink leading-tight uppercase tracking-wide line-clamp-2">
          {card.name}
        </div>
        {card.parent_hotel_name && (
          <div className="text-xs text-gencom-stone mt-0.5 italic">
            at {card.parent_hotel_name}
          </div>
        )}

        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-gencom-stone uppercase tracking-wider text-[10px]">Forecast</dt>
            <dd className="text-gencom-ink font-semibold">{fmtMoney(card.forecast_total)}</dd>
          </div>
          <div>
            <dt className="text-gencom-stone uppercase tracking-wider text-[10px]">Spent</dt>
            <dd className="text-gencom-ink font-semibold">{fmtMoney(card.spend_to_date)}</dd>
          </div>
          <div>
            <dt className="text-gencom-stone uppercase tracking-wider text-[10px]">{currentYear} Left</dt>
            <dd className="text-gencom-gold font-semibold">{fmtMoney(card.remaining_current_year)}</dd>
          </div>
        </dl>

        <div className="mt-3 pt-2 border-t border-gencom-sand flex justify-between items-center text-[11px] text-gencom-stone">
          <span>Updated {fmtDateShort(card.updated_at)}</span>
          <span className="text-gencom-stone group-hover:text-gencom-ink group-hover:translate-x-0.5 transition">
            →
          </span>
        </div>
      </div>
    </Link>
  );
}

const KIND_BADGE_COLOR: Record<CapexKind, string> = {
  single: "text-gencom-ink",
  portfolio: "text-gencom-green",
  project: "text-gencom-gold",
};


function NewProjectPicker({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const choose = (kind: CapexKind) => {
    onClose();
    navigate(`/capex-tracker/new/${kind}`);
  };
  return (
    <div
      className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="t-eyebrow">Choose a project type</div>
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-gencom-ink">
              What are you tracking?
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gencom-stone hover:text-gencom-ink text-xl leading-none w-8 h-8 rounded-md hover:bg-gencom-mist"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <PickerCard
            icon="🏛"
            title="Single Hotel"
            blurb="One hotel, one capex budget. Upload an existing budget or import from the Budget Generator."
            onClick={() => choose("single")}
          />
          <PickerCard
            icon="🏨"
            title="Portfolio"
            blurb="Multiple hotels, each with its own capex budget. Drill into any hotel to manage that property's budget."
            onClick={() => choose("portfolio")}
          />
          <PickerCard
            icon="🛠"
            title="Project"
            blurb="A discrete project at a hotel — elevator modernization, SGD replacement, etc. Build a budget from scratch as invoices arrive."
            onClick={() => choose("project")}
          />
        </div>
      </div>
    </div>
  );
}


function PickerCard({
  icon,
  title,
  blurb,
  onClick,
}: {
  icon: string;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group text-left bg-white border-2 border-gencom-sand rounded-lg p-5 transition hover:border-gencom-green hover:bg-gencom-greensoft"
    >
      <div className="text-3xl mb-3">{icon}</div>
      <div className="t-h3 font-display uppercase tracking-wide group-hover:text-gencom-green">
        {title}
      </div>
      <div className="t-micro mt-2 leading-snug">{blurb}</div>
      <div className="mt-3 t-eyebrow group-hover:text-gencom-green">
        Start →
      </div>
    </button>
  );
}


const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "May" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Oct" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
];


function EditProjectModal({
  card,
  onClose,
  onSaved,
}: {
  card: CapexProjectCard;
  onClose: () => void;
  onSaved: (updated: {
    id: string;
    name: string;
    year_start: number;
    year_end: number;
    month_start: number | null;
    month_end: number | null;
    image_path: string | null;
  }) => void;
}) {
  const [name, setName] = useState(card.name);
  const [yearStart, setYearStart] = useState<number>(card.year_start);
  const [yearEnd, setYearEnd] = useState<number>(card.year_end);
  const [monthStart, setMonthStart] = useState<number | null>(card.month_start ?? null);
  const [monthEnd, setMonthEnd] = useState<number | null>(card.month_end ?? null);
  const [imagePath, setImagePath] = useState<string>(card.image_path ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Title can't be empty.");
      return;
    }
    if (!Number.isFinite(yearStart) || !Number.isFinite(yearEnd)) {
      setError("Year start and year end must be numbers.");
      return;
    }
    if (yearEnd < yearStart) {
      setError(`Year end (${yearEnd}) must be on or after year start (${yearStart}).`);
      return;
    }
    // If both ends share a year and a month is set on each, ensure end month
    // is on/after start month so the project window doesn't run backwards.
    if (
      yearStart === yearEnd &&
      monthStart != null &&
      monthEnd != null &&
      monthEnd < monthStart
    ) {
      setError("End month must be on or after start month within the same year.");
      return;
    }
    setSaving(true);
    try {
      const updated = await capexApi.updateProject(card.id, {
        name: name.trim(),
        year_start: yearStart,
        year_end: yearEnd,
        month_start: monthStart,
        month_end: monthEnd,
        image_path: imagePath.trim() || null,
      });
      onSaved({
        id: updated.id,
        name: updated.name,
        year_start: updated.year_start,
        year_end: updated.year_end,
        month_start: updated.month_start ?? null,
        month_end: updated.month_end ?? null,
        image_path: updated.image_path,
      });
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-gencom-ink/40 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="t-eyebrow">Edit project</div>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-gencom-ink">
              {KIND_LABEL[card.kind]} details
            </h2>
            {card.parent_hotel_name && (
              <p className="text-xs text-gencom-stone mt-0.5 italic">
                at {card.parent_hotel_name}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gencom-stone hover:text-gencom-ink text-xl w-8 h-8 rounded-md hover:bg-gencom-mist"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <FieldLabel required>Title</FieldLabel>
            <TextInput value={name} onChange={setName} placeholder="Project name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MonthYearPicker
              label="Project start"
              year={yearStart}
              setYear={setYearStart}
              month={monthStart}
              setMonth={setMonthStart}
            />
            <MonthYearPicker
              label="Project finish"
              year={yearEnd}
              setYear={setYearEnd}
              month={monthEnd}
              setMonth={setMonthEnd}
            />
          </div>
          <div>
            <FieldLabel>Image URL</FieldLabel>
            <TextInput
              value={imagePath}
              onChange={setImagePath}
              placeholder="https://… or leave blank for a placeholder icon"
            />
            {imagePath.trim() && (
              <div className="mt-2 aspect-[16/9] w-full rounded-md border border-gencom-sand overflow-hidden bg-gencom-mist/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePath.trim()}
                  alt="Preview"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}


function MonthYearPicker({
  label,
  year,
  setYear,
  month,
  setMonth,
}: {
  label: string;
  year: number;
  setYear: (n: number) => void;
  month: number | null;
  setMonth: (m: number | null) => void;
}) {
  return (
    <div>
      <FieldLabel required>{label}</FieldLabel>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <select
          value={month ?? ""}
          onChange={(e) => setMonth(e.target.value === "" ? null : Number(e.target.value))}
          className="px-3 py-2 border border-gencom-sand rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
          aria-label={`${label} month`}
        >
          <option value="">— month —</option>
          {MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value) || 0)}
          className="w-24 px-3 py-2 border border-gencom-sand rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gencom-gold/40 focus:border-gencom-gold"
          aria-label={`${label} year`}
        />
      </div>
    </div>
  );
}
