import { ChevronRight } from "lucide-react";
import { levelOf, type Level } from "../intel/category";
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

export function PriorityPill({ level }: { level: Level }) {
  const label = { high: "High", medium: "Med", low: "Low" }[level];
  return <span className={`prio-pill pill-${level}`}>{label}</span>;
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
    <li className="message-row" onClick={onOpen}>
      <Avatar message={message} />
      <div className="message-body">
        <div className="message-top">
          <span className="sender">{senderDisplay(message)}</span>
          <span className="row-meta">
            <PriorityPill level={lvl} />
            <span className={`time time-${lvl}`}>{relativeTime(message.receivedDateTime)}</span>
          </span>
        </div>
        <div className={`subject ${message.isRead ? "" : "unread"}`}>{message.subject}</div>
        <div className="preview">{message.bodyPreview}</div>
      </div>
      <ChevronRight className="row-chevron" size={16} />
    </li>
  );
}
