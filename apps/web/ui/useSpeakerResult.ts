import { useEffect, useState } from 'react';
import type { MeetingStatus } from '../src/dto.js';

interface Pending {
  was: number;
  started: boolean;
}

/**
 * Remembers how many speakers there were when a re-run was requested. Once the meeting has been
 * processing and is back, `result` holds the old and the new number until it is dismissed.
 */
export function useSpeakerResult(status: MeetingStatus | undefined, count: number) {
  const [pending, setPending] = useState<Pending>();
  const [result, setResult] = useState<{ was: number; now: number }>();

  useEffect(() => {
    if (!pending) return;
    if (status === 'processing' && !pending.started) {
      setPending({ ...pending, started: true });
    } else if (status && status !== 'processing' && pending.started) {
      setPending(undefined);
      if (status === 'transcribed') setResult({ was: pending.was, now: count });
    }
  }, [pending, status, count]);

  return {
    result,
    track: () => {
      setResult(undefined);
      setPending({ was: count, started: false });
    },
    dismiss: () => {
      setResult(undefined);
    },
  };
}
