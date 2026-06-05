// Email composition for Gencom Stay requests.
//
// Tone rules (per spec):
//   - Polite, professional, brief. Reads like a PM email, not an AI draft.
//   - No em dashes anywhere in the body.
//   - No bullet-heavy / markdown-list structure. Date ranges flow as prose.
//   - Contractions are fine ("I'd", "don't") — they keep the tone human.

import type { BlackoutRange, Property } from "./types";

export type DateRange = { checkIn: string; checkOut: string };

export type EmailFormValues = {
  requesterName: string;
  requesterEmail: string;
  requesterDepartment: string;
  adults: number;
  children: number;
  roomType: string;
  dateRanges: DateRange[]; // up to 3
  purpose: "personal" | "family" | "business_adjacent" | "site_visit" | "other";
  purposeOther: string;
  specialRequests: string;
};

export type ComposedEmail = {
  to: string;
  cc: string;
  subject: string;
  body: string;
  mailtoUrl: string;
  clipboardText: string;
};


// ------------------------------------------------------------
// Public: compose the email from form state + property record.
// ------------------------------------------------------------
export function buildEmail(
  form: EmailFormValues,
  property: Property,
): ComposedEmail {
  const to = (property.contact?.email ?? "").trim();
  const cc = (property.assetManager?.email ?? "").trim();
  const subject = `Stay request for ${property.name}`;
  const body = buildBody(form, property);
  const mailtoUrl = buildMailtoUrl({ to, cc, subject, body });
  const clipboardText = buildClipboard({ to, cc, subject, body });
  return { to, cc, subject, body, mailtoUrl, clipboardText };
}


// ------------------------------------------------------------
// Body
// ------------------------------------------------------------
function buildBody(form: EmailFormValues, property: Property): string {
  const filledRanges = form.dateRanges.filter((r) => r.checkIn && r.checkOut);

  const contactFirstName = firstName(property.contact?.name) || "there";
  const propertyName = property.name;
  const purposeClause = purposeClauseFor(form.purpose, form.purposeOther);
  const guestsClause = guestsClauseFor(form.adults, form.children);
  const roomClause = form.roomType ? `a ${form.roomType}` : "a room";

  const paragraphs: string[] = [];

  paragraphs.push(`Hi ${contactFirstName},`);

  // Opening paragraph: purpose + property + transition to dates
  paragraphs.push(
    `I hope this finds you well. I'd like to request a stay at ${propertyName} and wanted to share my preferred dates and details so you can check availability on your end.`,
  );

  // Dates paragraph — prose, not bullets.
  if (filledRanges.length > 0) paragraphs.push(datesParagraph(filledRanges));

  // Room + guests + purpose in one tight sentence
  paragraphs.push(
    `I'm looking at ${roomClause} for ${guestsClause}, for ${purposeClause}. ` +
    `Happy to flex on the room category if something else works better for those dates.`,
  );

  // Special requests — only if provided. Keep as a gentle prose line.
  const notes = (form.specialRequests || "").trim();
  if (notes) {
    paragraphs.push(`A quick note: ${notes}`);
  }

  // Policy acknowledgment + asset manager mention
  const assetManagerName = (property.assetManager?.name ?? "").trim();
  if (assetManagerName) {
    paragraphs.push(
      `I understand this is a request subject to availability and the owner rate policy, and not confirmed until you're able to respond. ` +
      `I've copied ${assetManagerName} as my asset manager on this.`,
    );
  } else {
    paragraphs.push(
      `I understand this is a request subject to availability and the owner rate policy, and not confirmed until you're able to respond.`,
    );
  }

  // Sign-off
  const signoffLines = [
    "Thank you,",
    form.requesterName.trim(),
    form.requesterDepartment.trim(),
    form.requesterEmail.trim(),
  ].filter(Boolean);
  paragraphs.push(signoffLines.join("\n"));

  // CRLF line endings are safer for Outlook; single blank line between paragraphs.
  return paragraphs.join("\n\n");
}


function datesParagraph(ranges: DateRange[]): string {
  // Prose phrasing that avoids list markers. Format depends on count.
  const r0 = ranges[0];
  const r1 = ranges[1];
  const r2 = ranges[2];

  if (ranges.length === 1) {
    return `My preferred dates are ${fmtRange(r0)} (${nightsOf(r0)}).`;
  }

  if (ranges.length === 2) {
    return (
      `My first choice is ${fmtRange(r0)} (${nightsOf(r0)}). ` +
      `If those dates are tight on your side, my second choice is ${fmtRange(r1!)} (${nightsOf(r1!)}).`
    );
  }

  return (
    `My first choice is ${fmtRange(r0)} (${nightsOf(r0)}). ` +
    `My second choice is ${fmtRange(r1!)} (${nightsOf(r1!)}), and my third is ${fmtRange(r2!)} (${nightsOf(r2!)}).`
  );
}


function purposeClauseFor(p: EmailFormValues["purpose"], other: string): string {
  switch (p) {
    case "personal": return "a personal trip";
    case "family": return "a family visit";
    case "business_adjacent": return "a business-adjacent visit";
    case "site_visit": return "a site visit";
    case "other": return other.trim() || "a personal visit";
  }
}


function guestsClauseFor(adults: number, children: number): string {
  const a = Math.max(0, adults);
  const c = Math.max(0, children);
  if (a === 0 && c === 0) return "one guest";
  if (a === 1 && c === 0) return "one guest";
  const adultPart = a === 1 ? "1 adult" : `${a} adults`;
  if (c === 0) return adultPart;
  const childPart = c === 1 ? "1 child" : `${c} children`;
  return `${adultPart} and ${childPart}`;
}


// ------------------------------------------------------------
// Date formatting — avoids "—" (em dash) and verbose restating of
// month / year when both dates share them.
// ------------------------------------------------------------
function fmtRange(r: DateRange): string {
  const a = parseISO(r.checkIn);
  const b = parseISO(r.checkOut);
  if (!a || !b) return `${r.checkIn} through ${r.checkOut}`;

  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();

  if (sameMonth) {
    // "April 15 through April 19, 2026"
    const month = monthLong(a);
    return `${month} ${a.getDate()} through ${month} ${b.getDate()}, ${b.getFullYear()}`;
  }
  if (sameYear) {
    // "April 28 through May 2, 2026"
    return `${monthLong(a)} ${a.getDate()} through ${monthLong(b)} ${b.getDate()}, ${b.getFullYear()}`;
  }
  // Cross-year: "December 28, 2025 through January 3, 2026"
  return `${monthLong(a)} ${a.getDate()}, ${a.getFullYear()} through ${monthLong(b)} ${b.getDate()}, ${b.getFullYear()}`;
}


function nightsOf(r: DateRange): string {
  const a = parseISO(r.checkIn);
  const b = parseISO(r.checkOut);
  if (!a || !b) return "";
  const n = Math.max(0, Math.round((+b - +a) / 86400000));
  return n === 1 ? "1 night" : `${n} nights`;
}


function monthLong(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long" });
}


function parseISO(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}


function firstName(full?: string): string {
  if (!full) return "";
  const first = full.trim().split(/\s+/)[0] ?? "";
  return first.replace(/[.,:;!?]+$/, "");
}


// ------------------------------------------------------------
// mailto URL + clipboard text
// ------------------------------------------------------------
function buildMailtoUrl({
  to, cc, subject, body,
}: { to: string; cc: string; subject: string; body: string }): string {
  const params: string[] = [];
  if (cc) params.push(`cc=${encodeURIComponent(cc)}`);
  params.push(`subject=${encodeURIComponent(subject)}`);
  params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${encodeURIComponent(to)}?${params.join("&")}`;
}


function buildClipboard({
  to, cc, subject, body,
}: { to: string; cc: string; subject: string; body: string }): string {
  const lines: string[] = [];
  if (to) lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Subject: ${subject}`);
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}


// ------------------------------------------------------------
// Re-exported blackout check (used by the form's inline warnings
// AND by the confirmation summary). Safer to keep the two in sync.
// ------------------------------------------------------------
export function findBlackoutOverlaps(
  ranges: DateRange[],
  blackouts: BlackoutRange[],
): { rangeIndex: number; blackout: BlackoutRange }[] {
  const hits: { rangeIndex: number; blackout: BlackoutRange }[] = [];
  ranges.forEach((r, i) => {
    if (!r.checkIn || !r.checkOut) return;
    for (const b of blackouts) {
      if (r.checkIn <= b.end && b.start < r.checkOut) {
        hits.push({ rangeIndex: i, blackout: b });
      }
    }
  });
  return hits;
}
