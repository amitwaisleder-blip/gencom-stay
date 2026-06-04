import SwiftUI

/// Switches between the sign-in screen and the prioritized inbox based on auth.
struct RootView: View {
    @EnvironmentObject private var session: AppSession

    var body: some View {
        Group {
            switch session.authState {
            case .signedOut, .failed:
                SignInView()
            case .restoring:
                ProgressView("Restoring session…")
            case .signedIn:
                InboxView()
            }
        }
        .task {
            if case .signedOut = session.authState {
                await session.bootstrap()
            }
        }
    }
}
