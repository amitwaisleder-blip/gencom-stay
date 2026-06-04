import { useAuth } from "./auth/AuthProvider";
import { SignIn } from "./components/SignIn";
import { Inbox } from "./components/Inbox";

export function App() {
  const { ready, account } = useAuth();

  if (!ready) {
    return (
      <div className="centered">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  return account ? <Inbox /> : <SignIn />;
}
