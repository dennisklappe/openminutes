import { describe, expect, it } from 'vitest';
import {
  ALL_STATUSES,
  DEFAULT_STATUSES,
  isDefaultStatuses,
  parseStatuses,
  statusQuery,
  statusSummary,
} from './statusFilter.js';

describe('meetings status filter', () => {
  it('leaves out skipped and cancelled by default', () => {
    expect(DEFAULT_STATUSES).not.toContain('skipped');
    expect(DEFAULT_STATUSES).not.toContain('cancelled');
    expect(DEFAULT_STATUSES).toEqual(
      expect.arrayContaining(['joining', 'recording', 'processing', 'transcribed', 'failed']),
    );
  });

  it('sends nothing when every status is checked', () => {
    expect(statusQuery(ALL_STATUSES)).toBe('');
    expect(statusQuery(['failed', 'skipped'])).toBe('failed,skipped');
  });

  it('summarises the choice', () => {
    expect(statusSummary(DEFAULT_STATUSES)).toBe('Joined meetings');
    expect(statusSummary(ALL_STATUSES)).toBe('All statuses');
    expect(statusSummary(['failed'])).toBe('Failed');
    expect(statusSummary(['failed', 'skipped'])).toBe('Status: 2 of 11');
  });

  it('parses stored values defensively', () => {
    expect(parseStatuses(null)).toEqual(DEFAULT_STATUSES);
    expect(parseStatuses('not json')).toEqual(DEFAULT_STATUSES);
    expect(parseStatuses('["nope"]')).toEqual(DEFAULT_STATUSES);
    expect(parseStatuses('["skipped","bogus","failed"]')).toEqual(['failed', 'skipped']);
    expect(isDefaultStatuses(parseStatuses(JSON.stringify(DEFAULT_STATUSES)))).toBe(true);
  });
});
