// Project persistence — localStorage only, single-machine. Projects
// are keyed by id; the index lists ids in last-edited order so the
// home screen can render without parsing every project body.
//
// Schema (versioned so we can migrate later):
//   orgchart:index = { version: 1, ids: string[] }
//   orgchart:project:<id> = { id, name, chart, createdAt, updatedAt }

import type { ChartState } from "./types";

const INDEX_KEY = "orgchart:index";
const PROJECT_PREFIX = "orgchart:project:";

/** Hotel-property metadata captured at project creation. All optional
 *  beyond `name`: the user can skip AI-fill and just type a name. */
export type HotelMeta = {
  hotelName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  keyCount: number | null;
  yearBuilt: number | null;
  purchaseYear: number | null;
  brand: string | null;
  /** Resized JPEG data URL; ~600px max edge to stay under localStorage
   *  quota. Null if no photo uploaded. */
  photoDataUrl: string | null;
};

export function emptyHotel(): HotelMeta {
  return {
    hotelName: "",
    address: null, city: null, state: null, country: null,
    keyCount: null, yearBuilt: null, purchaseYear: null,
    brand: null, photoDataUrl: null,
  };
}

export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Quick stats for the home-screen card — recomputed on each save. */
  boxCount: number;
  connectorCount: number;
  hotel?: HotelMeta;
};

export type Project = ProjectMeta & {
  chart: ChartState;
};

type IndexFile = { version: 1; ids: string[] };

function readIndex(): IndexFile {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return { version: 1, ids: [] };
    const parsed = JSON.parse(raw) as IndexFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.ids)) return { version: 1, ids: [] };
    return parsed;
  } catch {
    return { version: 1, ids: [] };
  }
}

function writeIndex(idx: IndexFile) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

function projectKey(id: string): string {
  return PROJECT_PREFIX + id;
}

export function newId(): string {
  return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** List all projects, most recently updated first. */
export function listProjects(): ProjectMeta[] {
  const idx = readIndex();
  const out: ProjectMeta[] = [];
  for (const id of idx.ids) {
    const p = getProject(id);
    if (p) out.push(metaOf(p));
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function getProject(id: string): Project | null {
  try {
    const raw = localStorage.getItem(projectKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

function metaOf(p: Project): ProjectMeta {
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    boxCount: p.boxCount ?? p.chart.boxes.length,
    connectorCount: p.connectorCount ?? p.chart.connectors.length,
    hotel: p.hotel,
  };
}

/** Create a new project with the given name and seeded chart state.
 *  Pass `hotel` to attach hotel metadata captured by the new-project
 *  modal. Returns the new id so the caller can navigate to the editor. */
export function createProject(name: string, chart: ChartState, hotel?: HotelMeta): string {
  const id = newId();
  const now = Date.now();
  const p: Project = {
    id,
    name: name.trim() || "Untitled",
    chart: { ...chart, title: name.trim() || chart.title || "Untitled" },
    createdAt: now,
    updatedAt: now,
    boxCount: chart.boxes.length,
    connectorCount: chart.connectors.length,
    hotel,
  };
  localStorage.setItem(projectKey(id), JSON.stringify(p));
  const idx = readIndex();
  idx.ids = [id, ...idx.ids.filter((x) => x !== id)];
  writeIndex(idx);
  return id;
}

/** Save edits to an existing project. No-op if the project doesn't
 *  exist (e.g. the user deleted it in another tab). */
export function saveProject(id: string, chart: ChartState, name?: string) {
  const existing = getProject(id);
  if (!existing) return;
  const next: Project = {
    ...existing,
    name: (name ?? chart.title ?? existing.name) || "Untitled",
    chart,
    updatedAt: Date.now(),
    boxCount: chart.boxes.length,
    connectorCount: chart.connectors.length,
  };
  localStorage.setItem(projectKey(id), JSON.stringify(next));
  // Bump to top of recents.
  const idx = readIndex();
  idx.ids = [id, ...idx.ids.filter((x) => x !== id)];
  writeIndex(idx);
}

export function deleteProject(id: string) {
  localStorage.removeItem(projectKey(id));
  const idx = readIndex();
  idx.ids = idx.ids.filter((x) => x !== id);
  writeIndex(idx);
}

export function renameProject(id: string, name: string) {
  const existing = getProject(id);
  if (!existing) return;
  const next: Project = {
    ...existing,
    name: name.trim() || "Untitled",
    chart: { ...existing.chart, title: name.trim() || existing.chart.title },
    updatedAt: Date.now(),
  };
  localStorage.setItem(projectKey(id), JSON.stringify(next));
}

/** Duplicate a project under a new id. The new project is added at
 *  the top of the recents list. */
export function duplicateProject(id: string): string | null {
  const existing = getProject(id);
  if (!existing) return null;
  return createProject(`${existing.name} (copy)`, existing.chart);
}

/** Update the hotel metadata for an existing project (photo, address,
 *  key count, etc.). No-op when the project doesn't exist. */
export function updateProjectHotel(id: string, hotel: HotelMeta) {
  const existing = getProject(id);
  if (!existing) return;
  const next: Project = {
    ...existing,
    hotel,
    updatedAt: Date.now(),
  };
  localStorage.setItem(projectKey(id), JSON.stringify(next));
}
