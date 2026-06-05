import { useMemo } from "react";
import { Mail, MailOpen, Flag, MessageSquare, ChevronRight, PenLine } from "lucide-react";
import type { EmailMessage } from "../models/types";
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

  return (
    <div className="brief">
      <p className="brief-greeting">{brief.greeting}.</p>
      <p className="brief-headline">{brief.headline}</p>

      <div className="brief-stats">
        <Stat icon={<Mail size={15} />} n={brief.received} label="Received" tone="n" />
        <Stat icon={<MailOpen size={15} />} n={brief.unread} label="Unread" tone="n" />
        <Stat icon={<Flag size={15} />} n={brief.highPriority} label="High priority" tone="h" />
        <Stat icon={<MessageSquare size={15} />} n={brief.needingReply} label="Need reply" tone="i" />
      </div>

      {brief.highlights.length > 0 && (
        <section className="brief-sec">
          <p className="sec-label">Top of the pile</p>
          {brief.highlights.map((h) => (
            <button key={h.message.id} className="hilite" onClick={() => onOpen(h.message)}>
              <Avatar message={h.message} size={38} />
              <span className="hilite-text">
                <span className="hilite-subj">{h.message.subject}</span>
                <span className="hilite-reason">{h.reason}</span>
              </span>
              <span className="hilite-meta">
                <span className={`time time-${levelOf(h.message)}`}>
                  {shortTime(h.message.receivedDateTime)}
                </span>
                <ChevronRight size={14} className="row-chevron" />
              </span>
            </button>
          ))}
        </section>
      )}

      {brief.toReply.length > 0 && (
        <section className="brief-sec">
          <p className="sec-label">Waiting on you</p>
          <div className="waiting-card">
            <div className="waiting-head">
              <span className="waiting-ico">
                <Mail size={21} />
              </span>
              <div>
                <div className="waiting-title">
                  {brief.toReply.length} email{brief.toReply.length === 1 ? "" : "s"} need a reply
                </div>
                <div className="waiting-sub">AI-drafted replies are ready to review</div>
              </div>
            </div>
            <button className="cta-button" onClick={onGoToDrafts}>
              <PenLine size={14} /> Review draft replies
            </button>
          </div>
        </section>
      )}

      <p className="brief-footnote">Overview generated on-device from your inbox.</p>
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
  tone: "n" | "h" | "i";
}) {
  return (
    <div className="stat">
      <span className={`stat-chip chip-${tone}`}>{icon}</span>
      <span className="stat-body">
        <span className="stat-n">{n}</span>
        <span className="stat-label">{label}</span>
      </span>
    </div>
  );
}
