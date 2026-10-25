import { ExportError } from '../exporter.js';

export type Fetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 120_000;

export interface ApiClient {
  json<T>(method: string, url: string, body?: unknown): Promise<T>;
  raw(
    method: string,
    url: string,
    body: NonNullable<RequestInit['body']>,
    headers: Record<string, string>,
  ): Promise<Response>;
}

function failure(service: string, status: number, text: string): ExportError {
  let detail = `HTTP ${status}`;
  try {
    const error = (JSON.parse(text) as { error?: { message?: string } | string }).error;
    const message = typeof error === 'string' ? error : error?.message;
    if (message) detail = message;
  } catch {
    // keep the status line
  }
  return new ExportError(`${service} refused the request: ${detail}`);
}

export function apiClient(service: string, fetchImpl: Fetch, accessToken: string): ApiClient {
  const send = async (
    url: string,
    init: {
      method: string;
      headers?: Record<string, string>;
      body?: NonNullable<RequestInit['body']>;
    },
  ): Promise<Response> => {
    const response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) throw failure(service, response.status, await response.text());
    return response;
  };
  return {
    async json<T>(method: string, url: string, body?: unknown): Promise<T> {
      const response = await send(url, {
        method,
        ...(body !== undefined && {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      });
      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    },
    raw: (method, url, body, headers) => send(url, { method, body, headers }),
  };
}
