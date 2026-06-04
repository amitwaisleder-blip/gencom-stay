import Foundation

/// A thin client over the Microsoft Graph REST API for reading and triaging mail.
///
/// All requests attach a bearer token fetched from the `TokenProviding` source, so
/// token refresh stays in one place (AuthManager). Responses are decoded into the
/// app's normalized `EmailMessage` model rather than exposing Graph's wire format.
actor GraphClient {
    private let baseURL = URL(string: "https://graph.microsoft.com/v1.0")!
    private let tokenProvider: TokenProviding
    private let session: URLSession
    private let decoder: JSONDecoder

    init(tokenProvider: TokenProviding, session: URLSession = .shared) {
        self.tokenProvider = tokenProvider
        self.session = session
        let decoder = JSONDecoder()
        // Graph timestamps are ISO-8601 (e.g. "2026-06-04T18:13:00Z").
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    /// Fetch the most recent messages from the inbox, newest first.
    func fetchInbox(top: Int = 50) async throws -> [EmailMessage] {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("me/mailFolders/inbox/messages"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [
            URLQueryItem(name: "$top", value: String(top)),
            URLQueryItem(name: "$orderby", value: "receivedDateTime desc"),
            URLQueryItem(name: "$select",
                         value: "id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,hasAttachments,importance,webLink")
        ]
        let request = try await authorizedRequest(url: components.url!)
        let (data, response) = try await session.data(for: request)
        try Self.validate(response, data: data)
        let envelope = try decoder.decode(GraphCollection<GraphMessage>.self, from: data)
        return envelope.value.map { $0.normalized() }
    }

    /// Mark a message as read on the server (mirrors a user opening it).
    func markRead(messageId: String, isRead: Bool = true) async throws {
        let url = baseURL.appendingPathComponent("me/messages/\(messageId)")
        var request = try await authorizedRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["isRead": isRead])
        let (data, response) = try await session.data(for: request)
        try Self.validate(response, data: data)
    }

    // MARK: - Internals

    private func authorizedRequest(url: URL) async throws -> URLRequest {
        let token = try await tokenProvider.currentAccessToken()
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    private static func validate(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw GraphError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw GraphError.http(status: http.statusCode, body: body)
        }
    }
}

enum GraphError: LocalizedError {
    case invalidResponse
    case http(status: Int, body: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Unexpected response from Microsoft Graph."
        case .http(let status, let body):
            return "Graph request failed (\(status)): \(body)"
        }
    }
}
