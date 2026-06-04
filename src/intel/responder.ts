import { senderDisplay, type EmailMessage } from "../models/types";

// Decides which emails need a reply and generates a starter draft for each.
//
// These drafts are produced on-device from lightweight intent detection — no
// network, no account. They are deliberately conservative, polite placeholders.
// The upgrade path is to replace `generateDraft` with a Claude API call that reads
// the full thread and the user's writing style; the rest of the app stays the same.

const BULK_HINTS = [
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "notifications",
  "notification",
  "mailer",
  "news@",
  "newsletter",
  "deals@",
  "list@",
  "updates@",
  "support@",
];

const BULK_NAMES = ["linkedin", "newsletter", "the hustle", "talent partners"];

/** True for automated senders, newsletters, and promotions — these need no reply. */
export function isBulkSender(message: EmailMessage): boolean {
  const addr = message.sender?.address.toLowerCase() ?? "";
  const name = message.sender?.name.toLowerCase() ?? "";
  if (BULK_HINTS.some((h) => addr.includes(h))) return true;
  if (BULK_NAMES.some((n) => name.includes(n))) return true;
  return false;
}

const REQUEST_SIGNALS = [
  "?",
  "can you",
  "could you",
  "please",
  "need",
  "confirm",
  "sign-off",
  "sign off",
  "let me know",
  "review",
  "approve",
  "book",
  "schedule",
  "thoughts",
  "unblock",
  "asap",
  "by today",
  "by eod",
  "by 5",
];

/** True when a message looks like it's asking the user to do or decide something. */
export function needsResponse(message: EmailMessage): boolean {
  if (isBulkSender(message)) return false;
  const text = `${message.subject} ${message.bodyPreview}`.toLowerCase();
  return REQUEST_SIGNALS.some((s) => text.includes(s));
}

type DraftKind = "approval" | "scheduling" | "blocker" | "review" | "general";

function classify(message: EmailMessage): DraftKind {
  const text = `${message.subject} ${message.bodyPreview}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));
  if (has("sign-off", "sign off", "approve", "confirm", "redline", "proposal", "contract"))
    return "approval";
  if (has("book", "reservation", "dinner", "schedule", "meeting", "calendar", "reschedule"))
    return "scheduling";
  if (has("blocker", "unblock", "stuck", "issue", "help")) return "blocker";
  if (has("review", "deck", "draft", "take a pass", "eyes", "feedback")) return "review";
  return "general";
}

function firstName(message: EmailMessage): string {
  const name = message.sender?.name ?? "";
  // "Marcus Lee (CEO)" -> "Marcus"; fall back to a neutral greeting.
  const first = name.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0];
  return first || "there";
}

/** A polite starter draft tailored to the detected intent. */
export function generateDraft(message: EmailMessage): string {
  const name = firstName(message);
  switch (classify(message)) {
    case "approval":
      return `Hi ${name},\n\nThanks for sending this over. I'm reviewing the details now and will confirm my sign-off by end of day.\n\nBest,`;
    case "scheduling":
      return `Hi ${name},\n\nSounds good — I'll take care of this and send the details shortly.\n\nBest,`;
    case "blocker":
      return `Hi ${name},\n\nThanks for flagging. Let me look into this and I'll come back to you shortly with a way forward.\n\nBest,`;
    case "review":
      return `Hi ${name},\n\nThanks — I'll take a pass and share my comments shortly. Anything specific you'd like me to focus on?\n\nBest,`;
    default:
      return `Hi ${name},\n\nThanks for your email. I'll look into this and follow up soon.\n\nBest,`;
  }
}

/** A one-line reason this email needs attention, for the brief and drafts list. */
export function attentionReason(message: EmailMessage): string {
  if (message.importance === "high") return "Marked high importance";
  if (needsResponse(message)) return `Asks for a reply — ${senderDisplay(message)}`;
  if (message.hasAttachments) return "Has an attachment";
  return `From ${senderDisplay(message)}`;
}
