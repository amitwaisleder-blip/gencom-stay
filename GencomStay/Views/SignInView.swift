import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var session: AppSession
    @State private var isSigningIn = false

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "tray.full")
                .font(.system(size: 48))
                .foregroundStyle(.tint)

            Text("gencom-stay")
                .font(.largeTitle.bold())
            Text("A companion to Outlook that learns what matters — on your device.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button {
                Task {
                    isSigningIn = true
                    await session.signIn()
                    isSigningIn = false
                }
            } label: {
                Label("Sign in with Microsoft", systemImage: "person.crop.circle")
                    .frame(maxWidth: 280)
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSigningIn)

            if case .failed(let message) = session.authState {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(40)
        .frame(maxWidth: 460)
    }
}
