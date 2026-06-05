import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCw, LogOut } from "lucide-react";
import { Logo } from "./Brand";
import { prioritized } from "../learning/ranker";
import { behaviorStore } from "../storage/behaviorStore";
import { needsResponse } from "../intel/responder";
import type { EmailMessage } from "../models/types";
import type { MailSource } from "../models/mailSource";
import { TabBar, type Tab } from "./TabBar";
import { Brief } from "./Brief";
import { Inbox } from "./Inbox";
import { Drafts } from "./Drafts";
import { MessageDetail } from "./MessageDetail";

/** Top-level signed-in / demo screen: fetches the inbox once and hosts the tabs. */
export function MailScreen({
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
  const [tab, setTab] = useState<Tab>("brief");
  const [selected, setSelected] = useState<EmailMessage | null>(null);

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

  // Re-rank in place after a behavior event so learning is visible immediately.
  const reRank = useCallback((mutate: (m: EmailMessage) => EmailMessage) => {
    setMessages((prev) => prioritized(prev.map(mutate)));
  }, []);

  const handleOpen = useCallback(
    (message: EmailMessage) => {
      behaviorStore.record({
        messageId: message.id,
        conversationId: message.conversationId,
        senderAddress: message.sender?.address ?? null,
        action: "opened",
        secondsToAction:
          (Date.now() - new Date(message.receivedDateTime).getTime()) / 1000,
      });
      void source.markRead(message.id, true);
      reRank((m) => (m.id === message.id ? { ...m, isRead: true } : m));
      setSelected(message); // open the in-app reading + rating view
    },
    [source, reRank],
  );

  const handleRate = useCallback(
    (message: EmailMessage, rating: number) => {
      behaviorStore.record({
        messageId: message.id,
        conversationId: message.conversationId,
        senderAddress: message.sender?.address ?? null,
        action: "rated",
        rating,
      });
      // Scores change because the ranker reads the store — re-sort to reflect it.
      reRank((m) => m);
    },
    [reRank],
  );

  const markHandled = useCallback(
    (message: EmailMessage, action: "replied" | "opened") => {
      behaviorStore.record({
        messageId: message.id,
        conversationId: message.conversationId,
        senderAddress: message.sender?.address ?? null,
        action,
      });
      void source.markRead(message.id, true);
      reRank((m) => (m.id === message.id ? { ...m, isRead: true } : m));
    },
    [source, reRank],
  );

  const handleSaveDraft = useCallback(
    async (message: EmailMessage, text: string) => {
      await source.saveReplyDraft(message.id, text);
      markHandled(message, "opened");
    },
    [source, markHandled],
  );

  const handleSendReply = useCallback(
    async (message: EmailMessage, text: string) => {
      // Sending is the strongest "this mattered" learning signal.
      await source.sendReply(message.id, text);
      markHandled(message, "replied");
    },
    [source, markHandled],
  );

  const draftCount = useMemo(() => messages.filter(needsResponse).length, [messages]);

  const resetLearning = () => {
    behaviorStore.reset();
    void refresh();
  };

  return (
    <div className="screen">
      <header className="app-header">
        <div className="brandmark">
          <Logo size={34} />
          <span className="brandmark-name">Gencom Mail</span>
        </div>
        <div className="actions">
          <button onClick={() => void refresh()} disabled={loading} aria-label="Refresh">
            <RotateCw size={18} />
          </button>
          <button className="ghost with-icon" onClick={onExit}>
            <LogOut size={16} /> {demo ? "Exit" : "Sign out"}
          </button>
        </div>
      </header>

      <div className="account-row">
        <span className="account">{accountLabel}</span>
        {demo && (
          <button className="linklike" onClick={resetLearning}>
            Reset learning
          </button>
        )}
      </div>

      {error && <p className="error banner">{error}</p>}
      {loading && messages.length === 0 ? (
        <div className="spinner" />
      ) : (
        <main className="content" key={tab}>
          {tab === "brief" && (
            <Brief
              messages={messages}
              onOpen={handleOpen}
              onGoToDrafts={() => setTab("drafts")}
            />
          )}
          {tab === "priority" && <Inbox messages={messages} onOpen={handleOpen} />}
          {tab === "drafts" && (
            <Drafts
              messages={messages}
              onSaveDraft={handleSaveDraft}
              onSendReply={handleSendReply}
              demo={demo}
            />
          )}
        </main>
      )}

      <TabBar active={tab} onChange={setTab} draftCount={draftCount} />

      {selected && (
        <MessageDetail
          message={selected}
          onClose={() => setSelected(null)}
          onRate={handleRate}
        />
      )}
    </div>
  );
}
