/**
 * Shared context for injecting "extra context" into the chat panel from any
 * component on the page.
 *
 * The PIP preview flow uses this to make the 100+ pending items visible to
 * Claude before they're imported to the DB. Without this, the chat backend
 * only sees committed scope and reports "I can't see any of those items."
 *
 * Usage:
 *   const { setExtraContext } = useChatContext();
 *   useEffect(() => {
 *     setExtraContext(formatItems(previewItems));
 *     return () => setExtraContext("");  // clear on unmount
 *   }, [previewItems]);
 */

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

type ChatCtxValue = {
  extraContext: string;
  setExtraContext: (s: string) => void;
};

const ChatCtx = createContext<ChatCtxValue>({
  extraContext: "",
  setExtraContext: () => {},
});

export function ChatContextProvider({ children }: { children: ReactNode }) {
  const [extraContext, setExtraContext] = useState("");
  return (
    <ChatCtx.Provider value={{ extraContext, setExtraContext }}>
      {children}
    </ChatCtx.Provider>
  );
}

export function useChatContext(): ChatCtxValue {
  return useContext(ChatCtx);
}
