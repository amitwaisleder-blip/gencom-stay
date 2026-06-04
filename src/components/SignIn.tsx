import { useAuth } from "../auth/AuthProvider";

export function SignIn({ onDemo }: { onDemo: () => void }) {
  const { signIn, configured, error } = useAuth();

  return (
    <div className="centered">
      <div className="signin-card">
        <div className="logo">📥</div>
        <h1>gencom-stay</h1>
        <p className="tagline">
          A companion to Outlook that learns what matters — on your device.
        </p>

        <button className="primary" onClick={() => void signIn()} disabled={!configured}>
          Sign in with Microsoft
        </button>

        <button className="secondary" onClick={onDemo}>
          Explore the demo
        </button>

        {!configured && (
          <p className="hint">
            Sign-in is disabled until <code>VITE_MSAL_CLIENT_ID</code> is set (see the
            README). The demo needs no account.
          </p>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
