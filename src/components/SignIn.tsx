import { Compass } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { Logo, MicrosoftLogo } from "./Brand";

export function SignIn({ onDemo }: { onDemo: () => void }) {
  const { signIn, configured, error } = useAuth();

  return (
    <div className="centered signin-bg">
      <Leaves />
      <div className="signin-card">
        <div className="signin-logo">
          <Logo size={72} />
        </div>
        <h1 className="signin-title">Gencom Mail</h1>
        <p className="signin-kicker">Inbox intelligence</p>
        <p className="tagline">
          Your inbox, prioritized. Draft replies and a daily brief — that quietly
          learn what matters to you.
        </p>

        <button className="primary with-icon" onClick={() => void signIn()} disabled={!configured}>
          <MicrosoftLogo size={18} /> Sign in with Microsoft
        </button>

        <button className="secondary with-icon" onClick={onDemo}>
          <Compass size={18} /> Explore the demo
        </button>

        {!configured && (
          <p className="hint">
            Sign-in activates once <code>VITE_MSAL_CLIENT_ID</code> is set (see the
            README). The demo needs no account.
          </p>
        )}

        {error && <p className="error">{error}</p>}

        <p className="build-tag">build {__BUILD_ID__}</p>
      </div>
    </div>
  );
}

/** Soft circle decoration behind the sign-in card (Alpine direction). */
function Leaves() {
  return (
    <svg className="leaves" viewBox="0 0 390 680" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <g fill="#3A5A20">
        <circle cx="345" cy="55" r="115" opacity="0.06" />
        <circle cx="45" cy="645" r="95" opacity="0.06" />
        <circle cx="200" cy="355" r="55" opacity="0.04" />
      </g>
    </svg>
  );
}
