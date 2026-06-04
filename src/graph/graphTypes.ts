// Microsoft Graph wire-format types and the mapping into our domain model.
// Isolated here so nothing else depends on Graph's JSON shape.

import type { EmailMessage, Importance } from "../models/types";

export interface GraphCollection<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

interface GraphEmailAddress {
  name?: string;
  address?: string;
}

interface GraphRecipient {
  emailAddress?: GraphEmailAddress;
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  bodyPreview?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  importance?: string;
  webLink?: string;
}

export function normalizeMessage(m: GraphMessage): EmailMessage {
  const fromAddr = m.from?.emailAddress;
  return {
    id: m.id,
    conversationId: m.conversationId ?? null,
    subject: m.subject || "(no subject)",
    sender: fromAddr
      ? { name: fromAddr.name ?? "", address: fromAddr.address ?? "" }
      : null,
    toRecipients: (m.toRecipients ?? [])
      .map((r) => r.emailAddress)
      .filter((a): a is GraphEmailAddress => !!a)
      .map((a) => ({ name: a.name ?? "", address: a.address ?? "" })),
    receivedDateTime: m.receivedDateTime ?? new Date(0).toISOString(),
    bodyPreview: m.bodyPreview ?? "",
    isRead: m.isRead ?? false,
    hasAttachments: m.hasAttachments ?? false,
    importance: (["low", "normal", "high"].includes(m.importance ?? "")
      ? m.importance
      : "normal") as Importance,
    webLink: m.webLink ?? null,
  };
}
