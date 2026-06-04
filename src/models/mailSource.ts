import type { EmailMessage } from "./types";

/**
 * A source of mail the inbox can read and triage. Two implementations exist:
 *   - GraphClient: the real Microsoft Graph backend (needs Azure sign-in).
 *   - DemoMailSource: in-memory sample data so the whole UX runs with no account.
 * Keeping the UI behind this interface means demo and real modes share one code path.
 */
export interface MailSource {
  fetchInbox(top?: number): Promise<EmailMessage[]>;
  markRead(messageId: string, isRead?: boolean): Promise<void>;
  /** Create a reply draft in Outlook (in the original thread) without sending. */
  saveReplyDraft(messageId: string, bodyText: string): Promise<void>;
  /** Send a reply to the message immediately, in the original thread. */
  sendReply(messageId: string, bodyText: string): Promise<void>;
}
