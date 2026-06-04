import Foundation

/// Supplies a current access token to anything that calls Microsoft Graph.
protocol TokenProviding: AnyObject {
    func currentAccessToken() async throws -> String
}

struct AccessToken {
    let value: String
    let expiresOn: Date
    let accountDisplayName: String
}

enum AuthError: LocalizedError {
    case notConfigured
    case interactiveSignInRequired
    case msalUnavailable(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "MSAL is not configured. Fill in your Azure app registration in MSALConfig."
        case .interactiveSignInRequired:
            return "Interactive sign-in is required."
        case .msalUnavailable(let detail):
            return "MSAL error: \(detail)"
        }
    }
}

/// Wraps the Microsoft Authentication Library (MSAL).
///
/// This is the integration point with MSAL. The real implementation creates an
/// `MSALPublicClientApplication` from `MSALConfig`, performs interactive and silent
/// token acquisition, and caches the account. Until the MSAL SwiftPM dependency is
/// added in Xcode, the methods are stubbed so the rest of the app compiles and the
/// flow can be reasoned about.
///
/// See MSALConfig.swift for the values to fill in from the Azure portal.
@MainActor
final class AuthManager: TokenProviding {
    private var cachedToken: AccessToken?

    /// Attempt a silent sign-in from a cached account on launch.
    func restoreSession() async -> AccessToken? {
        // TODO(MSAL): acquireTokenSilent(forScopes:account:) using the cached account.
        return cachedToken
    }

    /// Present the interactive sign-in UI and acquire a token.
    func signIn() async throws -> AccessToken {
        guard MSALConfig.isConfigured else { throw AuthError.notConfigured }
        // TODO(MSAL): acquireToken(with: interactiveParameters) and store the account.
        throw AuthError.msalUnavailable("Add the MSAL package and implement signIn().")
    }

    func signOut() async {
        cachedToken = nil
        // TODO(MSAL): remove(account:) from the MSAL cache.
    }

    // MARK: TokenProviding

    func currentAccessToken() async throws -> String {
        if let token = cachedToken, token.expiresOn > Date().addingTimeInterval(60) {
            return token.value
        }
        // TODO(MSAL): refresh silently; fall back to interactive only if needed.
        throw AuthError.interactiveSignInRequired
    }
}
