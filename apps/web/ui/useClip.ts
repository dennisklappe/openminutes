import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { createClipPlayer, type ClipEnv, type ClipRequest } from './clipPlayer.js';

export interface Clip {
  startMs: number;
  endMs: number;
}

/** The address of the short cut of a meeting's audio, and for how long to play it. */
export function clipRequest(audioUrl: string, clip: Clip, maxMs: number): ClipRequest {
  const durationMs = Math.max(500, Math.min(clip.endMs - clip.startMs, maxMs));
  return {
    url: `${audioUrl}/clip?from=${String(Math.round(clip.startMs))}&to=${String(Math.round(clip.startMs + durationMs))}`,
    durationMs,
  };
}

let element: HTMLAudioElement | undefined;

const env: ClipEnv = {
  audio: () => {
    element ??= new Audio();
    element.preload = 'metadata';
    return element;
  },
  fetchClip: async (url, signal) => {
    const response = await fetch(url, { signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Clip answered ${String(response.status)}`);
    return {
      blob: await response.blob(),
      offsetMs: Number(response.headers.get('x-clip-offset-ms')) || 0,
    };
  },
  objectUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => {
    URL.revokeObjectURL(url);
  },
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => {
    clearTimeout(timer as number);
  },
};

/** One player for the whole page: there is one audio element and one clip playing at a time. */
export const clipPlayer = createClipPlayer(env);

/**
 * Plays one stretch of the meeting audio through the shared player, so the main player, the scroll
 * position and the focus stay where they are. Starting another clip stops this one, and leaving the
 * component stops it and cancels what it was loading.
 */
export function useClip(clip: Clip | undefined, audioUrl: string | undefined, maxMs: number) {
  const request = clip && audioUrl ? clipRequest(audioUrl, clip, maxMs) : undefined;
  const url = request?.url;
  const state = useSyncExternalStore(clipPlayer.subscribe, clipPlayer.getState);
  const mine = url !== undefined && state.url === url;

  const stop = useCallback(() => {
    if (clipPlayer.getState().url === url) clipPlayer.stop();
  }, [url]);

  useEffect(() => stop, [stop]);

  const duration = request?.durationMs;
  const play = () => {
    if (url && duration) clipPlayer.play({ url, durationMs: duration });
  };

  return {
    active: mine && state.status === 'playing',
    loading: mine && state.status === 'loading',
    error: mine && state.status === 'error' ? state.message : undefined,
    play,
    stop,
  };
}

/** Fetches the clip of the card that comes next, so it starts at once when the user gets there. */
export function usePrefetchClip(
  clip: Clip | undefined,
  audioUrl: string | undefined,
  maxMs: number,
) {
  const status = useSyncExternalStore(clipPlayer.subscribe, () => clipPlayer.getState().status);
  const request = clip && audioUrl ? clipRequest(audioUrl, clip, maxMs) : undefined;
  const url = request?.url;
  const duration = request?.durationMs;
  useEffect(() => {
    if (url && duration) clipPlayer.prefetch({ url, durationMs: duration });
  }, [url, duration, status]);
  useEffect(
    () => () => {
      clipPlayer.cancelPrefetch();
    },
    [],
  );
}
