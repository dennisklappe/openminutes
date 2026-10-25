import type { FetchLike } from '@openminutes/providers';
import type { MailMessage } from '../src/types.js';

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export function scriptedFetch(...responses: Response[]): {
  fetch: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetch: FetchLike = (url, init = {}) => {
    calls.push({ url, init });
    const next = queue.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error(`unexpected request to ${url}`));
  };
  return { fetch, calls };
}

export const message: MailMessage = {
  from: { name: 'Minutes Bot', address: 'bot@example.com' },
  to: ['ada@example.com', 'grace@example.com'],
  subject: 'Minutes: Weekly sync',
  text: 'Plain body',
  html: '<p>HTML body</p>',
};
