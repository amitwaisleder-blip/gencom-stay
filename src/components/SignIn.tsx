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

/** Soft botanical decoration behind the sign-in card. */
function Leaves() {
  return (
    <svg className="leaves" viewBox="0 0 1440 900" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <g fill="#4e6137" opacity="0.10">
        <path d="M1230 70c70 30 120 110 110 200-90-10-170-70-180-160-3-22 5-35 70-40z" />
        <path d="M1320 150c-40 60-40 150 10 210 50-50 70-140 30-210-12-20-28-22-40 0z" />
        <path d="M150 760c-70-30-120-110-110-200 90 10 170 70 180 160 3 22-5 35-70 40z" />
        <path d="M60 690c40-60 40-150-10-210-50 50-70 140-30 210 12 20 28 22 40 0z" />
      </g>
    </svg>
  );
}
