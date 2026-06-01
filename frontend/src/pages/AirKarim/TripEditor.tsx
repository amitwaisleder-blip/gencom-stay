// Tabbed editor for a single trip. All sections are simple inline tables
// with add / edit / delete rows. Autosave happens through the provider —
// every keystroke flows through useMutateTrip.

import { useEffect, useRef, useState } from "react";
import { useAK, useMutateTrip } from "./store";
import type {
  Attendee, AviationPrefs, Contact, CrewMember, Destination, Dining, Fbo,
  Flight, Ground, GroundKind, Lodging, Meeting, Trip, TripDocument,
} from "./types";
import { ak, Field, SectionCard, Warning as WarningBanner, fmtDateTime, toDatetimeLocal, fromDatetimeLocal } from "./ui";
import { validateTrip } from "./validation";
import { newId } from "./seed";
import {
  deleteTripFile, extractTripFromFiles, listTripFiles, mergeExtractedIntoTrip,
  saveFilesForTrip, updateFileSection, type TripFile,
} from "./extract";

type TabKey = "overview" | "flights" | "aviation" | "lodging" | "meetings" | "dining" | "ground" | "contacts";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "flights", label: "Flights" },
  { key: "aviation", label: "Aviation" },
  { key: "lodging", label: "Lodging" },
  { key: "meetings", label: "Meetings" },
  { key: "dining", label: "Dining" },
  { key: "ground", label: "Ground" },
  { key: "contacts", label: "Contacts" },
];

export default function TripEditor({ onPreview }: { onPreview: () => void }) {
  const {
    currentTrip, savedIndicator, dispatch, duplicateTrip,
    isOutlookConnected, outlookStatus, connectOutlook, disconnectOutlook, outlookIcsUrl,
  } = useAK();
  const [tab, setTab] = useState<TabKey>("overview");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [outlookModalOpen, setOutlookModalOpen] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const mutate = useMutateTrip();

  /** Commit the user-reviewed extraction. Saves the underlying files
   *  to the backend, then merges the (potentially filtered) Claude
   *  output into the current trip. Called by UploadDocsModal after the
   *  user confirms what to keep. */
  async function commitUploadedDocs(files: File[], extraction: Partial<Trip>) {
    if (!currentTrip) return;
    await saveFilesForTrip(currentTrip.id, files);
    mutate((t) => mergeExtractedIntoTrip(t, extraction));
    setFilesRefresh((n) => n + 1);
  }

  // Bumping this counter re-triggers the per-tab <SectionFiles> fetches.
  const [filesRefresh, setFilesRefresh] = useState(0);

  if (!currentTrip) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <div className="text-center">
          <div className="text-lg font-semibold mb-1">No trip selected</div>
          <div className="text-sm">Use "+ New Trip" in the sidebar to begin.</div>
        </div>
      </div>
    );
  }

  const warnings = validateTrip(currentTrip);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              className="text-xl font-semibold text-slate-900 bg-transparent border-0 outline-none w-full focus:bg-slate-50 rounded px-1"
              value={currentTrip.title}
              onChange={(e) => dispatch({ type: "UPDATE_TRIP", id: currentTrip.id, patch: { title: e.target.value } })}
            />
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {currentTrip.startDate && currentTrip.endDate
              ? `${new Date(currentTrip.startDate).toLocaleDateString()} → ${new Date(currentTrip.endDate).toLocaleDateString()}`
              : "Set dates in Overview"}
          </div>
        </div>
        <SaveIndicator status={savedIndicator} />
        <button className={ak.btn} onClick={() => duplicateTrip(currentTrip.id)}>Duplicate</button>
        <button
          className={ak.btn}
          onClick={() => setUploadModalOpen(true)}
          title="AI fills in flights, hotels, meetings, etc. from uploaded PDFs/emails/images — you review before it commits"
        >
          Upload docs
        </button>
        <OutlookButton
          tripId={currentTrip.id}
          connected={isOutlookConnected(currentTrip.id)}
          status={outlookStatus(currentTrip.id)}
          onOpen={() => setOutlookModalOpen(true)}
        />
        <button
          className={ak.btn}
          onClick={() => setBriefingOpen(true)}
          title="AI-drafted one-page crew + ground-team briefing"
        >
          Crew briefing
        </button>
        <button
          className={ak.btnDanger}
          onClick={() => {
            if (confirm(`Delete trip "${currentTrip.title}"?`)) dispatch({ type: "DELETE_TRIP", id: currentTrip.id });
          }}
        >
          Delete
        </button>
        <button className={ak.btnPrimary} onClick={onPreview}>Preview on iPhone</button>
      </header>

      {outlookModalOpen && (
        <OutlookModal
          tripId={currentTrip.id}
          tripTitle={currentTrip.title}
          connected={isOutlookConnected(currentTrip.id)}
          status={outlookStatus(currentTrip.id)}
          url={outlookIcsUrl(currentTrip.id)}
          onConnect={() => connectOutlook(currentTrip.id)}
          onDisconnect={() => disconnectOutlook(currentTrip.id)}
          onClose={() => setOutlookModalOpen(false)}
        />
      )}

      {briefingOpen && (
        <BriefingModal trip={currentTrip} onClose={() => setBriefingOpen(false)} />
      )}

      {uploadModalOpen && (
        <UploadDocsModal
          onClose={() => setUploadModalOpen(false)}
          onConfirm={commitUploadedDocs}
        />
      )}

      {/* Tabs */}
      <div className="px-6 pt-3 border-b border-slate-200 bg-white flex gap-0 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-xs uppercase tracking-[0.15em] font-semibold whitespace-nowrap border-b-2 -mb-px transition ${
              tab === t.key ? "border-sky-500 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto bg-slate-50 p-6">
        {warnings.length > 0 && (
          <div className="mb-4">
            {warnings.slice(0, 6).map((w) => (
              <WarningBanner key={w.id}>
                <span className="font-semibold uppercase tracking-wider text-[10px] mr-2">{w.category}</span>
                {w.message}
              </WarningBanner>
            ))}
          </div>
        )}

        {/* Per-tab PDF attachments. Fetched once on tab-change / refresh ping.
            Skipped on tabs that don't map to a file section. */}
        {tab !== "overview" && tab !== "contacts" && tab !== "aviation" && (
          <SectionFiles tripId={currentTrip.id} section={tab} refreshKey={filesRefresh} />
        )}

        {tab === "overview" && <OverviewTab />}
        {tab === "flights" && <FlightsTab />}
        {tab === "aviation" && <AviationTab />}
        {tab === "lodging" && <LodgingTab />}
        {tab === "meetings" && <MeetingsTab />}
        {tab === "dining" && <DiningTab />}
        {tab === "ground" && <GroundTab />}
        {tab === "contacts" && <ContactsTab />}
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: "saved" | "saving" | "idle" }) {
  const text = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : "";
  return (
    <div className="text-xs text-slate-500 flex items-center gap-1 whitespace-nowrap">
      {status === "saving" && <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />}
      {status === "saved" && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
      {text}
    </div>
  );
}

// ------------------------------------------------------------------
// Overview
// ------------------------------------------------------------------
function OverviewTab() {
  const { currentTrip, dispatch } = useAK();
  const mutate = useMutateTrip();
  if (!currentTrip) return null;

  function setField<K extends keyof Trip>(k: K, v: Trip[K]) {
    dispatch({ type: "UPDATE_TRIP", id: currentTrip!.id, patch: { [k]: v } as Partial<Trip> });
  }

  return (
    <div className="max-w-3xl">
      <SectionCard title="Trip">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Purpose">
            <input className={ak.input} value={currentTrip.purpose} onChange={(e) => setField("purpose", e.target.value)} placeholder="IC meetings, site walk, conference, etc." />
          </Field>
          <div />
          <Field label="Start">
            <input type="datetime-local" className={ak.input} value={toDatetimeLocal(currentTrip.startDate)} onChange={(e) => setField("startDate", fromDatetimeLocal(e.target.value))} />
          </Field>
          <Field label="End">
            <input type="datetime-local" className={ak.input} value={toDatetimeLocal(currentTrip.endDate)} onChange={(e) => setField("endDate", fromDatetimeLocal(e.target.value))} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Destinations"
        right={
          <button
            className={ak.btn}
            onClick={() => mutate((t) => ({
              ...t, destinations: [...t.destinations, { id: newId("dest"), city: "" }],
            }))}
          >+ City</button>
        }
      >
        {currentTrip.destinations.length === 0 ? (
          <div className="text-sm text-slate-500 italic">Add a city to anchor the itinerary.</div>
        ) : (
          <div className="space-y-2">
            {currentTrip.destinations.map((d) => (
              <div key={d.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                <Field label="City"><input className={ak.input} value={d.city} onChange={(e) => mutate((t) => ({ ...t, destinations: t.destinations.map((x) => (x.id === d.id ? { ...x, city: e.target.value } : x)) }))} /></Field>
                <Field label="Arrive"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(d.arriveAt)} onChange={(e) => mutate((t) => ({ ...t, destinations: t.destinations.map((x) => (x.id === d.id ? { ...x, arriveAt: fromDatetimeLocal(e.target.value) } : x)) }))} /></Field>
                <Field label="Depart"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(d.departAt)} onChange={(e) => mutate((t) => ({ ...t, destinations: t.destinations.map((x) => (x.id === d.id ? { ...x, departAt: fromDatetimeLocal(e.target.value) } : x)) }))} /></Field>
                <button className={ak.btnGhost} onClick={() => mutate((t) => ({ ...t, destinations: t.destinations.filter((x) => x.id !== d.id) }))}>✕</button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Owner notes">
        <textarea className={`${ak.input} min-h-[120px]`} value={currentTrip.notes ?? ""} onChange={(e) => setField("notes", e.target.value)} placeholder="Anything the owner should know about this trip." />
      </SectionCard>

      <SectionCard
        title="Documents"
        right={
          <button
            className={ak.btn}
            onClick={() => mutate((t) => ({ ...t, documents: [...t.documents, { id: newId("doc"), label: "New document", docType: "" }] }))}
          >+ Document</button>
        }
      >
        {currentTrip.documents.length === 0 ? (
          <div className="text-sm text-slate-500 italic">Track boarding passes, meeting materials, confirmations, etc.</div>
        ) : (
          <div className="space-y-2">
            {currentTrip.documents.map((d) => (
              <div key={d.id} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_2fr_auto] gap-2 items-end">
                <Field label="Label"><input className={ak.input} value={d.label} onChange={(e) => mutate((t) => ({ ...t, documents: t.documents.map((x) => (x.id === d.id ? { ...x, label: e.target.value } : x)) }))} /></Field>
                <Field label="Type"><input className={ak.input} value={d.docType ?? ""} onChange={(e) => mutate((t) => ({ ...t, documents: t.documents.map((x) => (x.id === d.id ? { ...x, docType: e.target.value } : x)) }))} /></Field>
                <Field label="Note"><input className={ak.input} value={d.note ?? ""} onChange={(e) => mutate((t) => ({ ...t, documents: t.documents.map((x) => (x.id === d.id ? { ...x, note: e.target.value } : x)) }))} /></Field>
                <button className={ak.btnGhost} onClick={() => mutate((t) => ({ ...t, documents: t.documents.filter((x) => x.id !== d.id) }))}>✕</button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ------------------------------------------------------------------
// Flights — rows are collapsed by default. Click the header strip to
// expand into the full form (commercial fields + private-aviation section).
// ------------------------------------------------------------------
function FlightsTab() {
  const { currentTrip } = useAK();
  const mutate = useMutateTrip();
  const [justAdded, setJustAdded] = useState<string | null>(null);
  if (!currentTrip) return null;
  function add() {
    const now = new Date();
    const f: Flight = {
      id: newId("f"), airline: "", flightNumber: "", departAirport: "", departAt: now.toISOString(),
      arriveAirport: "", arriveAt: new Date(now.getTime() + 3 * 3600 * 1000).toISOString(),
      aviationKind: "commercial",
    };
    mutate((t) => ({ ...t, flights: [...t.flights, f] }));
    setJustAdded(f.id);
  }
  return (
    <SectionCard
      title={`Flights (${currentTrip.flights.length})`}
      right={<button className={ak.btn} onClick={add}>+ Flight</button>}
    >
      {currentTrip.flights.length === 0 ? <EmptyNote label="No flights yet. Click + Flight to add one; rows expand when you click them." /> : (
        <div className="space-y-2">
          {currentTrip.flights.map((f) => (
            <FlightRow
              key={f.id}
              flight={f}
              aviationPrefs={currentTrip.aviationPrefs}
              defaultExpanded={f.id === justAdded}
              onPatch={(patch) => mutate((t) => ({ ...t, flights: t.flights.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) }))}
              onRemove={() => mutate((t) => ({ ...t, flights: t.flights.filter((x) => x.id !== f.id) }))}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function FlightRow({
  flight: f, aviationPrefs, defaultExpanded, onPatch, onRemove,
}: {
  flight: Flight;
  aviationPrefs?: AviationPrefs;
  defaultExpanded: boolean;
  onPatch: (patch: Partial<Flight>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isPrivate = f.aviationKind === "private";
  const depTime = f.departAt ? new Date(f.departAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

  // Look up an aircraft image (via Wikipedia) when we have enough info.
  const imageQuery = f.aircraftType?.trim() || (f.airline && f.flightNumber ? `${f.airline} ${f.flightNumber}` : "");
  const aircraftImage = useAircraftImage(imageQuery);

  return (
    <div className="border border-slate-200 rounded-md bg-white">
      {/* Collapsed header — click to expand */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-slate-50"
      >
        <div className="shrink-0 text-slate-400 w-4 text-center">{expanded ? "▾" : "▸"}</div>
        {aircraftImage?.imageUrl && (
          <img
            src={aircraftImage.imageUrl}
            alt={aircraftImage.caption || f.aircraftType || ""}
            className="shrink-0 h-10 w-16 object-cover rounded border border-slate-200 bg-slate-50"
            loading="lazy"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold truncate">
            <span className="truncate">
              {f.airline || f.operator || (isPrivate ? "Private flight" : "Flight")}{" "}
              {f.flightNumber}
              {f.tailNumber ? ` · ${f.tailNumber}` : ""}
            </span>
            {isPrivate && (
              <span className="shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-semibold">
                Private
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 truncate">
            {(f.departAirport || "???")} → {(f.arriveAirport || "???")}
            {f.aircraftType ? ` · ${f.aircraftType}` : ""}
            {" · "}{depTime}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-100">
          {aircraftImage?.imageUrl && (
            <a
              href={aircraftImage.sourceUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block rounded-md overflow-hidden border border-slate-200 bg-slate-50 relative"
              title={`${aircraftImage.caption ?? ""} — ${aircraftImage.source}`}
            >
              <img
                src={aircraftImage.imageUrl}
                alt={aircraftImage.caption || f.aircraftType || ""}
                className="w-full max-h-[180px] object-cover"
                loading="lazy"
              />
              <div className="absolute bottom-0 right-0 px-2 py-0.5 text-[10px] bg-black/60 text-white rounded-tl">
                {aircraftImage.caption} · {aircraftImage.source}
              </div>
            </a>
          )}

          {/* Aviation kind toggle */}
          <div className="mt-3 flex items-center gap-2">
            <span className={ak.label}>Aviation</span>
            <div className="flex rounded-md overflow-hidden border border-slate-300">
              {(["commercial", "private"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => onPatch({ aviationKind: k })}
                  className={`text-xs px-3 py-1 ${
                    (f.aviationKind ?? "commercial") === k
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {k === "commercial" ? "Commercial" : "Private / Charter"}
                </button>
              ))}
            </div>
          </div>

          {/* Basic fields */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-3">
            <Field label={isPrivate ? "Operator" : "Airline"}>
              <input className={ak.input} value={isPrivate ? (f.operator ?? "") : f.airline}
                onChange={(e) => onPatch(isPrivate ? { operator: e.target.value } : { airline: e.target.value })} />
            </Field>
            <Field label={isPrivate ? "Callsign / leg #" : "Flight #"}>
              <input className={ak.input} value={f.flightNumber}
                onChange={(e) => onPatch({ flightNumber: e.target.value })} />
            </Field>
            <Field label="Aircraft">
              <input className={ak.input} value={f.aircraftType ?? ""}
                onChange={(e) => onPatch({ aircraftType: e.target.value })} />
            </Field>
            <Field label="Confirmation">
              <input className={ak.input} value={f.confirmation ?? ""}
                onChange={(e) => onPatch({ confirmation: e.target.value })} />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mt-3">
            <Field label="Depart airport">
              <input
                className={ak.input}
                value={f.departAirport}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  // Seed FBO from trip-level prefs if we know this airport.
                  const seed = aviationPrefs?.fboPreferences?.[v];
                  onPatch(seed && !f.departFbo ? { departAirport: v, departFbo: seed } : { departAirport: v });
                }}
              />
            </Field>
            <Field label="Depart city"><input className={ak.input} value={f.departCity ?? ""} onChange={(e) => onPatch({ departCity: e.target.value })} /></Field>
            <Field label="Terminal"><input className={ak.input} value={f.departTerminal ?? ""} onChange={(e) => onPatch({ departTerminal: e.target.value })} /></Field>
            <Field label="Gate"><input className={ak.input} value={f.departGate ?? ""} onChange={(e) => onPatch({ departGate: e.target.value })} /></Field>
            <Field label="Depart time"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(f.departAt)} onChange={(e) => onPatch({ departAt: fromDatetimeLocal(e.target.value) })} /></Field>
            <Field label="Seat"><input className={ak.input} value={f.seat ?? ""} onChange={(e) => onPatch({ seat: e.target.value })} /></Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mt-3">
            <Field label="Arrive airport">
              <input
                className={ak.input}
                value={f.arriveAirport}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  const seed = aviationPrefs?.fboPreferences?.[v];
                  onPatch(seed && !f.arriveFbo ? { arriveAirport: v, arriveFbo: seed } : { arriveAirport: v });
                }}
              />
            </Field>
            <Field label="Arrive city"><input className={ak.input} value={f.arriveCity ?? ""} onChange={(e) => onPatch({ arriveCity: e.target.value })} /></Field>
            <Field label="Terminal"><input className={ak.input} value={f.arriveTerminal ?? ""} onChange={(e) => onPatch({ arriveTerminal: e.target.value })} /></Field>
            <Field label="Gate"><input className={ak.input} value={f.arriveGate ?? ""} onChange={(e) => onPatch({ arriveGate: e.target.value })} /></Field>
            <Field label="Arrive time"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(f.arriveAt)} onChange={(e) => onPatch({ arriveAt: fromDatetimeLocal(e.target.value) })} /></Field>
            <Field label="Cabin"><input className={ak.input} value={f.cabin ?? ""} onChange={(e) => onPatch({ cabin: e.target.value })} /></Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Field label="Duration (min)"><input type="number" className={ak.input} value={f.durationMin ?? ""} onChange={(e) => onPatch({ durationMin: Number(e.target.value) || 0 })} /></Field>
            <Field label="Notes"><input className={ak.input} value={f.notes ?? ""} onChange={(e) => onPatch({ notes: e.target.value })} /></Field>
          </div>

          {isPrivate && (
            <PrivateAviationSection
              flight={f}
              onPatch={onPatch}
              aviationPrefs={aviationPrefs}
            />
          )}

          <div className="mt-3 flex justify-end">
            <button className={ak.btnGhost} onClick={onRemove}>Remove flight</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Private-aviation detail block inside a flight row.
// Tail, broker, FBOs at both airports, crew, catering, alternates, customs.
// ------------------------------------------------------------------
function PrivateAviationSection({
  flight, onPatch, aviationPrefs,
}: {
  flight: Flight;
  onPatch: (patch: Partial<Flight>) => void;
  aviationPrefs?: AviationPrefs;
}) {
  return (
    <div className="mt-4 p-3 border border-indigo-200 rounded-md bg-indigo-50/40">
      <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-indigo-800 mb-2">
        Private aviation
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Tail number"><input className={ak.input} placeholder="N123AB" value={flight.tailNumber ?? ""} onChange={(e) => onPatch({ tailNumber: e.target.value.toUpperCase() })} /></Field>
        <Field label="Broker / operator"><input className={ak.input} placeholder="VistaJet, NetJets…" value={flight.operator ?? ""} onChange={(e) => onPatch({ operator: e.target.value })} /></Field>
        <Field label="Broker contact"><input className={ak.input} placeholder="Name · phone · email" value={flight.brokerContact ?? ""} onChange={(e) => onPatch({ brokerContact: e.target.value })} /></Field>
        <Field label="Customs pre-clearance">
          <label className="flex items-center gap-2 h-[34px] text-sm">
            <input type="checkbox" checked={!!flight.customsPreclearance} onChange={(e) => onPatch({ customsPreclearance: e.target.checked })} />
            <span className="text-slate-600">Arranged</span>
          </label>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <FboEditor
          label={`FBO at ${flight.departAirport || "departure"}`}
          fbo={flight.departFbo}
          onChange={(fbo) => onPatch({ departFbo: fbo })}
          onUseDefault={aviationPrefs?.fboPreferences?.[flight.departAirport]
            ? () => onPatch({ departFbo: aviationPrefs!.fboPreferences![flight.departAirport] })
            : undefined}
        />
        <FboEditor
          label={`FBO at ${flight.arriveAirport || "arrival"}`}
          fbo={flight.arriveFbo}
          onChange={(fbo) => onPatch({ arriveFbo: fbo })}
          onUseDefault={aviationPrefs?.fboPreferences?.[flight.arriveAirport]
            ? () => onPatch({ arriveFbo: aviationPrefs!.fboPreferences![flight.arriveAirport] })
            : undefined}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <Field label="Catering" hint="Water brand, coffee setup, snack profile, wine selections.">
          <textarea
            className={`${ak.input} min-h-[60px]`}
            value={flight.catering ?? ""}
            placeholder={aviationPrefs?.cateringDefaults || "Fiji still / sparkling, Nespresso Arpeggio, fruit + charcuterie, 2 × Opus One 2019"}
            onChange={(e) => onPatch({ catering: e.target.value })}
          />
          {aviationPrefs?.cateringDefaults && !flight.catering && (
            <button
              type="button"
              className="t-micro mt-1 text-sky-700 hover:underline"
              onClick={() => onPatch({ catering: aviationPrefs.cateringDefaults })}
            >
              Use trip default
            </button>
          )}
        </Field>
        <Field label="Pre-authorized alternates (IATA, comma-separated)" hint="Used when weather or slot risk forces a diversion.">
          <input
            className={ak.input}
            value={(flight.alternates ?? []).join(", ")}
            onChange={(e) => onPatch({ alternates: e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) })}
            placeholder="EWR, HPN"
          />
        </Field>
      </div>

      <CrewEditor flight={flight} onPatch={onPatch} />
    </div>
  );
}

function FboEditor({
  label, fbo, onChange, onUseDefault,
}: {
  label: string;
  fbo?: Fbo;
  onChange: (fbo: Fbo | undefined) => void;
  onUseDefault?: () => void;
}) {
  const f = fbo ?? { name: "" };
  function set<K extends keyof Fbo>(k: K, v: Fbo[K]) {
    onChange({ ...f, [k]: v });
  }
  return (
    <div className="p-2.5 border border-slate-200 rounded-md bg-white">
      <div className="flex items-center justify-between mb-1.5">
        <div className={ak.label}>{label}</div>
        <div className="flex gap-2 items-center">
          {onUseDefault && (
            <button type="button" className="t-micro text-sky-700 hover:underline" onClick={onUseDefault}>
              Use saved default
            </button>
          )}
          {fbo && (
            <button type="button" className="t-micro text-red-600 hover:underline" onClick={() => onChange(undefined)}>
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input className={ak.input} placeholder="FBO name (Signature, Jet Aviation…)" value={f.name} onChange={(e) => set("name", e.target.value)} />
        <input className={ak.input} placeholder="Phone" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        <input className={ak.input} placeholder="Address" value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} />
        <input className={ak.input} placeholder="Handler / CSR contact" value={f.handlerContact ?? ""} onChange={(e) => set("handlerContact", e.target.value)} />
      </div>
      <input className={`${ak.input} mt-2`} placeholder="Notes (hangar #, ramp location, hours)" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
    </div>
  );
}

function CrewEditor({
  flight, onPatch,
}: { flight: Flight; onPatch: (patch: Partial<Flight>) => void }) {
  const crew = flight.crew ?? [];
  function add() {
    onPatch({ crew: [...crew, { id: newId("crew"), role: "captain", name: "" }] });
  }
  function update(id: string, patch: Partial<CrewMember>) {
    onPatch({ crew: crew.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }
  function remove(id: string) {
    onPatch({ crew: crew.filter((c) => c.id !== id) });
  }
  const roles: { value: CrewMember["role"]; label: string }[] = [
    { value: "captain", label: "Captain" },
    { value: "first_officer", label: "First officer" },
    { value: "flight_attendant", label: "Flight attendant" },
    { value: "other", label: "Other" },
  ];
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className={ak.label}>Crew</div>
        <button type="button" className={ak.btn} onClick={add}>+ Crew member</button>
      </div>
      {crew.length === 0 ? (
        <div className="text-xs text-slate-500 italic">None assigned yet.</div>
      ) : (
        <div className="space-y-2">
          {crew.map((c) => (
            <div key={c.id} className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_1fr_1fr_auto] gap-2">
              <select className={ak.input} value={c.role} onChange={(e) => update(c.id, { role: e.target.value as CrewMember["role"] })}>
                {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <input className={ak.input} value={c.name} onChange={(e) => update(c.id, { name: e.target.value })} placeholder="Name" />
              <input className={ak.input} value={c.phone ?? ""} onChange={(e) => update(c.id, { phone: e.target.value })} placeholder="Phone" />
              <input className={ak.input} value={c.email ?? ""} onChange={(e) => update(c.id, { email: e.target.value })} placeholder="Email" />
              <button type="button" className={ak.btnGhost} onClick={() => remove(c.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Lodging
// ------------------------------------------------------------------
function LodgingTab() {
  const { currentTrip } = useAK();
  const mutate = useMutateTrip();
  if (!currentTrip) return null;
  function add() {
    const now = new Date();
    const l: Lodging = {
      id: newId("l"), hotel: "", address: "",
      checkInAt: now.toISOString(), checkOutAt: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
    };
    mutate((t) => ({ ...t, lodging: [...t.lodging, l] }));
  }
  return (
    <SectionCard
      title={`Lodging (${currentTrip.lodging.length})`}
      right={<button className={ak.btn} onClick={add}>+ Lodging</button>}
    >
      {currentTrip.lodging.length === 0 ? <EmptyNote label="No lodging yet." /> : (
        <div className="space-y-3">
          {currentTrip.lodging.map((l) => (
            <div key={l.id} className="p-3 border border-slate-200 rounded-md">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Hotel"><input className={ak.input} value={l.hotel} onChange={(e) => mutate((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === l.id ? { ...x, hotel: e.target.value } : x)) }))} /></Field>
                <Field label="City"><input className={ak.input} value={l.city ?? ""} onChange={(e) => mutate((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === l.id ? { ...x, city: e.target.value } : x)) }))} /></Field>
                <Field label="Confirmation"><input className={ak.input} value={l.confirmation ?? ""} onChange={(e) => mutate((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === l.id ? { ...x, confirmation: e.target.value } : x)) }))} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <Field label="Address"><input className={ak.input} value={l.address} onChange={(e) => mutate((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === l.id ? { ...x, address: e.target.value } : x)) }))} /></Field>
                <Field label="Phone"><input className={ak.input} value={l.phone ?? ""} onChange={(e) => mutate((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === l.id ? { ...x, phone: e.target.value } : x)) }))} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <Field label="Check-in"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(l.checkInAt)} onChange={(e) => mutate((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === l.id ? { ...x, checkInAt: fromDatetimeLocal(e.target.value) } : x)) }))} /></Field>
                <Field label="Check-out"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(l.checkOutAt)} onChange={(e) => mutate((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === l.id ? { ...x, checkOutAt: fromDatetimeLocal(e.target.value) } : x)) }))} /></Field>
                <Field label="Room type"><input className={ak.input} value={l.roomType ?? ""} onChange={(e) => mutate((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === l.id ? { ...x, roomType: e.target.value } : x)) }))} /></Field>
              </div>
              <Field label="Notes"><textarea className={`${ak.input} mt-3 min-h-[60px]`} value={l.notes ?? ""} onChange={(e) => mutate((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === l.id ? { ...x, notes: e.target.value } : x)) }))} /></Field>
              <div className="mt-2 flex justify-end">
                <button className={ak.btnGhost} onClick={() => mutate((t) => ({ ...t, lodging: t.lodging.filter((x) => x.id !== l.id) }))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------------
// Meetings
// ------------------------------------------------------------------
function MeetingsTab() {
  const { currentTrip } = useAK();
  const mutate = useMutateTrip();
  if (!currentTrip) return null;
  function add() {
    const now = new Date();
    const m: Meeting = {
      id: newId("m"), title: "", startAt: now.toISOString(), endAt: new Date(now.getTime() + 3600 * 1000).toISOString(),
      location: "", address: "", attendees: [],
    };
    mutate((t) => ({ ...t, meetings: [...t.meetings, m] }));
  }
  return (
    <SectionCard
      title={`Meetings (${currentTrip.meetings.length})`}
      right={<button className={ak.btn} onClick={add}>+ Meeting</button>}
    >
      {currentTrip.meetings.length === 0 ? <EmptyNote label="No meetings yet." /> : (
        <div className="space-y-3">
          {currentTrip.meetings.map((m) => (
            <div key={m.id} className="p-3 border border-slate-200 rounded-md">
              <Field label="Title"><input className={ak.input} value={m.title} onChange={(e) => mutate((t) => ({ ...t, meetings: t.meetings.map((x) => (x.id === m.id ? { ...x, title: e.target.value } : x)) }))} /></Field>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <Field label="Start"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(m.startAt)} onChange={(e) => mutate((t) => ({ ...t, meetings: t.meetings.map((x) => (x.id === m.id ? { ...x, startAt: fromDatetimeLocal(e.target.value) } : x)) }))} /></Field>
                <Field label="End"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(m.endAt)} onChange={(e) => mutate((t) => ({ ...t, meetings: t.meetings.map((x) => (x.id === m.id ? { ...x, endAt: fromDatetimeLocal(e.target.value) } : x)) }))} /></Field>
                <Field label="City"><input className={ak.input} value={m.city ?? ""} onChange={(e) => mutate((t) => ({ ...t, meetings: t.meetings.map((x) => (x.id === m.id ? { ...x, city: e.target.value } : x)) }))} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <Field label="Location"><input className={ak.input} value={m.location} onChange={(e) => mutate((t) => ({ ...t, meetings: t.meetings.map((x) => (x.id === m.id ? { ...x, location: e.target.value } : x)) }))} /></Field>
                <Field label="Address"><input className={ak.input} value={m.address} onChange={(e) => mutate((t) => ({ ...t, meetings: t.meetings.map((x) => (x.id === m.id ? { ...x, address: e.target.value } : x)) }))} /></Field>
              </div>
              <Field label="Agenda"><textarea className={`${ak.input} mt-3 min-h-[80px]`} value={m.agenda ?? ""} onChange={(e) => mutate((t) => ({ ...t, meetings: t.meetings.map((x) => (x.id === m.id ? { ...x, agenda: e.target.value } : x)) }))} /></Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <Field label="Materials"><input className={ak.input} value={m.materials ?? ""} onChange={(e) => mutate((t) => ({ ...t, meetings: t.meetings.map((x) => (x.id === m.id ? { ...x, materials: e.target.value } : x)) }))} /></Field>
                <Field label="Notes"><input className={ak.input} value={m.notes ?? ""} onChange={(e) => mutate((t) => ({ ...t, meetings: t.meetings.map((x) => (x.id === m.id ? { ...x, notes: e.target.value } : x)) }))} /></Field>
              </div>
              <AttendeesEditor meeting={m} />
              <div className="mt-2 flex justify-end">
                <button className={ak.btnGhost} onClick={() => mutate((t) => ({ ...t, meetings: t.meetings.filter((x) => x.id !== m.id) }))}>Remove meeting</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function AttendeesEditor({ meeting }: { meeting: Meeting }) {
  const mutate = useMutateTrip();
  function add() {
    mutate((t) => ({
      ...t,
      meetings: t.meetings.map((x) => (x.id === meeting.id ? { ...x, attendees: [...x.attendees, { id: newId("a"), name: "" }] } : x)),
    }));
  }
  function update(aid: string, patch: Partial<Attendee>) {
    mutate((t) => ({
      ...t,
      meetings: t.meetings.map((x) => (x.id === meeting.id
        ? { ...x, attendees: x.attendees.map((a) => (a.id === aid ? { ...a, ...patch } : a)) }
        : x)),
    }));
  }
  function remove(aid: string) {
    mutate((t) => ({
      ...t,
      meetings: t.meetings.map((x) => (x.id === meeting.id ? { ...x, attendees: x.attendees.filter((a) => a.id !== aid) } : x)),
    }));
  }
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className={ak.label}>Attendees</div>
        <button className={ak.btn} onClick={add}>+ Attendee</button>
      </div>
      {meeting.attendees.length === 0 ? (
        <div className="text-xs text-slate-500 italic">None added.</div>
      ) : (
        <div className="space-y-2">
          {meeting.attendees.map((a) => (
            <div key={a.id} className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto] gap-2">
              <input className={ak.input} value={a.name} onChange={(e) => update(a.id, { name: e.target.value })} placeholder="Name" />
              <input className={ak.input} value={a.company ?? ""} onChange={(e) => update(a.id, { company: e.target.value })} placeholder="Company" />
              <input className={ak.input} value={a.title ?? ""} onChange={(e) => update(a.id, { title: e.target.value })} placeholder="Title" />
              <input className={ak.input} value={a.email ?? ""} onChange={(e) => update(a.id, { email: e.target.value })} placeholder="Email" />
              <input className={ak.input} value={a.phone ?? ""} onChange={(e) => update(a.id, { phone: e.target.value })} placeholder="Phone" />
              <button className={ak.btnGhost} onClick={() => remove(a.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Dining
// ------------------------------------------------------------------
function DiningTab() {
  const { currentTrip } = useAK();
  const mutate = useMutateTrip();
  if (!currentTrip) return null;
  function add() {
    const d: Dining = { id: newId("d"), restaurant: "", address: "", time: new Date().toISOString() };
    mutate((t) => ({ ...t, dining: [...t.dining, d] }));
  }
  return (
    <SectionCard
      title={`Dining (${currentTrip.dining.length})`}
      right={<button className={ak.btn} onClick={add}>+ Reservation</button>}
    >
      {currentTrip.dining.length === 0 ? <EmptyNote label="No dining yet." /> : (
        <div className="space-y-3">
          {currentTrip.dining.map((d) => (
            <div key={d.id} className="p-3 border border-slate-200 rounded-md">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Restaurant"><input className={ak.input} value={d.restaurant} onChange={(e) => mutate((t) => ({ ...t, dining: t.dining.map((x) => (x.id === d.id ? { ...x, restaurant: e.target.value } : x)) }))} /></Field>
                <Field label="City"><input className={ak.input} value={d.city ?? ""} onChange={(e) => mutate((t) => ({ ...t, dining: t.dining.map((x) => (x.id === d.id ? { ...x, city: e.target.value } : x)) }))} /></Field>
                <Field label="Reservation"><input className={ak.input} value={d.reservation ?? ""} onChange={(e) => mutate((t) => ({ ...t, dining: t.dining.map((x) => (x.id === d.id ? { ...x, reservation: e.target.value } : x)) }))} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <Field label="Address"><input className={ak.input} value={d.address} onChange={(e) => mutate((t) => ({ ...t, dining: t.dining.map((x) => (x.id === d.id ? { ...x, address: e.target.value } : x)) }))} /></Field>
                <Field label="Time"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(d.time)} onChange={(e) => mutate((t) => ({ ...t, dining: t.dining.map((x) => (x.id === d.id ? { ...x, time: fromDatetimeLocal(e.target.value) } : x)) }))} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <Field label="Party size"><input type="number" className={ak.input} value={d.partySize ?? ""} onChange={(e) => mutate((t) => ({ ...t, dining: t.dining.map((x) => (x.id === d.id ? { ...x, partySize: Number(e.target.value) || 0 } : x)) }))} /></Field>
                <Field label="Dress code"><input className={ak.input} value={d.dressCode ?? ""} onChange={(e) => mutate((t) => ({ ...t, dining: t.dining.map((x) => (x.id === d.id ? { ...x, dressCode: e.target.value } : x)) }))} /></Field>
                <Field label="Notes"><input className={ak.input} value={d.notes ?? ""} onChange={(e) => mutate((t) => ({ ...t, dining: t.dining.map((x) => (x.id === d.id ? { ...x, notes: e.target.value } : x)) }))} /></Field>
              </div>
              <div className="mt-2 flex justify-end">
                <button className={ak.btnGhost} onClick={() => mutate((t) => ({ ...t, dining: t.dining.filter((x) => x.id !== d.id) }))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------------
// Ground
// ------------------------------------------------------------------
function GroundTab() {
  const { currentTrip } = useAK();
  const mutate = useMutateTrip();
  if (!currentTrip) return null;
  function add() {
    const g: Ground = { id: newId("g"), transportKind: "car", pickup: "", dropoff: "", time: new Date().toISOString() };
    mutate((t) => ({ ...t, ground: [...t.ground, g] }));
  }
  const kinds: GroundKind[] = ["car", "limo", "taxi", "rideshare", "rail", "walk", "other"];
  return (
    <SectionCard
      title={`Ground transport (${currentTrip.ground.length})`}
      right={<button className={ak.btn} onClick={add}>+ Ground</button>}
    >
      {currentTrip.ground.length === 0 ? <EmptyNote label="No ground transport yet." /> : (
        <div className="space-y-3">
          {currentTrip.ground.map((g) => (
            <div key={g.id} className="p-3 border border-slate-200 rounded-md">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Field label="Kind">
                  <select className={ak.input} value={g.transportKind} onChange={(e) => mutate((t) => ({ ...t, ground: t.ground.map((x) => (x.id === g.id ? { ...x, transportKind: e.target.value as GroundKind } : x)) }))}>
                    {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </Field>
                <Field label="Provider"><input className={ak.input} value={g.provider ?? ""} onChange={(e) => mutate((t) => ({ ...t, ground: t.ground.map((x) => (x.id === g.id ? { ...x, provider: e.target.value } : x)) }))} /></Field>
                <Field label="Time"><input type="datetime-local" className={ak.input} value={toDatetimeLocal(g.time)} onChange={(e) => mutate((t) => ({ ...t, ground: t.ground.map((x) => (x.id === g.id ? { ...x, time: fromDatetimeLocal(e.target.value) } : x)) }))} /></Field>
                <Field label="Confirmation"><input className={ak.input} value={g.confirmation ?? ""} onChange={(e) => mutate((t) => ({ ...t, ground: t.ground.map((x) => (x.id === g.id ? { ...x, confirmation: e.target.value } : x)) }))} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <Field label="Pickup"><input className={ak.input} value={g.pickup} onChange={(e) => mutate((t) => ({ ...t, ground: t.ground.map((x) => (x.id === g.id ? { ...x, pickup: e.target.value } : x)) }))} /></Field>
                <Field label="Drop-off"><input className={ak.input} value={g.dropoff} onChange={(e) => mutate((t) => ({ ...t, ground: t.ground.map((x) => (x.id === g.id ? { ...x, dropoff: e.target.value } : x)) }))} /></Field>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <Field label="Driver contact"><input className={ak.input} value={g.driverContact ?? ""} onChange={(e) => mutate((t) => ({ ...t, ground: t.ground.map((x) => (x.id === g.id ? { ...x, driverContact: e.target.value } : x)) }))} /></Field>
                <Field label="Notes"><input className={ak.input} value={g.notes ?? ""} onChange={(e) => mutate((t) => ({ ...t, ground: t.ground.map((x) => (x.id === g.id ? { ...x, notes: e.target.value } : x)) }))} /></Field>
              </div>
              <div className="mt-2 flex justify-end">
                <button className={ak.btnGhost} onClick={() => mutate((t) => ({ ...t, ground: t.ground.filter((x) => x.id !== g.id) }))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------------
// Contacts
// ------------------------------------------------------------------
function ContactsTab() {
  const { currentTrip } = useAK();
  const mutate = useMutateTrip();
  if (!currentTrip) return null;
  function add() {
    const c: Contact = { id: newId("c"), name: "" };
    mutate((t) => ({ ...t, contacts: [...t.contacts, c] }));
  }
  return (
    <SectionCard
      title={`Contacts (${currentTrip.contacts.length})`}
      right={<button className={ak.btn} onClick={add}>+ Contact</button>}
    >
      {currentTrip.contacts.length === 0 ? <EmptyNote label="No contacts yet." /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={ak.tableHead}>
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Role</th>
                <th className="text-left px-3 py-2">Phone</th>
                <th className="text-left px-3 py-2">Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {currentTrip.contacts.map((c) => (
                <tr key={c.id} className={ak.tableRow}>
                  <td className="px-2 py-1"><input className={ak.input} value={c.name} onChange={(e) => mutate((t) => ({ ...t, contacts: t.contacts.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) }))} /></td>
                  <td className="px-2 py-1"><input className={ak.input} value={c.role ?? ""} onChange={(e) => mutate((t) => ({ ...t, contacts: t.contacts.map((x) => (x.id === c.id ? { ...x, role: e.target.value } : x)) }))} /></td>
                  <td className="px-2 py-1"><input className={ak.input} value={c.phone ?? ""} onChange={(e) => mutate((t) => ({ ...t, contacts: t.contacts.map((x) => (x.id === c.id ? { ...x, phone: e.target.value } : x)) }))} /></td>
                  <td className="px-2 py-1"><input className={ak.input} value={c.email ?? ""} onChange={(e) => mutate((t) => ({ ...t, contacts: t.contacts.map((x) => (x.id === c.id ? { ...x, email: e.target.value } : x)) }))} /></td>
                  <td className="px-2 py-1"><button className={ak.btnGhost} onClick={() => mutate((t) => ({ ...t, contacts: t.contacts.filter((x) => x.id !== c.id) }))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function EmptyNote({ label }: { label: string }) {
  return <div className="text-sm text-slate-500 italic">{label}</div>;
}

// ------------------------------------------------------------------
// Aircraft image lookup — debounced, cached per query. Falls back to
// `null` when Wikipedia has no match.
// ------------------------------------------------------------------
type AircraftImage = { imageUrl: string; caption?: string; source?: string; sourceUrl?: string } | null;

const aircraftImageCache: Map<string, AircraftImage> = new Map();
const aircraftImageInflight: Map<string, Promise<AircraftImage>> = new Map();

function useAircraftImage(query: string): AircraftImage {
  const [img, setImg] = useState<AircraftImage>(() => aircraftImageCache.get(query.trim()) ?? null);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setImg(null); return; }
    if (aircraftImageCache.has(q)) { setImg(aircraftImageCache.get(q) ?? null); return; }

    // Debounce a bit so we don't hammer the endpoint on every keystroke.
    let cancelled = false;
    const handle = setTimeout(async () => {
      let p = aircraftImageInflight.get(q);
      if (!p) {
        p = (async () => {
          try {
            const r = await fetch(`/api/airkarim/aircraft-image?q=${encodeURIComponent(q)}`);
            if (!r.ok) return null;
            const j = await r.json();
            if (!j || !j.imageUrl) return null;
            return j as AircraftImage;
          } catch { return null; }
        })();
        aircraftImageInflight.set(q, p);
      }
      const result = await p;
      aircraftImageCache.set(q, result);
      aircraftImageInflight.delete(q);
      if (!cancelled) setImg(result);
    }, 400);

    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);
  return img;
}

// ------------------------------------------------------------------
// Aviation tab — trip-level private-aviation preferences. Seeds per-flight
// fields so the user doesn't retype FBO details for the same airport.
// ------------------------------------------------------------------
function AviationTab() {
  const { currentTrip, dispatch } = useAK();
  const mutate = useMutateTrip();
  if (!currentTrip) return null;
  const prefs: AviationPrefs = currentTrip.aviationPrefs ?? {};
  function setPrefs(patch: Partial<AviationPrefs>) {
    dispatch({ type: "UPDATE_TRIP", id: currentTrip!.id, patch: { aviationPrefs: { ...prefs, ...patch } } });
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4 p-3 rounded-md bg-indigo-50 border border-indigo-200 text-[13px] text-indigo-900">
        Preferences saved here seed every flight on this trip. FBO defaults
        per airport are auto-applied when you type an airport code in a
        flight row.
      </div>

      <SectionCard
        title="Aircraft preference hierarchy"
        right={
          <button
            className={ak.btn}
            onClick={() => setPrefs({ aircraftHierarchy: [...(prefs.aircraftHierarchy ?? []), ""] })}
          >+ Aircraft</button>
        }
      >
        <div className="text-xs text-slate-500 mb-2">Ranked preferred → acceptable. Brokers receive this list when sourcing charter.</div>
        {(prefs.aircraftHierarchy ?? []).length === 0 ? (
          <div className="text-sm text-slate-500 italic">Add at least one aircraft model (e.g. "Global 7500").</div>
        ) : (
          <div className="space-y-2">
            {(prefs.aircraftHierarchy ?? []).map((name, i) => (
              <div key={i} className="grid grid-cols-[28px_1fr_auto_auto] gap-2 items-center">
                <div className="text-xs font-semibold text-slate-500 text-center">#{i + 1}</div>
                <input
                  className={ak.input}
                  value={name}
                  placeholder={i === 0 ? "Global 7500" : i === 1 ? "Gulfstream G650" : "Challenger 350"}
                  onChange={(e) => {
                    const arr = [...(prefs.aircraftHierarchy ?? [])];
                    arr[i] = e.target.value;
                    setPrefs({ aircraftHierarchy: arr });
                  }}
                />
                <button
                  className={ak.btnGhost}
                  disabled={i === 0}
                  onClick={() => {
                    const arr = [...(prefs.aircraftHierarchy ?? [])];
                    [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                    setPrefs({ aircraftHierarchy: arr });
                  }}
                >↑</button>
                <button
                  className={ak.btnGhost}
                  onClick={() => setPrefs({ aircraftHierarchy: (prefs.aircraftHierarchy ?? []).filter((_, k) => k !== i) })}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Broker contacts"
        right={
          <button
            className={ak.btn}
            onClick={() => setPrefs({ brokers: [...(prefs.brokers ?? []), { id: newId("brk"), name: "" }] })}
          >+ Broker</button>
        }
      >
        <div className="text-xs text-slate-500 mb-2">Charter desks / brokers. Historical pricing notes go in the contact role or email field for now.</div>
        {(prefs.brokers ?? []).length === 0 ? (
          <div className="text-sm text-slate-500 italic">No broker contacts yet.</div>
        ) : (
          <div className="space-y-2">
            {(prefs.brokers ?? []).map((c) => (
              <div key={c.id} className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr_1fr_1.5fr_auto] gap-2">
                <input className={ak.input} value={c.name} onChange={(e) => setPrefs({ brokers: (prefs.brokers ?? []).map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) })} placeholder="Contact name" />
                <input className={ak.input} value={c.role ?? ""} onChange={(e) => setPrefs({ brokers: (prefs.brokers ?? []).map((x) => (x.id === c.id ? { ...x, role: e.target.value } : x)) })} placeholder="Firm (VistaJet, NetJets…)" />
                <input className={ak.input} value={c.phone ?? ""} onChange={(e) => setPrefs({ brokers: (prefs.brokers ?? []).map((x) => (x.id === c.id ? { ...x, phone: e.target.value } : x)) })} placeholder="Phone" />
                <input className={ak.input} value={c.email ?? ""} onChange={(e) => setPrefs({ brokers: (prefs.brokers ?? []).map((x) => (x.id === c.id ? { ...x, email: e.target.value } : x)) })} placeholder="Email / notes (last quote $X/hr)" />
                <button className={ak.btnGhost} onClick={() => setPrefs({ brokers: (prefs.brokers ?? []).filter((x) => x.id !== c.id) })}>✕</button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <FboPrefsCard prefs={prefs} setPrefs={setPrefs} />

      <SectionCard title="Catering defaults">
        <div className="text-xs text-slate-500 mb-2">Applied automatically to new flight legs (user can still override per leg).</div>
        <textarea
          className={`${ak.input} min-h-[80px]`}
          value={prefs.cateringDefaults ?? ""}
          placeholder="Still: Fiji 1L × 4.  Sparkling: Perrier 330ml × 4.  Coffee: Nespresso Arpeggio, oat milk.  Snacks: mixed nuts + fruit + cheese board.  Wine: Opus One 2019 (on request)."
          onChange={(e) => setPrefs({ cateringDefaults: e.target.value })}
        />
      </SectionCard>
    </div>
  );
}

function FboPrefsCard({
  prefs, setPrefs,
}: { prefs: AviationPrefs; setPrefs: (p: Partial<AviationPrefs>) => void }) {
  const [newCode, setNewCode] = useState("");
  const entries = Object.entries(prefs.fboPreferences ?? {});

  function setFbo(code: string, fbo: Fbo | undefined) {
    const next = { ...(prefs.fboPreferences ?? {}) };
    if (fbo) next[code] = fbo; else delete next[code];
    setPrefs({ fboPreferences: next });
  }

  return (
    <SectionCard
      title="FBO preferences by airport"
      right={
        <div className="flex gap-2 items-center">
          <input
            className={`${ak.input} w-24`}
            placeholder="IATA"
            maxLength={4}
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
          />
          <button
            className={ak.btn}
            disabled={!newCode.trim()}
            onClick={() => {
              if (!newCode.trim()) return;
              setFbo(newCode.trim().toUpperCase(), { name: "" });
              setNewCode("");
            }}
          >+ Airport</button>
        </div>
      }
    >
      <div className="text-xs text-slate-500 mb-2">Your preferred FBO (Signature vs Jet Aviation vs Million Air) and crew contacts per airport.</div>
      {entries.length === 0 ? (
        <div className="text-sm text-slate-500 italic">Add an airport code above to save a default FBO + contact.</div>
      ) : (
        <div className="space-y-3">
          {entries.map(([code, fbo]) => (
            <div key={code}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-semibold">{code}</div>
                <button className="t-micro text-red-600 hover:underline" onClick={() => setFbo(code, undefined)}>Remove</button>
              </div>
              <FboEditor
                label=""
                fbo={fbo}
                onChange={(next) => setFbo(code, next ?? { name: "" })}
              />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------------
// Per-section file attachments — shown at the top of each content tab.
// Pulls from /api/airkarim/trips/<id>/files and filters client-side. User
// can open, reassign section, or delete. Also hosts its own upload input
// so each tab can attach files targeted at that section.
// ------------------------------------------------------------------
const SECTION_LABELS: Record<string, string> = {
  flights: "Flights", lodging: "Lodging", meetings: "Meetings",
  dining: "Dining", ground: "Ground", other: "Other",
};

function SectionFiles({
  tripId, section, refreshKey,
}: { tripId: string; section: string; refreshKey: number }) {
  const [files, setFiles] = useState<TripFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTripFiles(tripId)
      .then((all) => { if (!cancelled) setFiles(all); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tripId, refreshKey]);

  const mine = files.filter((f) => f.section === section);

  async function onAttachFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      const saved = await saveFilesForTrip(tripId, Array.from(list));
      // If user attached from a specific tab, force that section for these files.
      const withSection = await Promise.all(
        saved.map((f) => f.section === section ? Promise.resolve(f) : updateFileSection(f.id, section as TripFile["section"])),
      );
      setFiles((prev) => [...prev.filter((p) => !withSection.find((w) => w.id === p.id)), ...withSection]);
    } catch (e) {
      alert(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onReassign(file: TripFile, newSection: TripFile["section"]) {
    const updated = await updateFileSection(file.id, newSection);
    setFiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  async function onDelete(file: TripFile) {
    if (!confirm(`Delete "${file.filename}"?`)) return;
    await deleteTripFile(file.id);
    setFiles((prev) => prev.filter((p) => p.id !== file.id));
  }

  return (
    <SectionCard
      title={`Attached documents${mine.length ? ` (${mine.length})` : ""}`}
      right={
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.eml"
            className="hidden"
            onChange={(e) => onAttachFiles(e.target.files)}
          />
          <button
            className={ak.btn}
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Uploading…" : "+ Attach PDF"}
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="text-sm text-slate-500 italic">Loading attachments…</div>
      ) : mine.length === 0 ? (
        <div className="text-sm text-slate-500 italic">
          No files attached to {SECTION_LABELS[section] ?? section} yet. Upload one above or use the top-bar "Upload docs" to have AI auto-tag them.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200">
          {mine.map((f) => (
            <li key={f.id} className="py-2 flex items-center gap-3">
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0 truncate text-sm text-sky-700 hover:underline"
                title="Open in new tab"
              >
                📄 {f.filename}
              </a>
              <span className="text-[11px] text-slate-500 shrink-0">
                {formatSize(f.size_bytes)}
              </span>
              <select
                value={f.section}
                onChange={(e) => onReassign(f, e.target.value as TripFile["section"])}
                className="text-xs px-1.5 py-1 border border-slate-300 rounded"
                title="Reassign section"
              >
                {Object.entries(SECTION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button
                className={ak.btnGhost}
                onClick={() => onDelete(f)}
                title="Delete"
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      {files.length > mine.length && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-800">
            {files.length - mine.length} more attached to other sections
          </summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {files.filter((f) => f.section !== section).map((f) => (
              <li key={f.id} className="py-1.5 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 shrink-0 w-[72px]">
                  {SECTION_LABELS[f.section] ?? f.section}
                </span>
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-sky-700 hover:underline">
                  {f.filename}
                </a>
                <button
                  className="text-xs px-1.5 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
                  onClick={() => onReassign(f, section as TripFile["section"])}
                >
                  Move here
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </SectionCard>
  );
}

function formatSize(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ------------------------------------------------------------------
// Outlook sync — button + modal
// ------------------------------------------------------------------
function OutlookButton({
  tripId: _tripId, connected, status, onOpen,
}: {
  tripId: string;
  connected: boolean;
  status: { status: "idle" | "syncing" | "synced" | "error"; error?: string };
  onOpen: () => void;
}) {
  // Status indicator dot so the user can see sync health at a glance.
  let dot = "bg-slate-300";
  let label: string;
  if (!connected) {
    label = "Add to Outlook";
  } else if (status.status === "syncing") {
    dot = "bg-amber-400 animate-pulse"; label = "Outlook · syncing";
  } else if (status.status === "error") {
    dot = "bg-red-500"; label = "Outlook · error";
  } else {
    dot = "bg-emerald-500"; label = "Outlook · synced";
  }
  return (
    <button
      className="text-sm px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 flex items-center gap-2"
      onClick={onOpen}
      title={status.error ?? "Subscribe to this trip in Outlook"}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </button>
  );
}

function OutlookModal({
  tripId: _tripId, tripTitle, connected, status, url, onConnect, onDisconnect, onClose,
}: {
  tripId: string;
  tripTitle: string;
  connected: boolean;
  status: { status: "idle" | "syncing" | "synced" | "error"; error?: string };
  url: string;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for browsers/iframes without clipboard access.
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl p-6 max-w-[560px] w-full shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-semibold">Outlook calendar</div>
            <div className="text-xl font-bold">Sync "{tripTitle}"</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-lg">✕</button>
        </div>

        {!connected ? (
          <>
            <p className="text-sm text-slate-700 mb-3">
              This creates a live calendar feed with every flight, meeting, dinner, hotel, and car on this trip.
              Outlook will refresh it in the background — edits here appear there within an hour or two.
            </p>
            <button
              className="w-full py-2.5 rounded-md bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold"
              onClick={onConnect}
            >
              Connect to Outlook
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-700 mb-3">
              Copy the URL below, then in Outlook go to{" "}
              <span className="font-semibold">Calendar → Add calendar → Subscribe from web</span>{" "}
              and paste it.
            </p>
            <div className="flex items-stretch gap-2 mb-3">
              <input
                readOnly
                value={url}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-md text-sm font-mono bg-slate-50"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                className="px-4 py-2 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold whitespace-nowrap"
                onClick={copy}
              >
                {copied ? "Copied!" : "Copy URL"}
              </button>
            </div>
            <div className="text-xs text-slate-500 mb-4">
              Status: {status.status === "syncing" && "Pushing latest changes…"}
              {status.status === "synced" && "Up to date — edits here flow to Outlook on its next refresh."}
              {status.status === "error" && <span className="text-red-600">Sync failed: {status.error}</span>}
              {status.status === "idle" && "Ready."}
            </div>
            <details className="mb-4 text-xs text-slate-600">
              <summary className="cursor-pointer select-none font-semibold text-slate-700">
                Detailed Outlook instructions
              </summary>
              <ol className="mt-2 ml-5 list-decimal space-y-1">
                <li>Open Outlook (desktop or outlook.office.com).</li>
                <li>Go to <strong>Calendar</strong>.</li>
                <li>Click <strong>Add calendar → Subscribe from web</strong> (web) or{" "}
                  <strong>Open Calendar → From Internet</strong> (desktop).</li>
                <li>Paste the URL above, name it "AirKarim · {tripTitle}", and save.</li>
                <li>Outlook auto-refreshes this feed on its own schedule.</li>
              </ol>
            </details>
            <button
              className="w-full py-2 rounded-md border border-red-300 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-semibold"
              onClick={async () => {
                if (confirm("Stop syncing this trip to Outlook? The server-side copy will be removed. Existing Outlook subscribers will see the events disappear on their next refresh.")) {
                  await onDisconnect();
                  onClose();
                }
              }}
            >
              Disconnect from Outlook
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Crew briefing modal — streams Claude-generated Markdown from the full
// trip JSON. Displays raw Markdown in a monospace block so the user can
// copy it (they paste into Word / Outlook / iMessage etc. for the crew).
// ------------------------------------------------------------------
function BriefingModal({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/airkarim/briefing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trip }),
        });
        if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          if (!cancelled) setText(acc);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore — user can select manually */ }
  }

  function download() {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(trip.title || "briefing").replace(/[^a-z0-9]+/gi, "_")}_briefing.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl p-5 max-w-[760px] w-full shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-semibold">Crew briefing</div>
            <div className="text-xl font-bold">{trip.title}</div>
          </div>
          <div className="flex items-center gap-2">
            {text && (
              <>
                <button onClick={copy} className={ak.btn}>{copied ? "Copied!" : "Copy"}</button>
                <button onClick={download} className={ak.btn}>Download .md</button>
              </>
            )}
            <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-lg">✕</button>
          </div>
        </div>

        {error ? (
          <div className="px-3 py-2 rounded-md bg-red-50 border border-red-300 text-red-700 text-sm">
            Briefing failed: {error}
          </div>
        ) : (
          <pre
            className="flex-1 overflow-auto border border-slate-200 rounded-md p-3 text-[12.5px] leading-snug whitespace-pre-wrap font-mono bg-slate-50"
          >
            {text || (loading ? "Drafting briefing with full trip context…" : "")}
          </pre>
        )}

        <div className="mt-2 text-[11px] text-slate-500">
          AI-drafted. Skim once before sending. Regenerate by closing and reopening.
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Upload Docs Modal
//
// Three-phase flow: pick files → AI extracts → user reviews and
// confirms before anything touches the trip. Each extracted item
// surfaces with a checkbox so the user can drop a misread flight or
// the wrong contact before merging. Replaces the old "click upload,
// instantly merge" behavior that blew through user edits without
// asking.
// ------------------------------------------------------------
const SUPPORTED_UPLOAD_EXTS = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.eml,.ics";


type UploadPhase = "picking" | "extracting" | "reviewing" | "saving";


type SectionKey =
  | "destinations" | "flights" | "lodging" | "meetings"
  | "dining" | "ground" | "contacts" | "documents";


/** Tracks which extracted items the user wants to keep. Each section's
 *  Set holds the indices of items in `extracted[section]` that are
 *  still checked. */
type SelectionState = Record<SectionKey, Set<number>>;


function emptySelection(): SelectionState {
  return {
    destinations: new Set(), flights: new Set(), lodging: new Set(),
    meetings: new Set(), dining: new Set(), ground: new Set(),
    contacts: new Set(), documents: new Set(),
  };
}


function selectAllFromExtraction(ex: Partial<Trip>): SelectionState {
  const sel = emptySelection();
  const fill = (key: SectionKey, arr: unknown[] | undefined) => {
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) sel[key].add(i);
  };
  fill("destinations", ex.destinations);
  fill("flights", ex.flights);
  fill("lodging", ex.lodging);
  fill("meetings", ex.meetings);
  fill("dining", ex.dining);
  fill("ground", ex.ground);
  fill("contacts", ex.contacts);
  fill("documents", ex.documents);
  return sel;
}


/** Build a filtered Partial<Trip> containing only the items the user
 *  kept. Trip-level scalars are passed through unchanged — those are
 *  presented as a single "Trip details" group with one checkbox. */
function applySelection(
  ex: Partial<Trip>,
  sel: SelectionState,
  keepScalars: boolean,
): Partial<Trip> {
  const pick = <T,>(arr: T[] | undefined, idx: Set<number>): T[] | undefined => {
    if (!arr) return undefined;
    const out = arr.filter((_, i) => idx.has(i));
    return out.length > 0 ? out : undefined;
  };
  return {
    title: keepScalars ? ex.title : undefined,
    purpose: keepScalars ? ex.purpose : undefined,
    startDate: keepScalars ? ex.startDate : undefined,
    endDate: keepScalars ? ex.endDate : undefined,
    notes: keepScalars ? ex.notes : undefined,
    destinations: pick(ex.destinations, sel.destinations),
    flights: pick(ex.flights, sel.flights),
    lodging: pick(ex.lodging, sel.lodging),
    meetings: pick(ex.meetings, sel.meetings),
    dining: pick(ex.dining, sel.dining),
    ground: pick(ex.ground, sel.ground),
    contacts: pick(ex.contacts, sel.contacts),
    documents: pick(ex.documents, sel.documents),
  };
}


function summarizeFlight(f: Partial<Flight>): string {
  const route = [f.departAirport, f.arriveAirport].filter(Boolean).join(" → ") || "—";
  const carrier = [f.airline, f.flightNumber].filter(Boolean).join(" ");
  const when = f.departAt ? fmtDateTime(f.departAt) : "";
  return [carrier || "Flight", route, when].filter(Boolean).join(" · ");
}

function summarizeLodging(l: Partial<Lodging>): string {
  const dates = [l.checkInAt && new Date(l.checkInAt).toLocaleDateString(),
    l.checkOutAt && new Date(l.checkOutAt).toLocaleDateString()].filter(Boolean).join("–");
  return [l.hotel || "Hotel", l.city, dates].filter(Boolean).join(" · ");
}

function summarizeMeeting(m: Partial<Meeting>): string {
  const when = m.startAt ? fmtDateTime(m.startAt) : "";
  return [m.title || "Meeting", m.location, when].filter(Boolean).join(" · ");
}

function summarizeDining(d: Partial<Dining>): string {
  const when = d.time ? fmtDateTime(d.time) : "";
  return [d.restaurant || "Restaurant", d.city, when].filter(Boolean).join(" · ");
}

function summarizeGround(g: Partial<Ground>): string {
  const route = [g.pickup, g.dropoff].filter(Boolean).join(" → ");
  const when = g.time ? fmtDateTime(g.time) : "";
  return [g.transportKind ?? "ground", route, when].filter(Boolean).join(" · ");
}

function summarizeContact(c: Partial<Contact>): string {
  return [c.name || "Contact", c.role, c.phone || c.email].filter(Boolean).join(" · ");
}

function summarizeDestination(d: Partial<Destination>): string {
  const dates = [d.arriveAt && new Date(d.arriveAt).toLocaleDateString(),
    d.departAt && new Date(d.departAt).toLocaleDateString()].filter(Boolean).join("–");
  return [d.city || "Destination", dates].filter(Boolean).join(" · ");
}

function summarizeDocument(d: Partial<TripDocument>): string {
  return [d.label || "Document", d.docType].filter(Boolean).join(" · ");
}


function fileKindLabel(f: File): string {
  const n = f.name.toLowerCase();
  if (n.endsWith(".pdf")) return "PDF";
  if (n.endsWith(".eml") || n.endsWith(".msg")) return "Email";
  if (n.endsWith(".ics")) return "ICS";
  if (n.endsWith(".txt")) return "Text";
  if (/\.(png|jpe?g|webp|gif)$/.test(n)) return "Image";
  return "File";
}


function UploadDocsModal({
  onClose, onConfirm,
}: {
  onClose: () => void;
  onConfirm: (files: File[], extraction: Partial<Trip>) => Promise<void>;
}) {
  const [phase, setPhase] = useState<UploadPhase>("picking");
  const [files, setFiles] = useState<File[]>([]);
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<Partial<Trip> | null>(null);
  const [selection, setSelection] = useState<SelectionState>(() => emptySelection());
  const [keepScalars, setKeepScalars] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function addFiles(picked: File[]) {
    if (picked.length === 0) return;
    setError(null);
    setFiles((prev) => [...prev, ...picked]);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setHover(false);
    const picked = Array.from(e.dataTransfer.files ?? []);
    if (picked.length) addFiles(picked);
  }

  async function runExtraction() {
    if (files.length === 0) return;
    setPhase("extracting");
    setError(null);
    try {
      const ex = await extractTripFromFiles(files);
      setExtracted(ex);
      setSelection(selectAllFromExtraction(ex));
      const hasAnything =
        Boolean(ex.title || ex.purpose || ex.startDate || ex.endDate || ex.notes)
        || (ex.destinations?.length ?? 0) > 0
        || (ex.flights?.length ?? 0) > 0
        || (ex.lodging?.length ?? 0) > 0
        || (ex.meetings?.length ?? 0) > 0
        || (ex.dining?.length ?? 0) > 0
        || (ex.ground?.length ?? 0) > 0
        || (ex.contacts?.length ?? 0) > 0
        || (ex.documents?.length ?? 0) > 0;
      if (!hasAnything) {
        setError("Claude couldn't pull anything itinerary-related from those files. Try clearer scans or different docs.");
        setPhase("picking");
        return;
      }
      setPhase("reviewing");
    } catch (e) {
      setError((e as Error).message);
      setPhase("picking");
    }
  }

  function toggleItem(section: SectionKey, idx: number) {
    setSelection((prev) => {
      const next: SelectionState = { ...prev, [section]: new Set(prev[section]) };
      if (next[section].has(idx)) next[section].delete(idx);
      else next[section].add(idx);
      return next;
    });
  }

  function setAllInSection(section: SectionKey, on: boolean) {
    setSelection((prev) => {
      const arr = (extracted?.[section] as unknown[] | undefined) ?? [];
      const next: SelectionState = { ...prev, [section]: new Set<number>() };
      if (on) for (let i = 0; i < arr.length; i++) next[section].add(i);
      return next;
    });
  }

  async function commit() {
    if (!extracted) return;
    setPhase("saving");
    setError(null);
    try {
      const filtered = applySelection(extracted, selection, keepScalars);
      await onConfirm(files, filtered);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setPhase("reviewing");
    }
  }

  // Selection summary for the footer.
  const totalSelected = (Object.keys(selection) as SectionKey[])
    .reduce((n, k) => n + selection[k].size, 0)
    + (keepScalars && extracted && (extracted.title || extracted.purpose || extracted.startDate || extracted.endDate || extracted.notes) ? 1 : 0);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget && phase !== "saving") onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[760px] max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-semibold">AirKarim</div>
            <div className="text-xl font-bold">
              {phase === "picking"    && "Upload trip documents"}
              {phase === "extracting" && "Reading documents…"}
              {phase === "reviewing"  && "Review what Claude found"}
              {phase === "saving"     && "Saving…"}
            </div>
            <div className="text-[12px] text-slate-500 mt-0.5">
              {phase === "picking"    && "Drag PDFs, emails, screenshots, or ICS files here. Claude reads them and pulls itinerary data — you review before anything is added."}
              {phase === "extracting" && "Claude is parsing your files. This usually takes 10–30 seconds."}
              {phase === "reviewing"  && "Uncheck anything that doesn't belong. Only checked items will be merged into the trip."}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={phase === "saving"}
            className="text-slate-500 hover:text-slate-900 text-lg disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-auto flex-1">
          {phase === "picking" && (
            <UploadPickPhase
              files={files}
              setFiles={setFiles}
              hover={hover}
              setHover={setHover}
              addFiles={addFiles}
              onDrop={onDrop}
              inputRef={inputRef}
            />
          )}

          {phase === "extracting" && (
            <div className="py-12 text-center">
              <div className="inline-block w-10 h-10 border-2 border-slate-300 border-t-sky-600 rounded-full animate-spin" />
              <div className="mt-4 text-sm text-slate-700">Extracting itinerary data from {files.length} file{files.length === 1 ? "" : "s"}…</div>
            </div>
          )}

          {phase === "reviewing" && extracted && (
            <UploadReviewPhase
              extracted={extracted}
              selection={selection}
              keepScalars={keepScalars}
              setKeepScalars={setKeepScalars}
              toggleItem={toggleItem}
              setAllInSection={setAllInSection}
            />
          )}

          {phase === "saving" && (
            <div className="py-12 text-center">
              <div className="inline-block w-10 h-10 border-2 border-slate-300 border-t-emerald-600 rounded-full animate-spin" />
              <div className="mt-4 text-sm text-slate-700">Saving files and merging into trip…</div>
            </div>
          )}

          {error && (
            <div className="mt-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-slate-500">
            {phase === "picking"   && `${files.length} file${files.length === 1 ? "" : "s"} ready`}
            {phase === "reviewing" && `${totalSelected} item${totalSelected === 1 ? "" : "s"} selected to merge`}
          </div>
          <div className="flex items-center gap-2">
            {phase === "reviewing" && (
              <button
                onClick={() => setPhase("picking")}
                className={ak.btn}
              >
                ← Back to files
              </button>
            )}
            <button
              onClick={onClose}
              disabled={phase === "saving"}
              className={ak.btn}
            >
              Cancel
            </button>
            {phase === "picking" && (
              <button
                onClick={runExtraction}
                disabled={files.length === 0}
                className={ak.btnPrimary}
                style={{ opacity: files.length === 0 ? 0.5 : 1 }}
              >
                Read with AI →
              </button>
            )}
            {phase === "reviewing" && (
              <button
                onClick={commit}
                disabled={totalSelected === 0}
                className={ak.btnPrimary}
                style={{ opacity: totalSelected === 0 ? 0.5 : 1 }}
              >
                Merge {totalSelected} item{totalSelected === 1 ? "" : "s"} into trip
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function UploadPickPhase({
  files, setFiles, hover, setHover, addFiles, onDrop, inputRef,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
  hover: boolean;
  setHover: (b: boolean) => void;
  addFiles: (picked: File[]) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <div
        onDragEnter={(e) => { e.preventDefault(); setHover(true); }}
        onDragOver={(e) => { e.preventDefault(); setHover(true); }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
        style={{
          padding: "40px 16px",
          background: hover ? "#f0f9ff" : "#ffffff",
          borderColor: hover ? "#0284c7" : "#cbd5e1",
        }}
      >
        <div className="text-[42px] leading-none text-sky-600">⬇</div>
        <div className="mt-2 font-semibold text-slate-900 text-lg">
          {hover ? "Drop to add" : "Drag files here"}
        </div>
        <div className="text-[12px] text-slate-500 mt-1">
          or click to browse — <span className="font-mono">.pdf .eml .ics .txt .png .jpg .webp</span>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={SUPPORTED_UPLOAD_EXTS}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length) addFiles(picked);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      {files.length > 0 && (
        <div className="mt-4 border border-slate-200 rounded-md overflow-hidden">
          <div className="px-3 py-1.5 bg-slate-50 text-[10px] uppercase tracking-[0.15em] font-semibold text-slate-500 flex items-center justify-between">
            <span>{files.length} file{files.length === 1 ? "" : "s"} queued</span>
            <button
              onClick={() => setFiles([])}
              className="text-[10px] text-slate-500 hover:text-red-700"
            >
              Clear all
            </button>
          </div>
          <ul className="divide-y divide-slate-200 max-h-[200px] overflow-y-auto">
            {files.map((f, i) => (
              <li key={i} className="px-3 py-1.5 flex items-center gap-2 text-[12px]">
                <span className="text-[9px] uppercase tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-slate-200 text-slate-700">
                  {fileKindLabel(f)}
                </span>
                <span className="flex-1 truncate text-slate-900">{f.name}</span>
                <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                  {Math.max(1, Math.round(f.size / 1024))} KB
                </span>
                <button
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="text-slate-400 hover:text-red-700"
                  title="Remove"
                >×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


function UploadReviewPhase({
  extracted, selection, keepScalars, setKeepScalars, toggleItem, setAllInSection,
}: {
  extracted: Partial<Trip>;
  selection: SelectionState;
  keepScalars: boolean;
  setKeepScalars: (b: boolean) => void;
  toggleItem: (section: SectionKey, idx: number) => void;
  setAllInSection: (section: SectionKey, on: boolean) => void;
}) {
  const hasScalars = Boolean(
    extracted.title || extracted.purpose || extracted.startDate || extracted.endDate || extracted.notes,
  );

  function ItemList<T>({
    section, items, summarize, label,
  }: {
    section: SectionKey;
    items: T[] | undefined;
    summarize: (it: T) => string;
    label: string;
  }) {
    if (!items || items.length === 0) return null;
    const sel = selection[section];
    const allOn = sel.size === items.length;
    return (
      <div className="border border-slate-200 rounded-md overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 flex items-center justify-between gap-2">
          <div className="text-[12px] font-semibold text-slate-900">
            {label} <span className="text-slate-500 font-normal">({sel.size}/{items.length})</span>
          </div>
          <button
            onClick={() => setAllInSection(section, !allOn)}
            className="text-[11px] text-sky-600 hover:text-sky-800 underline"
          >
            {allOn ? "uncheck all" : "check all"}
          </button>
        </div>
        <ul className="divide-y divide-slate-200">
          {items.map((it, i) => {
            const on = sel.has(i);
            return (
              <li key={i}>
                <label className="px-3 py-2 flex items-center gap-3 text-[12px] cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleItem(section, i)}
                    className="shrink-0"
                  />
                  <span className={`flex-1 ${on ? "text-slate-900" : "text-slate-400 line-through"}`}>
                    {summarize(it)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hasScalars && (
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 text-[12px] font-semibold text-slate-900">
            Trip details
          </div>
          <label className="px-3 py-2 flex items-center gap-3 text-[12px] cursor-pointer hover:bg-slate-50">
            <input
              type="checkbox"
              checked={keepScalars}
              onChange={() => setKeepScalars(!keepScalars)}
              className="shrink-0 mt-0.5"
            />
            <div className={`flex-1 space-y-0.5 ${keepScalars ? "text-slate-900" : "text-slate-400 line-through"}`}>
              {extracted.title && <div><b>Title:</b> {extracted.title}</div>}
              {extracted.purpose && <div><b>Purpose:</b> {extracted.purpose}</div>}
              {extracted.startDate && extracted.endDate && (
                <div>
                  <b>Dates:</b> {new Date(extracted.startDate).toLocaleDateString()} → {new Date(extracted.endDate).toLocaleDateString()}
                </div>
              )}
              {extracted.notes && <div className="italic text-slate-600">{extracted.notes}</div>}
            </div>
          </label>
          <div className="px-3 py-1.5 bg-slate-50/50 text-[10px] text-slate-500 italic border-t border-slate-100">
            Trip-level details only fill in fields that are currently empty — your edits are never overwritten.
          </div>
        </div>
      )}

      <ItemList<Destination> section="destinations" items={extracted.destinations} summarize={summarizeDestination} label="Destinations" />
      <ItemList<Flight>      section="flights"      items={extracted.flights}      summarize={summarizeFlight}      label="Flights" />
      <ItemList<Lodging>     section="lodging"      items={extracted.lodging}      summarize={summarizeLodging}     label="Lodging" />
      <ItemList<Meeting>     section="meetings"     items={extracted.meetings}     summarize={summarizeMeeting}     label="Meetings" />
      <ItemList<Dining>      section="dining"       items={extracted.dining}       summarize={summarizeDining}      label="Dining" />
      <ItemList<Ground>      section="ground"       items={extracted.ground}       summarize={summarizeGround}      label="Ground" />
      <ItemList<Contact>     section="contacts"     items={extracted.contacts}     summarize={summarizeContact}     label="Contacts" />
      <ItemList<TripDocument> section="documents"   items={extracted.documents}    summarize={summarizeDocument}    label="Documents" />
    </div>
  );
}


// Unused direct type imports kept so the module file can be checked on its own.
export type { AviationPrefs, Destination, TripDocument };
