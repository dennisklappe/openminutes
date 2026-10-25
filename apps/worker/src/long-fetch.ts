import type { FetchLike } from '@openminutes/providers';
import { Agent, fetch as undiciFetch } from 'undici';

type Init = NonNullable<Parameters<typeof undiciFetch>[1]>;

// The built-in fetch gives up when a server has not sent its headers after five minutes, which a
// local service transcribing or diarizing a long recording does not manage.
const agent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

// undici does not recognise a FormData of the built-in fetch, so it is sent as the stream it encodes to.
function encodeForm(init: RequestInit): RequestInit & { duplex?: 'half' } {
  if (!(init.body instanceof FormData)) return init;
  const encoded = new Response(init.body);
  const headers = new Headers(init.headers);
  headers.set('content-type', encoded.headers.get('content-type') ?? '');
  return { ...init, headers, body: encoded.body, duplex: 'half' };
}

export const longFetch: FetchLike = async (input, init = {}) =>
  (await undiciFetch(input, {
    ...encodeForm(init),
    dispatcher: agent,
  } as Init)) as unknown as Response;
