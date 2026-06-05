/**
 * Preset sub-area lists per division for the Scope tab's quick-picker and
 * the Excel exporter. Users can also type a freeform value — the dropdown is
 * a shortcut, not an enforced list.
 *
 * Data is organized as a list of groups per division so the picker can render
 * <optgroup> headers (visual section dividers in the dropdown).
 */

export type SubAreaGroup = {
  label?: string;   // optional visual group header (omit for ungrouped divisions)
  options: string[];
};

export const SUB_AREAS_BY_DIVISION: Record<string, SubAreaGroup[]> = {
  "COMMON AREA": [
    {
      label: "Exterior Spaces",
      options: [
        "Porte-cochère",
        "Entry canopy",
        "Building façade",
        "Rooftop",
        "Pedestrian walkways",
        "Landscaping",
        "Parking garage",
        "Loading dock",
        "Outdoor pool deck",
        "Exterior signage",
      ],
    },
    {
      label: "Arrival & Circulation",
      options: [
        "Porte-cochère",
        "Valet drop-off",
        "Lobby",
        "Elevator lobbies",
        "Elevator cabs",
        "Public restrooms (Lobby)",
      ],
    },
    {
      label: "Fitness & Spa",
      options: [
        "Fitness center",
        "Yoga / movement studio",
        "Locker rooms",
        "Spa",
        "Game room",
      ],
    },
    {
      label: "Club Lounge",
      options: [
        "Club lounge",
        "Executive lounge",
        "Concierge lounge",
        "Lounge pantry",
      ],
    },
    {
      label: "Retail & Services",
      options: [
        "Gift shop",
        "Sundries shop",
        "Business center",
        "Third-party retail",
        "Ice alcoves / Vending alcoves",
      ],
    },
    {
      label: "Back-of-House",
      options: [
        "Administrative offices",
        "Employee entrance",
        "Employee dining / cafeteria",
        "Employee locker rooms",
        "Uniform room",
        "Receiving / loading dock",
        "Housekeeping",
        "Laundry",
      ],
    },
  ],
  "F&B": [
    {
      label: "F&B (General)",
      options: [
        "Signature restaurant",
        "All-day dining / breakfast room",
        "Specialty restaurant",
        "Rooftop restaurant",
        "Lobby lounge",
        "Bar",
        "Pool bar",
        "Coffee shop",
        "Grab-and-go market",
      ],
    },
  ],
  "MEETING SPACE": [
    {
      label: "Meeting Space (general)",
      options: [
        "Ballroom",
        "Junior ballroom",
        "Breakout meeting rooms",
        "Boardrooms",
        "Exec meeting suites",
        "Pre-function",
        "Exhibit hall",
        "Outdoor event space",
        "Event restroom clusters",
      ],
    },
  ],
  "CORRIDORS": [
    {
      options: [
        "Guestroom Corridor",
        "Elevator Lobby",
        "Service Corridor",
        "BOH Corridor",
      ],
    },
  ],
  "GUESTROOMS": [
    {
      options: [
        "Guestroom Entry",
        "Guestroom",
        "Guestroom Bathroom",
        "Guestroom Closet",
        "Balcony / Terrace",
      ],
    },
  ],
  "SUITES": [
    {
      options: [
        "Suite Entry",
        "Suite",
        "Suite Bathroom",
        "Powder Room",
        "Living Room / Parlor",
        "Dining Area",
        "Kitchenette / Wet Bar",
        "Dressing Room",
        "Balcony / Terrace",
      ],
    },
  ],
  "SIGNATURE SUITES": [
    {
      options: [
        "Suite Entry",
        "Living Room / Parlor",
        "Dining Area",
        "Master Bedroom",
        "Master Bathroom",
        "Secondary Bedroom",
        "Secondary Bathroom",
        "Powder Room",
        "Kitchenette / Wet Bar",
        "Dressing Room",
        "Balcony / Terrace",
      ],
    },
  ],
  "DEFERRED MAINTENANCE": [
    {
      options: [
        "Roof",
        "Exterior Envelope",
        "Structural",
        "HVAC",
        "Electrical",
        "Plumbing",
        "Fire & Life Safety",
        "Vertical Transport",
        "Pool & Water Features",
        "Laundry",
        "IT / Low Voltage",
        "Site & Hardscape",
        "Landscape & Irrigation",
        "Parking Garage",
        "Life Safety / Code",
        "Back of House",
        "Guestroom MEP",
      ],
    },
  ],
  "MISC. ITEMS": [
    {
      options: [
        "Signage",
        "Lighting Package",
        "Administration / Offices",
        "Back of House",
        "Other",
      ],
    },
  ],
};

/** Flat list of all sub-areas for a division (preserves group order). */
export function subAreasForDivision(division: string | null | undefined): string[] {
  if (!division) return [];
  const groups = SUB_AREAS_BY_DIVISION[division] ?? [];
  return groups.flatMap((g) => g.options);
}

/** Grouped list for rendering with <optgroup> in a <select>. */
export function subAreaGroupsForDivision(
  division: string | null | undefined,
): SubAreaGroup[] {
  if (!division) return [];
  return SUB_AREAS_BY_DIVISION[division] ?? [];
}
