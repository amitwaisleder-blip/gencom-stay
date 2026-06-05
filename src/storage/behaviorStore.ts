import type { BehaviorAction, BehaviorEvent } from "../models/types";

// On-device persistence for observed behavior events.
//
// Privacy is a first-class requirement: these events describe how the user (and,
// in the real deployment, the boss) handles email. They MUST stay on the device,
// so we persist to the browser's localStorage and never transmit them anywhere.
// The surface is intentionally tiny so we can later swap to IndexedDB without
// changing callers.

const STORAGE_KEY = "gencom-stay.behavior-events";

function loadAll(): BehaviorEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BehaviorEvent[]) : [];
  } catch {
    return [];
  }
}

function saveAll(events: BehaviorEvent[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

export const behaviorStore = {
  all(): BehaviorEvent[] {
    return loadAll();
  },

  record(input: {
    messageId: string;
    conversationId: string | null;
    senderAddress: string | null;
    action: BehaviorAction;
    secondsToAction?: number | null;
    rating?: number | null;
  }): BehaviorEvent {
    const event: BehaviorEvent = {
      id: crypto.randomUUID(),
      messageId: input.messageId,
      conversationId: input.conversationId,
      senderAddress: input.senderAddress,
      action: input.action,
      occurredAt: new Date().toISOString(),
      secondsToAction: input.secondsToAction ?? null,
      rating: input.rating ?? null,
    };
    const events = loadAll();
    events.push(event);
    saveAll(events);
    return event;
  },

  /** All events for a given sender — the basis for per-sender personalization. */
  forSender(address: string): BehaviorEvent[] {
    const lower = address.toLowerCase();
    return loadAll().filter((e) => e.senderAddress?.toLowerCase() === lower);
  },

  /** Wipe all learned behavior. Exposed to the user so they stay in control. */
  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
  },
};
