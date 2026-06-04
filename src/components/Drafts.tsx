import { useMemo, useState } from "react";
import type { EmailMessage } from "../models/types";
import { senderDisplay } from "../models/types";
import { generateDraft, needsResponse } from "../intel/responder";

/** One editable starter draft per email that looks like it needs a reply. */
export function Drafts({
  messages,
  onSaveDraft,
  onSendReply,
  demo,
}: {
  messages: EmailMessage[];
  onSaveDraft: (m: EmailMessage, text: string) => Promise<void>;
  onSendReply: (m: EmailMessage, text: string) => Promise<void>;
  demo: boolean;
}) {
  const toReply = useMemo(() => messages.filter(needsResponse), [messages]);

  if (toReply.length === 0) {
    return <p className="empty">Nothing needs a reply right now. 🎉</p>;
  }

  return (
    <div className="drafts">
      <p className="drafts-intro">
        Starter replies, drafted on-device for each email that needs one. Edit, then
        save to Outlook or send — no copy-paste.
        {demo && " (Demo: saving and sending are simulated.)"}
      </p>
      {toReply.map((m) => (
        <DraftCard
          key={m.id}
          message={m}
          demo={demo}
          onSave={(text) => onSaveDraft(m, text)}
          onSend={(text) => onSendReply(m, text)}
        />
      ))}
    </div>
  );
}

type Status =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "saving" }
  | { kind: "sending" }
  | { kind: "saved" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

function DraftCard({
  message,
  demo,
  onSave,
  onSend,
}: {
  message: EmailMessage;
  demo: boolean;
  onSave: (text: string) => Promise<void>;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(() => generateDraft(message));
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  const done = status.kind === "saved" || status.kind === "sent";
  const busy = status.kind === "saving" || status.kind === "sending";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const save = async () => {
    setStatus({ kind: "saving" });
    try {
      await onSave(text);
      setStatus({ kind: "saved" });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const send = async () => {
    setStatus({ kind: "sending" });
    try {
      await onSend(text);
      setStatus({ kind: "sent" });
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <article className={`draft-card ${done ? "handled" : ""}`}>
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
        disabled={busy || done}
      />

      {done ? (
        <p className="draft-result">
          {status.kind === "sent"
            ? demo ? "Sent ✓ (demo)" : "Sent ✓"
            : demo ? "Saved to drafts ✓ (demo)" : "Saved to Outlook Drafts ✓"}
        </p>
      ) : status.kind === "confirm" ? (
        <div className="draft-confirm">
          <span>Send this reply now?</span>
          <div className="draft-actions">
            <button className="brand-button" onClick={() => void send()}>
              Confirm send
            </button>
            <button className="ghost-button" onClick={() => setStatus({ kind: "idle" })}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="draft-actions">
            <button
              className="brand-button"
              onClick={() => setStatus({ kind: "confirm" })}
              disabled={busy}
            >
              {status.kind === "sending" ? "Sending…" : "Send reply"}
            </button>
            <button className="ghost-button" onClick={() => void save()} disabled={busy}>
              {status.kind === "saving" ? "Saving…" : "Save to Outlook"}
            </button>
            <button className="linklike copy-link" onClick={() => void copy()}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          {status.kind === "error" && <p className="draft-error">{status.message}</p>}
        </>
      )}
    </article>
  );
}
