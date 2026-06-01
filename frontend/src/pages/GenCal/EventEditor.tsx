// GenCal — event editor modal. Three flows stacked in tabs:
//
//   1. Manual — single event form (create or edit).
//   2. Excel  — parse a spreadsheet client-side (xlsx) → preview → bulk save.
//   3. PDF    — upload to the backend which asks Claude to extract events.
//
// A single modal handles both "new event" (no initialEvent) and "edit
// existing event" (initialEvent supplied, Manual tab forced, other tabs
// hidden). Delete is wired from the context menu, not the editor.

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  CATEGORY_ORDER, CATEGORY_STYLES, type GenCalCategory,
} from "./categories";
import {
  createEvent, updateEvent, importPdfEvents, type EventPayload, type GenCalEvent,
} from "./api";


type Mode = "manual" | "excel" | "pdf";

export type EventEditorInitial = Partial<EventPayload> & { id?: string };


export default function EventEditor({
  initialEvent, lockedNote, onClose, onSaved,
}: {
  /** Pass an existing event (with id) to edit. Pass just dates to prefill the
   *  manual form for a new event. Omit to start blank. */
  initialEvent?: EventEditorInitial;
  /** Shown in place of Save when the caller has flagged the event as
   *  non-editable (system-generated birthdays/anniversaries, HSHR holidays). */
  lockedNote?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editingId = initialEvent?.id ?? null;
  const [mode, setMode] = useState<Mode>("manual");

  // When editing an existing event, hide Excel / PDF import tabs.
  const showTabs = !editingId;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[720px] max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-[#ece6d7] flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">
              GenCal
            </div>
            <div className="font-serif-display text-[26px] leading-tight mt-0.5 text-[#1a1d24]">
              {editingId ? "Edit event" : "Add event"}
            </div>
          </div>
          <button onClick={onClose} className="text-[#6b6f78] hover:text-[#1a1d24] text-lg leading-none">✕</button>
        </div>

        {showTabs && (
          <div className="px-6 pt-4 flex gap-1 border-b border-[#ece6d7]">
            {(["manual", "excel", "pdf"] as const).map((m) => (
              <TabButton key={m} active={mode === m} onClick={() => setMode(m)}>
                {m === "manual" ? "Manual entry" : m === "excel" ? "Import Excel" : "Import PDF"}
              </TabButton>
            ))}
          </div>
        )}

        <div className="px-6 py-5 overflow-auto flex-1">
          {lockedNote && (
            <div className="mb-4 p-3 rounded-md bg-[#faf7f1] border border-[#ece6d7] text-[12px] text-[#6b6f78]">
              {lockedNote}
            </div>
          )}
          {mode === "manual" && (
            <ManualForm initial={initialEvent} editingId={editingId} onSaved={onSaved} disabled={!!lockedNote} />
          )}
          {mode === "excel" && <ExcelImport onSaved={onSaved} />}
          {mode === "pdf" && <PdfImport onSaved={onSaved} />}
        </div>
      </div>
    </div>
  );
}


function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
// Manual entry (create or edit)
// ------------------------------------------------------------
function nowPlus(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000);
  return toLocalInput(d);
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string {
  if (!v) return new Date().toISOString();
  return new Date(v).toISOString();
}

function ManualForm({
  initial, editingId, onSaved, disabled,
}: {
  initial?: EventEditorInitial;
  editingId: string | null;
  onSaved: () => void;
  disabled?: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<GenCalCategory>(
    (initial?.category as GenCalCategory) ?? "general",
  );
  const [allDay, setAllDay] = useState<boolean>(initial?.all_day ?? false);
  const [startAt, setStartAt] = useState<string>(
    initial?.start_at ? toLocalInput(new Date(initial.start_at)) : nowPlus(60),
  );
  const [endAt, setEndAt] = useState<string>(
    initial?.end_at ? toLocalInput(new Date(initial.end_at)) : nowPlus(120),
  );
  const [location, setLocation] = useState(initial?.location ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!title.trim()) { setError("Title is required."); return; }
    const payload: EventPayload = {
      title: title.trim(),
      category,
      start_at: fromLocalInput(startAt),
      end_at: fromLocalInput(endAt),
      all_day: allDay,
      location: location.trim() || null,
      description: description.trim() || null,
      extras: null,
    };
    setBusy(true);
    try {
      if (editingId) await updateEvent(editingId, payload);
      else await createEvent(payload);
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
        <FormRow label="Title *" className="md:col-span-2">
          <LuxInput value={title} onChange={setTitle} placeholder="Q2 All-Hands, Founder dinner, etc." />
        </FormRow>
        <FormRow label="Category *">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as GenCalCategory)}
            className="w-full px-3 py-2 text-[13px] border border-[#d9d4c8] rounded-md bg-white focus:outline-none focus:border-[#b89555]"
          >
            {CATEGORY_ORDER.filter((c) => c !== "birthday" && c !== "anniversary").map((c) => (
              <option key={c} value={c}>{CATEGORY_STYLES[c].label}</option>
            ))}
          </select>
        </FormRow>
        <FormRow label="All day">
          <label className="flex items-center gap-2 h-[34px] text-sm">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            <span className="text-[#4a4d54]">Runs the full day</span>
          </label>
        </FormRow>
        <FormRow label="Start *">
          <LuxInput type="datetime-local" value={startAt} onChange={setStartAt} />
        </FormRow>
        <FormRow label="End *">
          <LuxInput type="datetime-local" value={endAt} onChange={setEndAt} />
        </FormRow>
        <FormRow label="Location" className="md:col-span-2">
          <LuxInput value={location} onChange={setLocation} placeholder="HQ Boardroom · Teams · 410 Park Ave, NY" />
        </FormRow>
        <FormRow label="Description" className="md:col-span-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-[13px] border border-[#d9d4c8] rounded-md bg-white focus:outline-none focus:border-[#b89555]"
          />
        </FormRow>
      </div>

      {error && <div className="mt-3 text-[12px] text-red-700">{error}</div>}

      <div className="mt-5 flex justify-end gap-2">
        <button
          disabled={busy || disabled}
          onClick={save}
          className="px-5 py-2 rounded-md text-[13px] font-semibold text-white"
          style={{ background: "#1a1d24", opacity: busy || disabled ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : editingId ? "Save changes" : "Add event"}
        </button>
      </div>
    </div>
  );
}


// ------------------------------------------------------------
// Excel import — client-side parsing via xlsx
// ------------------------------------------------------------
// Expected columns (header row, case-insensitive):
//   Title, Category, Start, End, All day, Location, Description
// Category falls back to "general" if the cell is empty or unrecognized.
// Start/End accept ISO or any format new Date() understands. If All day is
// truthy, the row is treated as all-day.

type ExcelDraft = EventPayload & { __error?: string };


function ExcelImport({ onSaved }: { onSaved: () => void }) {
  const [drafts, setDrafts] = useState<ExcelDraft[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const valid = useMemo(() => drafts.filter((d) => !d.__error), [drafts]);

  async function onFile(f: File) {
    setError(null); setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("No sheets in workbook");
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (rows.length === 0) throw new Error("No rows found");
      setDrafts(rows.map(parseRow));
    } catch (e) {
      setError((e as Error).message);
      setDrafts([]);
    }
  }

  async function saveAll() {
    setError(null);
    if (valid.length === 0) { setError("No valid rows to save."); return; }
    setBusy(true);
    try {
      for (const d of valid) {
        const { __error, ...rest } = d;
        void __error;
        await createEvent(rest);
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Title", "Category", "Start", "End", "All day", "Location", "Description"],
      ["Q3 All-Hands", "general", "2026-07-15T10:00", "2026-07-15T12:00", "no", "HQ Boardroom", "Quarterly update from leadership"],
      ["Summer Outing", "party", "2026-06-20", "2026-06-20", "yes", "Soho Beach House, Miami Beach", "Family friendly"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Events");
    XLSX.writeFile(wb, "gencal-events-template.xlsx");
  }

  return (
    <div>
      <p className="text-[12px] text-[#4a4d54] leading-relaxed">
        Upload a spreadsheet with one event per row. Required: <b>Title, Category, Start, End</b>.
        Optional: All day (yes/no), Location, Description.{" "}
        <button onClick={downloadTemplate} className="underline underline-offset-2 text-[#b89555] hover:text-[#1a1d24]">
          Download blank template
        </button>
      </p>

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
        <div className="mt-4 border border-[#ece6d7] rounded-md overflow-hidden max-h-[260px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0" style={{ background: "#faf7f1" }}>
              <tr className="text-left">
                <th className="px-2 py-2">Title</th>
                <th className="px-2 py-2">Category</th>
                <th className="px-2 py-2">Start</th>
                <th className="px-2 py-2">End</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={i} className={`border-t border-[#ece6d7] ${d.__error ? "bg-red-50" : ""}`}>
                  <td className="px-2 py-1">{d.title}{d.__error && <span className="ml-2 text-[10px] text-red-700">· {d.__error}</span>}</td>
                  <td className="px-2 py-1">{d.category}</td>
                  <td className="px-2 py-1 font-mono">{d.start_at}</td>
                  <td className="px-2 py-1 font-mono">{d.end_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          disabled={busy || valid.length === 0}
          onClick={saveAll}
          className="px-5 py-2 rounded-md text-[13px] font-semibold text-white"
          style={{ background: "#1a1d24", opacity: busy || valid.length === 0 ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : `Save ${valid.length} event${valid.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}

function parseRow(row: Record<string, unknown>): ExcelDraft {
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
  const title = pick(["Title", "Event", "Name"]);
  const categoryRaw = pick(["Category", "Type"]).toLowerCase();
  const category: GenCalCategory = (
    (["holiday", "party", "board", "property", "general"] as GenCalCategory[])
      .find((c) => c === categoryRaw) ?? "general"
  );
  const startStr = pick(["Start", "Start Date", "Start At"]);
  const endStr = pick(["End", "End Date", "End At"]);
  const allDayRaw = pick(["All Day", "All-day", "Allday"]).toLowerCase();
  const allDay = ["yes", "y", "true", "1"].includes(allDayRaw);
  const location = pick(["Location", "Where"]);
  const description = pick(["Description", "Details", "Notes"]);

  const start = parseLoose(startStr, allDay, false);
  const end = parseLoose(endStr, allDay, true);

  let err: string | undefined;
  if (!title) err = "Title missing";
  else if (!start || !end) err = "Start/End missing";
  else if (+new Date(end) < +new Date(start)) err = "End before start";

  return {
    title,
    category,
    start_at: start,
    end_at: end,
    all_day: allDay,
    location: location || null,
    description: description || null,
    extras: null,
    __error: err,
  };
}

function parseLoose(s: string, allDay: boolean, isEnd: boolean): string {
  if (!s) return "";
  const hasTime = /\d{1,2}:\d{2}/.test(s);
  const d = new Date(s);
  if (isNaN(+d)) return "";
  if (allDay && !hasTime) {
    // All-day: normalize to midnight / 23:59 local time.
    if (isEnd) d.setHours(23, 59, 0, 0); else d.setHours(0, 0, 0, 0);
  }
  return d.toISOString();
}


// ------------------------------------------------------------
// PDF import — backend Claude endpoint returns event drafts
// ------------------------------------------------------------
function PdfImport({ onSaved }: { onSaved: () => void }) {
  const [drafts, setDrafts] = useState<EventPayload[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onFile(f: File) {
    setError(null); setFileName(f.name); setLoading(true);
    try {
      const events = await importPdfEvents(f);
      setDrafts(events);
      if (events.length === 0) setError("No events extracted from the PDF.");
    } catch (e) {
      setError((e as Error).message);
      setDrafts([]);
    } finally { setLoading(false); }
  }

  async function saveAll() {
    if (drafts.length === 0) return;
    setBusy(true); setError(null);
    try {
      for (const d of drafts) await createEvent(d);
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <p className="text-[12px] text-[#4a4d54] leading-relaxed">
        Upload a PDF that lists events with dates (calendar export, internal schedule, etc).
        Claude reads the document and returns draft events you can review before saving.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="px-4 py-2 rounded-md text-[13px] font-semibold text-white"
          style={{ background: "#1a1d24", opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "Reading…" : "Choose PDF…"}
        </button>
        {fileName && <div className="text-[12px] text-[#6b6f78]">{fileName}{drafts.length ? ` · ${drafts.length} events` : ""}</div>}
      </div>

      {error && <div className="mt-3 text-[12px] text-red-700">{error}</div>}

      {drafts.length > 0 && (
        <div className="mt-4 border border-[#ece6d7] rounded-md overflow-hidden max-h-[260px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0" style={{ background: "#faf7f1" }}>
              <tr className="text-left">
                <th className="px-2 py-2">Title</th>
                <th className="px-2 py-2">Category</th>
                <th className="px-2 py-2">Start</th>
                <th className="px-2 py-2">End</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={i} className="border-t border-[#ece6d7]">
                  <td className="px-2 py-1">{d.title}</td>
                  <td className="px-2 py-1">{d.category}</td>
                  <td className="px-2 py-1 font-mono">{d.start_at}</td>
                  <td className="px-2 py-1 font-mono">{d.end_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          disabled={busy || drafts.length === 0}
          onClick={saveAll}
          className="px-5 py-2 rounded-md text-[13px] font-semibold text-white"
          style={{ background: "#1a1d24", opacity: busy || drafts.length === 0 ? 0.5 : 1 }}
        >
          {busy ? "Saving…" : `Save ${drafts.length} event${drafts.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}


// ------------------------------------------------------------
// Shared bits (kept local so the component file is self-contained)
// ------------------------------------------------------------
function FormRow({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <div className="text-[11px] uppercase tracking-[0.12em] text-[#6b6f78] font-semibold mb-1">{label}</div>
      {children}
    </label>
  );
}

function LuxInput({
  value, onChange, placeholder, type,
}: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type ?? "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-[13px] border border-[#d9d4c8] rounded-md bg-white focus:outline-none focus:border-[#b89555] focus:ring-1 focus:ring-[#b89555]/30"
    />
  );
}

// Unused value-types forwarded so callers can import from this file.
export type { GenCalEvent };
