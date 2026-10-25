import { useCallback, useEffect, useRef, useState } from 'react';

/** Polls `load` and exposes the latest result. A response from a request that a newer one superseded is dropped, so a slow poll cannot bring back what a mutation just changed. */
export function usePolling<T>(load: () => Promise<T>, intervalMs = 3000) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const latest = useRef(0);
  const pending = useRef(false);

  const refresh = useCallback(() => {
    const sequence = ++latest.current;
    pending.current = true;
    const settle = () => {
      if (sequence !== latest.current) return false;
      pending.current = false;
      return true;
    };
    load().then(
      (value) => {
        if (!settle()) return;
        setData(value);
        setError(undefined);
      },
      (failure: unknown) => {
        if (!settle()) return;
        setError(failure instanceof Error ? failure : new Error(String(failure)));
      },
    );
  }, [load]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!pending.current) refresh();
    }, intervalMs);
    return () => {
      clearInterval(timer);
      latest.current++;
      pending.current = false;
    };
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}
