# gencom-stay

A **Progressive Web App (PWA)** companion for **Outlook**. It does not replace the
inbox — it signs into a Microsoft account, reads mail through the **Microsoft Graph
API**, learns **on-device** which messages matter, and shows a prioritized view.

Built as a PWA so it needs **no Mac, no Apple Developer account, and no App Store**:
your boss just opens a link in Safari on his iPhone/iPad and taps *Share → Add to
Home Screen*. It then behaves like a real app (own icon, full-screen, offline shell).
If he likes it, the same product can later be wrapped into a real App Store app.

## Design decisions

| Question | Decision |
| --- | --- |
| Platform | PWA — works on iPhone/iPad (and anywhere), developed on Windows |
| Relationship to Outlook | **Companion** via Microsoft Graph + MSAL.js — not a replacement client |
| Where the learning runs | **On-device** (in the browser); behavior data never leaves the device |
| Cold start | Explainable rules ranker works from day one; in-browser ML can replace it later |
| Account | Prototype against your own Outlook account first |

Only read/triage Graph scopes are requested (`User.Read`, `Mail.Read`,
`Mail.ReadWrite`). The prototype never sends mail.

### How it learns from someone who only uses the stock Outlook app

iOS won't let this app watch *inside* Outlook — but it doesn't need to. Microsoft
Graph reflects the real mailbox, so the app can see which messages were read,
replied to, flagged, or deleted regardless of which app did it. Those signals feed
the on-device ranker. (The current build records actions taken *in this app*; a
follow-up will also diff mailbox state via Graph to capture actions taken elsewhere.)

## Project layout

```
src/
  auth/        msalConfig.ts (Azure values), AuthProvider.tsx (sign-in, tokens)
  graph/       graphClient.ts (REST), graphTypes.ts (wire types -> EmailMessage)
  models/      types.ts (EmailMessage, BehaviorEvent, engagement weights)
  storage/     behaviorStore.ts (on-device event log, localStorage)
  learning/    ranker.ts (rules-based importance scoring + features)
  components/   SignIn, Inbox, MessageRow
  App.tsx, main.tsx, styles.css
public/        icons + favicon
```

## Run it locally (on Windows)

```bash
npm install
cp .env.local.example .env.local   # then paste your Azure client id
npm run dev                         # opens http://localhost:5173
```

`npm run build` produces a deployable `dist/`. `npm run preview` serves it.

## Connect it to Outlook (Azure app registration)

1. portal.azure.com → **App registrations** → **New registration**.
2. **Supported account types:** "Accounts in any organizational directory and
   personal Microsoft accounts" (so a personal Outlook account works).
3. **Platform configuration → Single-page application.** Add redirect URIs:
   - `http://localhost:5173` (local dev)
   - your deployed PWA URL (see Deploy below)
4. **API permissions → Microsoft Graph → Delegated:** `User.Read`, `Mail.Read`,
   `Mail.ReadWrite`. Personal accounts grant these on consent (no admin needed).
5. Copy the **Application (client) ID** into `.env.local` as `VITE_MSAL_CLIENT_ID`.

## Deploy on Cloudflare Pages (so your boss can install it)

The app is fully static, deployed via Cloudflare Pages' GitHub integration — every
push to the branch auto-builds and publishes over HTTPS (required for PWAs).

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → pick this repo and the branch.
2. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Environment variables** → add `VITE_MSAL_CLIENT_ID` = your Azure client id
   (it's public, not a secret, so this is safe). The build reads it.
4. Save and deploy. Cloudflare gives you a URL like `https://gencom-stay.pages.dev`.
5. Add that URL as a **Single-page application** redirect URI in the Azure
   registration (see step 3 above), then send your boss the link. On his
   iPhone/iPad he opens it in Safari and taps **Share → Add to Home Screen**.

## Status

- [x] PWA shell: installable, offline app shell, iOS-friendly manifest/meta
- [x] Microsoft sign-in via MSAL.js (redirect flow, personal accounts)
- [x] Microsoft Graph inbox read + mark-as-read
- [x] On-device behavior logging (privacy-preserving, stays in the browser)
- [x] Rules-based priority ranker (works from day one)
- [ ] Background Graph polling to learn actions taken in the stock Outlook app
- [ ] In-browser ML model (TensorFlow.js / ONNX Runtime Web) to replace the rules
- [ ] Web push notifications for high-priority mail (iOS 16.4+ supports this for
      home-screen PWAs)
