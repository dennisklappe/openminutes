import { AuthRevokedError, CalendarApiError, SyncExpiredError } from './errors.js';

export type Fetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 30_000;

const withTimeout = (init: RequestInit): RequestInit => ({
  ...init,
  signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
});

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 200) };
  }
}

function describe(body: Record<string, unknown>, status: number): string {
  const error = body['error'];
  const detail =
    typeof error === 'object' && error !== null
      ? (error as { message?: unknown }).message
      : (body['error_description'] ?? error);
  return typeof detail === 'string' && detail ? detail : `HTTP ${status}`;
}

export async function getJson<T>(
  fetchImpl: Fetch,
  url: string,
  accessToken: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetchImpl(
    url,
    withTimeout({
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', ...headers },
    }),
  );
  if (response.status === 410) throw new SyncExpiredError();
  const body = await readJson(response);
  if (!response.ok) throw new CalendarApiError(response.status, describe(body, response.status));
  return body as T;
}

export async function postForm<T>(
  fetchImpl: Fetch,
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const response = await fetchImpl(
    url,
    withTimeout({
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params),
    }),
  );
  const body = await readJson(response);
  if (body['error'] === 'invalid_grant') throw new AuthRevokedError();
  if (!response.ok) throw new CalendarApiError(response.status, describe(body, response.status));
  return body as T;
}

export async function patchJson(
  fetchImpl: Fetch,
  url: string,
  accessToken: string,
  payload: unknown,
): Promise<void> {
  const response = await fetchImpl(
    url,
    withTimeout({
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
  );
  if (response.ok) return;
  const body = await readJson(response);
  throw new CalendarApiError(response.status, describe(body, response.status));
}
