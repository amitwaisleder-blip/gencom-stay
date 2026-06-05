// Event detail modal — the read-side of an event. Creation / editing
// comes in Phase 2. For now this is rich-enough read-only: title,
// category badge, date + time, location, description, and any
// category-specific extras (dress code, property / brand, RSVP flag).

import { format } from "date-fns";
import { CATEGORY_STYLES } from "./categories";
import type { GenCalEvent } from "./api";


export default function EventDetail({
  event, onClose,
}: { event: GenCalEvent; onClose: () => void }) {
  const style = CATEGORY_STYLES[event.category];
  const start = new Date(event.start_at);
  const end = new Date(event.end_at);
  const dateLine = formatDateLine(start, end, event.all_day);

  const extras = event.extras ?? {};
  const extraItems = extractExtras(extras);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[540px] overflow-hidden">
        {/* Hero bar in the category color */}
        <div className="px-6 py-4 flex items-center justify-between" style={{ background: style.bg, color: style.fg }}>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] font-semibold opacity-85">
              {style.label}
            </div>
            <div className="font-serif-display text-[22px] leading-tight mt-0.5">
              {event.title}
            </div>
          </div>
          <button onClick={onClose} className="text-[20px] leading-none opacity-85 hover:opacity-100">✕</button>
        </div>

        <div className="p-6 space-y-4">
          <Row label="When" value={dateLine} />
          {event.location && <Row label="Where" value={event.location} />}
          {event.description && <Row label="Details" value={event.description} multiline />}
          {extraItems.length > 0 && (
            <div className="pt-3 mt-3 border-t border-[#ece6d7]">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#b89555] font-semibold mb-2">
                Additional info
              </div>
              <dl className="space-y-1.5">
                {extraItems.map((it) => <Row key={it.label} label={it.label} value={it.value} compact />)}
              </dl>
            </div>
          )}

          {event.locked && (
            <div className="mt-4 px-3 py-2 rounded-md bg-[#faf7f1] border border-[#ece6d7] text-[11px] text-[#6b6f78]">
              Locked event — preloaded from the HSHR company schedule or auto-generated from the employee directory.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function Row({
  label, value, multiline, compact,
}: { label: string; value: string; multiline?: boolean; compact?: boolean }) {
  return (
    <div className={compact ? "grid grid-cols-[120px_1fr] items-baseline" : ""}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#6b6f78] font-semibold">{label}</div>
      <div
        className={`text-[14px] text-[#1a1d24] ${compact ? "" : "mt-1"}`}
        style={{ whiteSpace: multiline ? "pre-wrap" : "normal" }}
      >
        {value}
      </div>
    </div>
  );
}


function formatDateLine(start: Date, end: Date, allDay: boolean): string {
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (allDay) {
    if (sameDay) return format(start, "EEEE, MMMM d, yyyy");
    return `${format(start, "EEE, MMM d")} – ${format(end, "EEE, MMM d, yyyy")}`;
  }
  if (sameDay) {
    return `${format(start, "EEEE, MMMM d, yyyy")} · ${format(start, "h:mm a")} – ${format(end, "h:mm a")}`;
  }
  return `${format(start, "MMM d · h:mm a")} → ${format(end, "MMM d, yyyy · h:mm a")}`;
}


// Pull recognized keys out of the extras blob and render them as human
// rows. Unknown keys are skipped to avoid leaking backend internals.
function extractExtras(extras: Record<string, unknown>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const s = (v: unknown): string => (v === null || v === undefined || v === "") ? "" : String(v);

  if (extras.dress_code) rows.push({ label: "Dress code", value: s(extras.dress_code) });
  if (extras.host_contact) rows.push({ label: "Host", value: s(extras.host_contact) });
  if (extras.property) rows.push({ label: "Property", value: s(extras.property) });
  if (extras.brand) rows.push({ label: "Brand", value: s(extras.brand) });
  if (extras.milestone_type) rows.push({ label: "Milestone", value: s(extras.milestone_type) });

  if (extras.rsvp_required) {
    rows.push({ label: "RSVP", value: "Response required (enabled in Phase 3)" });
  }
  if (extras.plus_ones_allowed) {
    const max = extras.max_plus_ones;
    rows.push({ label: "Plus-ones", value: `Allowed${max ? ` (up to ${max} per attendee)` : ""}` });
  }
  if (extras.dietary_collection) {
    rows.push({ label: "Dietary", value: "Collected at RSVP (Phase 3)" });
  }
  return rows;
}
