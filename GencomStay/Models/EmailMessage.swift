import Foundation

/// A normalized email message decoded from a Microsoft Graph `message` resource.
///
/// We intentionally keep only the fields needed to display a message and to learn
/// from how the user handles it. Bodies are fetched lazily and not retained here.
struct EmailMessage: Identifiable, Hashable, Codable {
    let id: String
    let conversationId: String?
    let subject: String
    let sender: Recipient?
    let toRecipients: [Recipient]
    let receivedDateTime: Date
    let bodyPreview: String
    let isRead: Bool
    let hasAttachments: Bool
    let importance: Importance
    let webLink: URL?

    enum Importance: String, Codable {
        case low, normal, high
    }

    struct Recipient: Hashable, Codable {
        let name: String
        let address: String
    }
}

extension EmailMessage {
    /// A short label suitable for list rows.
    var senderDisplay: String {
        guard let sender else { return "(unknown sender)" }
        return sender.name.isEmpty ? sender.address : sender.name
    }
}
