import { useEffect, useState } from "react";

/** useState backed by localStorage. Persists per-key across page reloads
 *  and tab navigations so view choices (active tab, selected year, filter
 *  state, etc.) come back the way the user left them.
 *
 *  - On mount, reads the stored value if present and JSON-parsable.
 *  - On every change, writes the new value back. Quota / private mode
 *    failures are swallowed — the in-memory state still works.
 *  - Falsy stored values (e.g. `0`, empty string) are honored.
 *  - Keys should be globally unique (we suggest a `<feature>:<scope-id>`
 *    convention, e.g. `capex-cashflow-year:<hotelId>`).
 */
export function useLocalStorageState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw);
      return parsed as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota or disabled storage — silent.
    }
  }, [key, value]);

  return [value, setValue];
}
