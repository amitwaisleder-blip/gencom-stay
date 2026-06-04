import { useAuth } from "../auth/AuthProvider";

export function SignIn() {
  const { signIn, configured, error } = useAuth();

  return (
    <div className="centered">
      <div className="signin-card">
        <div className="logo">📥</div>
        <h1>gencom-stay</h1>
        <p className="tagline">
          A companion to Outlook that learns what matters — on your device.
        </p>

        {!configured && (
          <p className="warning">
            Set <code>VITE_MSAL_CLIENT_ID</code> in <code>.env.local</code> to enable
            sign-in. See the README.
          </p>
        )}

        <button className="primary" onClick={() => void signIn()} disabled={!configured}>
          Sign in with Microsoft
        </button>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
