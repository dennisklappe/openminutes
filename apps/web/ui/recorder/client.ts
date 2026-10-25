import type {
  PhoneConfigDto,
  RecordingFinishInput,
  RecordingStartInput,
  RecordingStatusDto,
} from '../../src/dto.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export class NetworkError extends Error {}

export interface MissingChunks {
  missing: number[];
}

export interface RecordingsClient {
  start: (input: RecordingStartInput) => Promise<RecordingStatusDto>;
  status: (id: string) => Promise<RecordingStatusDto>;
  putChunk: (id: string, index: number, blob: Blob) => Promise<void>;
  finish: (id: string, input: RecordingFinishInput) => Promise<RecordingStatusDto>;
  discard: (id: string) => Promise<void>;
}

type Fetch = typeof fetch;

async function send(fetcher: Fetch, path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(path, { credentials: 'same-origin', ...init });
  } catch (cause) {
    throw new NetworkError(cause instanceof Error ? cause.message : 'Network error');
  }
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => undefined);
  const message =
    typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Request failed (${String(response.status)})`;
  throw new HttpError(response.status, message, body);
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function createRecordingsClient(
  fetcher: Fetch = (...args) => fetch(...args),
): RecordingsClient {
  const read = async (path: string, init: RequestInit) =>
    (await (await send(fetcher, path, init)).json()) as RecordingStatusDto;
  return {
    start: (input) => read('/api/recordings', json(input)),
    status: (id) => read(`/api/recordings/${id}`, { method: 'GET' }),
    putChunk: async (id, index, blob) => {
      await send(fetcher, `/api/recordings/${id}/chunks/${String(index)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: blob,
      });
    },
    finish: (id, input) => read(`/api/recordings/${id}/finish`, json(input)),
    discard: async (id) => {
      await send(fetcher, `/api/recordings/${id}`, { method: 'DELETE' });
    },
  };
}

export async function fetchPhoneConfig(fetcher: Fetch = (...args) => fetch(...args)) {
  const response = await send(fetcher, '/api/phone', { method: 'GET' });
  return (await response.json()) as PhoneConfigDto;
}

export function missingFrom(error: unknown): number[] | undefined {
  if (!(error instanceof HttpError) || error.status !== 409) return undefined;
  const body = error.body as Partial<MissingChunks> | undefined;
  return Array.isArray(body?.missing) ? body.missing : undefined;
}
