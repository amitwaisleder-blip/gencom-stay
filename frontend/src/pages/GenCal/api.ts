// GenCal — backend API helpers. Phase 1 covers events + employees.

import type { GenCalCategory } from "./categories";

export type GenCalEvent = {
  id: string;
  title: string;
  category: GenCalCategory;
  start_at: string;      // ISO
  end_at: string;        // ISO
  all_day: boolean;
  location: string | null;
  description: string | null;
  locked: boolean;
  extras: Record<string, unknown>;
};

export type GenCalEmployee = {
  id: string;
  name: string;
  email: string;
  department: string | null;
  birthday: string | null;   // YYYY-MM-DD
  hire_date: string | null;  // YYYY-MM-DD
  active: boolean;
};


export async function listEvents(startISO: string, endISO: string): Promise<GenCalEvent[]> {
  const q = new URLSearchParams({ start: startISO, end: endISO });
  const r = await fetch(`/api/gen-cal/events?${q.toString()}`);
  if (!r.ok) return [];
  return (await r.json()) as GenCalEvent[];
}

export async function listEmployees(): Promise<GenCalEmployee[]> {
  const r = await fetch("/api/gen-cal/employees");
  if (!r.ok) return [];
  return (await r.json()) as GenCalEmployee[];
}

export type EventPayload = {
  title: string;
  category: GenCalCategory;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  extras: Record<string, unknown> | null;
};

export async function createEvent(payload: EventPayload): Promise<GenCalEvent> {
  const r = await fetch("/api/gen-cal/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as GenCalEvent;
}

export async function updateEvent(id: string, payload: EventPayload): Promise<GenCalEvent> {
  const r = await fetch(`/api/gen-cal/events/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as GenCalEvent;
}

export async function deleteEvent(id: string): Promise<void> {
  const r = await fetch(`/api/gen-cal/events/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error(`${r.status} ${await r.text()}`);
}

/** Parse a PDF lunch/event menu via Claude and return structured event drafts
 *  the caller can review before saving. The backend endpoint lives at
 *  /api/gen-cal/events/import-pdf. */
export async function importPdfEvents(file: File): Promise<EventPayload[]> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/gen-cal/events/import-pdf", { method: "POST", body: fd });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j = await r.json();
  return (j.events ?? []) as EventPayload[];
}

export async function runSeed(): Promise<{ status: string; created: Record<string, number> } | null> {
  try {
    const r = await fetch("/api/gen-cal/seed", { method: "POST" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
