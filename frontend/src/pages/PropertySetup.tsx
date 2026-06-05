import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PropertyNav from "../components/PropertyNav";
import UploadExtractPanel from "../components/UploadExtractPanel";
import { api, type Property } from "../lib/api";
import { ROOM_TYPES, totalKeys, type GuestroomMix } from "../lib/guestroomTemplates";

const SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "building", label: "Building" },
  { id: "fb", label: "F&B and Amenities" },
  { id: "systems", label: "Building Systems" },
  { id: "docs", label: "Documents Available" },
  { id: "walk", label: "Walk Info" },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

export default function PropertySetup() {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [section, setSection] = useState<SectionId>("basics");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    api.getProperty(id).then(setProperty);
  }, [id]);

  function set<K extends keyof Property>(key: K, value: Property[K]) {
    setProperty((p) => (p ? { ...p, [key]: value } : p));
    setDirty(true);
  }

  async function save() {
    if (!property || !id) return;
    setSaving(true);
    try {
      const saved = await api.updateProperty(id, property);
      setProperty(saved);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  if (!property) return <div className="text-gencom-stone">Loading…</div>;

  return (
    <div>
      <PropertyNav />

      {/* Upload & Extract panel — top of Setup. Drops a PIP/OM here and the
          extractor populates the rest of the form below. */}
      <UploadExtractPanel
        propertyId={id!}
        onExtracted={async () => {
          // Reload property after extraction so the form reflects new fields.
          if (id) {
            const fresh = await api.getProperty(id);
            setProperty(fresh);
          }
        }}
      />

      {/* Critical info prompt — any required field still missing/blank after
          extraction triggers a quick-fill banner. This handler sends the
          patch directly so it doesn't rely on a post-setState stale closure. */}
      <MissingCriticalBanner property={property} onSaveField={async (key, value) => {
        if (!id) return;
        setSaving(true);
        try {
          const updated = await api.updateProperty(id, { [key]: value } as any);
          setProperty(updated);
        } finally {
          setSaving(false);
        }
      }} />

      <div className="mb-6 flex items-center justify-between gap-4">
        <input
          type="text"
          value={property.name ?? ""}
          placeholder="Property name"
          onChange={(e) => set("name", e.target.value)}
          onBlur={save}
          className="font-display text-3xl bg-transparent border-b border-transparent focus:border-gencom-sand outline-none flex-1 max-w-xl"
        />
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="bg-gencom-ink text-gencom-mist px-4 py-2 rounded-md text-sm disabled:opacity-40"
          >
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
          <button
            onClick={() => navigate(`/properties/${id}/scope`)}
            className="border border-gencom-sand px-4 py-2 rounded-md text-sm hover:bg-white"
          >
            Continue to Scope →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
        <nav className="space-y-1 text-sm">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`w-full text-left px-3 py-2 rounded-md ${
                section === s.id ? "bg-gencom-ink text-gencom-mist" : "text-gencom-stone hover:bg-white"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="bg-white border border-gencom-sand rounded-lg p-6">
          {section === "basics" && (
            <BasicsForm property={property} set={set} onBlur={save} />
          )}
          {section === "building" && (
            <BuildingForm property={property} set={set} onBlur={save} />
          )}
          {section === "fb" && <FBForm property={property} set={set} onBlur={save} />}
          {section === "systems" && <SystemsForm property={property} set={set} onBlur={save} />}
          {section === "docs" && <DocsForm property={property} set={set} onBlur={save} />}
          {section === "walk" && <WalkForm property={property} set={set} onBlur={save} />}
        </div>
      </div>
    </div>
  );
}

type FormProps = {
  property: Property;
  set: <K extends keyof Property>(key: K, value: Property[K]) => void;
  onBlur: () => void;
};

function Field(props: {
  label: string;
  children: React.ReactNode;
  provenance?: Property["field_provenance"] extends infer P ? (P extends null | undefined ? never : any) : never;
  span?: 1 | 2 | 3;
}) {
  const span = props.span ?? 1;
  return (
    <label className={`flex flex-col gap-1 text-sm ${span === 2 ? "md:col-span-2" : span === 3 ? "md:col-span-3" : ""}`}>
      <span className="text-gencom-stone">{props.label}</span>
      {props.children}
    </label>
  );
}

const inputCls =
  "border border-gencom-sand rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gencom-gold/40";

function BasicsForm({ property, set, onBlur }: FormProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field label="Address" span={3}>
        <input className={inputCls} value={property.address ?? ""} onChange={(e) => set("address", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="City">
        <input className={inputCls} value={property.city ?? ""} onChange={(e) => set("city", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="State">
        <input className={inputCls} value={property.state ?? ""} onChange={(e) => set("state", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="Country">
        <input className={inputCls} value={property.country ?? ""} onChange={(e) => set("country", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="Current brand">
        <input className={inputCls} value={property.current_brand ?? ""} onChange={(e) => set("current_brand", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="Current flag">
        <input className={inputCls} value={property.current_flag ?? ""} onChange={(e) => set("current_flag", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="Target brand">
        <input className={inputCls} value={property.target_brand ?? ""} onChange={(e) => set("target_brand", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="Target flag">
        <input className={inputCls} value={property.target_flag ?? ""} onChange={(e) => set("target_flag", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="Target brand tier">
        <select
          className={inputCls}
          value={property.target_brand_tier ?? ""}
          onChange={(e) => set("target_brand_tier", e.target.value || null)}
          onBlur={onBlur}
        >
          <option value="">—</option>
          <option value="luxury">Luxury</option>
          <option value="upper_upscale">Upper-upscale</option>
          <option value="upscale">Upscale</option>
        </select>
      </Field>
      <Field label="Property type">
        <select
          className={inputCls}
          value={property.property_type ?? ""}
          onChange={(e) => set("property_type", e.target.value || null)}
          onBlur={onBlur}
        >
          <option value="">—</option>
          <option>full-service</option>
          <option>select-service</option>
          <option>resort</option>
          <option>limited-service</option>
          <option>extended-stay</option>
          <option>boutique</option>
        </select>
      </Field>
      <Field label="Year built">
        <input type="number" className={inputCls} value={property.year_built ?? ""} onChange={(e) => set("year_built", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Year last renovated">
        <input type="number" className={inputCls} value={property.year_last_renovated ?? ""} onChange={(e) => set("year_last_renovated", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Keys">
        <input type="number" className={inputCls} value={property.keys ?? ""} onChange={(e) => set("keys", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <GuestroomMatrix property={property} set={set} onBlur={onBlur} />
      <Field label="Deal notes" span={3}>
        <textarea rows={3} className={inputCls} value={property.deal_notes ?? ""} onChange={(e) => set("deal_notes", e.target.value)} onBlur={onBlur} />
      </Field>
    </div>
  );
}

function GuestroomMatrix({ property, set, onBlur }: FormProps) {
  const mix: GuestroomMix = (property.guestroom_mix as GuestroomMix) ?? {};
  const total = totalKeys(mix);
  const hasMix = Object.values(mix).some((v) => typeof v === "number" && v > 0);
  const keysMismatch = hasMix && property.keys != null && total !== property.keys;

  function updateRoom(key: keyof GuestroomMix, value: string) {
    const n = value === "" ? undefined : Number(value);
    const next = { ...mix };
    if (n === undefined || isNaN(n)) delete (next as any)[key];
    else (next as any)[key] = n;
    set("guestroom_mix", next as any);
  }

  function syncKeysToMatrix() {
    set("keys", total);
    onBlur();
  }

  return (
    <div className="md:col-span-3 mt-2">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm font-medium">Guestroom matrix</div>
        <div className="text-xs text-gencom-stone">
          Populates scope qty automatically. Total:{" "}
          <b className={keysMismatch ? "text-amber-700" : ""}>{total}</b>
          {keysMismatch && (
            <>
              {" "}vs Keys <b>{property.keys}</b>{" "}
              <button type="button" onClick={syncKeysToMatrix} className="text-gencom-gold hover:underline ml-1">
                sync →
              </button>
            </>
          )}
        </div>
      </div>
      <div className="bg-gencom-mist/40 border border-gencom-sand rounded-md p-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ROOM_TYPES.map((rt) => (
            <label key={rt.key} className="flex flex-col gap-1 text-xs">
              <span className="text-gencom-stone">{rt.label}</span>
              <input
                type="number"
                min="0"
                value={(mix as any)[rt.key] ?? ""}
                onChange={(e) => updateRoom(rt.key, e.target.value)}
                onBlur={onBlur}
                placeholder="0"
                className="border border-gencom-sand rounded-md px-2 py-1.5 bg-white"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function BuildingForm({ property, set, onBlur }: FormProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field label="Floors">
        <input type="number" className={inputCls} value={property.floors ?? ""} onChange={(e) => set("floors", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Towers">
        <input type="number" className={inputCls} value={property.towers ?? ""} onChange={(e) => set("towers", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Total GSF">
        <input type="number" className={inputCls} value={property.total_gsf ?? ""} onChange={(e) => set("total_gsf", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Envelope notes" span={3}>
        <textarea rows={2} className={inputCls} value={property.envelope_notes ?? ""} onChange={(e) => set("envelope_notes", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="Roof type">
        <input className={inputCls} value={property.roof_type ?? ""} onChange={(e) => set("roof_type", e.target.value)} onBlur={onBlur} />
      </Field>
      <Field label="Roof age (years)">
        <input type="number" className={inputCls} value={property.roof_age ?? ""} onChange={(e) => set("roof_age", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Passenger elevators">
        <input type="number" className={inputCls} value={property.passenger_elevators ?? ""} onChange={(e) => set("passenger_elevators", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Service elevators">
        <input type="number" className={inputCls} value={property.service_elevators ?? ""} onChange={(e) => set("service_elevators", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Elevator mod. status" span={2}>
        <select
          className={inputCls}
          value={property.elevator_modernization_status ?? ""}
          onChange={(e) => set("elevator_modernization_status", e.target.value || null)}
          onBlur={onBlur}
        >
          <option value="">—</option>
          <option value="original">Original</option>
          <option value="partial">Partial mod</option>
          <option value="fully_modernized">Fully modernized</option>
          <option value="unknown">Unknown</option>
        </select>
      </Field>
    </div>
  );
}

function FBForm({ property, set, onBlur }: FormProps) {
  const meeting = property.meeting_space_json ?? {};
  const pools = property.pools_json ?? {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field label="Ballroom sqft">
        <input type="number" className={inputCls} value={meeting.ballroom_sqft ?? ""} onChange={(e) => set("meeting_space_json", { ...meeting, ballroom_sqft: e.target.value ? Number(e.target.value) : undefined })} onBlur={onBlur} />
      </Field>
      <Field label="# Breakouts">
        <input type="number" className={inputCls} value={meeting.breakout_count ?? ""} onChange={(e) => set("meeting_space_json", { ...meeting, breakout_count: e.target.value ? Number(e.target.value) : undefined })} onBlur={onBlur} />
      </Field>
      <Field label="Largest breakout sqft">
        <input type="number" className={inputCls} value={meeting.largest_breakout_sqft ?? ""} onChange={(e) => set("meeting_space_json", { ...meeting, largest_breakout_sqft: e.target.value ? Number(e.target.value) : undefined })} onBlur={onBlur} />
      </Field>
      <Field label="Pool count">
        <input type="number" className={inputCls} value={pools.count ?? ""} onChange={(e) => set("pools_json", { ...pools, count: e.target.value ? Number(e.target.value) : undefined })} onBlur={onBlur} />
      </Field>
      <Field label="Pool type">
        <input className={inputCls} value={pools.type ?? ""} onChange={(e) => set("pools_json", { ...pools, type: e.target.value })} onBlur={onBlur} />
      </Field>
      <Field label="Spa treatment rooms">
        <input type="number" className={inputCls} value={property.spa_treatment_rooms ?? ""} onChange={(e) => set("spa_treatment_rooms", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Fitness sqft">
        <input type="number" className={inputCls} value={property.fitness_sqft ?? ""} onChange={(e) => set("fitness_sqft", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      <Field label="Parking type">
        <select className={inputCls} value={property.parking_type ?? ""} onChange={(e) => set("parking_type", e.target.value || null)} onBlur={onBlur}>
          <option value="">—</option>
          <option value="self">Self</option>
          <option value="valet">Valet</option>
          <option value="both">Both</option>
        </select>
      </Field>
      <Field label="Parking spaces">
        <input type="number" className={inputCls} value={property.parking_spaces ?? ""} onChange={(e) => set("parking_spaces", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
    </div>
  );
}

function SystemsForm({ property, set, onBlur }: FormProps) {
  const mep = property.mep_json ?? {};
  const isFL = property.state?.toUpperCase() === "FL";
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Field label="Chiller plant age (yrs)">
        <input type="number" className={inputCls} value={mep.chiller_age ?? ""} onChange={(e) => set("mep_json", { ...mep, chiller_age: e.target.value ? Number(e.target.value) : undefined })} onBlur={onBlur} />
      </Field>
      <Field label="Boiler plant age (yrs)">
        <input type="number" className={inputCls} value={mep.boiler_age ?? ""} onChange={(e) => set("mep_json", { ...mep, boiler_age: e.target.value ? Number(e.target.value) : undefined })} onBlur={onBlur} />
      </Field>
      <Field label="MEP other notes">
        <input className={inputCls} value={mep.other ?? ""} onChange={(e) => set("mep_json", { ...mep, other: e.target.value })} onBlur={onBlur} />
      </Field>
      <Field label="Sprinklered">
        <select
          className={inputCls}
          value={property.sprinklered == null ? "" : property.sprinklered ? "yes" : "no"}
          onChange={(e) => set("sprinklered", e.target.value === "" ? null : e.target.value === "yes")}
          onBlur={onBlur}
        >
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <Field label="Fire alarm age (yrs)">
        <input type="number" className={inputCls} value={property.fire_alarm_age ?? ""} onChange={(e) => set("fire_alarm_age", e.target.value ? Number(e.target.value) : null)} onBlur={onBlur} />
      </Field>
      {isFL && (
        <Field label="FL recertification status">
          <select className={inputCls} value={property.fl_recert_status ?? ""} onChange={(e) => set("fl_recert_status", e.target.value || null)} onBlur={onBlur}>
            <option value="">—</option>
            <option value="not_started">Not started</option>
            <option value="inspection_complete">Inspection complete</option>
            <option value="in_remediation">In remediation</option>
            <option value="complete">Complete</option>
            <option value="na">N/A</option>
          </select>
        </Field>
      )}
    </div>
  );
}

function DocsForm({ property, set, onBlur }: FormProps) {
  const docs = property.documents_available ?? {};
  const docKeys = ["site_plan", "survey", "as_builts", "arch_drawings", "om"] as const;
  function update(key: string, partial: Partial<{ available: boolean; link: string }>) {
    set("documents_available", {
      ...docs,
      [key]: { ...(docs[key] ?? { available: false }), ...partial },
    });
  }
  return (
    <div className="space-y-3">
      {docKeys.map((k) => {
        const d = docs[k] ?? { available: false };
        return (
          <div key={k} className="flex items-center gap-4 border border-gencom-sand rounded-md p-3">
            <label className="flex items-center gap-2 min-w-[180px]">
              <input type="checkbox" checked={!!d.available} onChange={(e) => update(k, { available: e.target.checked })} onBlur={onBlur} />
              <span className="capitalize">{k.replaceAll("_", " ")}</span>
            </label>
            <input
              placeholder="Link or file path"
              className={`${inputCls} flex-1`}
              value={d.link ?? ""}
              onChange={(e) => update(k, { link: e.target.value })}
              onBlur={onBlur}
            />
          </div>
        );
      })}
      <Field label="Matterport URL">
        <input className={inputCls} value={property.matterport_url ?? ""} onChange={(e) => set("matterport_url", e.target.value)} onBlur={onBlur} />
      </Field>
    </div>
  );
}

function WalkForm({ property, set, onBlur }: FormProps) {
  const datesStr = (property.walk_dates ?? []).join(", ");
  const peopleStr = (property.walk_attendees ?? []).join(", ");
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Walk dates (comma-separated)">
        <input
          className={inputCls}
          value={datesStr}
          onChange={(e) => set("walk_dates", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          onBlur={onBlur}
          placeholder="2025-03-12, 2025-03-28"
        />
      </Field>
      <Field label="People on the walk">
        <input
          className={inputCls}
          value={peopleStr}
          onChange={(e) => set("walk_attendees", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          onBlur={onBlur}
          placeholder="BD, Jane Smith"
        />
      </Field>
    </div>
  );
}

// ─── Missing critical info banner ──────────────────────────────────────
// Shown at the top of Setup when key fields are still missing after
// extraction (or manual entry). Lets the user fill them inline.
const CRITICAL_FIELDS: Array<{
  key: keyof Property;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
}> = [
  { key: "name", label: "Property name", type: "text" },
  { key: "address", label: "Address", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "keys", label: "Keys", type: "number" },
  { key: "current_brand", label: "Current brand", type: "text" },
  { key: "target_brand", label: "Target brand", type: "text" },
  { key: "target_brand_tier", label: "Brand tier", type: "select",
    options: ["luxury", "upper_upscale", "upscale"] },
  { key: "property_type", label: "Property type", type: "select",
    options: ["full-service", "select-service", "resort", "limited-service", "extended-stay", "boutique"] },
];

function isMissing(property: Property, key: keyof Property): boolean {
  const v = property[key];
  if (v == null || v === "") return true;
  if (typeof v === "string" && (v.trim() === "" || v.trim().toLowerCase() === "untitled deal")) return true;
  return false;
}

function MissingCriticalBanner({
  property,
  onSaveField,
}: {
  property: Property;
  onSaveField: <K extends keyof Property>(key: K, value: Property[K]) => Promise<void> | void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const missing = useMemo(
    () => CRITICAL_FIELDS.filter((f) => isMissing(property, f.key)),
    [property]
  );

  if (dismissed || missing.length === 0) return null;

  return (
    <div className="mb-6 bg-amber-50 border border-amber-400 rounded-lg p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="font-display text-lg text-amber-900">
            Critical info still needed
          </div>
          <div className="text-xs text-amber-800">
            These fields weren't found in the uploaded documents. Fill them in
            here — or scroll down to Basics if you need more context.
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-800 hover:text-amber-900 text-xl leading-none"
          title="Dismiss (you can still see the fields in Basics below)"
        >
          ×
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {missing.map((f) => (
          <label key={String(f.key)} className="flex flex-col gap-1 text-xs">
            <span className="text-amber-900 font-medium">{f.label}</span>
            {f.type === "select" ? (
              <select
                className="border border-amber-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value === "") return;
                  onSaveField(f.key, e.target.value as any);
                }}
              >
                <option value="">Select…</option>
                {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={f.type}
                placeholder={f.label}
                className="border border-amber-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (raw === "") return;
                  const v: any = f.type === "number" ? Number(raw) : raw;
                  if (f.type === "number" && isNaN(v)) return;
                  onSaveField(f.key, v);
                }}
              />
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
