import { describe, expect, it } from 'vitest';
import type { ApiKeyDto } from '../src/dto.js';
import { expiryText, lastUsedText, scopeLabel } from './apiKeys.js';

const key: ApiKeyDto = {
  id: '1',
  name: 'Sync',
  prefix: 'omk_abcd',
  scope: 'read',
  createdAt: '2026-01-01T00:00:00Z',
  lastUsedAt: null,
  expiresAt: null,
};

describe('api key text', () => {
  it('names the scope', () => {
    expect(scopeLabel('read')).toBe('Read only');
    expect(scopeLabel('full')).toBe('Full');
  });
  it('says when a key expires or was used', () => {
    expect(expiryText(key)).toBe('Never expires');
    expect(
      expiryText({ ...key, expiresAt: '2026-02-01T00:00:00Z' }, Date.parse('2026-03-01')),
    ).toMatch(/^Expired /);
    expect(
      expiryText({ ...key, expiresAt: '2026-02-01T00:00:00Z' }, Date.parse('2026-01-02')),
    ).toMatch(/^Expires /);
    expect(lastUsedText(key)).toBe('Never used');
    expect(lastUsedText({ ...key, lastUsedAt: '2026-01-02T00:00:00Z' })).toMatch(/^Last used /);
  });
});
