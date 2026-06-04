import Foundation

/// Configuration for the Azure AD app registration that backs sign-in.
///
/// To get these values:
///   1. Go to portal.azure.com → "App registrations" → "New registration".
///   2. Supported account types: "Accounts in any organizational directory and
///      personal Microsoft accounts" (so a personal Outlook account works for the
///      prototype).
///   3. Add a Redirect URI of platform "iOS/macOS" with your bundle id. MSAL also
///      requires the `msauth.<bundle-id>://auth` URL scheme in Info.plist.
///   4. Under "API permissions" add delegated Microsoft Graph permissions:
///      Mail.Read, Mail.ReadWrite (to flag/archive), and User.Read. Personal
///      accounts grant these on consent — no admin needed for read scopes.
///
/// Only read/triage scopes are requested. The prototype never requests Mail.Send.
enum MSALConfig {
    /// Application (client) ID from the Azure app registration.
    static let clientId = "<YOUR_AZURE_CLIENT_ID>"

    /// "common" lets both personal and work/school accounts sign in.
    static let authority = "https://login.microsoftonline.com/common"

    /// Must match the redirect URI registered in Azure.
    static let redirectUri = "msauth.<YOUR_BUNDLE_ID>://auth"

    /// Delegated Graph scopes. Least privilege for an on-device triage prototype.
    static let scopes = ["Mail.Read", "Mail.ReadWrite", "User.Read"]

    static var isConfigured: Bool {
        !clientId.contains("<") && !redirectUri.contains("<")
    }
}
