import { SettingsStore } from '@openminutes/core';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sendSessionAlert } from './session-alert.js';

describe('session alert mail', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  const sent: Record<string, unknown>[] = [];
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    sent.push(
      JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
    );
    return Promise.resolve(new Response('{"id":"m1"}', { status: 200 }));
  });
  const now = new Date('2026-10-22T10:00:00Z');
  const alert = (at = now) =>
    sendSessionAlert({ settings, mailDeps: { fetch }, now: () => at }, 'Signed out');

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  it('skips silently while mail is not set up', async () => {
    expect(await alert()).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('mails the owner once a day and respects the toggle', async () => {
    await settings.set('email.provider', 'emailit');
    await settings.set(
      'email.configs',
      JSON.stringify({ emailit: { apiKey: 'k', domain: 'example.com' } }),
    );
    await settings.set('email.from_address', 'minutes@example.com');
    await settings.set('email.owner_address', 'owner@example.com');

    await settings.set('bot.google_notify', 'false');
    expect(await alert()).toBe(false);
    await settings.set('bot.google_notify', 'true');

    expect(await alert()).toBe(true);
    expect(sent[0]?.['to']).toEqual(['owner@example.com']);
    expect(await alert(new Date(now.getTime() + 3_600_000))).toBe(false);
    expect(await alert(new Date(now.getTime() + 25 * 3_600_000))).toBe(true);
    expect(sent).toHaveLength(2);
  });
});
