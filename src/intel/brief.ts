import type { EmailMessage } from "../models/types";
import { senderDisplay } from "../models/types";
import { score } from "../learning/ranker";
import { needsResponse } from "./responder";

// Builds the daily brief: a plain-language overview of what's landed so far today,
// computed on-device from the inbox and the on-device ranker. The upgrade path is a
// Claude API call that writes a richer narrative; the structured counts stay useful.

export interface BriefHighlight {
  message: EmailMessage;
  reason: string;
}

export interface DailyBrief {
  greeting: string;
  headline: string;
  received: number;
  unread: number;
  highPriority: number;
  needingReply: number;
  highlights: BriefHighlight[];
  toReply: EmailMessage[];
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function reasonFor(m: EmailMessage): string {
  const bits: string[] = [];
  if (m.importance === "high") bits.push("high importance");
  if (needsResponse(m)) bits.push("needs a reply");
  if (m.toRecipients.length <= 3) bits.push("addressed to you");
  if (m.hasAttachments) bits.push("has an attachment");
  const detail = bits.slice(0, 2).join(", ");
  return detail ? `${senderDisplay(m)} — ${detail}` : senderDisplay(m);
}

export function buildBrief(messages: EmailMessage[]): DailyBrief {
  const today = messages.filter((m) => isToday(m.receivedDateTime));
  const ranked = [...today].sort((a, b) => score(b) - score(a));

  const unread = today.filter((m) => !m.isRead).length;
  const highPriority = today.filter((m) => score(m) >= 0.66).length;
  const toReply = today.filter(needsResponse);

  const headline =
    today.length === 0
      ? "No new mail so far today."
      : `${today.length} email${today.length === 1 ? "" : "s"} so far today` +
        ` · ${unread} unread · ${toReply.length} need a reply.`;

  return {
    greeting: greetingForNow(),
    headline,
    received: today.length,
    unread,
    highPriority,
    needingReply: toReply.length,
    highlights: ranked.slice(0, 3).map((m) => ({ message: m, reason: reasonFor(m) })),
    toReply,
  };
}
