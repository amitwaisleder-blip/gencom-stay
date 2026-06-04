import Foundation

/// Wire-format types matching Microsoft Graph JSON, kept separate from the app's
/// domain model so the rest of the code never depends on Graph's shape.

struct GraphCollection<T: Decodable>: Decodable {
    let value: [T]
    /// Present when more pages are available (`@odata.nextLink`).
    let nextLink: URL?

    enum CodingKeys: String, CodingKey {
        case value
        case nextLink = "@odata.nextLink"
    }
}

struct GraphMessage: Decodable {
    let id: String
    let conversationId: String?
    let subject: String?
    let from: GraphRecipientWrapper?
    let toRecipients: [GraphRecipientWrapper]?
    let receivedDateTime: Date?
    let bodyPreview: String?
    let isRead: Bool?
    let hasAttachments: Bool?
    let importance: String?
    let webLink: String?

    func normalized() -> EmailMessage {
        EmailMessage(
            id: id,
            conversationId: conversationId,
            subject: subject ?? "(no subject)",
            sender: from?.emailAddress.map {
                EmailMessage.Recipient(name: $0.name ?? "", address: $0.address ?? "")
            },
            toRecipients: (toRecipients ?? []).compactMap { wrapper in
                wrapper.emailAddress.map {
                    EmailMessage.Recipient(name: $0.name ?? "", address: $0.address ?? "")
                }
            },
            receivedDateTime: GraphMessage.parseDate(receivedDateTime),
            bodyPreview: bodyPreview ?? "",
            isRead: isRead ?? false,
            hasAttachments: hasAttachments ?? false,
            importance: EmailMessage.Importance(rawValue: importance ?? "normal") ?? .normal,
            webLink: webLink.flatMap(URL.init(string:))
        )
    }

    /// Graph returns ISO-8601 with fractional seconds; `receivedDateTime` here is
    /// already a Date if the decoder is configured for ISO-8601, but we guard the
    /// optional to keep decoding resilient.
    private static func parseDate(_ date: Date?) -> Date {
        date ?? Date(timeIntervalSince1970: 0)
    }
}

struct GraphRecipientWrapper: Decodable {
    let emailAddress: GraphEmailAddress?
}

struct GraphEmailAddress: Decodable {
    let name: String?
    let address: String?
}
