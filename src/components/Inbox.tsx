import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { GraphClient } from "../graph/graphClient";
import { prioritized } from "../learning/ranker";
import { behaviorStore } from "../storage/behaviorStore";
import type { EmailMessage } from "../models/types";
import { MessageRow } from "./MessageRow";

export function Inbox() {
  const { account, signOut, getAccessToken } = useAuth();
  const graph = useMemo(() => new GraphClient(getAccessToken), [getAccessToken]);

  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const inbox = await graph.fetchInbox();
      setMessages(prioritized(inbox));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [graph]);

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
    if (message.webLink) window.open(message.webLink, "_blank", "noopener");
  };

  return (
    <div className="inbox">
      <header className="inbox-header">
        <div>
          <h1>Priority Inbox</h1>
          <span className="account">{account?.username}</span>
        </div>
        <div className="actions">
          <button onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
            ↻
          </button>
          <button className="ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

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
