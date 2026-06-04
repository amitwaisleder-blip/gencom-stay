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

function priorityClass(s: number): string {
  if (s >= 0.66) return "dot high";
  if (s >= 0.4) return "dot medium";
  return "dot low";
}

export function MessageRow({
  message,
  onOpen,
}: {
  message: EmailMessage;
  onOpen: () => void;
}) {
  const s = score(message);
  return (
    <li
      className={`message-row ${message.isRead ? "read" : "unread"}`}
      onClick={onOpen}
    >
      <span
        className={priorityClass(s)}
        title={`Predicted importance: ${Math.round(s * 100)}%`}
      />
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
