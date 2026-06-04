import type { EmailMessage } from "../models/types";
import type { MailSource } from "../models/mailSource";
import {
  normalizeMessage,
  type GraphCollection,
  type GraphMessage,
} from "./graphTypes";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * Thin client over the Microsoft Graph REST API for reading and triaging mail.
 * Every request attaches a fresh bearer token from the supplied async getter, so
 * token refresh stays entirely in the auth layer.
 */
export class GraphClient implements MailSource {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  /** Fetch recent inbox messages, newest first. */
  async fetchInbox(top = 50): Promise<EmailMessage[]> {
    const select = [
      "id",
      "conversationId",
      "subject",
      "from",
      "toRecipients",
      "receivedDateTime",
      "bodyPreview",
      "isRead",
      "hasAttachments",
      "importance",
      "webLink",
    ].join(",");
    const url =
      `${GRAPH_BASE}/me/mailFolders/inbox/messages` +
      `?$top=${top}&$orderby=receivedDateTime desc&$select=${select}`;

    const data = await this.request<GraphCollection<GraphMessage>>(url);
    return data.value.map(normalizeMessage);
  }

  /** Mark a message read/unread on the server (mirrors the user opening it). */
  async markRead(messageId: string, isRead = true): Promise<void> {
    await this.request(`${GRAPH_BASE}/me/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ isRead }),
    });
  }

  /**
   * Create a reply draft in Outlook. Graph's createReply builds a draft in the
   * original thread (with the quoted message); `comment` is our text, placed above
   * the quote. The draft lands in the user's Outlook Drafts folder. Needs Mail.ReadWrite.
   */
  async saveReplyDraft(messageId: string, bodyText: string): Promise<void> {
    await this.request(`${GRAPH_BASE}/me/messages/${messageId}/createReply`, {
      method: "POST",
      body: JSON.stringify({ comment: GraphClient.toHtml(bodyText) }),
    });
  }

  /** Send a reply in the original thread in one call. Needs Mail.Send. */
  async sendReply(messageId: string, bodyText: string): Promise<void> {
    await this.request(`${GRAPH_BASE}/me/messages/${messageId}/reply`, {
      method: "POST",
      body: JSON.stringify({ comment: GraphClient.toHtml(bodyText) }),
    });
  }

  /** Escape text and preserve line breaks for the HTML mail body. */
  private static toHtml(text: string): string {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped.replace(/\r?\n/g, "<br>");
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    // Read once: send/reply return 202 with no body, createReply 201, PATCH 200.
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`Graph request failed (${res.status}): ${text}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
