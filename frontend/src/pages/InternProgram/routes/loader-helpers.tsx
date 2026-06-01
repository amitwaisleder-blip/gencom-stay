// Tiny load-on-mount helper so each route component reads cleanly.
// Returns { data, loading, error, reload }. Reload bumps a counter the
// effect deps watch so callers can force a refetch after a write.

import { useCallback, useEffect, useState } from "react";

export function useStoreData<T>(loader: () => Promise<T>): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader()
      .then((v) => { if (!cancelled) setData(v); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // The loader closure changes per render; we rely on tick as the
  // single re-fetch trigger. Callers that need fresh deps in their
  // loader should instantiate a new loader closure on those deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { data, loading, error, reload };
}
