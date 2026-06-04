import SwiftUI

/// The prioritized inbox: messages from Outlook, reordered by the on-device ranker,
/// with user actions recorded as behavior events that feed learning.
struct InboxView: View {
    @EnvironmentObject private var session: AppSession
    @State private var messages: [EmailMessage] = []
    @State private var loadError: String?
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            List(messages) { message in
                MessageRow(message: message, score: session.ranker?.score(message) ?? 0)
                    .contentShape(Rectangle())
                    .onTapGesture { handleOpen(message) }
            }
            .overlay { if isLoading { ProgressView() } }
            .navigationTitle("Priority Inbox")
            .toolbar {
                Button {
                    Task { await refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
            }
            .task { await refresh() }
            .alert("Couldn't load mail", isPresented: .constant(loadError != nil)) {
                Button("OK") { loadError = nil }
            } message: {
                Text(loadError ?? "")
            }
        }
    }

    private func refresh() async {
        guard let graph = session.graph, let ranker = session.ranker else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let inbox = try await graph.fetchInbox()
            messages = ranker.prioritized(inbox)
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func handleOpen(_ message: EmailMessage) {
        // Record the behavior signal first; learning happens regardless of network.
        session.behaviorStore.record(
            BehaviorEvent(
                messageId: message.id,
                conversationId: message.conversationId,
                senderAddress: message.sender?.address,
                action: .opened,
                secondsToAction: Date().timeIntervalSince(message.receivedDateTime)
            )
        )
        if let link = message.webLink {
            #if os(macOS)
            NSWorkspace.shared.open(link)
            #else
            UIApplication.shared.open(link)
            #endif
        }
    }
}

private struct MessageRow: View {
    let message: EmailMessage
    let score: Double

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            PriorityDot(score: score)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(message.senderDisplay)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer()
                    Text(message.receivedDateTime, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(message.subject)
                    .font(.subheadline)
                    .lineLimit(1)
                Text(message.bodyPreview)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            .fontWeight(message.isRead ? .regular : .semibold)
        }
        .padding(.vertical, 4)
    }
}

private struct PriorityDot: View {
    let score: Double

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
            .padding(.top, 6)
            .help("Predicted importance: \(Int(score * 100))%")
    }

    private var color: Color {
        switch score {
        case 0.66...:    return .red
        case 0.4..<0.66: return .orange
        default:         return .gray
        }
    }
}
