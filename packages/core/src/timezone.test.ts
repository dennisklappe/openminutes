import { describe, expect, it } from 'vitest';
import { isValidTimeZone, resolveTimeZone } from './timezone.js';

describe('resolveTimeZone', () => {
  it('prefers the setting over TZ', () => {
    expect(resolveTimeZone('Europe/Amsterdam', 'America/New_York')).toBe('Europe/Amsterdam');
  });
  it('uses TZ without a setting', () => {
    expect(resolveTimeZone(undefined, 'America/New_York')).toBe('America/New_York');
  });
  it('falls back to UTC', () => {
    expect(resolveTimeZone(undefined, undefined)).toBe('UTC');
  });
  it('ignores invalid zones', () => {
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(resolveTimeZone('Mars/Base', 'Also/Wrong')).toBe('UTC');
    expect(resolveTimeZone('Mars/Base', 'Asia/Tokyo')).toBe('Asia/Tokyo');
  });
});
