import SwiftUI

/// Entry point for the gencom-stay companion app.
///
/// gencom-stay is a native Apple companion to Outlook. It does not replace the
/// inbox; it signs into the user's Microsoft account via MSAL, reads mail through
/// the Microsoft Graph API, observes how the user handles messages, and learns
/// — entirely on-device — to surface what matters.
@main
struct GencomStayApp: App {
    @StateObject private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
        }
    }
}

/// Top-level observable state shared across the app: who's signed in and the
/// services that depend on that identity.
@MainActor
final class AppSession: ObservableObject {
    @Published private(set) var authState: AuthState = .signedOut

    let auth: AuthManager
    let behaviorStore: BehaviorStore

    private(set) var graph: GraphClient?
    private(set) var ranker: MessageRanker?

    init() {
        self.auth = AuthManager()
        self.behaviorStore = BehaviorStore()
    }

    func bootstrap() async {
        authState = .restoring
        if let token = await auth.restoreSession() {
            configureSignedIn(with: token)
        } else {
            authState = .signedOut
        }
    }

    func signIn() async {
        do {
            let token = try await auth.signIn()
            configureSignedIn(with: token)
        } catch {
            authState = .failed(error.localizedDescription)
        }
    }

    func signOut() async {
        await auth.signOut()
        graph = nil
        ranker = nil
        authState = .signedOut
    }

    private func configureSignedIn(with token: AccessToken) {
        let graph = GraphClient(tokenProvider: auth)
        self.graph = graph
        self.ranker = MessageRanker(behaviorStore: behaviorStore)
        authState = .signedIn(account: token.accountDisplayName)
    }
}

enum AuthState: Equatable {
    case signedOut
    case restoring
    case signedIn(account: String)
    case failed(String)
}
