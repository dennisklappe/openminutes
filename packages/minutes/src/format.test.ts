import { describe, expect, it } from 'vitest';
import { formatTimeRange } from './format.js';

describe('formatTimeRange', () => {
  const zone = { timeZone: 'Europe/Amsterdam' };
  it('shows the zone name of the host', () => {
    expect(formatTimeRange('2026-10-24T10:59:00Z', '2026-10-24T11:26:00Z', zone)).toBe(
      '12:59 to 13:26 CEST',
    );
    expect(formatTimeRange('2026-01-24T10:59:00Z', '2026-01-24T11:26:00Z', zone)).toBe(
      '11:59 to 12:26 CET',
    );
  });
  it('names UTC only when the zone is UTC', () => {
    expect(formatTimeRange('2026-10-24T10:59:00Z', null, { timeZone: 'UTC' })).toBe('10:59 UTC');
  });
  it('names both zones when the meeting crosses a DST change', () => {
    expect(formatTimeRange('2026-10-25T00:30:00Z', '2026-10-25T02:30:00Z', zone)).toBe(
      '02:30 CEST to 03:30 CET',
    );
  });
});
