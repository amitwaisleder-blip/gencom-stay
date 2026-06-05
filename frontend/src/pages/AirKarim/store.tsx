import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { buildSampleTrip, newId } from "./seed";
import type { AKState, Trip } from "./types";

const LS_KEY = "airkarim_state_v1";

function defaultState(): AKState {
  const sample = buildSampleTrip();
  return { schemaVersion: 1, trips: [sample], currentTripId: sample.id, outlookConnectedTripIds: [] };
}

function load(): AKState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as AKState;
    if (!parsed.schemaVersion) return defaultState();
    if (!parsed.outlookConnectedTripIds) parsed.outlookConnectedTripIds = [];
    return parsed;
  } catch {
    return defaultState();
  }
}

function save(s: AKState) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { console.error("[airkarim] save failed", e); }
}

type Action =
  | { type: "HYDRATE"; state: AKState }
  | { type: "RESET_SEED" }
  | { type: "ADD_TRIP"; t: Trip }
  | { type: "UPDATE_TRIP"; id: string; patch: Partial<Trip> }
  | { type: "REPLACE_TRIP"; t: Trip }
  | { type: "DELETE_TRIP"; id: string }
  | { type: "SET_CURRENT"; id: string | null }
  | { type: "OUTLOOK_CONNECT"; id: string }
  | { type: "OUTLOOK_DISCONNECT"; id: string };

function reducer(state: AKState, action: Action): AKState {
  switch (action.type) {
    case "HYDRATE":
      return action.state;
    case "RESET_SEED":
      return defaultState();
    case "ADD_TRIP":
      return { ...state, trips: [action.t, ...state.trips], currentTripId: action.t.id };
    case "UPDATE_TRIP":
      return {
        ...state,
        trips: state.trips.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      };
    case "REPLACE_TRIP":
      return {
        ...state,
        trips: state.trips.map((t) => (t.id === action.t.id ? action.t : t)),
      };
    case "DELETE_TRIP": {
      const trips = state.trips.filter((t) => t.id !== action.id);
      return {
        ...state,
        trips,
        currentTripId: state.currentTripId === action.id ? (trips[0]?.id ?? null) : state.currentTripId,
        outlookConnectedTripIds: (state.outlookConnectedTripIds ?? []).filter((id) => id !== action.id),
      };
    }
    case "SET_CURRENT":
      return { ...state, currentTripId: action.id };
    case "OUTLOOK_CONNECT":
      return {
        ...state,
        outlookConnectedTripIds: [
          ...(state.outlookConnectedTripIds ?? []).filter((id) => id !== action.id),
          action.id,
        ],
      };
    case "OUTLOOK_DISCONNECT":
      return {
        ...state,
        outlookConnectedTripIds: (state.outlookConnectedTripIds ?? []).filter((id) => id !== action.id),
      };
    default:
      return state;
  }
}

export type OutlookStatus = "idle" | "syncing" | "synced" | "error";

type AKContextValue = {
  state: AKState;
  dispatch: React.Dispatch<Action>;
  currentTrip: Trip | null;
  savedIndicator: "saved" | "saving" | "idle";
  newTrip: () => Trip;
  duplicateTrip: (id: string) => Trip | null;
  exportJson: () => string;
  importJson: (json: string) => boolean;
  // Outlook ICS subscription helpers
  isOutlookConnected: (tripId: string) => boolean;
  outlookStatus: (tripId: string) => { status: OutlookStatus; error?: string };
  connectOutlook: (tripId: string) => Promise<void>;
  disconnectOutlook: (tripId: string) => Promise<void>;
  outlookIcsUrl: (tripId: string) => string;
};

const Ctx = createContext<AKContextValue | null>(null);

export function AKProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined as unknown as AKState, load);

  // Save on every change. "Saving" flashes briefly for the indicator.
  const firstRun = useRef(true);
  const savedTimer = useRef<number | null>(null);
  const savingRef = useRef<"saved" | "saving" | "idle">("idle");
  // A piece of state we bump whenever save status flips, just so consumers rerender.
  const [, forceTick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      savingRef.current = "saved";
      forceTick();
      return;
    }
    savingRef.current = "saving";
    forceTick();
    save(state);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => {
      savingRef.current = "saved";
      forceTick();
    }, 300);
  }, [state]);

  const currentTrip = useMemo(
    () => state.trips.find((t) => t.id === state.currentTripId) ?? null,
    [state],
  );

  const newTrip = useCallback((): Trip => {
    const now = new Date();
    const start = new Date(now); start.setHours(6, 0, 0, 0);
    const end = new Date(now); end.setDate(end.getDate() + 2); end.setHours(22, 0, 0, 0);
    const t: Trip = {
      id: newId("trip"),
      title: "Untitled trip",
      purpose: "",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      destinations: [],
      flights: [],
      lodging: [],
      meetings: [],
      dining: [],
      ground: [],
      contacts: [],
      documents: [],
      aviationPrefs: { aircraftHierarchy: [], brokers: [], fboPreferences: {}, cateringDefaults: "" },
    };
    dispatch({ type: "ADD_TRIP", t });
    return t;
  }, []);

  const duplicateTrip = useCallback((id: string): Trip | null => {
    const src = state.trips.find((t) => t.id === id);
    if (!src) return null;
    const copy: Trip = JSON.parse(JSON.stringify(src));
    copy.id = newId("trip");
    copy.title = `${src.title} (copy)`;
    // Re-id nested lists so future edits don't collide.
    copy.destinations = copy.destinations.map((d) => ({ ...d, id: newId("dest") }));
    copy.flights = copy.flights.map((f) => ({ ...f, id: newId("f") }));
    copy.lodging = copy.lodging.map((l) => ({ ...l, id: newId("l") }));
    copy.meetings = copy.meetings.map((m) => ({ ...m, id: newId("m"), attendees: m.attendees.map((a) => ({ ...a, id: newId("a") })) }));
    copy.dining = copy.dining.map((d) => ({ ...d, id: newId("d") }));
    copy.ground = copy.ground.map((g) => ({ ...g, id: newId("g") }));
    copy.contacts = copy.contacts.map((c) => ({ ...c, id: newId("c") }));
    copy.documents = copy.documents.map((d) => ({ ...d, id: newId("doc") }));
    dispatch({ type: "ADD_TRIP", t: copy });
    return copy;
  }, [state.trips]);

  const exportJson = useCallback(() => JSON.stringify(state, null, 2), [state]);
  const importJson = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json) as AKState;
      if (!parsed.schemaVersion) return false;
      dispatch({ type: "HYDRATE", state: parsed });
      return true;
    } catch { return false; }
  }, []);

  // ------------------------------------------------------------------
  // Outlook ICS sync
  // ------------------------------------------------------------------
  // Status per trip ID. Not persisted — only meaningful in the current tab.
  const outlookStatusRef = useRef<Record<string, { status: OutlookStatus; error?: string }>>({});
  const syncTimers = useRef<Record<string, number>>({});
  const lastSyncedHash = useRef<Record<string, string>>({});

  function setOutlookStatus(id: string, status: OutlookStatus, error?: string) {
    outlookStatusRef.current[id] = { status, error };
    forceTick();
  }

  async function putTripToBackend(trip: Trip) {
    setOutlookStatus(trip.id, "syncing");
    try {
      const res = await fetch(`/api/airkarim/trips/${encodeURIComponent(trip.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trip),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setOutlookStatus(trip.id, "synced");
    } catch (e) {
      setOutlookStatus(trip.id, "error", (e as Error).message);
    }
  }

  // Auto-sync: when a connected trip's data changes, debounce 1.2s then PUT.
  const connectedIds = state.outlookConnectedTripIds ?? [];
  useEffect(() => {
    for (const id of connectedIds) {
      const trip = state.trips.find((t) => t.id === id);
      if (!trip) continue;
      const hash = JSON.stringify(trip);
      if (lastSyncedHash.current[id] === hash) continue;
      lastSyncedHash.current[id] = hash;
      if (syncTimers.current[id]) window.clearTimeout(syncTimers.current[id]);
      syncTimers.current[id] = window.setTimeout(() => {
        putTripToBackend(trip);
      }, 1200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.trips, connectedIds.join(",")]);

  const isOutlookConnected = useCallback(
    (id: string) => (state.outlookConnectedTripIds ?? []).includes(id),
    [state.outlookConnectedTripIds],
  );

  const outlookStatus = useCallback(
    (id: string) => outlookStatusRef.current[id] ?? { status: "idle" as OutlookStatus },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outlookStatusRef.current],
  );

  const connectOutlook = useCallback(
    async (id: string) => {
      const trip = state.trips.find((t) => t.id === id);
      if (!trip) return;
      dispatch({ type: "OUTLOOK_CONNECT", id });
      await putTripToBackend(trip);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.trips],
  );

  const disconnectOutlook = useCallback(async (id: string) => {
    dispatch({ type: "OUTLOOK_DISCONNECT", id });
    try {
      await fetch(`/api/airkarim/trips/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch { /* non-fatal — user removed their local link */ }
    setOutlookStatus(id, "idle");
  }, []);

  const outlookIcsUrl = useCallback((id: string) => {
    // Absolute URL so it can be pasted directly into Outlook. Vite dev binds
    // to 127.0.0.1; in production the host is whatever served the dashboard.
    const origin = window.location.origin.replace(/:5173$/, ":8000");
    return `${origin}/api/airkarim/trips/${encodeURIComponent(id)}.ics`;
  }, []);

  const value: AKContextValue = {
    state, dispatch, currentTrip,
    savedIndicator: savingRef.current,
    newTrip, duplicateTrip,
    exportJson, importJson,
    isOutlookConnected, outlookStatus,
    connectOutlook, disconnectOutlook, outlookIcsUrl,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAK(): AKContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAK must be used inside <AKProvider>");
  return v;
}

// Convenience — mutate the current trip via a callback.
export function useMutateTrip() {
  const { currentTrip, dispatch } = useAK();
  return useCallback(
    (updater: (t: Trip) => Trip) => {
      if (!currentTrip) return;
      dispatch({ type: "REPLACE_TRIP", t: updater(currentTrip) });
    },
    [currentTrip, dispatch],
  );
}
