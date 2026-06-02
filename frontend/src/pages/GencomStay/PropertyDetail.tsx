// Property detail — everything a requester needs: property + asset-manager
// contacts, the editable owner / F&F rate table, a 3-month visual blackout
// calendar, property notes, and a "Request a Stay" entry point (Stage 3).
// All edits auto-persist through the backend via upsertProperty.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { GENCOM_PORTFOLIO } from "./config";
import type { BlackoutRange, Property, RoomRate } from "./types";
import { deleteProperty, listProperties, uploadHeroImage, upsertProperty } from "./api";

export default function PropertyDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [property, setProperty] = useState<Property | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backendKnown, setBackendKnown] = useState(false);

  const reload = useCallback(async () => {
    const backend = await listProperties();
    setBackendKnown(backend.some((p) => p.id === id));
    const match = backend.find((p) => p.id === id) ?? GENCOM_PORTFOLIO.find((p) => p.id === id) ?? null;
    setProperty(match);
    setLoaded(true);
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  // Centralized mutate → push to backend → refresh local.
  const update = useCallback(async (patch: Partial<Property>) => {
    if (!property) return;
    const next: Property = { ...property, ...patch };
    setProperty(next);          // optimistic
    setSaving(true);
    try {
      await upsertProperty(next);
      setBackendKnown(true);
    } catch (e) {
      alert(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [property]);

  async function onDelete() {
    if (!property) return;
    const confirmed = confirm(`Remove "${property.name}" from the portfolio? This can be reversed by a developer if needed.`);
    if (!confirmed) return;
    try {
      if (backendKnown) {
        // Real backend row → hard delete.
        await deleteProperty(property.id);
      } else {
        // Seed-only property → write a tombstone so the list hides it.
        await upsertProperty({ ...property, hidden: true });
      }
      navigate("/gencom-stay");
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  }

  async function onUploadPhoto(file: File) {
    if (!property) return;
    try {
      const url = await uploadHeroImage(property.id, file);
      setProperty({ ...property, heroImage: url });
      setBackendKnown(true);
    } catch (e) {
      alert(`Upload failed: ${(e as Error).message}`);
    }
  }

  if (!loaded) return <div className="text-[13px] text-gencom-stone">Loading property…</div>;

  if (!property) {
    return (
      <div>
        <Link to="/gencom-stay" className="text-[12px] uppercase tracking-[0.18em] text-gencom-green">
          ← Back to portfolio
        </Link>
        <div className="mt-6 font-serif-display text-2xl">Property not found.</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between">
        <Link to="/gencom-stay" className="text-[12px] uppercase tracking-[0.18em] text-gencom-green">
          ← Back to portfolio
        </Link>
        <div className="text-[11px] text-gencom-stone h-4">{saving && "Saving…"}</div>
      </div>

      <Hero property={property} onUploadPhoto={onUploadPhoto} />

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-10 mt-10">
        <div>
          <RateSection property={property} update={update} />
          <BlackoutSection property={property} update={update} />
          <NotesSection property={property} update={update} />
        </div>
        <aside className="space-y-6">
          <ContactCard
            title="Property contact"
            subtitle="Request emails route here"
            contact={property.contact}
            onChange={(next) => update({ contact: next })}
          />
          <ContactCard
            title="Gencom asset manager"
            subtitle="Copied on every request"
            contact={{ ...property.assetManager }}
            onChange={(next) => update({ assetManager: { name: next.name, email: next.email } })}
            compact
          />

          <div className="pt-4 border-t border-gencom-sand">
            <button
              onClick={() => navigate(`/gencom-stay/properties/${property.id}/request`)}
              className="btn-primary w-full py-3"
            >
              Request a Stay
            </button>
            <div className="text-[11px] text-gencom-stone text-center mt-1.5">
              Sends to {property.contact.name || "the property"}, CC {property.assetManager.name || "your asset manager"}.
            </div>
          </div>

          <button
            onClick={onDelete}
            className="w-full py-2 rounded-xl text-[12px] font-semibold border"
            style={{ borderColor: "#e4bcbc", color: "#9b2226", background: "#fff" }}
          >
            Delete hotel
          </button>
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Hero — name, brand, location, address, tagline, photo upload
// ------------------------------------------------------------
function Hero({ property, onUploadPhoto }: { property: Property; onUploadPhoto: (f: File) => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="mt-5 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6 items-start">
      <div>
        <div className="text-[11px] uppercase tracking-[0.22em] text-gencom-green font-semibold">
          {property.brand}
        </div>
        <h1 className="font-serif-display text-4xl md:text-5xl leading-tight mt-1 text-gencom-ink">
          {property.name}
        </h1>
        <div className="text-[13px] uppercase tracking-wider text-gencom-stone mt-2">
          {property.location}
        </div>
        {property.address && (
          <div className="text-[13px] text-[#4a4d54] mt-1">{property.address}</div>
        )}
        <div className="mt-3 h-px w-12 bg-gencom-green" />
        {property.tagline && (
          <p className="text-[15px] italic text-[#4a4d54] mt-5 max-w-xl">
            {property.tagline}
          </p>
        )}
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-gencom-sand shadow-card">
        {property.heroImage ? (
          <div className="relative aspect-[5/3] bg-gencom-sand">
            <img src={property.heroImage} alt={property.name} className="absolute inset-0 w-full h-full object-cover" />
          </div>
        ) : (
          <div className="relative aspect-[5/3] flex items-center justify-center" style={{ background: "linear-gradient(135deg, #2a2e38 0%, #3c4150 50%, #1a1d24 100%)" }}>
            <div className="font-serif-display text-[64px] text-gencom-green leading-none">{initials(property.name)}</div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPhoto(f); e.currentTarget.value = ""; }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-black/60 text-white hover:bg-black/80"
        >
          {property.heroImage ? "Replace photo" : "Upload photo"}
        </button>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const stripped = name.replace(/^The\s+/i, "").trim();
  const words = stripped.split(/\s+|—|-/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || name.slice(0, 2).toUpperCase();
}

// ------------------------------------------------------------
// Contact / asset manager card
// ------------------------------------------------------------
function ContactCard({
  title, subtitle, contact, onChange, compact,
}: {
  title: string;
  subtitle: string;
  contact: { name: string; title?: string; email: string; phone?: string };
  onChange: (next: { name: string; title?: string; email: string; phone?: string }) => void;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(contact);
  useEffect(() => { setLocal(contact); }, [contact]);

  function save() {
    onChange(local);
    setEditing(false);
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-gencom-green font-semibold">{title}</div>
          <div className="text-[11px] text-gencom-stone mt-0.5">{subtitle}</div>
        </div>
        <button onClick={() => editing ? save() : setEditing(true)} className="text-[11px] uppercase tracking-[0.12em] font-semibold text-gencom-stone hover:text-gencom-ink">
          {editing ? "Save" : "Edit"}
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {editing ? (
          <>
            <LuxInput value={local.name} onChange={(v) => setLocal({ ...local, name: v })} placeholder="Full name" />
            {!compact && <LuxInput value={local.title ?? ""} onChange={(v) => setLocal({ ...local, title: v })} placeholder="Title" />}
            <LuxInput value={local.email} onChange={(v) => setLocal({ ...local, email: v })} placeholder="Email" type="email" />
            {!compact && <LuxInput value={local.phone ?? ""} onChange={(v) => setLocal({ ...local, phone: v })} placeholder="Phone" />}
          </>
        ) : (
          <>
            <div className="text-[15px] font-semibold text-gencom-ink">{contact.name || <em className="text-gencom-stone not-italic">Not set</em>}</div>
            {!compact && contact.title && <div className="text-[12px] text-gencom-stone">{contact.title}</div>}
            {contact.email && <a href={`mailto:${contact.email}`} className="block text-[13px] text-gencom-green hover:underline">{contact.email}</a>}
            {!compact && contact.phone && <a href={`tel:${contact.phone}`} className="block text-[13px] text-[#4a4d54]">{contact.phone}</a>}
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Rate table — editable rows for the friends-and-family rate by category
// ------------------------------------------------------------
function RateSection({ property, update }: { property: Property; update: (patch: Partial<Property>) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RoomRate[]>(property.rates);
  useEffect(() => { setDraft(property.rates); }, [property.rates]);

  function save() {
    const cleaned = draft
      .filter((r) => r.category.trim())
      .map((r) => ({ ...r, category: r.category.trim(), friendsAndFamilyRate: Math.max(0, Number(r.friendsAndFamilyRate) || 0), notes: r.notes?.trim() || undefined }));
    update({ rates: cleaned });
    setEditing(false);
  }

  return (
    <Section title="Owner / friends & family rates" subtitle="Per-night rates for Gencom team stays.">
      <div className="flex justify-end mb-2 -mt-6">
        <button onClick={() => editing ? save() : setEditing(true)} className="text-[11px] uppercase tracking-[0.12em] font-semibold text-gencom-stone hover:text-gencom-ink">
          {editing ? "Save rates" : "Edit rates"}
        </button>
      </div>
      {editing ? (
        <div className="border border-gencom-sand rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead style={{ background: "#faf7f1" }}>
              <tr className="text-left">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 w-28">Rate (USD)</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {draft.map((r, i) => (
                <tr key={i} className="border-t border-gencom-sand">
                  <td className="px-3 py-1.5"><LuxInput value={r.category} onChange={(v) => setDraft(draft.map((x, k) => k === i ? { ...x, category: v } : x))} placeholder="Deluxe King" /></td>
                  <td className="px-3 py-1.5"><LuxInput type="number" value={String(r.friendsAndFamilyRate)} onChange={(v) => setDraft(draft.map((x, k) => k === i ? { ...x, friendsAndFamilyRate: Number(v) || 0 } : x))} /></td>
                  <td className="px-3 py-1.5"><LuxInput value={r.notes ?? ""} onChange={(v) => setDraft(draft.map((x, k) => k === i ? { ...x, notes: v } : x))} placeholder="Optional — lounge access, view, etc." /></td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => setDraft(draft.filter((_, k) => k !== i))} className="text-[11px] text-[#9b2226] hover:underline">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-gencom-sand text-right">
            <button onClick={() => setDraft([...draft, { category: "", friendsAndFamilyRate: 0 }])} className="text-[12px] uppercase tracking-[0.12em] font-semibold text-gencom-green hover:text-gencom-ink">
              + Add rate
            </button>
          </div>
        </div>
      ) : property.rates.length === 0 ? (
        <div className="text-[13px] text-gencom-stone italic">No rates entered yet. Click "Edit rates" to add the first row.</div>
      ) : (
        <div className="border border-gencom-sand rounded-xl overflow-hidden bg-white">
          <table className="w-full text-[14px]">
            <thead style={{ background: "#faf7f1" }}>
              <tr className="text-left">
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gencom-stone">Category</th>
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gencom-stone text-right">Nightly rate</th>
                <th className="px-4 py-2.5 text-[11px] uppercase tracking-[0.12em] text-gencom-stone">Notes</th>
              </tr>
            </thead>
            <tbody>
              {property.rates.map((r, i) => (
                <tr key={i} className="border-t border-gencom-sand">
                  <td className="px-4 py-2.5 font-semibold text-gencom-ink">{r.category}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-gencom-ink">
                    {r.friendsAndFamilyRate === 0 ? <span className="text-[#248A3D] font-semibold">Complimentary</span> : `$${r.friendsAndFamilyRate.toLocaleString()}`}
                  </td>
                  <td className="px-4 py-2.5 text-gencom-stone">{r.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------
// Blackout calendar — visual 3-month grid + editable range list
// ------------------------------------------------------------
function BlackoutSection({ property, update }: { property: Property; update: (patch: Partial<Property>) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BlackoutRange[]>(property.blackoutRanges);
  useEffect(() => { setDraft(property.blackoutRanges); }, [property.blackoutRanges]);

  // 3 months starting from current month so ranges in the near future are visible.
  const baseMonth = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }, []);
  const months = useMemo(() => [0, 1, 2].map((i) => new Date(baseMonth.getFullYear(), baseMonth.getMonth() + i, 1)), [baseMonth]);

  const blockedSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of property.blackoutRanges) {
      const start = parseISODate(r.start);
      const end = parseISODate(r.end);
      if (!start || !end) continue;
      const d = new Date(start);
      while (d <= end) {
        s.add(iso(d));
        d.setDate(d.getDate() + 1);
      }
    }
    return s;
  }, [property.blackoutRanges]);

  function save() {
    const cleaned = draft
      .filter((r) => r.start && r.end)
      .map((r) => ({ start: r.start, end: r.end, reason: r.reason?.trim() || undefined }));
    update({ blackoutRanges: cleaned });
    setEditing(false);
  }

  return (
    <Section title="Blackout & blocked dates" subtitle="Compression periods, citywide events, and sold-out windows when owner stays are not permitted.">
      <div className="flex justify-end mb-2 -mt-6">
        <button onClick={() => editing ? save() : setEditing(true)} className="text-[11px] uppercase tracking-[0.12em] font-semibold text-gencom-stone hover:text-gencom-ink">
          {editing ? "Save dates" : "Edit dates"}
        </button>
      </div>

      {/* Visual calendar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {months.map((m, i) => <MiniMonth key={i} anchor={m} blocked={blockedSet} />)}
      </div>

      {/* List */}
      {editing ? (
        <div className="border border-gencom-sand rounded-xl bg-white">
          {draft.length === 0 && <div className="px-3 py-3 text-[12px] text-gencom-stone italic">No blackout ranges yet.</div>}
          {draft.map((r, i) => (
            <div key={i} className="px-3 py-2 border-b border-gencom-sand last:border-b-0 grid grid-cols-1 md:grid-cols-[120px_120px_1fr_auto] gap-2 items-center">
              <LuxInput type="date" value={r.start} onChange={(v) => setDraft(draft.map((x, k) => k === i ? { ...x, start: v } : x))} />
              <LuxInput type="date" value={r.end} onChange={(v) => setDraft(draft.map((x, k) => k === i ? { ...x, end: v } : x))} />
              <LuxInput value={r.reason ?? ""} onChange={(v) => setDraft(draft.map((x, k) => k === i ? { ...x, reason: v } : x))} placeholder="Reason (e.g. Jazz Fest)" />
              <button onClick={() => setDraft(draft.filter((_, k) => k !== i))} className="text-[11px] text-[#9b2226] hover:underline">Remove</button>
            </div>
          ))}
          <div className="px-3 py-2 text-right">
            <button onClick={() => setDraft([...draft, { start: iso(new Date()), end: iso(new Date()) }])} className="text-[12px] uppercase tracking-[0.12em] font-semibold text-gencom-green hover:text-gencom-ink">
              + Add blackout range
            </button>
          </div>
        </div>
      ) : property.blackoutRanges.length === 0 ? (
        <div className="text-[13px] text-gencom-stone italic">No blackout dates recorded.</div>
      ) : (
        <ul className="border border-gencom-sand rounded-xl bg-white divide-y divide-gencom-sand">
          {property.blackoutRanges.map((r, i) => (
            <li key={i} className="px-4 py-2.5 flex items-center justify-between">
              <div className="text-[13px] font-mono tabular-nums">
                {fmtDate(r.start)} – {fmtDate(r.end)}
              </div>
              <div className="text-[13px] text-gencom-stone italic">{r.reason ?? ""}</div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function MiniMonth({ anchor, blocked }: { anchor: Date; blocked: Set<string> }) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const first = new Date(y, m, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const label = anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const cells: ({ d: Date; inMonth: boolean } | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push({ d: new Date(y, m, 1 - (startOffset - i)), inMonth: false });
  for (let i = 1; i <= daysInMonth; i++) cells.push({ d: new Date(y, m, i), inMonth: true });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!.d;
    const nd = new Date(last); nd.setDate(nd.getDate() + 1);
    cells.push({ d: nd, inMonth: false });
  }

  return (
    <div className="rounded-xl border border-gencom-sand bg-white p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-gencom-ink mb-2">{label}</div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[9px] uppercase tracking-wider text-gencom-stone mb-1">
        {["S","M","T","W","T","F","S"].map((l, i) => <div key={i}>{l}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const isBlocked = c.inMonth && blocked.has(iso(c.d));
          return (
            <div
              key={i}
              className="aspect-square flex items-center justify-center text-[11px] rounded-sm"
              style={{
                background: isBlocked ? "#1a1d24" : "transparent",
                color: isBlocked ? "#b89555" : c.inMonth ? "#1a1d24" : "#c9c3b1",
                textDecoration: isBlocked ? "line-through" : "none",
                fontWeight: isBlocked ? 600 : 400,
              }}
              title={isBlocked ? "Blocked" : ""}
            >
              {c.d.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Notes
// ------------------------------------------------------------
function NotesSection({ property, update }: { property: Property; update: (patch: Partial<Property>) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(property.notes.join("\n"));
  useEffect(() => { setText(property.notes.join("\n")); }, [property.notes]);

  function save() {
    update({ notes: text.split(/\n+/).map((s) => s.trim()).filter(Boolean) });
    setEditing(false);
  }

  return (
    <Section title="Property notes" subtitle="Resort fees, parking, breakfast, minimum notice — whatever matters for this hotel.">
      <div className="flex justify-end mb-2 -mt-6">
        <button onClick={() => editing ? save() : setEditing(true)} className="text-[11px] uppercase tracking-[0.12em] font-semibold text-gencom-stone hover:text-gencom-ink">
          {editing ? "Save notes" : "Edit notes"}
        </button>
      </div>
      {editing ? (
        <textarea
          className="w-full min-h-[120px] px-3 py-2 text-[13px] border border-gencom-sand rounded-xl bg-white focus:outline-none focus:border-gencom-green focus:ring-1 focus:ring-gencom-green/30"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Resort fee waived for owner rates.\nValet parking $29/night.\n14-day advance notice required."}
        />
      ) : property.notes.length === 0 ? (
        <div className="text-[13px] text-gencom-stone italic">No property notes yet.</div>
      ) : (
        <ul className="space-y-2 text-[14px] text-gencom-ink leading-relaxed">
          {property.notes.map((n, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-gencom-green mt-1.5 shrink-0">•</span>
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ------------------------------------------------------------
// Shared layout + inputs
// ------------------------------------------------------------
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="font-serif-display text-[26px] leading-tight text-gencom-ink">{title}</div>
          {subtitle && <div className="text-[12px] text-gencom-stone mt-0.5">{subtitle}</div>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
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
      className="w-full px-3 py-2 text-[13px] border border-gencom-sand rounded-xl bg-white focus:outline-none focus:border-gencom-green focus:ring-1 focus:ring-gencom-green/30"
    />
  );
}

// ------------------------------------------------------------
// Date helpers — operate on local-time YYYY-MM-DD strings so a blackout
// entered in ET doesn't surprise-shift when rendered in PT.
// ------------------------------------------------------------
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function fmtDate(s: string): string {
  const d = parseISODate(s);
  if (!d) return s;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
