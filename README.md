# gencom-stay

A native **Apple** (Swift / SwiftUI) companion app for **Outlook**. It does *not*
replace the inbox — it signs into a Microsoft account, reads mail through the
**Microsoft Graph API**, and learns **on-device** which messages matter, then
surfaces a prioritized view.

## Design decisions

| Question | Decision |
| --- | --- |
| Platform | Apple-only, native Swift/SwiftUI (macOS + iOS shared codebase) |
| Relationship to Outlook | **Companion**, via Microsoft Graph + MSAL sign-in — not a replacement client |
| Where ML runs | **On-device** (Core ML), with an explainable rules fallback for cold start |
| Account | Prototype against your own Outlook account first |

Only read/triage Graph scopes are requested (`Mail.Read`, `Mail.ReadWrite`,
`User.Read`). The prototype never sends mail. Behavior data never leaves the device.

## Project layout

```
GencomStay/
  App/        GencomStayApp.swift, AppSession (auth + service wiring)
  Auth/       AuthManager (MSAL wrapper), MSALConfig (Azure values to fill in)
  Graph/      GraphClient (REST), GraphDTO (wire types → EmailMessage)
  Models/     EmailMessage, BehaviorEvent
  Storage/    BehaviorStore (on-device event log)
  Learning/   MessageRanker (rules + model), OnDeviceModel (Core ML hook)
  Views/      RootView, SignInView, InboxView
```

## Getting it running (on your Mac)

> Note: these source files were authored in a Linux CI environment that has no
> Xcode toolchain, so they have **not** been compiled. The first Xcode build may
> surface small adjustments — that's expected.

1. **Create the app target.** In Xcode: *File → New → Project → Multiplatform → App*,
   name it `GencomStay`. Delete the generated `ContentView`/`App` stubs and add the
   files under `GencomStay/` to the target.
2. **Add MSAL.** *File → Add Package Dependencies* →
   `https://github.com/AzureAD/microsoft-authentication-library-for-objc`.
3. **Register an Azure app.** portal.azure.com → *App registrations* → *New*.
   - Account types: personal + work/school accounts.
   - Add an iOS/macOS redirect URI for your bundle id.
   - API permissions (delegated Graph): `Mail.Read`, `Mail.ReadWrite`, `User.Read`.
4. **Fill in `MSALConfig.swift`** with your client id, redirect URI, and bundle id,
   and add the `msauth.<bundle-id>` URL scheme to Info.plist.
5. **Implement the MSAL calls** marked `TODO(MSAL)` in `AuthManager.swift`
   (interactive + silent token acquisition). The rest of the app is wired to consume
   the resulting token.
6. **Build & run.** Sign in, and the Priority Inbox loads your mail ranked by the
   rules engine. As you interact, `BehaviorStore` records events that will later
   train the Core ML model (`TODO(CoreML)` in `OnDeviceModel.swift`).

## Status

- [x] App skeleton, navigation, auth state machine
- [x] Microsoft Graph inbox read + mark-as-read
- [x] On-device behavior logging
- [x] Rules-based ranker (works from day one)
- [ ] MSAL token acquisition (stubbed — see `TODO(MSAL)`)
- [ ] Core ML importance model + on-device training (stubbed — see `TODO(CoreML)`)
