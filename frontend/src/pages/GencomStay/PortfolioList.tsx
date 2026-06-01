// Portfolio landing — a curated grid of every Gencom property. Seed
// entries from config.ts render instantly; backend entries (added via
// "+ Hotel") override / extend the seed. Each card supports an inline
// photo upload that replaces the monogram placeholder.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { GENCOM_PORTFOLIO } from "./config";
import type { Property } from "./types";
import { deleteProperty, listProperties, uploadHeroImage, upsertProperty } from "./api";
import AddHotelModal from "./AddHotelModal";

export default function PortfolioList() {
  const [backendProps, setBackendProps] = useState<Property[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const reload = useCallback(() => {
    listProperties()
      .then(setBackendProps)
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Merge: backend entries win where IDs collide. Any seed the user hasn't
  // touched stays visible so the page is never empty on first load. Tombstoned
  // entries (hidden: true) drop out of the view entirely.
  const merged = useMemo(() => {
    const byId = new Map<string, Property>();
    for (const p of GENCOM_PORTFOLIO) byId.set(p.id, p);
    for (const p of backendProps) byId.set(p.id, p);
    const seedIds = new Set(GENCOM_PORTFOLIO.map((p) => p.id));
    const seedOrder = GENCOM_PORTFOLIO
      .map((p) => byId.get(p.id)!)
      .filter((p): p is Property => Boolean(p) && !p.hidden);
    const backendOnly = backendProps.filter((p) => !seedIds.has(p.id) && !p.hidden);
    return [...seedOrder, ...backendOnly];
  }, [backendProps]);

  return (
    <div>
      <Header onAddHotel={() => setModalOpen(true)} />

      {!loaded ? (
        <div className="mt-10 text-[13px] text-[#6b6f78]">Loading portfolio…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
          {merged.map((p) => (
            <PropertyCard
              key={p.id}
              property={p}
              isBackend={backendProps.some((b) => b.id === p.id)}
              onImageUploaded={reload}
              onDeleted={reload}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <AddHotelModal
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); reload(); }}
          existingIds={new Set(merged.map((p) => p.id))}
        />
      )}
    </div>
  );
}

function Header({ onAddHotel }: { onAddHotel: () => void }) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.22em] text-[#b89555] font-semibold">
          Gencom Stay
        </div>
        <h1 className="font-serif-display text-4xl md:text-5xl leading-tight mt-2 text-[#1a1d24]">
          The Portfolio
        </h1>
        <p className="text-[15px] leading-relaxed text-[#6b6f78] max-w-xl mt-3">
          A private directory of Gencom-owned and operated hotels. Select a
          property to review owner rates, blocked dates, and to request a
          stay for you or your family.
        </p>
        <div className="mt-5 h-px w-16 bg-[#b89555]" />
      </div>
      <button
        onClick={onAddHotel}
        className="shrink-0 mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-md text-[13px] font-semibold text-white transition"
        style={{ background: "#1a1d24" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2e38")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#1a1d24")}
      >
        <span className="text-base leading-none">+</span>
        <span>Hotel</span>
      </button>
    </header>
  );
}

function PropertyCard({
  property, isBackend, onImageUploaded, onDeleted,
}: {
  property: Property;
  isBackend: boolean;
  onImageUploaded: () => void;
  onDeleted: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onFile(f: File | null) {
    if (!f) return;
    setUploading(true);
    try {
      await uploadHeroImage(property.id, f);
      onImageUploaded();
    } catch (e) {
      alert(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!confirm(`Remove "${property.name}" from the portfolio?`)) return;
    try {
      if (isBackend) {
        await deleteProperty(property.id);
      } else {
        // Seed-only → tombstone via hidden=true so the merge skips it.
        await upsertProperty({ ...property, hidden: true });
      }
      onDeleted();
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
    }
  }

  return (
    <div className="group relative block rounded-lg overflow-hidden bg-white border border-[#ece6d7] transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5">
      <Link to={`properties/${property.id}`} className="block">
        <HeroImage property={property} />
        <div className="p-5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[#b89555] font-semibold">
            {property.brand}
          </div>
          <div className="font-serif-display text-[22px] leading-tight mt-1.5 text-[#1a1d24]">
            {property.name}
          </div>
          <div className="text-[12px] text-[#6b6f78] mt-1 uppercase tracking-wider">
            {property.location}
          </div>
          {property.tagline && (
            <div className="text-[13px] leading-relaxed text-[#4a4d54] mt-3 italic">
              {property.tagline}
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-[#ece6d7] flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.15em] text-[#6b6f78]">
              View property
            </span>
            <span className="text-[#b89555] text-sm group-hover:translate-x-0.5 transition-transform">
              →
            </span>
          </div>
        </div>
      </Link>

      {/* Overlay photo button — not part of the Link so a tap here doesn't
          navigate. Visible on hover on desktop; always visible on touch. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 disabled:opacity-60"
          title="Upload a photo for this property"
        >
          <CameraIcon />
          {uploading ? "Uploading…" : property.heroImage ? "Replace" : "Photo"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-900/70 text-white backdrop-blur-sm hover:bg-red-900"
          title="Remove this property from the portfolio"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8 h3 l2 -2 h8 l2 2 h3 v11 h-18 z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

// ------------------------------------------------------------
// Hero image — uses the provided URL if present, otherwise renders a
// restrained monogram placeholder (property initials on a warm gradient
// with the Gencom gold accent).
// ------------------------------------------------------------
function HeroImage({ property }: { property: Property }) {
  if (property.heroImage) {
    return (
      <div className="relative aspect-[5/3] bg-[#ece6d7] overflow-hidden">
        <img
          src={property.heroImage}
          alt={property.name}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          loading="lazy"
        />
      </div>
    );
  }
  const initials = monogramInitials(property.name);
  return (
    <div
      className="relative aspect-[5/3] flex items-center justify-center"
      style={{
        background:
          "linear-gradient(135deg, #2a2e38 0%, #3c4150 50%, #1a1d24 100%)",
      }}
    >
      <div
        className="font-serif-display text-[80px] leading-none"
        style={{ color: "#b89555", letterSpacing: "-0.02em" }}
      >
        {initials}
      </div>
      <div className="absolute bottom-3 left-5 text-[10px] uppercase tracking-[0.25em] text-white/70">
        Gencom Portfolio
      </div>
    </div>
  );
}

function monogramInitials(name: string): string {
  const stripped = name
    .replace(/^The\s+/i, "")
    .replace(/^(Ritz-Carlton|Four Seasons|InterContinental|Westin|Sheraton|Hyatt|Thompson|Mama Shelter|St\.?\s*Regis|Park Hyatt|Grand Hyatt|Marriott|Hilton|W Hotel)\s+/i, "")
    .trim();
  const target = stripped || name;
  const words = target.split(/\s+|—|-/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return letters || name.slice(0, 2).toUpperCase();
}
