import type { EmailMessage } from "../models/types";
import type { MailSource } from "../models/mailSource";
import { sampleInbox } from "./sampleInbox";

/**
 * In-memory MailSource backed by sample data, so the full experience runs with no
 * Microsoft account. State is mutable: marking a message read updates it in place,
 * which—combined with the behavior log—lets demo mode show the ranking adapt live.
 */
export class DemoMailSource implements MailSource {
  private messages: EmailMessage[] = sampleInbox();

  async fetchInbox(): Promise<EmailMessage[]> {
    // Return copies so callers can't mutate our store directly.
    return this.messages.map((m) => ({ ...m }));
  }

  async markRead(messageId: string, isRead = true): Promise<void> {
    const msg = this.messages.find((m) => m.id === messageId);
    if (msg) msg.isRead = isRead;
  }

  // Simulated in demo mode (no real mailbox). The short delay lets the UI show its
  // loading state so the flow feels real.
  async saveReplyDraft(messageId: string): Promise<void> {
    await this.delay();
    await this.markRead(messageId, true);
  }

  async sendReply(messageId: string): Promise<void> {
    await this.delay();
    await this.markRead(messageId, true);
  }

  private delay(ms = 650): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
