import type { EmailMessage } from "../models/types";
import { score } from "../learning/ranker";

// Classifies a message into a visual category (which icon to show) and a priority
// level (which color tint to use), purely for presentation — the avatar tiles.

export type Category =
  | "security"
  | "social"
  | "promo"
  | "calendar"
  | "news"
  | "group"
  | "update"
  | "person";

export type Level = "high" | "medium" | "low";

export function levelOf(message: EmailMessage): Level {
  const s = score(message);
  if (s >= 0.66) return "high";
  if (s >= 0.4) return "medium";
  return "low";
}

export function categoryOf(message: EmailMessage): Category {
  const addr = message.sender?.address.toLowerCase() ?? "";
  const name = message.sender?.name.toLowerCase() ?? "";
  const text = `${message.subject} ${message.bodyPreview}`.toLowerCase();
  const has = (...w: string[]) => w.some((x) => text.includes(x));

  if (name.includes("linkedin") || addr.includes("linkedin")) return "social";
  if (
    addr.includes("noreply") ||
    addr.includes("no-reply") ||
    has("password", "[automated]", "security alert", "verify your", "expires")
  )
    return "security";
  if (has("sale", "% off", "deal", "flash", "unsubscribe", "promo") || addr.includes("deals@"))
    return "promo";
  if (has("dinner", "reservation", "schedule", "meeting", "calendar", "book ", "reschedule"))
    return "calendar";
  if (name.includes("newsletter") || addr.includes("news@") || has("trends", "weekly digest"))
    return "news";
  if (has("standup", "blockers", "migration", "notes", "update") ) return "update";
  if (name.includes("(ceo)") || has("board", "team", "all-hands", "everyone")) return "group";
  return "person";
}
