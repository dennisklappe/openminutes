import { ProviderError } from '@openminutes/providers';
import { describe, expect, it } from 'vitest';
import { createMailProvider } from '../src/index.js';
import { json, message, scriptedFetch } from './helpers.js';

describe('emailit', () => {
  it('posts to the v2 emails endpoint with a bearer key', async () => {
    const { fetch, calls } = scriptedFetch(json({ id: 'em_1', status: 'accepted' }));
    const provider = createMailProvider(
      'emailit',
      { apiKey: 'secret-key', domain: 'mail.example.com' },
      { fetch },
    );

    await expect(provider.send({ ...message, replyTo: 'me@example.com' })).resolves.toEqual({
      id: 'em_1',
    });

    const [call] = calls;
    expect(call?.url).toBe('https://api.emailit.com/v2/emails');
    expect(new Headers(call?.init.headers).get('authorization')).toBe('Bearer secret-key');
    expect(JSON.parse(call?.init.body as string)).toEqual({
      from: 'Minutes Bot <bot@example.com>',
      to: ['ada@example.com', 'grace@example.com'],
      reply_to: 'me@example.com',
      subject: 'Minutes: Weekly sync',
      text: 'Plain body',
      html: '<p>HTML body</p>',
    });
  });

  it('reports an unverified domain without leaking the key', async () => {
    const { fetch } = scriptedFetch(json({ error: 'Unauthorized domain' }, 403));
    const provider = createMailProvider(
      'emailit',
      { apiKey: 'secret-key', domain: 'mail.example.com' },
      { fetch },
    );
    const error = await provider.send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('auth');
    expect((error as ProviderError).message).not.toContain('secret-key');
  });

  it('requires an api key and a sending domain', () => {
    expect(() => createMailProvider('emailit', { domain: 'mail.example.com' })).toThrow(/apiKey/);
    expect(() => createMailProvider('emailit', { apiKey: 'k' })).toThrow(/domain/);
    expect(() => createMailProvider('emailit', { apiKey: 'k', domain: 'not a domain' })).toThrow(
      /domain/,
    );
  });

  it('ignores a stored base URL, the API address is fixed', async () => {
    const { fetch, calls } = scriptedFetch(json({ id: 'em_2' }));
    const provider = createMailProvider(
      'emailit',
      { apiKey: 'k', domain: 'mail.example.com', baseUrl: 'https://evil.example/v2' },
      { fetch },
    );
    await provider.send(message);
    expect(calls[0]?.url).toBe('https://api.emailit.com/v2/emails');
  });

  it('rejects unknown providers', () => {
    expect(() => createMailProvider('nope', {})).toThrow(/unknown mail provider/);
  });
});
