import { describe, expect, it } from 'vitest';
import { parseRequest, ticketMessage, ticketSubject } from '../src/request.js';

describe('parseRequest', () => {
  it('accepts a complete request and trims it', () => {
    const parsed = parseRequest({
      name: ' Ada ',
      email: 'Ada@Example.com',
      tier: 'team',
      notes: 'hi',
    });
    expect(parsed).toEqual({
      kind: 'ok',
      request: { name: 'Ada', email: 'ada@example.com', tier: 'team', notes: 'hi' },
    });
  });

  it('treats a filled honeypot as a bot', () => {
    expect(parseRequest({ email: 'a@b.co', tier: 'solo', website: 'x' })).toEqual({ kind: 'bot' });
  });

  it('rejects a bad email and an unknown tier', () => {
    expect(parseRequest({ email: 'nope', tier: 'solo' })).toEqual({
      kind: 'invalid',
      error: 'invalid_email',
    });
    expect(parseRequest({ email: 'a@b.co', tier: 'gold' })).toEqual({
      kind: 'invalid',
      error: 'invalid_tier',
    });
  });

  it('writes a ticket from the name and notes', () => {
    const request = { name: 'Ada', email: 'a@b.co', tier: 'company', notes: '' } as const;
    expect(ticketSubject(request)).toBe('Hosting request from Ada');
    expect(ticketMessage(request)).toBe('Tier: company\n\n(no further detail)');
  });

  it('keeps address syntax and line breaks out of the email and the name', () => {
    for (const email of [
      'a@b.co,c@d.co',
      'a b@c.co',
      '"a"@b.co',
      'a@b.co>',
      'a@b.co\r\nBcc: x@y.co',
      'Ada <a@b.co>',
    ]) {
      expect(parseRequest({ email, tier: 'solo' })).toEqual({
        kind: 'invalid',
        error: 'invalid_email',
      });
    }
    const parsed = parseRequest({
      name: 'Ada\r\nBcc: x y',
      email: 'ada+x@b.example',
      tier: 'solo',
    });
    expect(parsed).toMatchObject({ kind: 'ok', request: { name: 'Ada Bcc: x y' } });
  });
});
