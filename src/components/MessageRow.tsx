import { score } from "../learning/ranker";
import { senderDisplay, type EmailMessage } from "../models/types";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function level(s: number): "high" | "medium" | "low" {
  if (s >= 0.66) return "high";
  if (s >= 0.4) return "medium";
  return "low";
}

export function MessageRow({
  message,
  onOpen,
}: {
  message: EmailMessage;
  onOpen: () => void;
}) {
  const lvl = level(score(message));
  return (
    <li
      className={`message-row prio-${lvl} ${message.isRead ? "read" : "unread"}`}
      onClick={onOpen}
    >
      <span className={`dot ${lvl}`} title={`Predicted importance: ${lvl}`} />
      <div className="message-body">
        <div className="message-top">
          <span className="sender">{senderDisplay(message)}</span>
          <span className="time">{relativeTime(message.receivedDateTime)}</span>
        </div>
        <div className="subject">{message.subject}</div>
        <div className="preview">{message.bodyPreview}</div>
      </div>
    </li>
  );
}
