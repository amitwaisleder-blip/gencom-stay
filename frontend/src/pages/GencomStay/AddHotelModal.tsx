// + Hotel modal — two flows: Manual (a clean form) and Import Excel
// (parsed client-side with the xlsx lib, previewed, then bulk-saved).
//
// Excel template columns (header row required, case-insensitive):
//   Name, Brand, Location, Address, Tagline,
//   Contact Name, Contact Title, Contact Email, Contact Phone,
//   Asset Manager Name, Asset Manager Email,
//   Notes                        (semicolons become separate bullets)
// Anything not in the header row is ignored so partial sheets still work.

import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { bulkUpsert, upsertProperty } from "./api";
import type { Property } from "./types";

type Mode = "manual" | "excel";

export default function AddHotelModal({
  onClose, onSaved, existingIds,
}: {
  onClose: () => void;
  onSaved: () => void;
  existingIds: Set<string>;
}) {
  const [mode, setMode] = useState<Mode>("manual");
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[720px] max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-[#ece6d7] flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">
              Add a hotel
            </div>
            <div className="font-serif-display text-[26px] leading-tight mt-0.5 text-[#1a1d24]">
              Portfolio entry
            </div>
          </div>
          <button onClick={onClose} className="text-[#6b6f78] hover:text-[#1a1d24] text-lg leading-none">✕</button>
        </div>

        <div className="px-6 pt-4 flex gap-1 border-b border-[#ece6d7]">
          <TabButton active={mode === "manual"} onClick={() => setMode("manual")}>Manual entry</TabButton>
          <TabButton active={mode === "excel"} onClick={() => setMode("excel")}>Import from Excel</TabButton>
        </div>

        <div className="px-6 py-5 overflow-auto flex-1">
          {mode === "manual"
            ? <ManualForm existingIds={existingIds} onSaved={onSaved} />
            : <ExcelImport existingIds={existingIds} onSaved={onSaved} />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-[12px] uppercase tracking-[0.15em] font-semibold -mb-px border-b-2 transition"
      style={{
        color: active ? "#1a1d24" : "#6b6f78",
        borderColor: active ? "#b89555" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------
// Manual entry
// ------------------------------------------------------------
type DraftProperty = Property;

function emptyDraft(): DraftProperty {
  return {
    id: "",
    name: "",
    brand: "",
    location: "",
    tagline: "",
    heroImage: null,
    address: "",
    contact: { name: "", title: "", email: "", phone: "" },
    assetManager: { name: "", email: "" },
    rates: [],
    blackoutRanges: [],
    notes: [],
  };
}

function ManualForm({
  existingIds, onSaved,
}: { existingIds: Set<string>; onSaved: () => void }) {
  const [draft, setDraft] = useState<DraftProperty>(emptyDraft());
  const [notesInput, setNotesInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof DraftProperty>(k: K, v: DraftProperty[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  async function save() {
    setError(null);
    if (!draft.name.trim()) { setError("Name is required."); return; }
    if (!draft.brand.trim()) { setError("Brand is required."); return; }
    if (!draft.location.trim()) { setError("Location is required."); return; }

    const id = draft.id.trim() || uniqueSlug(draft.name, existingIds);
    const notesList = notesInput.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const payload: Property = { ...draft, id, notes: notesList };
    setBusy(true);
    try {
      await upsertProperty(payload);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FormRow label="Hotel name *"><input className={INPUT} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="The Four Seasons Miami" /></FormRow>
        <FormRow label="Brand *"><input className={INPUT} value={draft.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Four Seasons" /></FormRow>
        <FormRow label="Location *"><input className={INPUT} value={draft.location} onChange={(e) => set("location", e.target.value)} placeholder="Miami, FL" /></FormRow>
        <FormRow label="Slug (optional)" hint="Auto-generated from name if blank"><input className={INPUT} value={draft.id} onChange={(e) => set("id", e.target.value)} placeholder="four-seasons-miami" /></FormRow>
        <FormRow label="Address" className="md:col-span-2"><input className={INPUT} value={draft.address} onChange={(e) => set("address", e.target.value)} /></FormRow>
        <FormRow label="Tagline" className="md:col-span-2"><input className={INPUT} value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="One-sentence descriptor shown on the card" /></FormRow>
      </div>

      <Section title="Property contact">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormRow label="Name"><input className={INPUT} value={draft.contact.name} onChange={(e) => set("contact", { ...draft.contact, name: e.target.value })} /></FormRow>
          <FormRow label="Title"><input className={INPUT} value={draft.contact.title ?? ""} onChange={(e) => set("contact", { ...draft.contact, title: e.target.value })} /></FormRow>
          <FormRow label="Email"><input type="email" className={INPUT} value={draft.contact.email} onChange={(e) => set("contact", { ...draft.contact, email: e.target.value })} /></FormRow>
          <FormRow label="Phone"><input className={INPUT} value={draft.contact.phone ?? ""} onChange={(e) => set("contact", { ...draft.contact, phone: e.target.value })} /></FormRow>
        </div>
      </Section>

      <Section title="Gencom asset manager">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormRow label="Name"><input className={INPUT} value={draft.assetManager.name} onChange={(e) => set("assetManager", { ...draft.assetManager, name: e.target.value })} /></FormRow>
          <FormRow label="Email"><input type="email" className={INPUT} value={draft.assetManager.email} onChange={(e) => set("assetManager", { ...draft.assetManager, email: e.target.value })} /></FormRow>
        </div>
      </Section>

      <Section title="Notes" subtitle="One bullet per line — shown on the property detail page.">
        <textarea
          className={`${INPUT} min-h-[90px]`}
          value={notesInput}
          onChange={(e) => setNotesInput(e.target.value)}
          placeholder={"Resort fee waived for owner rates.\nValet parking $29/night.\n14-day advance notice required."}
        />
      </Section>

      {error && <div className="mt-3 text-[12px] text-red-700">{error}</div>}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button disabled={busy} onClick={save} className="px-4 py-2 rounded-md text-[13px] font-semibold text-white" style={{ background: "#1a1d24", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : "Save hotel"}
        </button>
      </div>
      <div className="mt-2 text-[11px] text-[#6b6f78]">
        Rates and blackout dates can be added from the property detail page after saving.
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Excel import
// ------------------------------------------------------------
type ParsedDraft = Property & { __error?: string };

function ExcelImport({
  existingIds, onSaved,
}: { existingIds: Set<string>; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<ParsedDraft[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const validCount = useMemo(() => drafts.filter((d) => !d.__error).length, [drafts]);

  async function onFile(f: File) {
    setError(null);
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("No sheets in workbook");
      const sheet = wb.Sheets[sheetName];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (rows.length === 0) throw new Error("No rows found");
      const parsed = rows.map((r) => parseRow(r, existingIds));
      setDrafts(parsed);
    } catch (e) {
      setError(`Couldn't parse "${f.name}": ${(e as Error).message}`);
      setDrafts([]);
    }
  }

  function update(i: number, patch: Partial<ParsedDraft>) {
    setDrafts((ds) => ds.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  }
  function remove(i: number) {
    setDrafts((ds) => ds.filter((_, k) => k !== i));
  }

  async function saveAll() {
    setError(null);
    const valid = drafts.filter((d) => !d.__error);
    if (valid.length === 0) { setError("No valid rows to save."); return; }
    setBusy(true);
    try {
      await bulkUpsert(valid.map(({ __error: _err, ...p }) => p as Property));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="text-[12px] text-[#4a4d54] leading-relaxed">
        Upload a spreadsheet with one hotel per row. Required columns: <span className="font-semibold">Name, Brand, Location</span>.
        Optional: Address, Tagline, Contact Name / Title / Email / Phone, Asset Manager Name / Email, Notes (separate multiple notes with semicolons).
        {" "}
        <button
          onClick={downloadTemplate}
          className="underline underline-offset-2 text-[#b89555] hover:text-[#1a1d24]"
        >
          Download blank template
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 rounded-md text-[13px] font-semibold text-white"
          style={{ background: "#1a1d24" }}
        >
          Choose file…
        </button>
        {fileName && <div className="text-[12px] text-[#6b6f78]">{fileName} · {drafts.length} row{drafts.length === 1 ? "" : "s"}</div>}
      </div>

      {error && <div className="mt-3 text-[12px] text-red-700">{error}</div>}

      {drafts.length > 0 && (
        <div className="mt-4 border border-[#ece6d7] rounded-md overflow-hidden">
          <table className="w-full text-[12px]">
            <thead style={{ background: "#faf7f1" }}>
              <tr className="text-left">
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Brand</th>
                <th className="px-2 py-2">Location</th>
                <th className="px-2 py-2">Contact email</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={i} className={`border-t border-[#ece6d7] ${d.__error ? "bg-red-50" : ""}`}>
                  <td className="px-2 py-1"><input className={INPUT_SM} value={d.name} onChange={(e) => update(i, { name: e.target.value, __error: e.target.value ? undefined : d.__error })} /></td>
                  <td className="px-2 py-1"><input className={INPUT_SM} value={d.brand} onChange={(e) => update(i, { brand: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className={INPUT_SM} value={d.location} onChange={(e) => update(i, { location: e.target.value })} /></td>
                  <td className="px-2 py-1"><input className={INPUT_SM} value={d.contact.email} onChange={(e) => update(i, { contact: { ...d.contact, email: e.target.value } })} /></td>
                  <td className="px-2 py-1 text-right">
                    <button onClick={() => remove(i)} className="text-[#c62828] hover:underline text-[11px]">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {drafts.some((d) => d.__error) && (
            <div className="px-3 py-2 border-t border-[#ece6d7] bg-red-50 text-[11px] text-red-700">
              {drafts.filter((d) => d.__error).length} row(s) have errors and will be skipped.
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          disabled={busy || validCount === 0}
          onClick={saveAll}
          className="px-4 py-2 rounded-md text-[13px] font-semibold text-white"
          style={{ background: "#1a1d24", opacity: busy || validCount === 0 ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : `Save ${validCount} hotel${validCount === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

function parseRow(row: Record<string, unknown>, existingIds: Set<string>): ParsedDraft {
  const pick = (keys: string[]) => {
    for (const k of keys) {
      const hit = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k.toLowerCase());
      if (hit) {
        const v = row[hit];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
      }
    }
    return "";
  };
  const name = pick(["Name", "Hotel", "Hotel Name", "Property", "Property Name"]);
  const brand = pick(["Brand", "Flag"]);
  const location = pick(["Location", "City", "City, State"]);
  const address = pick(["Address", "Street Address"]);
  const tagline = pick(["Tagline", "Description"]);

  const contact = {
    name: pick(["Contact Name", "Contact"]),
    title: pick(["Contact Title", "Title"]) || undefined,
    email: pick(["Contact Email"]),
    phone: pick(["Contact Phone", "Phone"]) || undefined,
  };
  const assetManager = {
    name: pick(["Asset Manager Name", "Asset Manager", "AM Name", "AM"]),
    email: pick(["Asset Manager Email", "AM Email"]),
  };
  const notesRaw = pick(["Notes", "Property Notes"]);
  const notes = notesRaw ? notesRaw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean) : [];

  const slugSource = pick(["Slug", "ID", "Id"]) || name;
  const id = slugSource ? uniqueSlug(slugSource, existingIds) : "";

  let errMsg: string | undefined;
  if (!name) errMsg = "Name missing";
  else if (!brand) errMsg = "Brand missing";
  else if (!location) errMsg = "Location missing";

  return {
    id,
    name,
    brand,
    location,
    tagline,
    heroImage: null,
    address,
    contact,
    assetManager,
    rates: [],
    blackoutRanges: [],
    notes,
    __error: errMsg,
  };
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    [
      "Name", "Brand", "Location", "Address", "Tagline",
      "Contact Name", "Contact Title", "Contact Email", "Contact Phone",
      "Asset Manager Name", "Asset Manager Email",
      "Notes",
    ],
    [
      "The Four Seasons Miami", "Four Seasons", "Miami, FL",
      "1435 Brickell Ave, Miami, FL 33131",
      "Brickell skyline tower with private oasis pool.",
      "Elena Ruiz", "Director of Sales", "elena.ruiz@fourseasons.example", "+1 (305) 358-3535",
      "Ben Dennis", "bdennis@gencomgrp.com",
      "Resort fee waived for owner rates; Valet at $35/night; 14-day notice required",
    ],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Portfolio");
  XLSX.writeFile(wb, "gencom-stay-template.xlsx");
}

// ------------------------------------------------------------
// Shared bits
// ------------------------------------------------------------
const INPUT = "w-full px-3 py-2 text-[13px] border border-[#d9d4c8] rounded-md bg-white focus:outline-none focus:border-[#b89555] focus:ring-1 focus:ring-[#b89555]/30";
const INPUT_SM = "w-full px-2 py-1 text-[12px] border border-[#ece6d7] rounded bg-white focus:outline-none focus:border-[#b89555]";

function FormRow({
  label, hint, className, children,
}: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <div className="text-[11px] uppercase tracking-[0.12em] text-[#6b6f78] font-semibold mb-1">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-[#6b6f78] mt-0.5">{hint}</div>}
    </label>
  );
}

function Section({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 pt-4 border-t border-[#ece6d7]">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[#b89555] font-semibold">{title}</div>
      {subtitle && <div className="text-[11px] text-[#6b6f78] mt-0.5">{subtitle}</div>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function uniqueSlug(seed: string, existing: Set<string>): string {
  const base = seed.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "hotel";
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
