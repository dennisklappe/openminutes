import { settings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingsStore } from './settings.js';

describe('SettingsStore', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let store: SettingsStore;

  beforeAll(async () => {
    test = await createTestDatabase();
    store = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('falls back to defaults and parses numbers', async () => {
    expect(await store.get('admin.password_hash')).toBeUndefined();
    expect(await store.getNumber('bot.lobby_timeout_seconds')).toBe(600);
  });

  it('stores secrets encrypted and plain values readable', async () => {
    await store.set('admin.password_hash', 'scrypt$abc');
    await store.set('bot.lobby_timeout_seconds', '30');

    const rows = await test.db.select().from(settings);
    const secret = rows.find((r) => r.key === 'admin.password_hash');
    expect(secret?.secret).toBe(true);
    expect(secret?.value).not.toContain('scrypt');
    expect(await store.get('admin.password_hash')).toBe('scrypt$abc');
    expect(await store.getNumber('bot.lobby_timeout_seconds')).toBe(30);
  });

  it('only sets a value once with setIfAbsent', async () => {
    expect(await store.setIfAbsent('bot.alone_timeout_seconds', '5')).toBe(true);
    expect(await store.setIfAbsent('bot.alone_timeout_seconds', '9')).toBe(false);
    expect(await store.getNumber('bot.alone_timeout_seconds')).toBe(5);
  });

  it('overwrites existing values', async () => {
    await store.set('bot.max_duration_minutes', '10');
    await store.set('bot.max_duration_minutes', '20');
    expect(await store.getNumber('bot.max_duration_minutes')).toBe(20);
  });
});
