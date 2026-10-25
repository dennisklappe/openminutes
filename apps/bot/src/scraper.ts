import type { Platform } from '@openminutes/platforms';
import type { Page } from 'playwright-core';
import type { RoomRecord } from './room-store.js';
import { RoomTracker, SAMPLE_INTERVAL_MS } from './room-tracker.js';

export interface RoomScraper {
  readonly tracker: RoomTracker;
  readonly startedAt: Date;
  stop(): Promise<RoomRecord>;
}

export function startRoomScraper(platform: Platform, page: Page, selfName: string): RoomScraper {
  const tracker = new RoomTracker();
  const startedAt = new Date();
  const elapsed = () => Date.now() - startedAt.getTime();
  const state = { running: true };

  const loop = (async () => {
    while (state.running) {
      const began = Date.now();
      try {
        tracker.observe(await platform.scrapeRoom(page, selfName), elapsed());
      } catch {
        // The page may be navigating or closing, the next sample or the watch loop will tell.
      }
      const wait = SAMPLE_INTERVAL_MS - (Date.now() - began);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  })();

  return {
    tracker,
    startedAt,
    async stop() {
      state.running = false;
      await loop;
      return tracker.finish(elapsed());
    },
  };
}
