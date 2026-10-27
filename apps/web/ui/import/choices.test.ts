import { describe, expect, it } from 'vitest';
import type { ImportMeetingDto } from '../../src/dto.js';
import { isSelectable, selectableKeys } from './choices.js';

const meeting = (over: Partial<ImportMeetingDto> = {}): ImportMeetingDto => ({
  key: 'k1',
  title: 'Weekly planning',
  startedAt: '2026-10-01T09:00:00.000Z',
  durationMs: 3_600_000,
  attendees: 2,
  hasAudio: true,
  meeting: null,
  ...over,
});
const linked = (status: 'failed' | 'transcribed' | 'ended') => ({
  id: 'm1',
  status,
  error: null,
  progress: null,
});

describe('selection', () => {
  it('lets only new and failed meetings with a recording be picked', () => {
    expect(isSelectable(meeting())).toBe(true);
    expect(isSelectable(meeting({ meeting: linked('failed') }))).toBe(true);
    expect(isSelectable(meeting({ meeting: linked('transcribed') }))).toBe(false);
    expect(isSelectable(meeting({ meeting: linked('ended') }))).toBe(false);
    expect(isSelectable(meeting({ hasAudio: false }))).toBe(false);
    expect(
      selectableKeys([
        meeting({ key: 'a' }),
        meeting({ key: 'b', meeting: linked('transcribed') }),
        meeting({ key: 'c', hasAudio: false }),
      ]),
    ).toEqual(['a']);
  });
});
