import { createMiddleware } from 'hono/factory';
import { SHARE_PREFIX } from './minutes/public-routes.js';

export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  if (c.req.path.startsWith(SHARE_PREFIX)) return;
  c.header('x-frame-options', 'DENY');
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'same-origin');
});
