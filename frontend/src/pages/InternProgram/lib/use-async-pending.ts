// Drop-in replacement for React 19's useTransition with async support.
// pip-budget-app is on React 18, where startTransition's argument type
// is `() => void` — passing an async function fails type-checking.
//
// This hook exposes the same `[pending, run]` shape but `run` takes an
// async function (or sync — both fine). Used across the ported intern
// module so write-then-revalidate flows compile under React 18.
//
// We don't get the actual concurrent-mode benefits useTransition would
// provide, but for these mostly-localStorage writes the practical
// difference is nil.

import { useCallback, useState } from "react";

export function useAsyncPending(): readonly [
  boolean,
  (fn: () => unknown | Promise<unknown>) => void,
] {
  const [pending, setPending] = useState(false);
  const run = useCallback((fn: () => unknown | Promise<unknown>) => {
    setPending(true);
    Promise.resolve()
      .then(() => fn())
      .catch((e) => {
        // Surface the error in the console; per-component error UX
        // (toast / inline) can be layered on top later.
        // eslint-disable-next-line no-console
        console.error("[intern-module] pending action failed:", e);
      })
      .finally(() => setPending(false));
  }, []);
  return [pending, run] as const;
}
