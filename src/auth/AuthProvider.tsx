import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
} from "@azure/msal-browser";
import { msalConfig, loginRequest, isMsalConfigured } from "./msalConfig";

// Auth context exposing the signed-in account, sign-in/out actions, and a token
// getter for the Graph client. Uses the redirect flow, which is the most reliable
// option inside an iOS standalone PWA (popups are unreliable there).

interface AuthContextValue {
  ready: boolean;
  configured: boolean;
  account: AccountInfo | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const pcaRef = useRef<PublicClientApplication | null>(null);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = isMsalConfigured();

  useEffect(() => {
    if (!configured) {
      setReady(true);
      return;
    }
    const pca = new PublicClientApplication(msalConfig);
    pcaRef.current = pca;

    (async () => {
      try {
        await pca.initialize();
        // Completes a sign-in that returned via redirect.
        const result = await pca.handleRedirectPromise();
        const active = result?.account ?? pca.getAllAccounts()[0] ?? null;
        if (active) pca.setActiveAccount(active);
        setAccount(active);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setReady(true);
      }
    })();
  }, [configured]);

  const value = useMemo<AuthContextValue>(() => {
    const requirePca = () => {
      const pca = pcaRef.current;
      if (!pca) throw new Error("MSAL is not configured.");
      return pca;
    };

    return {
      ready,
      configured,
      account,
      error,
      signIn: async () => {
        setError(null);
        await requirePca().loginRedirect(loginRequest);
      },
      signOut: async () => {
        const pca = requirePca();
        await pca.logoutRedirect({ account: account ?? undefined });
        setAccount(null);
      },
      getAccessToken: async () => {
        const pca = requirePca();
        const active = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
        if (!active) throw new Error("Not signed in.");
        try {
          const res = await pca.acquireTokenSilent({ ...loginRequest, account: active });
          return res.accessToken;
        } catch (e) {
          if (e instanceof InteractionRequiredAuthError) {
            // Silent failed (consent/expiry) -> fall back to interactive redirect.
            await pca.acquireTokenRedirect({ ...loginRequest, account: active });
          }
          throw e;
        }
      },
    };
  }, [ready, configured, account, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
