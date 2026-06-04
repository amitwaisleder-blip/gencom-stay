import type { Configuration, PopupRequest } from "@azure/msal-browser";

// Configuration for the Azure AD app registration that backs Microsoft sign-in
// from the browser (MSAL.js, single-page-app flow with PKCE).
//
// To get these values:
//   1. portal.azure.com -> "App registrations" -> "New registration".
//   2. Supported account types: "Accounts in any organizational directory and
//      personal Microsoft accounts" (so a personal Outlook account works).
//   3. Platform configuration: add a "Single-page application" redirect URI.
//      For local dev use http://localhost:5173 ; for the deployed PWA use its URL.
//   4. API permissions (delegated Microsoft Graph): Mail.Read, Mail.ReadWrite,
//      User.Read. Personal accounts grant these on consent, no admin needed.
//
// Only read/triage scopes are requested. The prototype never requests Mail.Send.

// Read the client id from the build-time env (.env.local: VITE_MSAL_CLIENT_ID=...)
// so the secret-free public id isn't hardcoded and dev/prod can differ.
const CLIENT_ID = import.meta.env.VITE_MSAL_CLIENT_ID ?? "";

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: "https://login.microsoftonline.com/common",
    redirectUri: window.location.origin,
  },
  cache: {
    // sessionStorage keeps tokens for the tab only; better default for a shared
    // device than localStorage. Switch to "localStorage" if you want persistence.
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
};

/** Delegated Graph scopes. Least privilege for an on-device triage prototype. */
export const loginRequest: PopupRequest = {
  scopes: ["User.Read", "Mail.Read", "Mail.ReadWrite"],
};

export const isMsalConfigured = (): boolean => CLIENT_ID.length > 0;
