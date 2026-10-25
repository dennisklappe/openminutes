import type { Page } from 'playwright-core';
import type { Platform } from '@openminutes/platforms';

type EndReason = 'ended' | 'alone' | 'max_duration';

interface WatchLimits {
  maxDurationMs: number;
  aloneTimeoutMs: number;
  pollIntervalMs: number;
  participantCount: () => number;
  onPoll?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const REQUIRED_ENDED_POLLS = 2;

export async function watchMeeting(
  platform: Platform,
  page: Page,
  limits: WatchLimits,
): Promise<EndReason> {
  const sleep = limits.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = limits.now ?? Date.now;
  const startedAt = now();
  let aloneSince: number | undefined;
  let endedPolls = 0;

  for (;;) {
    if (now() - startedAt >= limits.maxDurationMs) return 'max_duration';

    endedPolls = (await platform.state(page)) === 'ended' ? endedPolls + 1 : 0;
    if (endedPolls >= REQUIRED_ENDED_POLLS) return 'ended';

    if (limits.participantCount() <= 1) {
      aloneSince ??= now();
      if (now() - aloneSince >= limits.aloneTimeoutMs) return 'alone';
    } else {
      aloneSince = undefined;
    }
    await limits.onPoll?.();
    await sleep(limits.pollIntervalMs);
  }
}
