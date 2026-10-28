export interface ClipRequest {
  /** The address of the clip, which is also what identifies it. */
  url: string;
  durationMs: number;
}

export interface ClipData {
  blob: Blob;
  /** Where the wanted start lies inside the clip. */
  offsetMs: number;
}

export type ClipStatus = 'idle' | 'loading' | 'playing' | 'error';

export interface ClipState {
  status: ClipStatus;
  /** The clip the status is about. */
  url?: string;
  message?: string;
}

/** The parts of an audio element the player uses, so it can be tested without a browser. */
export interface AudioLike {
  src: string;
  currentTime: number;
  readonly readyState: number;
  play: () => Promise<void>;
  pause: () => void;
  load: () => void;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

export interface ClipEnv {
  audio: () => AudioLike;
  fetchClip: (url: string, signal: AbortSignal) => Promise<ClipData>;
  objectUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

/** A clip that has not started after this long is given up on, with a way to retry. */
export const START_TIMEOUT_MS = 4000;
const CACHED = 3;

export const SLOW = 'The audio is slow to load.';
export const FAILED = 'The audio could not be loaded.';
export const BLOCKED = 'The browser did not start the audio. Tap play again.';

interface Fetch {
  url: string;
  controller: AbortController;
  done: Promise<ClipData>;
}

/**
 * Plays short clips on ONE audio element. Starting a clip, stopping or leaving the page cancels the
 * clip request before it, so requests never pile up behind the browser's limit of connections per
 * host. Only the next clip is fetched ahead, and never more than one request is in flight besides
 * the one the user waits for.
 */
export function createClipPlayer(env: ClipEnv) {
  let state: ClipState = { status: 'idle' };
  const listeners = new Set<() => void>();
  const cache = new Map<string, ClipData>();
  let current: Fetch | undefined;
  let ahead: Fetch | undefined;
  let timer: unknown;
  let objectUrl: string | undefined;
  let detach: (() => void) | undefined;

  const set = (next: ClipState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const remember = (url: string, data: ClipData) => {
    cache.delete(url);
    cache.set(url, data);
    for (const old of cache.keys()) {
      if (cache.size <= CACHED) break;
      cache.delete(old);
    }
  };

  const request = (url: string): Fetch => {
    const controller = new AbortController();
    const done = env.fetchClip(url, controller.signal).then((data) => {
      remember(url, data);
      return data;
    });
    done.catch(() => undefined);
    return { url, controller, done };
  };

  const release = () => {
    env.clearTimer(timer);
    timer = undefined;
    detach?.();
    detach = undefined;
    const audio = env.audio();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (objectUrl) env.revokeUrl(objectUrl);
    objectUrl = undefined;
  };

  const abortCurrent = () => {
    current?.controller.abort();
    current = undefined;
  };

  const stop = () => {
    abortCurrent();
    release();
    if (state.status !== 'idle') set({ status: 'idle' });
  };

  const fail = (url: string, message: string) => {
    abortCurrent();
    release();
    set({ status: 'error', url, message });
  };

  const start = (clip: ClipRequest, data: ClipData) => {
    const audio = env.audio();
    objectUrl = env.objectUrl(data.blob);
    const offset = data.offsetMs / 1000;
    const endsAt = offset + clip.durationMs / 1000;
    const listeners = {
      loadedmetadata: () => {
        audio.currentTime = offset;
      },
      playing: () => {
        env.clearTimer(timer);
        set({ status: 'playing', url: clip.url });
      },
      timeupdate: () => {
        if (audio.currentTime >= endsAt) stop();
      },
      ended: stop,
      error: () => {
        fail(clip.url, FAILED);
      },
    };
    for (const [type, listener] of Object.entries(listeners))
      audio.addEventListener(type, listener);
    detach = () => {
      for (const [type, listener] of Object.entries(listeners)) {
        audio.removeEventListener(type, listener);
      }
    };
    audio.src = objectUrl;
    audio.play().catch((failure: unknown) => {
      if (state.url !== clip.url || state.status !== 'loading') return;
      fail(
        clip.url,
        failure instanceof Error && failure.name === 'NotAllowedError' ? BLOCKED : FAILED,
      );
    });
  };

  const play = (clip: ClipRequest) => {
    abortCurrent();
    release();
    set({ status: 'loading', url: clip.url });
    timer = env.setTimer(() => {
      fail(clip.url, SLOW);
    }, START_TIMEOUT_MS);
    const cached = cache.get(clip.url);
    if (cached) {
      start(clip, cached);
      return;
    }
    if (ahead?.url === clip.url) {
      current = ahead;
      ahead = undefined;
    } else {
      ahead?.controller.abort();
      ahead = undefined;
      current = request(clip.url);
    }
    const mine = current;
    mine.done.then(
      (data) => {
        if (current !== mine) return;
        current = undefined;
        start(clip, data);
      },
      () => {
        if (current === mine && !mine.controller.signal.aborted) fail(clip.url, FAILED);
      },
    );
  };

  /** Fetches the clip that probably comes next, once and only when nothing else is loading. */
  const prefetch = (clip: ClipRequest | undefined) => {
    if (!clip || cache.has(clip.url) || ahead?.url === clip.url) return;
    if (current?.url === clip.url) return;
    ahead?.controller.abort();
    ahead = undefined;
    if (current) return;
    const mine = request(clip.url);
    ahead = mine;
    const forget = () => {
      if (ahead === mine) ahead = undefined;
    };
    mine.done.then(forget, forget);
  };

  /** Drops a prefetch that is no longer wanted, as when the page is left. */
  const cancelPrefetch = () => {
    ahead?.controller.abort();
    ahead = undefined;
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    play,
    stop,
    prefetch,
    cancelPrefetch,
    /** Stops everything and frees the clips, for when the last user of the player is gone. */
    dispose: () => {
      cancelPrefetch();
      stop();
      cache.clear();
    },
  };
}

export type ClipPlayer = ReturnType<typeof createClipPlayer>;
