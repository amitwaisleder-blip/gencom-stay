import { useMemo, useState } from "react";
import type { EmailMessage } from "../models/types";
import { senderDisplay } from "../models/types";
import { generateDraft, needsResponse } from "../intel/responder";

/** One editable starter draft per email that looks like it needs a reply. */
export function Drafts({
  messages,
  onMarkHandled,
}: {
  messages: EmailMessage[];
  onMarkHandled: (m: EmailMessage) => void;
}) {
  const toReply = useMemo(() => messages.filter(needsResponse), [messages]);

  if (toReply.length === 0) {
    return <p className="empty">Nothing needs a reply right now. 🎉</p>;
  }

  return (
    <div className="drafts">
      <p className="drafts-intro">
        Starter replies, drafted on-device for each email that looks like it needs one.
        Edit, copy, then send from Outlook. Connect Claude for smart, on-style drafts.
      </p>
      {toReply.map((m) => (
        <DraftCard key={m.id} message={m} onMarkHandled={() => onMarkHandled(m)} />
      ))}
    </div>
  );
}

function DraftCard({
  message,
  onMarkHandled,
}: {
  message: EmailMessage;
  onMarkHandled: () => void;
}) {
  const [text, setText] = useState(() => generateDraft(message));
  const [copied, setCopied] = useState(false);
  const [handled, setHandled] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className={`draft-card ${handled ? "handled" : ""}`}>
      <header className="draft-head">
        <div>
          <span className="draft-sender">{senderDisplay(message)}</span>
          <span className="draft-subject">{message.subject}</span>
        </div>
      </header>
      <p className="draft-context">“{message.bodyPreview}”</p>
      <textarea
        className="draft-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
      />
      <div className="draft-actions">
        <button className="brand-button" onClick={() => void copy()}>
          {copied ? "Copied ✓" : "Copy draft"}
        </button>
        <button
          className="ghost-button"
          onClick={() => {
            setHandled(true);
            onMarkHandled();
          }}
          disabled={handled}
        >
          {handled ? "Marked handled ✓" : "Mark handled"}
        </button>
      </div>
    </article>
  );
}
