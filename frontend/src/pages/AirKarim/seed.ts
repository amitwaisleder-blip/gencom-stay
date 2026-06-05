import type { Trip } from "./types";

// Build an ISO timestamp in New York-relative time (we don't worry about
// timezones here — everything renders in the user's local timezone).
function at(daysFromToday: number, hour: number, min: number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSampleTrip(): Trip {
  return {
    id: id("trip"),
    title: "New York — Q2 Owner's Investment Committee",
    purpose: "IC meetings + RCCP Central Park site walk",
    startDate: at(7, 6, 0),
    endDate: at(9, 22, 0),
    destinations: [{ id: id("dest"), city: "New York, NY", arriveAt: at(7, 12, 15), departAt: at(9, 20, 0) }],
    flights: [
      {
        id: id("f"),
        airline: "American Airlines",
        flightNumber: "AA2234",
        aircraftType: "Boeing 737-800",
        departAirport: "MIA", departCity: "Miami, FL", departTerminal: "D", departGate: "D16",
        departAt: at(7, 9, 10),
        arriveAirport: "LGA", arriveCity: "New York, NY", arriveTerminal: "B", arriveGate: "B12",
        arriveAt: at(7, 12, 15),
        confirmation: "JPQR84", seat: "2A", cabin: "First", durationMin: 185,
        notes: "Private transfer meeting at baggage claim carousel 3.",
      },
      {
        id: id("f"),
        airline: "American Airlines",
        flightNumber: "AA1819",
        aircraftType: "Airbus A321",
        departAirport: "LGA", departCity: "New York, NY", departTerminal: "B", departGate: "B22",
        departAt: at(9, 17, 30),
        arriveAirport: "MIA", arriveCity: "Miami, FL", arriveTerminal: "D", arriveGate: "D14",
        arriveAt: at(9, 20, 55),
        confirmation: "JPQR84", seat: "1C", cabin: "First", durationMin: 205,
      },
    ],
    lodging: [
      {
        id: id("l"),
        hotel: "The Ritz-Carlton New York, Central Park",
        address: "50 Central Park South, New York, NY 10019",
        city: "New York, NY",
        checkInAt: at(7, 14, 0),
        checkOutAt: at(9, 11, 0),
        confirmation: "RC98321-CP",
        roomType: "Central Park Suite, King",
        phone: "+1 (212) 308-9100",
        notes: "Late-arrival flagged with Mr. Alibhai's assistant; welcome amenity requested.",
      },
    ],
    meetings: [
      {
        id: id("m"),
        title: "IC — Q2 Portfolio Review",
        startAt: at(8, 9, 0),
        endAt: at(8, 11, 30),
        location: "Gencom NY Office — Conference Room 22A",
        address: "410 Park Ave, 22nd Floor, New York, NY 10022",
        city: "New York, NY",
        attendees: [
          { id: id("a"), name: "Karim Alibhai", company: "Gencom", title: "Chairman & CEO" },
          { id: id("a"), name: "Ben Dennis", company: "Gencom", title: "Project Manager", email: "bdennis@gencomgrp.com" },
          { id: id("a"), name: "Patrick Imbardelli", company: "Gencom", title: "President" },
        ],
        agenda: "• Q2 portfolio performance\n• RCCP Central Park IC update\n• 25-Year Recertification progress review",
        materials: "IC deck v4, RCCP construction report, trailing 12-month operating summary",
        notes: "Coffee service at 8:45 AM. Board packets pre-delivered.",
      },
      {
        id: id("m"),
        title: "RCCP Central Park — Site Walk",
        startAt: at(8, 14, 30),
        endAt: at(8, 16, 30),
        location: "Ritz-Carlton Central Park — lobby meet",
        address: "50 Central Park South, New York, NY 10019",
        city: "New York, NY",
        attendees: [
          { id: id("a"), name: "Suffolk Project Executive", company: "Suffolk Construction", title: "PX" },
          { id: id("a"), name: "NBWW Architect", company: "Nichols Brosch Wurst Wolfe", title: "Principal" },
        ],
        agenda: "Walk the post-tension cable remediation zones on floors 18-22; review façade scaffolding plan.",
        notes: "Hard hats and high-vis vests required. Entry via back-of-house service corridor.",
      },
    ],
    dining: [
      {
        id: id("d"),
        restaurant: "The Grill",
        address: "99 E 52nd St, New York, NY 10022",
        city: "New York, NY",
        time: at(7, 19, 30),
        reservation: "OpenTable #UX4482 — Alibhai",
        partySize: 3,
        dressCode: "Business formal; jacket required",
        notes: "Pre-ordered wine pairing from the 2016 vintage list.",
      },
    ],
    ground: [
      {
        id: id("g"),
        transportKind: "limo",
        provider: "Dav El New York",
        pickup: "LGA Terminal B — Baggage Claim Carousel 3",
        dropoff: "Ritz-Carlton NY, Central Park",
        time: at(7, 12, 30),
        confirmation: "DAV-88421",
        driverContact: "+1 (917) 555-0139 — Joseph",
      },
      {
        id: id("g"),
        transportKind: "limo",
        provider: "Dav El New York",
        pickup: "Ritz-Carlton NY, Central Park",
        dropoff: "LGA Terminal B — Departures",
        time: at(9, 15, 30),
        confirmation: "DAV-88422",
      },
    ],
    contacts: [
      { id: id("c"), name: "Karim Alibhai", role: "Chairman & CEO", phone: "+1 (305) 555-0101", email: "karim@gencomgrp.com" },
      { id: id("c"), name: "Ritz-Carlton Concierge", role: "Hotel", phone: "+1 (212) 308-9100" },
      { id: id("c"), name: "Dav El Dispatch", role: "Ground", phone: "+1 (212) 555-0400" },
    ],
    documents: [
      { id: id("doc"), label: "AA Boarding Pass — MIA → LGA", docType: "Boarding pass" },
      { id: id("doc"), label: "AA Boarding Pass — LGA → MIA", docType: "Boarding pass" },
      { id: id("doc"), label: "IC Deck v4", docType: "Meeting material" },
      { id: id("doc"), label: "Ritz-Carlton confirmation email", docType: "Reservation" },
    ],
    notes: "Owner prefers morning arrivals; coffee delivered to room between 6:30-7:00 AM. Security detail not required in NY.",
  };
}

export function newId(prefix: string): string {
  return id(prefix);
}
