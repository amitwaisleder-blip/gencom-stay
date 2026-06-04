// Domain types shared across the app. Kept free of any Microsoft Graph wire shape
// so the UI and learning code never depend on the API's format.

export interface Recipient {
  name: string;
  address: string;
}

export type Importance = "low" | "normal" | "high";

/** A normalized email message ready to display and learn from. */
export interface EmailMessage {
  id: string;
  conversationId: string | null;
  subject: string;
  sender: Recipient | null;
  toRecipients: Recipient[];
  receivedDateTime: string; // ISO-8601
  bodyPreview: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: Importance;
  webLink: string | null;
}

/** A single observed action. These are the raw training signal and stay on-device. */
export interface BehaviorEvent {
  id: string;
  messageId: string;
  conversationId: string | null;
  senderAddress: string | null;
  action: BehaviorAction;
  occurredAt: string; // ISO-8601
  /** Seconds between arrival and action, when known. */
  secondsToAction: number | null;
}

export type BehaviorAction =
  | "opened"
  | "replied"
  | "forwarded"
  | "archived"
  | "deleted"
  | "flagged"
  | "ignored";

/** How strongly an action implies the user cared. Used by the rules ranker. */
export const ENGAGEMENT_WEIGHT: Record<BehaviorAction, number> = {
  replied: 1.0,
  forwarded: 0.8,
  flagged: 0.7,
  opened: 0.3,
  archived: -0.2,
  ignored: -0.4,
  deleted: -0.8,
};

export function senderDisplay(message: EmailMessage): string {
  if (!message.sender) return "(unknown sender)";
  return message.sender.name || message.sender.address;
}
