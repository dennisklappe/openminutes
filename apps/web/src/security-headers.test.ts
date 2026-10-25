import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security-headers.js';

describe('securityHeaders', () => {
  const app = new Hono();
  app.use('*', securityHeaders);
  app.get('/', (c) => c.text('ok'));
  app.get('/s/token', (c) => c.text('shared', 200, { 'referrer-policy': 'no-referrer' }));

  it('forbids framing and sniffing on the app', async () => {
    const response = await app.request('/');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('leaves share pages to their own headers', async () => {
    const response = await app.request('/s/token');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-frame-options')).toBeNull();
  });
});
