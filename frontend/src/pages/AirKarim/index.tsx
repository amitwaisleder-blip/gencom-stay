// AirKarim — executive trip itinerary authoring tool. Dark sidebar with
// the trip list, light content area with the tabbed editor. Persists
// everything to localStorage. Preview opens an iPhone 15 Pro mockup that
// renders the same trip data the editor holds.

import { useState } from "react";
import { AKProvider, useAK } from "./store";
import TripEditor from "./TripEditor";
import IPhonePreview from "./IPhonePreview";
import type { Trip } from "./types";
import { fmtDate } from "./ui";

export default function AirKarim() {
  return (
    <AKProvider>
      <Shell />
    </AKProvider>
  );
}

function Shell() {
  const [previewOpen, setPreviewOpen] = useState(false);
  const { state, currentTrip } = useAK();

  return (
    // Stretch to fit the remaining viewport under the app header.
    <div className="flex min-h-[calc(100vh-160px)] -mx-6 -my-8 bg-white rounded-md overflow-hidden border border-slate-200">
      <Sidebar />
      <TripEditor onPreview={() => setPreviewOpen(true)} />

      {previewOpen && (
        <IPhonePreview
          trips={state.trips}
          initialTripId={currentTrip?.id ?? state.trips[0]?.id ?? null}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

function Sidebar() {
  const { state, dispatch, newTrip, exportJson, importJson } = useAK();

  function onExport() {
    const json = exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `airkarim-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function onImport() {
    const pasted = window.prompt("Paste AirKarim backup JSON:");
    if (!pasted) return;
    const ok = importJson(pasted);
    alert(ok ? "Imported." : "Invalid backup.");
  }

  return (
    <aside className="w-64 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
      <div className="p-4 border-b border-slate-800">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold">AirKarim</div>
        <div className="text-lg font-semibold mt-0.5">Executive trips</div>
        <button
          className="mt-3 w-full rounded-md bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold py-2"
          onClick={() => newTrip()}
        >
          + New trip
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {state.trips.length === 0 ? (
          <div className="p-4 text-sm text-slate-400 italic">No trips yet.</div>
        ) : (
          <ul>
            {state.trips.map((trip) => (
              <TripListItem
                key={trip.id}
                trip={trip}
                active={trip.id === state.currentTripId}
                onClick={() => dispatch({ type: "SET_CURRENT", id: trip.id })}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="p-3 border-t border-slate-800 space-y-2 text-xs">
        <button className="w-full text-left text-slate-400 hover:text-white" onClick={onExport}>Export JSON backup</button>
        <button className="w-full text-left text-slate-400 hover:text-white" onClick={onImport}>Import JSON backup</button>
        <button
          className="w-full text-left text-slate-500 hover:text-red-300"
          onClick={() => { if (confirm("Reset AirKarim to the demo seed? Wipes all trips.")) dispatch({ type: "RESET_SEED" }); }}
        >
          Reset to demo
        </button>
      </div>
    </aside>
  );
}

function TripListItem({ trip, active, onClick }: { trip: Trip; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left px-4 py-3 border-l-2 transition ${
          active
            ? "bg-slate-800 border-sky-400 text-white"
            : "border-transparent text-slate-300 hover:bg-slate-800/60 hover:text-white"
        }`}
      >
        <div className="text-sm font-semibold truncate leading-tight">{trip.title}</div>
        <div className="text-[11px] text-slate-400 mt-0.5">
          {fmtDate(trip.startDate)} → {fmtDate(trip.endDate)}
        </div>
        <div className="text-[10px] text-slate-500 mt-0.5">
          {trip.flights.length}f · {trip.lodging.length}h · {trip.meetings.length}m · {trip.dining.length}d
        </div>
      </button>
    </li>
  );
}
