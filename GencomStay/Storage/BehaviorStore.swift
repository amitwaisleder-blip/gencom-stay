import Foundation

/// On-device persistence for observed behavior events.
///
/// Privacy is a first-class requirement: these events describe how the user (or,
/// in the real deployment, their boss) handles email, and they MUST stay on the
/// device. This store writes to the app's Application Support directory as a local
/// JSON log. A future iteration can swap this for Core Data / SQLite without
/// changing callers, since the surface here is intentionally small.
@MainActor
final class BehaviorStore: ObservableObject {
    @Published private(set) var events: [BehaviorEvent] = []

    private let fileURL: URL

    init(filename: String = "behavior-events.json") {
        let base = FileManager.default.urls(for: .applicationSupportDirectory,
                                            in: .userDomainMask).first!
        let dir = base.appendingPathComponent("GencomStay", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent(filename)
        load()
    }

    func record(_ event: BehaviorEvent) {
        events.append(event)
        persist()
    }

    /// All events for a given sender — the basis for "does the user engage with
    /// this person" personalization.
    func events(forSender address: String) -> [BehaviorEvent] {
        events.filter { $0.senderAddress?.caseInsensitiveCompare(address) == .orderedSame }
    }

    /// Wipe all learned behavior. Exposed to the user so they stay in control of
    /// their data.
    func reset() {
        events.removeAll()
        try? FileManager.default.removeItem(at: fileURL)
    }

    // MARK: - Persistence

    private func load() {
        guard let data = try? Data(contentsOf: fileURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        events = (try? decoder.decode([BehaviorEvent].self, from: data)) ?? []
    }

    private func persist() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(events) else { return }
        try? data.write(to: fileURL, options: [.atomic])
    }
}
