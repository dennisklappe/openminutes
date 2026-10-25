import type { Fetch } from './http.js';

export interface RecordedRequest {
  url: URL;
  method: string;
  headers: Headers;
  form: URLSearchParams;
  body: string;
}

type Responder = (request: RecordedRequest) => { status?: number; body: unknown };

export function mockFetch(responder: Responder) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: Fetch = (input, init) => {
    const body = init?.body;
    const request: RecordedRequest = {
      url: new URL(input instanceof Request ? input.url : input.toString()),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      form: body instanceof URLSearchParams ? body : new URLSearchParams(),
      body: typeof body === 'string' ? body : '',
    };
    requests.push(request);
    const { status = 200, body: payload } = responder(request);
    return Promise.resolve(new Response(JSON.stringify(payload), { status }));
  };
  return { fetch: fetchImpl, requests };
}
