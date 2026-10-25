import { ProviderError } from './errors.js';
import type { FetchLike } from './types.js';

export interface RequestOptions {
  provider: string;
  fetch: FetchLike;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
}

const MAX_DETAIL = 300;

async function describe(response: Response): Promise<string> {
  const body = (await response.text().catch(() => '')).trim().slice(0, MAX_DETAIL);
  return body ? `HTTP ${String(response.status)}: ${body}` : `HTTP ${String(response.status)}`;
}

function codeFor(status: number): ProviderError['code'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export async function request(
  url: string,
  init: RequestInit,
  { provider, fetch, timeoutMs, signal }: RequestOptions,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    if (cause instanceof DOMException && cause.name === 'TimeoutError') {
      throw new ProviderError(
        provider,
        'timeout',
        `no response within ${String(timeoutMs)} ms`,
        undefined,
        { cause },
      );
    }
    throw new ProviderError(provider, 'network', 'request failed', undefined, { cause });
  }
  if (!response.ok) {
    throw new ProviderError(
      provider,
      codeFor(response.status),
      await describe(response),
      response.status,
    );
  }
  return response;
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}
