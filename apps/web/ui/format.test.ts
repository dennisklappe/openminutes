import { describe, expect, it } from 'vitest';
import { daysLeft, leftLabel } from './format.js';

const NOW = new Date('2026-10-20T12:00:00Z').getTime();
const DAY_MS = 86_400_000;

describe('bin countdown', () => {
  it('counts whole days left, rounding up', () => {
    expect(daysLeft(new Date(NOW + 30 * DAY_MS).toISOString(), NOW)).toBe(30);
    expect(daysLeft(new Date(NOW + 29.2 * DAY_MS).toISOString(), NOW)).toBe(30);
    expect(daysLeft(new Date(NOW + 1000).toISOString(), NOW)).toBe(1);
  });

  it('never goes negative and copes with a missing date', () => {
    expect(daysLeft(new Date(NOW - DAY_MS).toISOString(), NOW)).toBe(0);
    expect(daysLeft(null, NOW)).toBe(0);
  });

  it('words the label', () => {
    expect(leftLabel(30)).toBe('30 days');
    expect(leftLabel(1)).toBe('1 day');
    expect(leftLabel(0)).toBe('Removed today');
  });
});
