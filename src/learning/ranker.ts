import { ENGAGEMENT_WEIGHT, type EmailMessage } from "../models/types";
import { behaviorStore } from "../storage/behaviorStore";

// Scores incoming messages by predicted importance to the user.
//
// This is the rules-based stage that solves the cold-start problem: it works from
// the very first message using simple, explainable signals plus whatever per-sender
// engagement history exists. As behavior accumulates, a later in-browser ML model
// (TensorFlow.js / ONNX Runtime Web) can replace `rulesScore` with a learned one,
// consuming the same MessageFeatures. Everything runs on-device.

export interface MessageFeatures {
  senderEngagement: number; // -1..1 average engagement weight for the sender
  senderInteractionCount: number;
  isHighImportance: boolean;
  hasAttachments: boolean;
  isUnread: boolean;
  addressedDirectly: boolean; // small recipient list => likely meant for the user
}

export function features(message: EmailMessage): MessageFeatures {
  const history = message.sender
    ? behaviorStore.forSender(message.sender.address)
    : [];
  const engagementSum = history.reduce(
    (sum, e) => sum + ENGAGEMENT_WEIGHT[e.action],
    0,
  );
  const senderEngagement = history.length ? engagementSum / history.length : 0;

  return {
    senderEngagement,
    senderInteractionCount: history.length,
    isHighImportance: message.importance === "high",
    hasAttachments: message.hasAttachments,
    isUnread: !message.isRead,
    addressedDirectly: message.toRecipients.length <= 3,
  };
}

/** A 0..1 importance score. Higher means "more likely the user will act." */
export function score(message: EmailMessage): number {
  const f = features(message);
  let s = 0.5;
  s += f.senderEngagement * 0.3; // learned per-sender signal
  s += f.isHighImportance ? 0.15 : 0;
  s += f.addressedDirectly ? 0.1 : -0.05; // direct beats bulk/CC blasts
  s += f.hasAttachments ? 0.05 : 0;
  s += f.isUnread ? 0.05 : -0.05;
  return Math.min(Math.max(s, 0), 1);
}

/** Sort by descending importance, stable on received date for ties. */
export function prioritized(messages: EmailMessage[]): EmailMessage[] {
  return messages
    .map((m) => ({ m, s: score(m) }))
    .sort((a, b) =>
      a.s !== b.s
        ? b.s - a.s
        : b.m.receivedDateTime.localeCompare(a.m.receivedDateTime),
    )
    .map((x) => x.m);
}
