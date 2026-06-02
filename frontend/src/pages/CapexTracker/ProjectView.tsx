import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Breadcrumb } from "./Breadcrumb";
import { BudgetTable } from "./BudgetTable/BudgetTable";
import { lineSpendToDate } from "./BudgetTable/helpers";
import { DocumentUploadModal } from "./documents/DocumentUploadModal";
import { InvoiceUploadModal } from "./invoices/InvoiceUploadModal";
import { capexApi, fmtMoney } from "./lib/capexApi";
import { KIND_LABEL, type CapexHotel, type CapexLine, type CapexProject } from "./lib/types";
import { HotelDetailsForm, type HotelDetails } from "./wizards/HotelDetailsForm";

export default function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<CapexProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lines-by-hotel cache so the Invoice Upload modal can feed Claude every line
  // in the project, and so any apply roll-up refreshes the right hotel's table.
  const [linesByHotel, setLinesByHotel] = useState<Record<string, CapexLine[]>>({});
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [linesBumpKey, setLinesBumpKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    capexApi
      .getProject(id)
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Pull lines for every hotel once project loads (and again when an invoice apply
  // bumps the key).
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    Promise.all(
      project.hotels.map((h) => capexApi.listLines(h.id).then((lines) => [h.id, lines] as const)),
    )
      .then((entries) => {
        if (cancelled) return;
        const next: Record<string, CapexLine[]> = {};
        entries.forEach(([hid, lines]) => {
          next[hid] = lines;
        });
        setLinesByHotel(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project, linesBumpKey]);

  const allLines = useMemo(() => Object.values(linesByHotel).flat(), [linesByHotel]);
  const totals = useMemo(() => {
    let original = 0;
    let forecast = 0;
    let spent = 0;
    for (const line of allLines) {
      original += line.original_total_budget ?? 0;
      forecast += line.forecast_total_budget ?? 0;
      spent += lineSpendToDate(line);
    }
    return { original, forecast, spent };
  }, [allLines]);
  // Don't dismiss the modal here — the upload modal transitions to its
  // own "done" stage right after onApplied fires, where the user can
  // (a) see the success state and (b) click "Save a copy" to file the
  // original to Box / Desktop / wherever. The modal closes itself when
  // they hit Done. We only refresh the underlying line data.
  const handleInvoiceApplied = useCallback(() => {
    setLinesBumpKey((k) => k + 1);
  }, []);
  const handleDocumentApplied = useCallback(() => {
    setLinesBumpKey((k) => k + 1);
  }, []);

  if (error) {
    return (
      <div className="max-w-2xl">
        <Breadcrumb items={[{ label: "Capex Tracker", to: "/capex-tracker" }]} />
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      </div>
    );
  }

  if (!project) {
    return <div className="text-sm text-gencom-stone">Loading…</div>;
  }

  const yearRange =
    project.year_start === project.year_end
      ? `${project.year_start}`
      : `${project.year_start}–${project.year_end}`;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Capex Tracker", to: "/capex-tracker" },
          { label: project.name },
        ]}
      />

      <ProjectHeaderBar project={project} yearRange={yearRange} totals={totals} />

      {project.kind === "portfolio" ? (
        <PortfolioHotelList project={project} />
      ) : (
        <SingleHotelLanding
          project={project}
          onUploadInvoice={() => setUploadingInvoice(true)}
          onUploadContract={() => setUploadingDocument(true)}
          refreshKey={linesBumpKey}
        />
      )}

      {uploadingInvoice && (
        <InvoiceUploadModal
          project={project}
          allLines={allLines}
          onClose={() => setUploadingInvoice(false)}
          onApplied={handleInvoiceApplied}
        />
      )}

      {uploadingDocument && (
        <DocumentUploadModal
          project={project}
          allLines={allLines}
          onClose={() => setUploadingDocument(false)}
          onApplied={handleDocumentApplied}
        />
      )}
    </div>
  );
}


function HotelHeaderBar({ hotel, yearRange }: { hotel: CapexHotel; yearRange: string }) {
  // Mirrors ProjectHeaderBar's layout: title block on the left, property
  // fields right-aligned. Keeps the hotel detail page visually consistent
  // with single-hotel and project views.
  const fields = buildHotelFields(hotel);
  return (
    <div className="mb-4 rounded-lg border-2 border-gencom-sand bg-white overflow-hidden">
      <div className="flex items-stretch">
        <div className="flex-1 px-6 py-4 flex items-center gap-5 min-w-0">
          <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-gencom-ink leading-none">
            {hotel.name}
          </h1>
          <div className="flex flex-col justify-center gap-0.5">
            <div className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold whitespace-nowrap">
              Hotel · {yearRange}
            </div>
          </div>
        </div>
        {fields.length > 0 && (
          <div className="flex-1 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-6 py-3 min-w-0">
            {fields.map((f) => (
              <DetailField key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function buildHotelFields(hotel: CapexHotel): Array<{ label: string; value: string | string[] }> {
  const fields: Array<{ label: string; value: string | string[] }> = [];
  if (hotel.address) fields.push({ label: "Address", value: hotel.address });
  if (hotel.keys != null) fields.push({ label: "Keys", value: hotel.keys.toLocaleString() });
  if (hotel.year_built != null) fields.push({ label: "Built", value: String(hotel.year_built) });
  return fields;
}


function ProjectHeaderBar({
  project,
  yearRange,
  totals,
}: {
  project: CapexProject;
  yearRange: string;
  totals: { original: number; forecast: number; spent: number };
}) {
  // For single + project kinds, the project has exactly one hotel — show its
  // address / specs inline with the project title. For portfolios, just show
  // the title block (the hotel grid below carries property data).
  const inlineHotel = project.kind !== "portfolio" ? project.hotels[0] : null;
  const fields = inlineHotel ? buildHotelFields(inlineHotel) : [];

  return (
    <div className="mb-4 rounded-lg border-2 border-gencom-sand bg-white overflow-hidden">
      <div className="flex items-stretch">
        {/* LEFT — title block. flex-1 balances the right-side fields so the
            middle stats column stays visually centered in the bar. */}
        <div className="flex-1 px-6 py-4 flex items-center gap-5 min-w-0">
          <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-gencom-ink leading-none">
            {project.name}
          </h1>
          <div className="flex flex-col justify-center gap-0.5">
            <div className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold whitespace-nowrap">
              {KIND_LABEL[project.kind]} · {yearRange}
            </div>
            {project.parent_hotel_name && (
              <div className="text-[11px] text-gencom-stone/80 italic whitespace-nowrap">
                at {project.parent_hotel_name}
              </div>
            )}
          </div>
        </div>

        {/* MIDDLE — budget summary stats, large + centered */}
        <div className="flex items-center justify-center gap-10 px-8 flex-shrink-0">
          <HeaderStat label="Original" value={totals.original} />
          <HeaderStat label="Forecast" value={totals.forecast} />
          <HeaderStat label="Spent" value={totals.spent} />
        </div>

        {/* RIGHT — hotel property fields, right-aligned */}
        {fields.length > 0 && (
          <div className="flex-1 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-6 py-3 min-w-0">
            {fields.map((f) => (
              <DetailField key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


function HeaderStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center whitespace-nowrap">
      <div className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold">
        {label}
      </div>
      <div className="font-display text-2xl font-bold text-gencom-ink leading-tight tabular-nums">
        {fmtMoney(value)}
      </div>
    </div>
  );
}


function DetailField({ label, value }: { label: string; value: string | string[] }) {
  const lines = Array.isArray(value) ? value : [value];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gencom-stone font-semibold">
        {label}
      </div>
      {lines.map((line, i) => (
        <div key={i} className="text-sm text-gencom-ink font-medium whitespace-nowrap leading-tight">
          {line}
        </div>
      ))}
    </div>
  );
}


function SingleHotelLanding({
  project,
  onUploadInvoice,
  onUploadContract,
  refreshKey,
}: {
  project: CapexProject;
  onUploadInvoice?: () => void;
  onUploadContract?: () => void;
  /** Bumped by the parent after an invoice/document apply so BudgetTable
   *  refetches lines without remounting (which would reset the active view
   *  tab back to Budget — bad UX after uploading from the Invoices tab). */
  refreshKey?: number;
}) {
  const hotel = project.hotels[0];
  if (!hotel) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        This project has no hotel attached. That's a bug — please re-create the project.
      </div>
    );
  }
  return (
    <div>
      <BudgetTable
        hotelId={hotel.id}
        yearStart={project.year_start}
        yearEnd={project.year_end}
        project={project}
        onUploadInvoice={onUploadInvoice}
        onUploadContract={onUploadContract}
        refreshKey={refreshKey}
      />
    </div>
  );
}


function PortfolioHotelList({ project }: { project: CapexProject }) {
  // Local hotel snapshot so edits land in the tile without a full project
  // refetch. Seeded from the project prop and replaced on each save.
  const [hotels, setHotels] = useState<CapexHotel[]>(project.hotels);
  useEffect(() => {
    setHotels(project.hotels);
  }, [project.hotels]);

  const [editingHotel, setEditingHotel] = useState<CapexHotel | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold text-gencom-ink uppercase tracking-wide">
          Hotels in portfolio
        </h2>
      </div>
      {hotels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gencom-sand bg-gencom-mist/40 p-8 text-center text-sm text-gencom-stone">
          No hotels in this portfolio yet.
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-4">
          {hotels.map((h) => (
            <Link
              key={h.id}
              to={`/capex-tracker/projects/${project.id}/hotels/${h.id}`}
              className="group relative flex flex-col bg-white border-2 border-gencom-sand rounded-xl overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-0.5 hover:border-gencom-green transition w-[260px]"
            >
              {/* Hover-only edit affordance pinned top-right. Stops propagation
                  so clicking it doesn't follow the tile link. */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingHotel(h);
                }}
                className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/95 border border-gencom-sand text-[10px] uppercase tracking-wider font-semibold text-gencom-ink shadow-sm opacity-0 group-hover:opacity-100 transition hover:border-gencom-green hover:text-gencom-green"
                title="Edit hotel details"
              >
                ✎ Edit
              </button>
              {/* Image area — flex-centered so any aspect-ratio image sits
                  visually centered within the frame. object-cover then crops
                  symmetrically around the center point. */}
              <div className="aspect-[16/10] bg-gencom-mist border-b border-gencom-sand overflow-hidden flex items-center justify-center">
                {h.image_path ? (
                  <img
                    src={h.image_path}
                    alt={h.name}
                    className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="text-gencom-stone/60 text-3xl">🏛</div>
                )}
              </div>
              <div className="p-3 text-center flex flex-col flex-1">
                <div className="font-display text-sm font-bold text-gencom-ink uppercase tracking-wide line-clamp-1">
                  {h.name}
                </div>
                {h.address && (
                  <div className="text-[11px] text-gencom-stone mt-0.5 line-clamp-1" title={h.address}>
                    {h.address}
                  </div>
                )}
                {(h.city || h.state) && (
                  <div className="text-[10px] text-gencom-stone/80 mt-0.5">
                    {[h.city, h.state].filter(Boolean).join(", ")}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[10px] text-gencom-stone">
                  {h.current_brand && (
                    <span className="text-gencom-ink/80 font-medium line-clamp-1 max-w-full" title={h.current_brand}>
                      {h.current_brand}
                    </span>
                  )}
                  {h.keys != null && (
                    <span>
                      <span className="text-gencom-ink font-semibold">{h.keys.toLocaleString()}</span> keys
                    </span>
                  )}
                  {h.year_built != null && (
                    <span>
                      Built <span className="text-gencom-ink font-semibold">{h.year_built}</span>
                    </span>
                  )}
                </div>

                <div className="mt-auto pt-2 border-t border-gencom-sand/70 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-gencom-stone uppercase tracking-wider text-[9px]">Forecast</div>
                    <div className="text-gencom-ink font-semibold">{fmtMoney(h.forecast_total)}</div>
                  </div>
                  <div>
                    <div className="text-gencom-stone uppercase tracking-wider text-[9px]">Spent</div>
                    <div className="text-gencom-ink font-semibold">{fmtMoney(h.spend_to_date)}</div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {editingHotel && (
        <HotelEditModal
          hotel={editingHotel}
          onClose={() => setEditingHotel(null)}
          onSaved={(updated) => {
            setHotels((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
            setEditingHotel(null);
          }}
        />
      )}
    </div>
  );
}


function HotelEditModal({
  hotel,
  onClose,
  onSaved,
}: {
  hotel: CapexHotel;
  onClose: () => void;
  onSaved: (updated: CapexHotel) => void;
}) {
  const [details, setDetails] = useState<HotelDetails>({
    name: hotel.name,
    address: hotel.address ?? null,
    city: hotel.city ?? null,
    state: hotel.state ?? null,
    country: hotel.country ?? null,
    keys: hotel.keys ?? null,
    year_built: hotel.year_built ?? null,
    last_renovation: hotel.last_renovation ?? null,
    current_brand: hotel.current_brand ?? null,
    current_flag: hotel.current_flag ?? null,
    property_type: hotel.property_type ?? null,
    floors: hotel.floors ?? null,
    notes: hotel.notes ?? null,
    enrichment_confidence: hotel.enrichment_confidence ?? null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!details.name.trim()) {
      setError("Hotel name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await capexApi.updateHotel(hotel.id, {
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
      });
      onSaved(updated);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 overflow-y-auto">
      <div className="bg-white rounded-xl border-2 border-gencom-sand shadow-2xl w-full max-w-2xl max-h-full overflow-y-auto">
        <div className="px-5 py-3 border-b border-gencom-sand flex items-center justify-between">
          <div>
            <div className="t-eyebrow">Edit hotel</div>
            <h2 className="font-display text-lg font-bold text-gencom-ink uppercase tracking-wide">
              {hotel.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gencom-stone hover:text-gencom-ink text-xl leading-none px-2"
            title="Close"
          >
            ×
          </button>
        </div>
        <div className="p-5">
          <HotelDetailsForm
            details={details}
            onChange={setDetails}
            cityHint={details.city ?? undefined}
          />
          {error && (
            <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gencom-sand flex items-center justify-end gap-2 bg-gencom-mist/30">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md border border-gencom-sand bg-white text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="text-xs px-4 py-1.5 rounded-md bg-gencom-green text-white font-semibold hover:bg-gencom-green disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}


export function HotelView() {
  const { hotelId, id: projectId } = useParams<{ hotelId: string; id: string }>();
  const [hotel, setHotel] = useState<CapexHotel | null>(null);
  const [project, setProject] = useState<CapexProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hotelLines, setHotelLines] = useState<CapexLine[]>([]);
  const [linesBumpKey, setLinesBumpKey] = useState(0);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);

  useEffect(() => {
    if (!hotelId || !projectId) return;
    let cancelled = false;
    Promise.all([capexApi.getHotel(hotelId), capexApi.getProject(projectId)])
      .then(([h, p]) => {
        if (!cancelled) {
          setHotel(h);
          setProject(p);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [hotelId, projectId]);

  // Pull lines for this hotel (and only this hotel) so the invoice / document
  // modals are scoped to just this property's budget.
  useEffect(() => {
    if (!hotelId) return;
    let cancelled = false;
    capexApi
      .listLines(hotelId)
      .then((rows) => {
        if (!cancelled) setHotelLines(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hotelId, linesBumpKey]);

  // Same as handleInvoiceApplied/handleDocumentApplied above: don't
  // auto-close the modal on apply — let it run its own done stage so the
  // user can Save a copy of the original file before dismissing.
  const handleApplied = useCallback(() => {
    setLinesBumpKey((k) => k + 1);
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>
    );
  }
  if (!hotel || !project) return <div className="text-sm text-gencom-stone">Loading…</div>;

  const yearRange =
    project.year_start === project.year_end
      ? `${project.year_start}`
      : `${project.year_start}–${project.year_end}`;

  return (
    <div>
      <Breadcrumb
        items={[
          { label: "Capex Tracker", to: "/capex-tracker" },
          { label: project.name, to: `/capex-tracker/projects/${project.id}` },
          { label: hotel.name },
        ]}
      />
      <HotelHeaderBar hotel={hotel} yearRange={yearRange} />
      <BudgetTable
        hotelId={hotel.id}
        yearStart={project.year_start}
        yearEnd={project.year_end}
        project={project}
        onUploadInvoice={() => setUploadingInvoice(true)}
        onUploadContract={() => setUploadingDocument(true)}
        refreshKey={linesBumpKey}
      />

      {uploadingInvoice && (
        <InvoiceUploadModal
          project={project}
          allLines={hotelLines}
          onClose={() => setUploadingInvoice(false)}
          onApplied={handleApplied}
        />
      )}
      {uploadingDocument && (
        <DocumentUploadModal
          project={project}
          allLines={hotelLines}
          onClose={() => setUploadingDocument(false)}
          onApplied={handleApplied}
        />
      )}
    </div>
  );
}


function LogoSlot({
  hotel,
  onUpdate,
}: {
  hotel: CapexHotel;
  onUpdate: (h: CapexHotel) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<"upload" | "auto" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function uploadFile(file: File) {
    setError(null);
    setBusy("upload");
    try {
      const r = await capexApi.uploadHotelLogo(hotel.id, file);
      onUpdate({ ...hotel, logo_path: r.logo_path });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function autoDetect() {
    setError(null);
    setBusy("auto");
    try {
      const r = await capexApi.autoDetectHotelLogo(hotel.id);
      onUpdate({ ...hotel, logo_path: r.logo_path });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  async function clearLogo() {
    setError(null);
    try {
      await capexApi.clearHotelLogo(hotel.id);
      onUpdate({ ...hotel, logo_path: null });
    } catch (e) {
      setError(String(e));
    }
  }

  function pickFile() {
    inputRef.current?.click();
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    void uploadFile(files[0]);
  }

  if (hotel.logo_path) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="group relative flex items-center justify-center">
          <img
            src={hotel.logo_path}
            alt={`${hotel.current_brand ?? hotel.name} logo`}
            // Explicit height makes small native favicons scale up; object-contain
            // preserves aspect ratio for tall or wide brand marks. mix-blend-mode
            // multiply makes white pixels in the source PNG transparent so the
            // logo blends into the page background — handy for Wikipedia/Marriott
            // logos that ship on white.
            className="h-28 w-auto max-w-[320px] object-contain"
            style={{ mixBlendMode: "multiply" }}
          />
          <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition pointer-events-none">
            <button
              type="button"
              onClick={pickFile}
              disabled={busy !== null}
              className="pointer-events-auto text-[10px] px-2 py-1 rounded bg-white/95 border border-gencom-sand text-gencom-ink font-semibold hover:bg-white shadow disabled:opacity-50"
              title="Replace logo"
            >
              ✎ Replace
            </button>
            <button
              type="button"
              onClick={clearLogo}
              className="pointer-events-auto text-[10px] px-2 py-1 rounded bg-white/95 border border-gencom-sand text-red-600 font-semibold hover:bg-white shadow"
              title="Remove logo"
            >
              ✕
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.svg"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
        {error && <div className="text-[10px] text-red-700 max-w-[280px] text-right">{error}</div>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div
        className={`relative h-20 w-44 rounded-md border-2 border-dashed flex flex-col items-center justify-center text-center px-2 cursor-pointer transition ${
          dragOver
            ? "border-gencom-gold bg-gencom-gold/10"
            : "border-gencom-sand bg-white/60 hover:border-gencom-stone hover:bg-white"
        }`}
        onClick={pickFile}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        {busy === "upload" || busy === "auto" ? (
          <div className="text-[11px] text-gencom-stone">
            {busy === "auto" ? "Looking up brand…" : "Uploading…"}
          </div>
        ) : (
          <>
            <div className="text-[11px] uppercase tracking-wider text-gencom-stone font-semibold">
              Brand logo
            </div>
            <div className="text-[10px] text-gencom-stone/70 mt-0.5">
              Drop a file or click
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.svg"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      <button
        type="button"
        onClick={autoDetect}
        disabled={busy !== null}
        className="text-[10px] uppercase tracking-wider font-semibold text-gencom-gold hover:text-gencom-ink disabled:opacity-50 disabled:cursor-not-allowed"
        title={`Use Claude to find the official ${hotel.current_brand ?? hotel.name} logo`}
      >
        ✨ Auto-detect
      </button>
      {error && <div className="text-[10px] text-red-700 max-w-[180px] text-right">{error}</div>}
    </div>
  );
}
