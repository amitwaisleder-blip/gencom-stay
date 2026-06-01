import { useEffect, useRef, useState } from "react";
import { useChatContext } from "../lib/chatContext";

type ChatMessage = { role: "user" | "assistant"; content: string };

type Props = {
  propertyId: string;
  /** Whether the drawer is open. Controlled by parent so the toggle can live
   *  in the page header. */
  open: boolean;
  onClose: () => void;
};

const STORAGE_PREFIX = "pipbudget.chat.";

function loadHistory(propertyId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + propertyId);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* ignore */ }
  return [];
}

function saveHistory(propertyId: string, msgs: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_PREFIX + propertyId, JSON.stringify(msgs));
  } catch (_) { /* ignore */ }
}

export default function ChatPanel({ propertyId, open, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { extraContext } = useChatContext();

  useEffect(() => setMessages(loadHistory(propertyId)), [propertyId]);
  useEffect(() => saveHistory(propertyId, messages), [propertyId, messages]);

  // Auto-scroll to bottom when new content arrives.
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    const next = [...messages, userMsg, assistantMsg];
    setMessages(next);
    setInput("");
    setStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/properties/${propertyId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(0, -1).map(({ role, content }) => ({ role, content })),
          extra_context: extraContext || undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status}: ${body.slice(0, 300)}`);
      }
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accum = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accum += decoder.decode(value, { stream: true });
        setMessages((cur) => {
          const copy = [...cur];
          copy[copy.length - 1] = { role: "assistant", content: accum };
          return copy;
        });
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        // User cancelled — leave partial reply in place.
      } else {
        setError(String(e));
        setMessages((cur) => {
          const copy = [...cur];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant" && !last.content) {
            copy.pop();
          }
          return copy;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function clearHistory() {
    if (!confirm("Clear chat history for this property?")) return;
    setMessages([]);
  }

  return (
    <aside
      className={`fixed top-0 right-0 h-screen w-[420px] max-w-[92vw] bg-white border-l border-gencom-sand shadow-xl z-40 flex flex-col transition-transform duration-200 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gencom-sand">
        <div>
          <div className="font-display text-lg">Scope chat</div>
          <div className="text-[11px] text-gencom-stone">
            Context: this property's scope + metadata
            {extraContext && (
              <span className="ml-1 px-1 rounded bg-emerald-100 text-emerald-800 font-medium">
                + {extraContext.split("\n").filter((l) => l.trim()).length} pending preview items
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearHistory}
            className="text-xs text-gencom-stone hover:text-gencom-ink"
            title="Clear chat history for this property"
          >
            clear
          </button>
          <button
            onClick={onClose}
            className="text-gencom-stone hover:text-gencom-ink text-xl leading-none"
            aria-label="Close chat"
          >×</button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gencom-mist/30">
        {messages.length === 0 && (
          <div className="text-sm text-gencom-stone py-8 text-center">
            Ask a question about your scope, costs, or budget strategy.
            <div className="mt-3 text-xs italic">
              Try: "What's likely missing from my guestroom scope?"<br />
              or: "Suggest a cost for the sleeper sofa mechanism."
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-emerald-700 text-white"
                  : "bg-white border border-gencom-sand text-gencom-ink"
              }`}
            >
              {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
            </div>
          </div>
        ))}
        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
            {error}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-gencom-sand bg-white">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about this property's scope…"
            rows={2}
            className="flex-1 resize-none border border-gencom-sand rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-700"
            disabled={streaming}
          />
          {streaming ? (
            <button
              onClick={cancel}
              className="px-3 bg-gencom-sand text-gencom-ink rounded-md text-sm hover:bg-gencom-mist"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className="px-3 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800 disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
        <div className="text-[10px] text-gencom-stone mt-1 text-right">
          Enter to send · Shift+Enter for newline
        </div>
      </div>
    </aside>
  );
}
