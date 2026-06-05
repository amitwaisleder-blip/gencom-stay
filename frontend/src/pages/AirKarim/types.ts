// AirKarim — types for executive trip itineraries. All dates are stored as
// ISO strings so time-zone handling is trivial and the data serializes
// cleanly to localStorage / JSON backup.

export type Attendee = {
  id: string;
  name: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
};

/** A Fixed-Base Operator (private-aviation terminal) at an airport. Saved
 *  on a flight leg so the crew knows exactly where to pull up. Trip-level
 *  preferences (aviationPrefs.fboPreferences) seed these when the user
 *  enters a known airport. */
export type Fbo = {
  name: string;         // "Signature Flight Support", "Jet Aviation", "Million Air"
  phone?: string;
  address?: string;
  handlerContact?: string;
  notes?: string;
};

/** Crew member on a private flight leg. */
export type CrewMember = {
  id: string;
  role: "captain" | "first_officer" | "flight_attendant" | "other";
  name: string;
  phone?: string;
  email?: string;
};

export type Flight = {
  id: string;
  airline: string;
  flightNumber: string;
  aircraftType?: string;
  departAirport: string; // 3-letter IATA or full name
  departCity?: string;
  departTerminal?: string;
  departGate?: string;
  departAt: string; // ISO
  arriveAirport: string;
  arriveCity?: string;
  arriveTerminal?: string;
  arriveGate?: string;
  arriveAt: string; // ISO
  confirmation?: string;
  seat?: string;
  cabin?: string;
  durationMin?: number;
  notes?: string;

  // ---------- Private aviation ----------
  /** "commercial" = airline ticket; "private" = charter / fractional / owned. */
  aviationKind?: "commercial" | "private";
  tailNumber?: string;          // e.g. "N123AB"
  operator?: string;            // charter broker or fleet operator
  brokerContact?: string;       // "John Doe — VistaJet — +1 555…"
  departFbo?: Fbo;
  arriveFbo?: Fbo;
  crew?: CrewMember[];
  /** Free-form catering notes for this leg (water brand, coffee, snack profile, wines). */
  catering?: string;
  /** Pre-authorized alternate airports in priority order (IATA codes). */
  alternates?: string[];
  /** International legs only — has customs pre-clearance been arranged? */
  customsPreclearance?: boolean;
};

export type Lodging = {
  id: string;
  hotel: string;
  address: string;
  city?: string;
  checkInAt: string; // ISO
  checkOutAt: string; // ISO
  confirmation?: string;
  roomType?: string;
  phone?: string;
  notes?: string;
};

export type Meeting = {
  id: string;
  title: string;
  startAt: string; // ISO
  endAt: string; // ISO
  location: string;
  address: string;
  city?: string;
  attendees: Attendee[];
  agenda?: string;
  materials?: string;
  notes?: string;
};

export type Dining = {
  id: string;
  restaurant: string;
  address: string;
  city?: string;
  time: string; // ISO
  reservation?: string;
  partySize?: number;
  dressCode?: string;
  notes?: string;
};

export type GroundKind = "car" | "limo" | "taxi" | "rideshare" | "rail" | "walk" | "other";

export type Ground = {
  id: string;
  transportKind: GroundKind;
  provider?: string;
  pickup: string;
  dropoff: string;
  time: string; // ISO
  confirmation?: string;
  driverContact?: string;
  notes?: string;
};

export type Contact = {
  id: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
};

export type TripDocument = {
  id: string;
  label: string;
  docType?: string;
  note?: string;
};

export type Destination = {
  id: string;
  city: string;
  arriveAt?: string;
  departAt?: string;
};

/** Trip-level private-aviation preferences — the things you want AirKarim
 *  to remember across trips, shown in the Aviation tab. */
export type AviationPrefs = {
  /** Aircraft models ranked preferred → acceptable, for charter sourcing.
   *  e.g. ["Global 7500", "Gulfstream G650", "Challenger 350"] */
  aircraftHierarchy?: string[];
  /** Broker contacts that can source aircraft (VistaJet desk, NetJets, etc). */
  brokers?: Contact[];
  /** Default FBO of choice per airport IATA code. Seeds the per-flight FBO
   *  field when the user enters an airport we've been to before. */
  fboPreferences?: Record<string, Fbo>;
  /** Persistent catering defaults applied to new flight legs unless the user
   *  overrides. "Fiji water, Nespresso Arpeggio, no dairy snacks, ..." */
  cateringDefaults?: string;
};

export type Trip = {
  id: string;
  title: string;
  purpose: string;
  startDate: string;
  endDate: string;
  destinations: Destination[];
  flights: Flight[];
  lodging: Lodging[];
  meetings: Meeting[];
  dining: Dining[];
  ground: Ground[];
  contacts: Contact[];
  documents: TripDocument[];
  // free-text notes that don't belong to a single block
  notes?: string;
  aviationPrefs?: AviationPrefs;
};

export type AKState = {
  schemaVersion: number;
  trips: Trip[];
  currentTripId: string | null;
  // Trip IDs the user has opted into syncing to the backend for Outlook
  // subscription. Only these trips are PUT to /api/airkarim/trips/<id>.
  outlookConnectedTripIds?: string[];
};

// Discriminated union used by the iPhone preview timeline.
export type TimelineBlock =
  | ({ kind: "flight"; at: string; endAt?: string } & Flight)
  | ({ kind: "lodging-checkin"; at: string; endAt?: string } & Lodging)
  | ({ kind: "lodging-checkout"; at: string; endAt?: string } & Lodging)
  | ({ kind: "meeting"; at: string; endAt?: string } & Meeting)
  | ({ kind: "dining"; at: string; endAt?: string } & Dining)
  | ({ kind: "ground"; at: string; endAt?: string } & Ground);
