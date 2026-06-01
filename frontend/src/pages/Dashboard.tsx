import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatMoney, relativeDate, type PropertyCard } from "../lib/api";

export default function Dashboard() {
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [cards, setCards] = useState<PropertyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const navigate = useNavigate();

  async function refresh() {
    setLoading(true);
    try {
      const rows = await api.listProperties(tab === "archived");
      setCards(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [tab]);

  async function handleNew() {
    const p = await api.createProperty({ name: "Untitled deal" });
    // Intake questionnaire was retired — new deals land directly on Setup.
    navigate(`/properties/${p.id}/setup`);
  }

  async function handleArchive(id: string) {
    await api.archiveProperty(id);
    setMenuOpen(null);
    refresh();
  }

  async function handleRestore(id: string) {
    await api.restoreProperty(id);
    setMenuOpen(null);
    refresh();
  }

  async function handleDuplicate(id: string) {
    const p = await api.duplicateProperty(id);
    setMenuOpen(null);
    navigate(`/properties/${p.id}/setup`);
  }

  async function handleDelete(id: string, name: string | null) {
    if (!confirm(`Permanently delete "${name ?? "Untitled deal"}"? This cannot be undone.`)) return;
    await api.deleteProperty(id);
    setMenuOpen(null);
    refresh();
  }

  async function handleThumbnailUpload(id: string, file: File) {
    await api.uploadThumbnail(id, file);
    setMenuOpen(null);
    refresh();
  }

  async function handleThumbnailDelete(id: string) {
    if (!confirm("Remove this property's photo?")) return;
    await api.deleteThumbnail(id);
    setMenuOpen(null);
    refresh();
  }

  return (
    <div>
      <div className="mb-3 text-sm text-gencom-stone">
        <Link to="/" className="hover:text-gencom-ink">Home</Link>
        {" / "}<span>Full Budget Generator</span>
      </div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex gap-1 rounded-lg bg-white p-1 shadow-sm border border-gencom-sand">
          <button
            onClick={() => setTab("active")}
            className={`px-4 py-1.5 text-sm rounded-md transition ${
              tab === "active" ? "bg-gencom-ink text-gencom-mist" : "text-gencom-stone hover:text-gencom-ink"
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setTab("archived")}
            className={`px-4 py-1.5 text-sm rounded-md transition ${
              tab === "archived" ? "bg-gencom-ink text-gencom-mist" : "text-gencom-stone hover:text-gencom-ink"
            }`}
          >
            Archived
          </button>
        </div>
        <button
          onClick={handleNew}
          className="bg-gencom-ink text-gencom-mist px-4 py-2 rounded-md text-sm font-medium hover:bg-gencom-ink/90"
        >
          + New Property
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gencom-stone py-20">Loading…</div>
      ) : cards.length === 0 ? (
        <div className="text-center text-gencom-stone py-20 border border-dashed border-gencom-sand rounded-lg bg-white">
          {tab === "active" ? (
            <>
              <div className="mb-2 font-display text-xl text-gencom-ink">No active deals yet</div>
              <div className="text-sm">Click <b>+ New Property</b> to start your first renovation budget.</div>
            </>
          ) : (
            <>No archived deals.</>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((c) => (
            <div key={c.id} className="relative group">
              <Link
                to={`/properties/${c.id}/setup`}
                className={`block bg-white border border-gencom-sand rounded-lg overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition ${
                  c.archived ? "opacity-60" : ""
                }`}
              >
                <div className="aspect-[16/9] bg-gradient-to-br from-gencom-sand to-gencom-mist relative">
                  {c.thumbnail_path ? (
                    <img
                      src={`/files/uploads/${c.thumbnail_path}`}
                      alt={c.name ?? ""}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center font-display text-3xl text-gencom-gold">
                      {(c.name?.[0] ?? "?").toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="p-4 space-y-2">
                  <div>
                    <div className="font-display text-lg leading-tight">{c.name ?? "Untitled deal"}</div>
                    {(c.current_brand || c.target_brand) && (
                      <div className="text-xs text-gencom-stone">
                        {c.current_brand ?? "—"} → {c.target_brand ?? "—"}
                      </div>
                    )}
                  </div>
                  {/* Key facts — Address, keys, year built (in that order) */}
                  <div className="text-xs text-gencom-stone space-y-0.5">
                    <div className="truncate" title={[c.address, c.city, c.state].filter(Boolean).join(", ") || "—"}>
                      <span className="text-gencom-ink/60">Address:</span>{" "}
                      {[c.address, c.city, c.state].filter(Boolean).join(", ") || "—"}
                    </div>
                    <div>
                      <span className="text-gencom-ink/60">Keys:</span>{" "}
                      {c.keys != null ? c.keys.toLocaleString() : "—"}
                    </div>
                    <div>
                      <span className="text-gencom-ink/60">Year built:</span>{" "}
                      {c.year_built ?? "—"}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gencom-sand grid grid-cols-3 gap-1 text-center">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-gencom-stone">Required</div>
                      <div className="text-sm font-mono">{formatMoney(c.required_total)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-gencom-stone">Req. + Rec.</div>
                      <div className="text-sm font-mono">{formatMoney(c.required_recommended_total)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-gencom-stone">Full Scope</div>
                      <div className="text-sm font-medium font-mono text-gencom-ink">{formatMoney(c.full_scope_total)}</div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-gencom-stone">
                    {relativeDate(c.updated_at)}
                  </div>
                  {/* Section quick-nav — centered and always visible. Sits
                      INSIDE the card Link block so layout stays stable, but
                      stops propagation on its own clicks so row clicks don't
                      navigate to Setup. */}
                  <div
                    className="pt-2 border-t border-gencom-sand flex gap-1 justify-center flex-wrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {([
                      ["setup", "Setup"],
                      ["scope", "Scope"],
                      ["overview", "Overview"],
                      ["summary", "Summary"],
                      ["export", "Export"],
                    ] as const).map(([slug, label]) => (
                      <button
                        key={slug}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/properties/${c.id}/${slug}`); }}
                        className="text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded border border-gencom-sand bg-white text-gencom-stone hover:border-gencom-ink hover:text-gencom-ink hover:bg-gencom-mist/60"
                        title={`Jump to ${label}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </Link>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setMenuOpen(menuOpen === c.id ? null : c.id);
                }}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-white/90 rounded-md p-1.5 text-gencom-stone hover:text-gencom-ink transition"
                aria-label="More"
              >
                ⋯
              </button>
              {/* Photo controls. The <label> + hidden <input type="file"> is
                  the standard pattern for opening the OS file picker. The
                  controls are siblings of the <Link> card body, so we DON'T
                  need preventDefault here — clicks never bubble to the Link.
                  preventDefault on a label click blocks it from triggering
                  the input, so do NOT call it on the wrapper. */}
              <div className="absolute top-2 left-2 flex gap-2 items-center text-xs">
                <label
                  htmlFor={`thumb-upload-${c.id}`}
                  className="bg-white/90 rounded px-2 py-1 text-gencom-ink underline underline-offset-2 cursor-pointer hover:bg-white shadow-sm"
                >
                  {c.thumbnail_path ? "Replace image" : "Add image"}
                </label>
                <input
                  id={`thumb-upload-${c.id}`}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleThumbnailUpload(c.id, f);
                    e.target.value = "";
                  }}
                />
                {c.thumbnail_path && (
                  <button
                    type="button"
                    onClick={() => handleThumbnailDelete(c.id)}
                    className="bg-white/90 rounded px-2 py-1 text-red-700 underline underline-offset-2 shadow-sm hover:bg-white"
                  >
                    Remove
                  </button>
                )}
              </div>
              {menuOpen === c.id && (
                <div className="absolute top-10 right-2 bg-white border border-gencom-sand rounded-md shadow-lg z-10 min-w-[140px] py-1 text-sm">
                  {c.archived ? (
                    <button className="w-full text-left px-3 py-1.5 hover:bg-gencom-mist" onClick={() => handleRestore(c.id)}>
                      Restore
                    </button>
                  ) : (
                    <>
                      <button className="w-full text-left px-3 py-1.5 hover:bg-gencom-mist" onClick={() => handleDuplicate(c.id)}>
                        Duplicate
                      </button>
                      <button className="w-full text-left px-3 py-1.5 hover:bg-gencom-mist" onClick={() => handleArchive(c.id)}>
                        Archive
                      </button>
                    </>
                  )}
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-gencom-mist text-red-700"
                    onClick={() => handleDelete(c.id, c.name)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
