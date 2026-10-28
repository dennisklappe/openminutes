import type { Clip } from './ogg-clip.js';

export class ClipBusyError extends Error {}

interface Options {
  /** Cuts that may run at the same time. */
  concurrent: number;
  /** Requests that may wait for a turn before the next one is turned away. */
  waiting: number;
  /** Bytes of finished clips kept in memory. */
  cacheBytes: number;
}

/**
 * Runs clip cuts with a hard limit on how many run at once, hands the same cut to everyone who
 * asks for it at the same time, and keeps the most recent clips in memory.
 */
export function createClipService({ concurrent, waiting, cacheBytes }: Options) {
  const cache = new Map<string, Clip>();
  const running = new Map<string, Promise<Clip>>();
  const queue: (() => void)[] = [];
  let active = 0;
  let cached = 0;

  const remember = (key: string, clip: Clip) => {
    cache.set(key, clip);
    cached += clip.body.length;
    for (const [oldKey, old] of cache) {
      if (cached <= cacheBytes || oldKey === key) break;
      cache.delete(oldKey);
      cached -= old.body.length;
    }
  };

  const turn = async () => {
    if (active >= concurrent) {
      if (queue.length >= waiting) throw new ClipBusyError('Too many clips are being cut');
      await new Promise<void>((resolve) => queue.push(resolve));
    } else active++;
  };

  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active--;
  };

  return {
    async get(key: string, cut: () => Promise<Clip>): Promise<Clip> {
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const same = running.get(key);
      if (same) return same;
      const job = (async () => {
        await turn();
        try {
          const clip = await cut();
          remember(key, clip);
          return clip;
        } finally {
          release();
        }
      })();
      running.set(key, job);
      try {
        return await job;
      } finally {
        running.delete(key);
      }
    },
  };
}
