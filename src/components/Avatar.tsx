import type { EmailMessage } from "../models/types";
import { levelOf } from "../intel/category";

/** Two-letter initials from a sender's name (or address as a fallback). */
function initials(name: string): string {
  const clean = name.replace(/\(.*?\)/g, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A rounded tile with the sender's initials, colored by predicted priority. */
export function Avatar({ message, size = 40 }: { message: EmailMessage; size?: number }) {
  const level = levelOf(message);
  const label = message.sender
    ? initials(message.sender.name || message.sender.address)
    : "?";
  return (
    <span className={`gm-av av-${level}`} style={{ width: size, height: size }}>
      {label}
    </span>
  );
}
