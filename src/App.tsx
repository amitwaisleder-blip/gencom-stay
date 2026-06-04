import { useMemo, useState } from "react";
import { useAuth } from "./auth/AuthProvider";
import { GraphClient } from "./graph/graphClient";
import { DemoMailSource } from "./demo/demoMailSource";
import { SignIn } from "./components/SignIn";
import { Inbox } from "./components/Inbox";

export function App() {
  const { ready, account, getAccessToken, signOut } = useAuth();
  const [demo, setDemo] = useState(false);

  // Stable sources: the demo store is in-memory; the Graph client wraps the token getter.
  const demoSource = useMemo(() => new DemoMailSource(), []);
  const graphSource = useMemo(() => new GraphClient(getAccessToken), [getAccessToken]);

  if (!ready) {
    return (
      <div className="centered">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (demo) {
    return (
      <Inbox source={demoSource} accountLabel="Demo inbox" onExit={() => setDemo(false)} demo />
    );
  }

  if (account) {
    return (
      <Inbox
        source={graphSource}
        accountLabel={account.username}
        onExit={() => void signOut()}
      />
    );
  }

  return <SignIn onDemo={() => setDemo(true)} />;
}
