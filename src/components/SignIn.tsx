import { useAuth } from "../auth/AuthProvider";

export function SignIn({ onDemo }: { onDemo: () => void }) {
  const { signIn, configured, error } = useAuth();

  return (
    <div className="centered signin-bg">
      <div className="signin-card">
        <div className="brand-badge brand-badge-lg">g</div>
        <h1 className="signin-title">Gencom Mail</h1>
        <p className="signin-kicker">Inbox intelligence</p>
        <p className="tagline">
          Your inbox, prioritized. Draft replies and a daily brief — that quietly
          learn what matters to you.
        </p>

        <button className="primary" onClick={() => void signIn()} disabled={!configured}>
          Sign in with Microsoft
        </button>

        <button className="secondary" onClick={onDemo}>
          Explore the demo
        </button>

        {!configured && (
          <p className="hint">
            Sign-in activates once <code>VITE_MSAL_CLIENT_ID</code> is set (see the
            README). The demo needs no account.
          </p>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
