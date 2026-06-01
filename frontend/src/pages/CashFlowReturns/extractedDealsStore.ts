// localStorage-backed store for user-extracted deals (Phase 7).
//
// The static DEALS registry in deals.ts holds seeded deals (Paris LXR
// + three illustrative deals). Deals the user uploads via "+ New Deal"
// are stored here, persisted across reloads, and merged with the
// static list at read time so the rest of the app doesn't need to care
// about the split.

import type { Assumptions } from "./types";
import type { DealRecord, DealStatus } from "./deals";


const STORAGE_KEY = "cfr.extractedDeals.v1";


type Persisted = {
  id: string;
  name: string;
  location: string;
  status: DealStatus;
  modified: string;
  description: string;
  seed: Assumptions;
  sourceFilename?: string;
};


function readAll(): Persisted[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Persisted[]) : [];
  } catch {
    return [];
  }
}


function writeAll(records: Persisted[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}


export function listExtractedDeals(): DealRecord[] {
  return readAll().map((p) => ({
    id: p.id,
    name: p.name,
    location: p.location,
    status: p.status,
    modified: p.modified,
    description: p.description,
    seed: p.seed,
  }));
}


export function getExtractedDeal(id: string): DealRecord | undefined {
  const p = readAll().find((x) => x.id === id);
  if (!p) return undefined;
  return {
    id: p.id, name: p.name, location: p.location, status: p.status,
    modified: p.modified, description: p.description, seed: p.seed,
  };
}


export function saveExtractedDeal(args: {
  name: string;
  location: string;
  description: string;
  seed: Assumptions;
  sourceFilename?: string;
  status?: DealStatus;
}): DealRecord {
  const id = slugifyUnique(args.name, [...readAll().map((p) => p.id)]);
  const rec: Persisted = {
    id,
    name: args.name,
    location: args.location,
    description: args.description,
    status: args.status ?? "Modeling",
    modified: new Date().toISOString().slice(0, 10),
    seed: args.seed,
    sourceFilename: args.sourceFilename,
  };
  const next = [...readAll(), rec];
  writeAll(next);
  return {
    id: rec.id, name: rec.name, location: rec.location, status: rec.status,
    modified: rec.modified, description: rec.description, seed: rec.seed,
  };
}


export function deleteExtractedDeal(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}


function slugifyUnique(name: string, existing: string[]): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40) || "deal";
  let candidate = base;
  let n = 2;
  const taken = new Set(existing);
  while (taken.has(candidate)) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}
