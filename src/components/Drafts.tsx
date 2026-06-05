import { useMemo, useState } from "react";
import { Send, Check } from "lucide-react";
import type { EmailMessage } from "../models/types";
import { senderDisplay } from "../models/types";
import { generateDraft, needsResponse } from "../intel/responder";
import { Avatar } from "./Avatar";
import { OutlookLogo } from "./Brand";

function shortTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
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

  return (
    <div className="drafts">
      <p className="kicker">Draft replies</p>
      <h1 className="screen-title">Your drafts</h1>
      <p className="drafts-intro">
        Starter replies drafted on-device. Edit freely, then send or save to Outlook.
        {demo && " (Demo: saving and sending are simulated.)"}
      </p>
      {toReply.length === 0 ? (
        <p className="empty">Nothing needs a reply right now. 🎉</p>
      ) : (
        toReply.map((m) => (
          <DraftCard
            key={m.id}
            message={m}
            demo={demo}
            onSave={(text) => onSaveDraft(m, text)}
            onSend={(text) => onSendReply(m, text)}
          />
        ))
      )}
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

  const done = status.kind === "saved" || status.kind === "sent";
  const busy = status.kind === "saving" || status.kind === "sending";

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
    <article className={`draft-card ${done ? "handled" : ""}`}>
      <div className="draft-head">
        <Avatar message={message} size={36} />
        <div className="draft-meta">
          <span className="draft-sender">{senderDisplay(message)}</span>
          <span className="draft-subject">{message.subject}</span>
        </div>
        <span className="time time-low">{shortTime(message.receivedDateTime)}</span>
      </div>

      <p className="draft-quote">“{message.bodyPreview}”</p>

      <textarea
        className="draft-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        disabled={busy || done}
      />

      {done ? (
        <p className="draft-result">
          <Check size={15} />
          {status.kind === "sent"
            ? demo ? " Sent (demo)" : " Sent"
            : demo ? " Saved to drafts (demo)" : " Saved to Outlook Drafts"}
        </p>
      ) : status.kind === "confirm" ? (
        <div className="draft-confirm">
          <span>Send this reply now?</span>
          <div className="draft-acts">
            <button
              className="draft-send"
              onClick={() => void run(() => onSend(text), { kind: "sending" }, { kind: "sent" })}
            >
              <Send size={13} /> Confirm send
            </button>
            <button className="draft-save" onClick={() => setStatus({ kind: "idle" })}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="draft-acts">
            <button
              className="draft-send"
              onClick={() => setStatus({ kind: "confirm" })}
              disabled={busy}
            >
              <Send size={13} /> {status.kind === "sending" ? "Sending…" : "Send reply"}
            </button>
            <button
              className="draft-save"
              onClick={() => void run(() => onSave(text), { kind: "saving" }, { kind: "saved" })}
              disabled={busy}
            >
              <OutlookLogo size={14} /> {status.kind === "saving" ? "Saving…" : "Save draft"}
            </button>
          </div>
          {status.kind === "error" && <p className="draft-error">{status.message}</p>}
        </>
      )}
    </article>
  );
}
