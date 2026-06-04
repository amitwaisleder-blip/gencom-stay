import type { EmailMessage } from "../models/types";
import { MessageRow } from "./MessageRow";

/** Presentational priority list. Fetching and state live in MailScreen. */
export function Inbox({
  messages,
  onOpen,
}: {
  messages: EmailMessage[];
  onOpen: (m: EmailMessage) => void;
}) {
  if (messages.length === 0) {
    return <p className="empty">No messages.</p>;
  }
  return (
    <ul className="message-list">
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} onOpen={() => onOpen(m)} />
      ))}
    </ul>
  );
}
