import { useCallback, useRef, type RefObject } from 'react';

/** Plays a stretch of an audio element and pauses at its end. */
export function useAudioRange(audio: RefObject<HTMLAudioElement | null>) {
  const stopAt = useRef<number | null>(null);

  const clear = useCallback(() => {
    stopAt.current = null;
  }, []);

  const play = useCallback(
    (startMs: number, endMs: number) => {
      const element = audio.current;
      if (!element) return;
      stopAt.current = endMs;
      const seekToStart = () => {
        element.currentTime = startMs / 1000;
      };
      if (element.readyState >= 1) seekToStart();
      else element.addEventListener('loadedmetadata', seekToStart, { once: true });
      void element.play();
    },
    [audio],
  );

  const check = useCallback(
    (currentMs: number) => {
      if (stopAt.current === null || currentMs < stopAt.current) return;
      stopAt.current = null;
      audio.current?.pause();
    },
    [audio],
  );

  return { play, clear, check };
}
