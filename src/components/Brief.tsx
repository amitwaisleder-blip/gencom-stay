import { useMemo } from "react";
import type { EmailMessage } from "../models/types";
import { senderDisplay } from "../models/types";
import { buildBrief } from "../intel/brief";

/** The daily overview: what's landed today, what's urgent, what needs a reply. */
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
        <Stat n={brief.received} label="received" />
        <Stat n={brief.unread} label="unread" />
        <Stat n={brief.highPriority} label="high priority" />
        <Stat n={brief.needingReply} label="need a reply" />
      </div>

      {brief.highlights.length > 0 && (
        <section className="brief-section">
          <h2>Top of the pile</h2>
          {brief.highlights.map((h) => (
            <button key={h.message.id} className="brief-item" onClick={() => onOpen(h.message)}>
              <span className="brief-item-subject">{h.message.subject}</span>
              <span className="brief-item-reason">{h.reason}</span>
            </button>
          ))}
        </section>
      )}

      {brief.toReply.length > 0 && (
        <section className="brief-section">
          <h2>Waiting on you</h2>
          <p className="brief-note">
            {brief.toReply.length} message{brief.toReply.length === 1 ? "" : "s"} look like
            {brief.toReply.length === 1 ? "s" : ""} they need a reply.
          </p>
          <ul className="brief-reply-list">
            {brief.toReply.map((m) => (
              <li key={m.id}>
                <strong>{senderDisplay(m)}</strong> — {m.subject}
              </li>
            ))}
          </ul>
          <button className="brand-button" onClick={onGoToDrafts}>
            Review draft replies
          </button>
        </section>
      )}

      <p className="brief-footnote">
        Overview generated on-device from your inbox. Connect Claude for a richer,
        written summary.
      </p>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="stat">
      <span className="stat-n">{n}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
