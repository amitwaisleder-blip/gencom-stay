import type { EmailMessage } from "../models/types";
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
export class GraphClient {
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
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Graph request failed (${res.status}): ${body}`);
    }
    // PATCH to messages returns the updated entity; callers that ignore it are fine.
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
