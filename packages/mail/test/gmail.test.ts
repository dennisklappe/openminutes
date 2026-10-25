import { describe, expect, it, vi } from 'vitest';
import { createMailProvider } from '../src/index.js';
import { json, message, scriptedFetch } from './helpers.js';

describe('gmail', () => {
  it('sends a base64url MIME message with the account token', async () => {
    const { fetch, calls } = scriptedFetch(json({ id: 'g1' }));
    const googleToken = vi.fn(() => Promise.resolve('access-1'));
    const provider = createMailProvider(
      'gmail',
      { account: 'bot@gmail.com' },
      { fetch, googleToken },
    );

    await expect(provider.send(message)).resolves.toEqual({ id: 'g1' });

    expect(googleToken).toHaveBeenCalledWith('bot@gmail.com');
    const [call] = calls;
    expect(call?.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(new Headers(call?.init.headers).get('authorization')).toBe('Bearer access-1');
    const { raw } = JSON.parse(call?.init.body as string) as { raw: string };
    const mime = Buffer.from(raw, 'base64url').toString();
    expect(mime).toContain('To: ada@example.com, grace@example.com');
    expect(mime).toContain('Subject: Minutes: Weekly sync');
    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('Plain body');
  });

  it('tests by reading the profile', async () => {
    const { fetch, calls } = scriptedFetch(json({ emailAddress: 'bot@gmail.com' }));
    const provider = createMailProvider(
      'gmail',
      {},
      { fetch, googleToken: () => Promise.resolve('t') },
    );
    await expect(provider.test()).resolves.toEqual({ detail: 'sending as bot@gmail.com' });
    expect(calls[0]?.url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/profile');
  });

  it('fails clearly when no Google account is connected', async () => {
    const provider = createMailProvider('gmail', {});
    await expect(provider.send(message)).rejects.toThrow(/no Google account is connected/);
  });
});
