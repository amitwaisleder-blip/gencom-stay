import { useMemo, useState } from "react";
import { Clock, SendHorizontal, Sparkles, Check } from "lucide-react";
import type { EmailMessage } from "../models/types";
import { senderDisplay } from "../models/types";
import { generateDraft, needsResponse } from "../intel/responder";
import { levelOf } from "../intel/category";
import { Avatar } from "./Avatar";
import { OutlookLogo } from "./Brand";

function shortTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

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
      <p className="kicker">Draft replies</p>
      <h1 className="screen-title">Your draft replies</h1>
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

  const run = async (fn: () => Promise<void>, working: Status, ok: Status) => {
    setStatus(working);
    try {
      await fn();
      setStatus(ok);
    } catch (e) {
      setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <article className={`draft-card prio-${levelOf(message)} ${done ? "handled" : ""}`}>
      <header className="draft-head">
        <Avatar message={message} size={40} />
        <div className="draft-meta">
          <span className="draft-sender">{senderDisplay(message)}</span>
          <span className="draft-subject">{message.subject}</span>
        </div>
        <span className={`draft-time time-${levelOf(message)}`}>
          <Clock size={13} /> {shortTime(message.receivedDateTime)}
        </span>
      </header>

      <p className="draft-context">“{message.bodyPreview}”</p>

      <div className="draft-editor">
        <textarea
          className="draft-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          disabled={busy || done}
        />
        <span className="draft-ai" title="AI-assisted draft">
          <Sparkles size={15} />
        </span>
      </div>

      {done ? (
        <p className="draft-result">
          <Check size={16} />
          {status.kind === "sent"
            ? demo ? " Sent (demo)" : " Sent"
            : demo ? " Saved to drafts (demo)" : " Saved to Outlook Drafts"}
        </p>
      ) : status.kind === "confirm" ? (
        <div className="draft-confirm">
          <span>Send this reply now?</span>
          <div className="draft-actions">
            <button
              className="brand-button"
              onClick={() => void run(() => onSend(text), { kind: "sending" }, { kind: "sent" })}
            >
              <SendHorizontal size={16} /> Confirm send
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
              <SendHorizontal size={16} />
              {status.kind === "sending" ? "Sending…" : "Send reply"}
            </button>
            <button
              className="ghost-button"
              onClick={() => void run(() => onSave(text), { kind: "saving" }, { kind: "saved" })}
              disabled={busy}
            >
              <OutlookLogo size={16} />
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
