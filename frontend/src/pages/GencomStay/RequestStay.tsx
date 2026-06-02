// Request a stay — full-page form. Stage 3: all fields + field-level
// validation + inline blackout warnings. Submit stays disabled until
// Stage 4 wires the mailto / clipboard email flow.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { GENCOM_PORTFOLIO } from "./config";
import { listProperties } from "./api";
import { buildEmail, type ComposedEmail } from "./email";
import type { BlackoutRange, Property, RequestPurpose } from "./types";

// ------------------------------------------------------------
// Form state
// ------------------------------------------------------------
type DateRange = { checkIn: string; checkOut: string };

type FormState = {
  requesterName: string;
  requesterEmail: string;
  requesterDepartment: string;
  adults: number;
  children: number;
  roomType: string;
  dateRanges: [DateRange, DateRange, DateRange];
  purpose: RequestPurpose;
  purposeOther: string;
  specialRequests: string;
  acknowledged: boolean;
};

function emptyForm(): FormState {
  return {
    requesterName: "",
    requesterEmail: "",
    requesterDepartment: "",
    adults: 2,
    children: 0,
    roomType: "",
    dateRanges: [
      { checkIn: "", checkOut: "" },
      { checkIn: "", checkOut: "" },
      { checkIn: "", checkOut: "" },
    ],
    purpose: "personal",
    purposeOther: "",
    specialRequests: "",
    acknowledged: false,
  };
}

const PURPOSE_OPTIONS: { value: RequestPurpose; label: string }[] = [
  { value: "personal", label: "Personal" },
  { value: "family", label: "Family" },
  { value: "business_adjacent", label: "Business-adjacent" },
  { value: "site_visit", label: "Site visit" },
  { value: "other", label: "Other" },
];


// ------------------------------------------------------------
// Page
// ------------------------------------------------------------
export default function RequestStay() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [property, setProperty] = useState<Property | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [submitted, setSubmitted] = useState<ComposedEmail | null>(null);

  useEffect(() => {
    (async () => {
      const backend = await listProperties();
      const match = backend.find((p) => p.id === id) ?? GENCOM_PORTFOLIO.find((p) => p.id === id) ?? null;
      setProperty(match);
      // Default room type to the first configured rate so the dropdown isn't blank.
      if (match && match.rates.length > 0) {
        setForm((f) => ({ ...f, roomType: match.rates[0].category }));
      }
      setLoaded(true);
    })();
  }, [id]);

  const set = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  }, []);

  function setRange(i: 0 | 1 | 2, patch: Partial<DateRange>) {
    setForm((f) => {
      const next = [...f.dateRanges] as [DateRange, DateRange, DateRange];
      next[i] = { ...next[i], ...patch };
      return { ...f, dateRanges: next };
    });
  }

  const validation = useMemo(() => validate(form), [form]);
  const blackoutHits = useMemo(() => checkBlackouts(form.dateRanges, property?.blackoutRanges ?? []), [form.dateRanges, property]);

  function onSubmit() {
    setAttemptedSubmit(true);
    if (!validation.valid || !form.acknowledged || !property) return;
    const composed = buildEmail({
      requesterName: form.requesterName,
      requesterEmail: form.requesterEmail,
      requesterDepartment: form.requesterDepartment,
      adults: form.adults,
      children: form.children,
      roomType: form.roomType,
      dateRanges: form.dateRanges.filter((r) => r.checkIn && r.checkOut),
      purpose: form.purpose,
      purposeOther: form.purposeOther,
      specialRequests: form.specialRequests,
    }, property);
    setSubmitted(composed);
    // Kick the user's default mail client. We don't rely on this succeeding —
    // the confirmation screen also has the Copy button as a fallback.
    try {
      window.location.href = composed.mailtoUrl;
    } catch { /* clipboard fallback still works */ }
  }

  if (!loaded) return <div className="text-[13px] text-gencom-stone">Loading…</div>;
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

  const canSubmit = validation.valid && form.acknowledged;

  if (submitted) {
    return (
      <Confirmation
        property={property}
        composed={submitted}
        form={form}
        onSendAnother={() => { setSubmitted(null); setAttemptedSubmit(false); }}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between">
        <Link to={`/gencom-stay/properties/${property.id}`} className="text-[12px] uppercase tracking-[0.18em] text-gencom-green">
          ← Back to property
        </Link>
      </div>

      {/* Header */}
      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-gencom-green font-semibold">
          Request a stay
        </div>
        <h1 className="font-serif-display text-4xl md:text-5xl leading-tight mt-1 text-gencom-ink">
          {property.name}
        </h1>
        <div className="text-[13px] uppercase tracking-wider text-gencom-stone mt-2">
          {property.location}
        </div>
        <div className="mt-3 h-px w-12 bg-gencom-green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-10 mt-10">
        <div className="space-y-10">
          <WhoSection form={form} set={set} attempted={attemptedSubmit} validation={validation} />
          <WhenSection
            form={form}
            setRange={setRange}
            blackoutHits={blackoutHits}
            attempted={attemptedSubmit}
            validation={validation}
          />
          <WhySection property={property} form={form} set={set} attempted={attemptedSubmit} validation={validation} />
          <AcknowledgmentSection
            acknowledged={form.acknowledged}
            onChange={(v) => set("acknowledged", v)}
            attempted={attemptedSubmit}
          />
        </div>

        <aside className="space-y-5">
          <Summary property={property} form={form} />
          <div className="p-4 card">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gencom-green font-semibold">Routing</div>
            <div className="mt-2 text-[13px] text-gencom-ink">
              Your request will route to <span className="font-semibold">{property.contact.name || "the property contact"}</span> at {property.name}, with <span className="font-semibold">{property.assetManager.name || "the Gencom asset manager"}</span> copied.
            </div>
          </div>
        </aside>
      </div>

      {/* Submit bar */}
      <div className="mt-10 pt-5 border-t border-gencom-sand flex items-center justify-between gap-3">
        <div className="text-[12px] text-gencom-stone">
          {canSubmit
            ? "Ready. Clicking Send will open your email client with the request pre-filled."
            : attemptedSubmit && validation.errors.length > 0
              ? `${validation.errors.length} field${validation.errors.length === 1 ? "" : "s"} still need attention.`
              : "Fill in the required fields and acknowledge before sending."}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/gencom-stay/properties/${property.id}`)}
            className="btn-ghost px-4 py-2"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            className="btn-primary px-5 py-2"
          >
            Send request
          </button>
        </div>
      </div>
    </div>
  );
}


// ------------------------------------------------------------
// Confirmation — shown after submit. Summarises what was sent,
// reminds the user the property responds directly, and gives a
// clipboard fallback if the mailto didn't open a client.
// ------------------------------------------------------------
function Confirmation({
  property, composed, form, onSendAnother,
}: {
  property: Property;
  composed: ComposedEmail;
  form: FormState;
  onSendAnother: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showFullEmail, setShowFullEmail] = useState(false);
  const filled = form.dateRanges.filter((r) => r.checkIn && r.checkOut);

  async function copy() {
    try {
      await navigator.clipboard.writeText(composed.clipboardText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback for browsers that block clipboard API in an iframe / insecure ctx.
      const ta = document.createElement("textarea");
      ta.value = composed.clipboardText;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no-op */ }
      document.body.removeChild(ta);
    }
  }

  return (
    <div className="max-w-6xl mx-auto animate-fade-in">
      <Link to={`/gencom-stay/properties/${property.id}`} className="text-[12px] uppercase tracking-[0.18em] text-gencom-green">
        ← Back to property
      </Link>

      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-[0.22em] text-gencom-green font-semibold">
          Request sent
        </div>
        <h1 className="font-serif-display text-4xl md:text-5xl leading-tight mt-1 text-gencom-ink">
          Your email is on the way
        </h1>
        <div className="mt-3 h-px w-12 bg-gencom-green" />
        <p className="text-[15px] leading-relaxed text-[#4a4d54] mt-5 max-w-2xl">
          Your default mail client should have opened with the request pre-filled.
          If nothing opened, use the copy button below and paste into a new email.
          {" "}
          <span className="text-gencom-ink font-semibold">
            {property.contact.name || "The property"} will respond directly to confirm availability.
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-10 mt-10">
        <div className="space-y-6">
          <div className="p-5 card">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gencom-green font-semibold">Email</div>
            <dl className="mt-3 text-[13px]">
              <EmailMetaRow label="To" value={composed.to} />
              {composed.cc && <EmailMetaRow label="Cc" value={composed.cc} />}
              <EmailMetaRow label="Subject" value={composed.subject} />
            </dl>
            <div className="mt-4 flex items-center gap-2">
              <a
                href={composed.mailtoUrl}
                className="btn-primary px-4 py-2"
              >
                Re-open in mail client
              </a>
              <button
                onClick={copy}
                className="btn-ghost px-4 py-2"
              >
                {copied ? "Copied" : "Copy email to clipboard"}
              </button>
              <button
                onClick={() => setShowFullEmail((v) => !v)}
                className="ml-auto text-[12px] uppercase tracking-[0.12em] font-semibold text-gencom-stone hover:text-gencom-ink"
              >
                {showFullEmail ? "Hide body" : "Show body"}
              </button>
            </div>
            {showFullEmail && (
              <pre
                className="mt-4 p-3 rounded-xl bg-gencom-cloud border border-gencom-sand text-[12.5px] leading-snug whitespace-pre-wrap font-sans"
                style={{ color: "#1a1d24" }}
              >
                {composed.body}
              </pre>
            )}
          </div>

          <div className="p-5 card">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gencom-green font-semibold">What you asked for</div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <SummaryRow label="Property" value={property.name} />
              <SummaryRow label="Location" value={property.location} />
              <SummaryRow label="Requester" value={`${form.requesterName} · ${form.requesterDepartment}`} />
              <SummaryRow label="Email" value={form.requesterEmail} />
              <SummaryRow label="Guests" value={guestSummary(form.adults, form.children)} />
              <SummaryRow label="Room type" value={form.roomType} />
              <SummaryRow label="Purpose" value={purposeLabel(form.purpose, form.purposeOther)} />
            </div>
            <div className="mt-4 text-[11px] uppercase tracking-[0.12em] text-gencom-stone font-semibold">
              Date preferences
            </div>
            <ul className="mt-2 text-[13px] space-y-1">
              {filled.map((r, i) => (
                <li key={i}>
                  <span className="font-semibold">{ordinal(i)} choice:</span>{" "}
                  {fmtDate(r.checkIn)} – {fmtDate(r.checkOut)}
                </li>
              ))}
            </ul>
            {form.specialRequests.trim() && (
              <>
                <div className="mt-4 text-[11px] uppercase tracking-[0.12em] text-gencom-stone font-semibold">Special requests</div>
                <div className="mt-1 text-[13px] text-gencom-ink whitespace-pre-wrap">{form.specialRequests}</div>
              </>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="p-4 card">
            <div className="text-[10px] uppercase tracking-[0.2em] text-gencom-green font-semibold">What happens next</div>
            <ol className="mt-2 text-[13px] text-gencom-ink list-decimal pl-5 space-y-1.5">
              <li>{property.contact.name || "The property contact"} reviews availability.</li>
              <li>They reply directly to {form.requesterEmail || "you"} with confirmation or an alternate option.</li>
              <li>{property.assetManager.name || "Your asset manager"} is copied on every exchange.</li>
            </ol>
          </div>

          <button
            onClick={onSendAnother}
            className="btn-ghost w-full py-2"
          >
            Edit and resend
          </button>
          <Link
            to="/gencom-stay"
            className="btn-primary w-full py-2"
          >
            Back to portfolio
          </Link>
        </aside>
      </div>
    </div>
  );
}


function EmailMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[60px_1fr] items-baseline py-0.5">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-gencom-stone font-semibold">{label}</dt>
      <dd className="text-[13px] text-gencom-ink break-all">{value}</dd>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-gencom-stone font-semibold">{label}</div>
      <div className="text-[13px] text-gencom-ink">{value || "—"}</div>
    </div>
  );
}

function ordinal(i: number): string {
  return i === 0 ? "1st" : i === 1 ? "2nd" : "3rd";
}

function guestSummary(adults: number, children: number): string {
  const a = `${adults} adult${adults === 1 ? "" : "s"}`;
  if (!children) return a;
  return `${a}, ${children} child${children === 1 ? "" : "ren"}`;
}

function purposeLabel(p: RequestPurpose, other: string): string {
  switch (p) {
    case "personal": return "Personal";
    case "family": return "Family";
    case "business_adjacent": return "Business-adjacent";
    case "site_visit": return "Site visit";
    case "other": return other ? `Other — ${other}` : "Other";
  }
}


// ------------------------------------------------------------
// Sections
// ------------------------------------------------------------
function WhoSection({
  form, set, attempted, validation,
}: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void; attempted: boolean; validation: Validation }) {
  return (
    <Section title="Who" subtitle="Requester contact info — the property will reply to this email.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Full name *" error={attempted && validation.errors.includes("requesterName")}>
          <LuxInput value={form.requesterName} onChange={(v) => set("requesterName", v)} placeholder="Ben Dennis" />
        </Field>
        <Field label="Email *" error={attempted && validation.errors.includes("requesterEmail")}>
          <LuxInput type="email" value={form.requesterEmail} onChange={(v) => set("requesterEmail", v)} placeholder="bdennis@gencomgrp.com" />
        </Field>
        <Field label="Department / role *" className="md:col-span-2" error={attempted && validation.errors.includes("requesterDepartment")}>
          <LuxInput value={form.requesterDepartment} onChange={(v) => set("requesterDepartment", v)} placeholder="Development · Project Manager" />
        </Field>
      </div>
    </Section>
  );
}

function WhenSection({
  form, setRange, blackoutHits, attempted, validation,
}: {
  form: FormState;
  setRange: (i: 0 | 1 | 2, patch: Partial<DateRange>) => void;
  blackoutHits: BlackoutHit[][];
  attempted: boolean;
  validation: Validation;
}) {
  const ranges: Array<{ index: 0 | 1 | 2; label: string; required: boolean }> = [
    { index: 0, label: "1st choice", required: true },
    { index: 1, label: "2nd choice", required: false },
    { index: 2, label: "3rd choice", required: false },
  ];
  return (
    <Section title="When" subtitle="Up to three preferred date ranges, ranked. Offering alternates substantially improves your chance of approval.">
      <div className="space-y-3">
        {ranges.map(({ index, label, required }) => (
          <DateRangeRow
            key={index}
            label={label}
            required={required}
            range={form.dateRanges[index]}
            onChange={(patch) => setRange(index, patch)}
            hits={blackoutHits[index]}
            errorCheckIn={attempted && required && validation.errors.includes(`dateRange${index}CheckIn`)}
            errorCheckOut={attempted && required && validation.errors.includes(`dateRange${index}CheckOut`)}
            errorOrder={attempted && validation.errors.includes(`dateRange${index}Order`)}
          />
        ))}
      </div>
    </Section>
  );
}

function DateRangeRow({
  label, required, range, onChange, hits, errorCheckIn, errorCheckOut, errorOrder,
}: {
  label: string;
  required: boolean;
  range: DateRange;
  onChange: (patch: Partial<DateRange>) => void;
  hits: BlackoutHit[];
  errorCheckIn: boolean;
  errorCheckOut: boolean;
  errorOrder: boolean;
}) {
  return (
    <div className="p-4 rounded-xl border border-gencom-sand bg-white">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] uppercase tracking-[0.15em] font-semibold text-gencom-ink">
          {label}{required && <span className="text-gencom-green"> *</span>}
          {!required && <span className="text-gencom-stone normal-case tracking-normal font-normal"> — strongly encouraged</span>}
        </div>
        {range.checkIn && range.checkOut && !errorOrder && (
          <div className="text-[11px] text-gencom-stone">{nightsBetween(range)} nights</div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Check-in" error={errorCheckIn}>
          <LuxInput type="date" value={range.checkIn} onChange={(v) => onChange({ checkIn: v })} />
        </Field>
        <Field label="Check-out" error={errorCheckOut || errorOrder}>
          <LuxInput type="date" value={range.checkOut} onChange={(v) => onChange({ checkOut: v })} />
        </Field>
      </div>
      {errorOrder && (
        <InlineAlert tone="error">Check-out must be after check-in.</InlineAlert>
      )}
      {hits.length > 0 && (
        <InlineAlert tone="warn">
          These dates overlap a property blackout:
          <ul className="mt-1 ml-4 list-disc">
            {hits.map((h, i) => (
              <li key={i}>
                {fmtRange(h.range)}{h.range.reason ? ` · ${h.range.reason}` : ""}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[11px] opacity-80">
            You can still send this request — the property may be able to accommodate, or you can adjust before sending.
          </div>
        </InlineAlert>
      )}
    </div>
  );
}

function WhySection({
  property, form, set, attempted, validation,
}: {
  property: Property;
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  attempted: boolean;
  validation: Validation;
}) {
  return (
    <Section title="Why" subtitle="Details that help the property prepare the right room and experience.">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Purpose of stay *">
          <select
            value={form.purpose}
            onChange={(e) => set("purpose", e.target.value as RequestPurpose)}
            className="w-full px-3 py-2 text-[13px] border border-gencom-sand rounded-xl bg-white focus:outline-none focus:border-gencom-green"
          >
            {PURPOSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        {form.purpose === "other" && (
          <Field label="Please specify *" error={attempted && validation.errors.includes("purposeOther")}>
            <LuxInput value={form.purposeOther} onChange={(v) => set("purposeOther", v)} placeholder="Describe briefly" />
          </Field>
        )}
        <Field label="Room type preference *" error={attempted && validation.errors.includes("roomType")}>
          {property.rates.length === 0 ? (
            <LuxInput value={form.roomType} onChange={(v) => set("roomType", v)} placeholder="No rates set — type a preference" />
          ) : (
            <select
              value={form.roomType}
              onChange={(e) => set("roomType", e.target.value)}
              className="w-full px-3 py-2 text-[13px] border border-gencom-sand rounded-xl bg-white focus:outline-none focus:border-gencom-green"
            >
              <option value="">Select a category…</option>
              {property.rates.map((r) => (
                <option key={r.category} value={r.category}>
                  {r.category}
                  {r.friendsAndFamilyRate === 0 ? " — Complimentary" : ` — $${r.friendsAndFamilyRate.toLocaleString()}/night`}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Adults *" error={attempted && validation.errors.includes("adults")}>
          <LuxInput type="number" value={String(form.adults)} onChange={(v) => set("adults", Math.max(0, Number(v) || 0))} />
        </Field>
        <Field label="Children">
          <LuxInput type="number" value={String(form.children)} onChange={(v) => set("children", Math.max(0, Number(v) || 0))} />
        </Field>
        <Field label="Special requests" className="md:col-span-2">
          <textarea
            value={form.specialRequests}
            onChange={(e) => set("specialRequests", e.target.value)}
            placeholder="Dietary restrictions, accessibility needs, anniversary or birthday celebrations, anything the property should know."
            className="w-full min-h-[90px] px-3 py-2 text-[13px] border border-gencom-sand rounded-xl bg-white focus:outline-none focus:border-gencom-green"
          />
        </Field>
      </div>
    </Section>
  );
}

function AcknowledgmentSection({
  acknowledged, onChange, attempted,
}: { acknowledged: boolean; onChange: (v: boolean) => void; attempted: boolean }) {
  const missing = attempted && !acknowledged;
  return (
    <div className={`p-4 rounded-xl border ${missing ? "border-[#c62828] bg-red-50" : "border-gencom-sand bg-white"}`}>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 accent-gencom-green"
        />
        <div className="text-[13px] leading-relaxed text-gencom-ink">
          I understand this is a request subject to availability and owner rate policy, and is not confirmed until the property responds.
        </div>
      </label>
    </div>
  );
}

function Summary({ property, form }: { property: Property; form: FormState }) {
  const first = form.dateRanges[0];
  return (
    <div className="p-4 card">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gencom-green font-semibold">Summary</div>
      <div className="mt-2 font-serif-display text-[20px] leading-tight">{property.name}</div>
      <div className="text-[11px] uppercase tracking-wider text-gencom-stone mt-1">{property.location}</div>
      <div className="mt-3 text-[13px] text-gencom-ink space-y-1">
        <div>{form.requesterName || <span className="text-gencom-stone/70">Requester name —</span>}</div>
        <div>{form.roomType || <span className="text-gencom-stone/70">Room type —</span>}</div>
        <div>{form.adults + form.children > 0 ? `${form.adults} adult${form.adults === 1 ? "" : "s"}${form.children ? `, ${form.children} child${form.children === 1 ? "" : "ren"}` : ""}` : <span className="text-gencom-stone/70">Guests —</span>}</div>
        <div>
          {first.checkIn && first.checkOut
            ? `${fmtDate(first.checkIn)} – ${fmtDate(first.checkOut)}`
            : <span className="text-gencom-stone/70">1st-choice dates —</span>}
        </div>
      </div>
    </div>
  );
}


// ------------------------------------------------------------
// Validation + blackout overlap
// ------------------------------------------------------------
type Validation = { valid: boolean; errors: string[] };
type BlackoutHit = { range: BlackoutRange };

function validate(f: FormState): Validation {
  const errors: string[] = [];
  if (!f.requesterName.trim()) errors.push("requesterName");
  if (!validEmail(f.requesterEmail)) errors.push("requesterEmail");
  if (!f.requesterDepartment.trim()) errors.push("requesterDepartment");
  if (f.adults < 1) errors.push("adults");
  if (!f.roomType.trim()) errors.push("roomType");
  if (f.purpose === "other" && !f.purposeOther.trim()) errors.push("purposeOther");

  // 1st-choice dates required.
  if (!f.dateRanges[0].checkIn) errors.push("dateRange0CheckIn");
  if (!f.dateRanges[0].checkOut) errors.push("dateRange0CheckOut");
  // Check-out must be after check-in for any range that has both dates filled.
  f.dateRanges.forEach((r, i) => {
    if (r.checkIn && r.checkOut && r.checkIn >= r.checkOut) errors.push(`dateRange${i}Order`);
  });

  return { valid: errors.length === 0, errors };
}

function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function checkBlackouts(
  ranges: DateRange[],
  blackouts: BlackoutRange[],
): BlackoutHit[][] {
  return ranges.map((r) => {
    if (!r.checkIn || !r.checkOut) return [];
    const hits: BlackoutHit[] = [];
    for (const b of blackouts) {
      if (rangesOverlap(r.checkIn, r.checkOut, b.start, b.end)) {
        hits.push({ range: b });
      }
    }
    return hits;
  });
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart < aEnd;
}

function nightsBetween(r: DateRange): number {
  const a = new Date(r.checkIn);
  const b = new Date(r.checkOut);
  if (isNaN(+a) || isNaN(+b)) return 0;
  return Math.max(0, Math.round((+b - +a) / 86400000));
}


// ------------------------------------------------------------
// Shared bits
// ------------------------------------------------------------
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="font-serif-display text-[26px] leading-tight text-gencom-ink">{title}</div>
      {subtitle && <div className="text-[12px] text-gencom-stone mt-0.5 max-w-xl">{subtitle}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label, error, className, children,
}: { label: string; error?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <div className={`text-[11px] uppercase tracking-[0.12em] font-semibold mb-1 ${error ? "text-[#c62828]" : "text-gencom-stone"}`}>
        {label}
      </div>
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
      className="w-full px-3 py-2 text-[13px] border border-gencom-sand rounded-xl bg-white focus:outline-none focus:border-gencom-green focus:ring-1 focus:ring-gencom-green/30"
    />
  );
}

function InlineAlert({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  const style = tone === "warn"
    ? { bg: "#fdf4e3", border: "#e6c36a", color: "#78551b" }
    : { bg: "#fdecec", border: "#e5a4a4", color: "#9b2226" };
  return (
    <div className="mt-2 p-2.5 rounded-xl text-[12px] leading-snug" style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}>
      {children}
    </div>
  );
}

function fmtDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtRange(r: BlackoutRange): string {
  return `${fmtDate(r.start)} – ${fmtDate(r.end)}`;
}
