import { useCallback, useEffect, useState } from "react";
import { prioritized } from "../learning/ranker";
import { behaviorStore } from "../storage/behaviorStore";
import type { EmailMessage } from "../models/types";
import type { MailSource } from "../models/mailSource";
import { MessageRow } from "./MessageRow";

export function Inbox({
  source,
  accountLabel,
  onExit,
  demo = false,
}: {
  source: MailSource;
  accountLabel: string;
  onExit: () => void;
  demo?: boolean;
}) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const inbox = await source.fetchInbox();
      setMessages(prioritized(inbox));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleOpen = (message: EmailMessage) => {
    // Record the behavior signal first; learning happens regardless of network.
    behaviorStore.record({
      messageId: message.id,
      conversationId: message.conversationId,
      senderAddress: message.sender?.address ?? null,
      action: "opened",
      secondsToAction:
        (Date.now() - new Date(message.receivedDateTime).getTime()) / 1000,
    });
    void source.markRead(message.id, true);

    // Reflect the read state and re-rank so the learning is visible immediately:
    // opening a sender's mail nudges their other messages up the list.
    setMessages((prev) =>
      prioritized(
        prev.map((m) => (m.id === message.id ? { ...m, isRead: true } : m)),
      ),
    );

    if (message.webLink) window.open(message.webLink, "_blank", "noopener");
  };

  const resetLearning = () => {
    behaviorStore.reset();
    void refresh();
  };

  return (
    <div className="inbox">
      <header className="inbox-header">
        <div>
          <h1>Priority Inbox</h1>
          <span className="account">{accountLabel}</span>
        </div>
        <div className="actions">
          <button onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
            ↻
          </button>
          <button className="ghost" onClick={onExit}>
            {demo ? "Exit demo" : "Sign out"}
          </button>
        </div>
      </header>

      {demo && (
        <p className="demo-banner">
          Demo mode — sample inbox, no account. Tap messages to watch the on-device
          ranking learn. <button className="linklike" onClick={resetLearning}>Reset learning</button>
        </p>
      )}

      {error && <p className="error banner">{error}</p>}
      {loading && messages.length === 0 && <div className="spinner" />}
      {!loading && messages.length === 0 && !error && (
        <p className="empty">No messages.</p>
      )}

      <ul className="message-list">
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} onOpen={() => handleOpen(m)} />
        ))}
      </ul>
    </div>
  );
}
