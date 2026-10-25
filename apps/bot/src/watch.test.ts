import type { Platform } from '@openminutes/platforms';
import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { watchMeeting } from './watch.js';

function scripted(states: ('active' | 'ended')[], counts: number[]) {
  let poll = 0;
  const at = <T>(list: T[]): T => list[Math.min(poll, list.length - 1)] as T;
  const platform = {
    state: () => Promise.resolve(at(states)),
  } as unknown as Platform;

  let clock = 0;
  const limits = {
    maxDurationMs: 60_000,
    aloneTimeoutMs: 10_000,
    pollIntervalMs: 1_000,
    participantCount: () => at(counts),
    now: () => clock,
    sleep: (ms: number) => {
      clock += ms;
      poll += 1;
      return Promise.resolve();
    },
  };
  return { platform, limits, page: {} as Page };
}

describe('watchMeeting', () => {
  it('stops once the meeting has ended for two polls in a row', async () => {
    const { platform, limits, page } = scripted(
      ['active', 'ended', 'active', 'ended', 'ended'],
      [3],
    );
    expect(await watchMeeting(platform, page, limits)).toBe('ended');
    expect(limits.now()).toBe(4_000);
  });

  it('leaves after being alone for the timeout', async () => {
    const { platform, limits, page } = scripted(['active'], [3, 3, 1]);
    expect(await watchMeeting(platform, page, limits)).toBe('alone');
    expect(limits.now()).toBe(12_000);
  });

  it('leaves a meeting the bot was admitted to when nobody else is in it', async () => {
    const { platform, limits, page } = scripted(['active'], [1]);
    expect(await watchMeeting(platform, page, limits)).toBe('alone');
    expect(limits.now()).toBe(10_000);
  });

  it('resets the alone timer when someone returns', async () => {
    const counts = [1, 1, 1, 1, 1, 2, 1];
    const { platform, limits, page } = scripted(['active'], counts);
    await watchMeeting(platform, page, limits);
    expect(limits.now()).toBeGreaterThanOrEqual(5_000 + 10_000);
  });

  it('stops at the maximum duration', async () => {
    const { platform, limits, page } = scripted(['active'], [5]);
    expect(await watchMeeting(platform, page, limits)).toBe('max_duration');
    expect(limits.now()).toBe(60_000);
  });
});
