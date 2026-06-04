import { ChevronRight } from "lucide-react";
import { levelOf } from "../intel/category";
import { senderDisplay, type EmailMessage } from "../models/types";
import { Avatar } from "./Avatar";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function MessageRow({
  message,
  onOpen,
}: {
  message: EmailMessage;
  onOpen: () => void;
}) {
  const lvl = levelOf(message);
  return (
    <li
      className={`message-row prio-${lvl} ${message.isRead ? "read" : "unread"}`}
      onClick={onOpen}
    >
      <Avatar message={message} />
      <div className="message-body">
        <div className="message-top">
          <span className="sender">
            <span className={`status-dot ${lvl}`} />
            {senderDisplay(message)}
          </span>
          <span className={`time time-${lvl}`}>{relativeTime(message.receivedDateTime)}</span>
        </div>
        <div className="subject">{message.subject}</div>
        <div className="preview">{message.bodyPreview}</div>
      </div>
      <ChevronRight className="row-chevron" size={18} />
    </li>
  );
}
