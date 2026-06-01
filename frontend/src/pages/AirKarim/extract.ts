// Upload files to /api/airkarim/extract-trip and merge the returned Trip
// fragment into the current trip. Claude returns a Trip-shaped object; we
// apply it conservatively — scalar fields only overwrite if empty, list
// fields always append with fresh IDs so the user can review and prune.

import type { Trip } from "./types";
import { newId } from "./seed";

export type TripFile = {
  id: string;
  trip_id: string;
  filename: string;
  section: "flights" | "lodging" | "meetings" | "dining" | "ground" | "other";
  content_type: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  url: string;
};

export async function extractTripFromFiles(files: File[]): Promise<Partial<Trip>> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const res = await fetch("/api/airkarim/extract-trip", { method: "POST", body: fd });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as Partial<Trip>;
}

/** Save uploaded files to the backend under this trip, auto-assigning a
 *  section based on filename heuristics. Returned records include a URL
 *  the editor can link to for preview/download. */
export async function saveFilesForTrip(tripId: string, files: File[]): Promise<TripFile[]> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const res = await fetch(`/api/airkarim/trips/${encodeURIComponent(tripId)}/files`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as TripFile[];
}

export async function listTripFiles(tripId: string): Promise<TripFile[]> {
  const res = await fetch(`/api/airkarim/trips/${encodeURIComponent(tripId)}/files`);
  if (!res.ok) return [];
  return (await res.json()) as TripFile[];
}

export async function updateFileSection(fileId: string, section: TripFile["section"]): Promise<TripFile> {
  const res = await fetch(`/api/airkarim/files/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  return (await res.json()) as TripFile;
}

export async function deleteTripFile(fileId: string): Promise<void> {
  await fetch(`/api/airkarim/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
}

function orBlank(current: string | undefined, incoming: string | undefined): string {
  if (current && current.trim()) return current;
  return (incoming ?? "").toString();
}

export function mergeExtractedIntoTrip(current: Trip, extracted: Partial<Trip>): Trip {
  // Scalars: only fill if currently blank so we don't clobber user edits.
  const next: Trip = {
    ...current,
    title: orBlank(current.title === "Untitled trip" || !current.title ? "" : current.title, extracted.title) || current.title,
    purpose: orBlank(current.purpose, extracted.purpose),
    startDate: current.startDate || (extracted.startDate ?? current.startDate),
    endDate: current.endDate || (extracted.endDate ?? current.endDate),
    notes: orBlank(current.notes, extracted.notes) || current.notes,
  };

  // If the extracted range is earlier than current (current was a placeholder),
  // prefer the extracted range.
  if (extracted.startDate && extracted.endDate) {
    next.startDate = extracted.startDate;
    next.endDate = extracted.endDate;
  }

  if (extracted.destinations?.length) {
    next.destinations = [
      ...current.destinations,
      ...extracted.destinations.map((d) => ({ ...d, id: newId("dest") })),
    ];
  }

  if (extracted.flights?.length) {
    next.flights = [
      ...current.flights,
      ...extracted.flights.map((f) => ({ ...f, id: newId("f") })),
    ];
  }

  if (extracted.lodging?.length) {
    next.lodging = [
      ...current.lodging,
      ...extracted.lodging.map((l) => ({ ...l, id: newId("l") })),
    ];
  }

  if (extracted.meetings?.length) {
    next.meetings = [
      ...current.meetings,
      ...extracted.meetings.map((m) => ({
        ...m,
        id: newId("m"),
        attendees: (m.attendees ?? []).map((a) => ({ ...a, id: newId("a") })),
      })),
    ];
  }

  if (extracted.dining?.length) {
    next.dining = [
      ...current.dining,
      ...extracted.dining.map((d) => ({ ...d, id: newId("d") })),
    ];
  }

  if (extracted.ground?.length) {
    next.ground = [
      ...current.ground,
      ...extracted.ground.map((g) => ({ ...g, id: newId("g") })),
    ];
  }

  if (extracted.contacts?.length) {
    next.contacts = [
      ...current.contacts,
      ...extracted.contacts.map((c) => ({ ...c, id: newId("c") })),
    ];
  }

  if (extracted.documents?.length) {
    next.documents = [
      ...current.documents,
      ...extracted.documents.map((d) => ({ ...d, id: newId("doc") })),
    ];
  }

  return next;
}
