import { useMemo } from "react";
import { Inbox, MailOpen, Flag, MessageSquare, ChevronRight, PenLine, Mail } from "lucide-react";
import type { EmailMessage } from "../models/types";
import { senderDisplay } from "../models/types";
import { buildBrief } from "../intel/brief";
import { levelOf } from "../intel/category";
import { Avatar } from "./Avatar";

function shortTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

export function Brief({
  messages,
  onOpen,
  onGoToDrafts,
}: {
  messages: EmailMessage[];
  onOpen: (m: EmailMessage) => void;
  onGoToDrafts: () => void;
}) {
  const brief = useMemo(() => buildBrief(messages), [messages]);
  const hour = new Date().getHours();
  const emoji = hour < 12 ? "🌅" : hour < 18 ? "☀️" : "🌙";

  return (
    <div className="brief">
      <p className="brief-greeting">
        {brief.greeting}. <span className="brief-emoji">{emoji}</span>
      </p>
      <p className="brief-headline">{brief.headline}</p>

      <div className="brief-stats">
        <Stat icon={<Inbox size={16} />} n={brief.received} label="Received" tone="neutral" />
        <Stat icon={<MailOpen size={16} />} n={brief.unread} label="Unread" tone="neutral" />
        <Stat icon={<Flag size={16} />} n={brief.highPriority} label="High priority" tone="high" />
        <Stat icon={<MessageSquare size={16} />} n={brief.needingReply} label="Need a reply" tone="info" />
      </div>

      {brief.highlights.length > 0 && (
        <section className="brief-section">
          <h2>Top of the pile</h2>
          {brief.highlights.map((h) => (
            <button
              key={h.message.id}
              className={`brief-item prio-${levelOf(h.message)}`}
              onClick={() => onOpen(h.message)}
            >
              <Avatar message={h.message} size={40} />
              <span className="brief-item-text">
                <span className="brief-item-subject">{h.message.subject}</span>
                <span className="brief-item-reason">{h.reason}</span>
              </span>
              <span className="brief-item-meta">
                <span className={`time time-${levelOf(h.message)}`}>
                  {shortTime(h.message.receivedDateTime)}
                </span>
                <ChevronRight size={18} className="row-chevron" />
              </span>
            </button>
          ))}
        </section>
      )}

      {brief.toReply.length > 0 && (
        <section className="brief-section">
          <h2>Waiting on you</h2>
          <div className="waiting-card">
            <div className="waiting-head">
              <span className="waiting-illustration">
                <Mail size={26} />
              </span>
              <ul className="waiting-list">
                {brief.toReply.slice(0, 5).map((m) => (
                  <li key={m.id}>
                    <span className={`status-dot ${levelOf(m)}`} />
                    <span className="waiting-sender">{senderDisplay(m)}</span>
                    <span className="waiting-subject"> — {m.subject}</span>
                    <span className="waiting-time">{shortTime(m.receivedDateTime)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="waiting-cta">
              <button className="brand-button" onClick={onGoToDrafts}>
                <PenLine size={16} /> Review draft replies
              </button>
              <span className="waiting-note">Save time with AI-assisted replies</span>
            </div>
          </div>
        </section>
      )}

      <p className="brief-footnote">
        Overview generated on-device from your inbox.
      </p>
    </div>
  );
}

function Stat({
  icon,
  n,
  label,
  tone,
}: {
  icon: React.ReactNode;
  n: number;
  label: string;
  tone: "neutral" | "high" | "info";
}) {
  return (
    <div className="stat">
      <span className={`stat-chip chip-${tone}`}>{icon}</span>
      <span className="stat-n">{n}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
