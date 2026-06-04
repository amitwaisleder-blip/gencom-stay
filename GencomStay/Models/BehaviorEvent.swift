import Foundation

/// A single observed user action on a message. These events are the raw training
/// signal for the on-device learning system. They never leave the device.
struct BehaviorEvent: Codable, Identifiable {
    let id: UUID
    let messageId: String
    let conversationId: String?
    let senderAddress: String?
    let action: Action
    let occurredAt: Date

    /// Seconds between the message arriving and the user acting on it, when known.
    /// A strong signal: fast replies indicate importance, long ignores the opposite.
    let secondsToAction: TimeInterval?

    enum Action: String, Codable, CaseIterable {
        case opened
        case replied
        case forwarded
        case archived
        case deleted
        case flagged
        case ignored   // surfaced to the user but no action taken within a window
    }

    init(
        messageId: String,
        conversationId: String?,
        senderAddress: String?,
        action: Action,
        occurredAt: Date = .now,
        secondsToAction: TimeInterval? = nil
    ) {
        self.id = UUID()
        self.messageId = messageId
        self.conversationId = conversationId
        self.senderAddress = senderAddress
        self.action = action
        self.occurredAt = occurredAt
        self.secondsToAction = secondsToAction
    }
}

extension BehaviorEvent.Action {
    /// How strongly an action implies the user cared about the message.
    /// Used by the rules-based fallback ranker before the Core ML model is trained.
    var engagementWeight: Double {
        switch self {
        case .replied:   return 1.0
        case .forwarded: return 0.8
        case .flagged:   return 0.7
        case .opened:    return 0.3
        case .archived:  return -0.2
        case .ignored:   return -0.4
        case .deleted:   return -0.8
        }
    }
}
