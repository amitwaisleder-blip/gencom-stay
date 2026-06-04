import Foundation

/// Scores incoming messages by predicted importance to the user.
///
/// Two-stage design that addresses the cold-start problem:
///
///   1. Rules fallback — works from event one. It scores a message using simple,
///      explainable signals plus whatever per-sender engagement history exists.
///   2. Core ML model — once enough behavior is collected, an on-device model
///      trained from `BehaviorEvent`s takes over (see `OnDeviceModel`). Until that
///      model exists, the ranker transparently uses the rules.
///
/// Everything runs on-device. No scores or features are sent anywhere.
@MainActor
final class MessageRanker {
    private let behaviorStore: BehaviorStore
    private let model: OnDeviceModel?

    init(behaviorStore: BehaviorStore, model: OnDeviceModel? = OnDeviceModel.loadIfAvailable()) {
        self.behaviorStore = behaviorStore
        self.model = model
    }

    /// A 0...1 importance score. Higher means "the user is more likely to act."
    func score(_ message: EmailMessage) -> Double {
        let features = features(for: message)
        if let model {
            return model.predictImportance(features)
        }
        return rulesScore(features)
    }

    /// Sort messages by descending importance, stable on received date for ties.
    func prioritized(_ messages: [EmailMessage]) -> [EmailMessage] {
        messages
            .map { ($0, score($0)) }
            .sorted { lhs, rhs in
                lhs.1 != rhs.1
                    ? lhs.1 > rhs.1
                    : lhs.0.receivedDateTime > rhs.0.receivedDateTime
            }
            .map { $0.0 }
    }

    // MARK: - Features

    func features(for message: EmailMessage) -> MessageFeatures {
        let senderHistory = message.sender.map { behaviorStore.events(forSender: $0.address) } ?? []
        let engagement = senderHistory.map { $0.action.engagementWeight }.reduce(0, +)
        let normalizedEngagement = senderHistory.isEmpty
            ? 0
            : engagement / Double(senderHistory.count)

        return MessageFeatures(
            senderEngagement: normalizedEngagement,
            senderInteractionCount: senderHistory.count,
            isHighImportance: message.importance == .high,
            hasAttachments: message.hasAttachments,
            isUnread: !message.isRead,
            addressedDirectly: message.toRecipients.count <= 3,
            subjectLength: message.subject.count
        )
    }

    // MARK: - Rules fallback

    private func rulesScore(_ f: MessageFeatures) -> Double {
        var score = 0.5
        score += f.senderEngagement * 0.3          // learned per-sender signal
        score += f.isHighImportance ? 0.15 : 0
        score += f.addressedDirectly ? 0.1 : -0.05 // direct beats bulk/CC blasts
        score += f.hasAttachments ? 0.05 : 0
        score += f.isUnread ? 0.05 : -0.05
        return min(max(score, 0), 1)
    }
}

/// The feature vector handed to either the rules or the Core ML model. Keeping it
/// in one place means the model and the fallback always see the same inputs.
struct MessageFeatures {
    let senderEngagement: Double      // -1...1 average engagement weight for sender
    let senderInteractionCount: Int
    let isHighImportance: Bool
    let hasAttachments: Bool
    let isUnread: Bool
    let addressedDirectly: Bool
    let subjectLength: Int
}
