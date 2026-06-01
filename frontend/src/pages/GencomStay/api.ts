// Gencom Stay — backend API helpers. Properties persist server-side; the
// seed config (config.ts) is shown when the backend has no entries yet.

import type { Property } from "./types";

export async function listProperties(): Promise<Property[]> {
  const r = await fetch("/api/gencom-stay/properties");
  if (!r.ok) return [];
  return (await r.json()) as Property[];
}

export async function upsertProperty(p: Property): Promise<Property> {
  const r = await fetch(`/api/gencom-stay/properties/${encodeURIComponent(p.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as Property;
}

export async function deleteProperty(id: string): Promise<void> {
  await fetch(`/api/gencom-stay/properties/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function bulkUpsert(properties: Property[]): Promise<Property[]> {
  const r = await fetch("/api/gencom-stay/properties/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j = await r.json();
  return (j.properties ?? []) as Property[];
}

export async function uploadHeroImage(propertyId: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`/api/gencom-stay/properties/${encodeURIComponent(propertyId)}/image`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.url as string;
}
