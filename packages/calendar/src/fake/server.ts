import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FakeDocuments } from './documents.js';
import { googleCancelled, googleEvent, graphEvent, graphRemoved } from './render.js';
import { FakeStore, type FakeEvent, type FakeOptions, type FakeProvider } from './store.js';

type Query = URLSearchParams;
type Handler = (request: Request) => unknown;

interface Request {
  url: URL;
  query: Query;
  params: string[];
  form: Query;
  body: string;
  headers: IncomingMessage['headers'];
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(JSON.stringify(body));
  }
}

class Redirect {
  constructor(readonly location: string) {}
}

const route = (pattern: string) => new RegExp(`^${pattern.replace(/:[a-z]+/g, '([^/]+)')}$`);

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function page<T>(items: T[], offset: number, size: number) {
  const slice = items.slice(offset, offset + size);
  return { slice, next: offset + size < items.length ? offset + size : undefined };
}

export interface FakeCalendar {
  store: FakeStore;
  documents: FakeDocuments;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startFakeCalendar(
  options: FakeOptions & { port?: number } = {},
): Promise<FakeCalendar> {
  const store = new FakeStore(options);
  const documents = new FakeDocuments();
  const routes = new Map<string, { pattern: RegExp; handler: Handler }[]>();
  const on = (method: string, pattern: string, handler: Handler) => {
    routes.set(method, [...(routes.get(method) ?? []), { pattern: route(pattern), handler }]);
  };

  const bearer = (request: Request) => {
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (!store.isAccessTokenValid(token)) {
      throw new HttpError(401, { error: { message: 'Invalid credentials' } });
    }
  };

  const authorize = (request: Request) => {
    const redirectUri = request.query.get('redirect_uri') ?? '';
    const challenge = request.query.get('code_challenge') ?? '';
    if (request.query.get('code_challenge_method') !== 'S256' || !challenge || !redirectUri) {
      throw new HttpError(400, { error: 'invalid_request' });
    }
    const target = new URL(redirectUri);
    target.searchParams.set(
      'code',
      store.issueCode(challenge, redirectUri, request.query.get('scope') ?? ''),
    );
    target.searchParams.set('state', request.query.get('state') ?? '');
    return new Redirect(target.toString());
  };

  const token = (rotateRefresh: boolean) => (request: Request) => {
    const { form } = request;
    if (!form.get('client_id') || !form.get('client_secret')) {
      throw new HttpError(401, { error: 'invalid_client' });
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (!store.consumeRefreshToken(form.get('refresh_token') ?? '', rotateRefresh)) {
        throw new HttpError(400, { error: 'invalid_grant' });
      }
      return {
        access_token: store.issueAccessToken(),
        expires_in: store.expiresInSeconds,
        ...(rotateRefresh && { refresh_token: store.issueRefreshToken() }),
      };
    }
    const grant = store.redeemCode(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (!grant || grant.challenge !== challenge || grant.redirectUri !== form.get('redirect_uri')) {
      throw new HttpError(400, { error: 'invalid_grant' });
    }
    return {
      access_token: store.issueAccessToken(),
      refresh_token: store.issueRefreshToken(),
      expires_in: store.expiresInSeconds,
      scope: grant.scope,
    };
  };

  on('GET', '/google/auth', authorize);
  on('GET', '/microsoft/login/:tenant/oauth2/v2.0/authorize', authorize);
  on('POST', '/google/token', token(false));
  on('POST', '/microsoft/login/:tenant/oauth2/v2.0/token', token(true));

  on('GET', '/google/userinfo', (request) => {
    bearer(request);
    return { email: store.email };
  });
  on('GET', '/microsoft/graph/me', (request) => {
    bearer(request);
    return { mail: store.email, userPrincipalName: store.email };
  });

  on('GET', '/google/calendar/v3/users/me/calendarList', (request) => {
    bearer(request);
    return {
      items: store.calendarsOf('google').map((c) => ({
        id: c.id,
        summary: c.name,
        primary: c.primary,
        accessRole: 'owner',
      })),
    };
  });
  on('GET', '/microsoft/graph/me/calendars', (request) => {
    bearer(request);
    return {
      value: store.calendarsOf('microsoft').map((c) => ({
        id: c.id,
        name: c.name,
        isDefaultCalendar: c.primary,
      })),
    };
  });

  on('GET', '/google/calendar/v3/calendars/:id/events', (request) => {
    bearer(request);
    const calendar = decodeURIComponent(request.params[0] ?? '');
    const syncToken = request.query.get('syncToken');
    const offset = Number(request.query.get('pageToken') ?? 0);
    const size = Number(request.query.get('maxResults') ?? store.pageSize);
    if (syncToken && !/^sync-\d+$/.test(syncToken)) throw new HttpError(410, { error: 'Gone' });
    const version = syncToken ? Number(syncToken.replace('sync-', '')) : store.version;
    const items = syncToken
      ? store
          .changedSince('google', calendar, version)
          .map(({ id, event }) => (event ? googleEvent(store, event) : googleCancelled(id)))
      : store
          .eventsIn(
            'google',
            calendar,
            new Date(request.query.get('timeMin') ?? 0),
            new Date(request.query.get('timeMax') ?? '2999-01-01'),
          )
          .map((event) => googleEvent(store, event));
    const { slice, next } = page(items, offset, size);
    return {
      items: slice,
      ...(next === undefined
        ? { nextSyncToken: `sync-${store.version}` }
        : { nextPageToken: String(next) }),
    };
  });

  const json = (request: Request) => JSON.parse(request.body || '{}') as Record<string, unknown>;
  const editable = (provider: FakeProvider, request: Request) => {
    bearer(request);
    const calendar = decodeURIComponent(request.params[0] ?? '');
    const event = store.getEvent(provider, calendar, decodeURIComponent(request.params[1] ?? ''));
    if (!event) throw new HttpError(404, { error: { message: 'Event not found' } });
    return { calendar, event };
  };
  const patchDescription = (provider: FakeProvider, description: unknown, request: Request) => {
    const { calendar, event } = editable(provider, request);
    if (event.readOnly) throw new HttpError(403, { error: { message: 'Forbidden' } });
    store.patches.push({ provider, calendar, eventId: event.id, query: request.url.search });
    store.upsertEvent(provider, calendar, { ...event, description: String(description) });
    return {};
  };
  on('GET', '/google/calendar/v3/calendars/:id/events/:event', (request) => ({
    description: editable('google', request).event.description,
  }));
  on('PATCH', '/google/calendar/v3/calendars/:id/events/:event', (request) =>
    patchDescription('google', json(request)['description'], request),
  );
  on('GET', '/microsoft/graph/me/calendars/:id/events/:event', (request) => ({
    body: { contentType: 'html', content: editable('microsoft', request).event.description ?? '' },
  }));
  on('PATCH', '/microsoft/graph/me/calendars/:id/events/:event', (request) =>
    patchDescription(
      'microsoft',
      (json(request)['body'] as { content?: string } | undefined)?.content,
      request,
    ),
  );

  const graphView = (calendar: string, delta: boolean) => (request: Request) => {
    bearer(request);
    const skip = request.query.get('$skiptoken');
    const deltaToken = request.query.get('$deltatoken');
    const [offset = 0, version = store.version] = skip ? skip.split(':').map(Number) : [];
    const size = store.pageSize;
    const items =
      delta && deltaToken
        ? store
            .changedSince('microsoft', calendar, Number(deltaToken))
            .map(({ id, event }) => (event ? graphEvent(event) : graphRemoved(id)))
        : store
            .eventsIn(
              'microsoft',
              calendar,
              new Date(request.query.get('startDateTime') ?? 0),
              new Date(request.query.get('endDateTime') ?? '2999-01-01'),
            )
            .map(graphEvent);
    const { slice, next } = page(items, offset, size);
    const base = `http://${request.headers.host ?? ''}${request.url.pathname}`;
    const carried = new URLSearchParams(request.query);
    carried.delete('$skiptoken');
    return {
      value: slice,
      ...(next === undefined
        ? delta && { '@odata.deltaLink': `${base}?$deltatoken=${version}` }
        : {
            '@odata.nextLink': `${base}?${carried.toString()}&$skiptoken=${next}:${version}`,
          }),
    };
  };
  on('GET', '/microsoft/graph/me/calendarView/delta', (request) =>
    graphView(store.primaryCalendar('microsoft'), true)(request),
  );
  on('GET', '/microsoft/graph/me/calendars/:id/calendarView', (request) =>
    graphView(decodeURIComponent(request.params[0] ?? ''), false)(request),
  );

  const document = (request: Request) => {
    bearer(request);
    const doc = documents.documents.get((request.params[0] ?? '').split(':')[0] ?? '');
    if (!doc) throw new HttpError(404, { error: { message: 'Document not found' } });
    return doc;
  };
  on('POST', '/google/docs/v1/documents', (request) => {
    bearer(request);
    return documents.view(documents.create(json(request)['title'] as string));
  });
  on('GET', '/google/docs/v1/documents/:id', (request) => documents.view(document(request)));
  on('POST', '/google/docs/v1/documents/:id', (request) => {
    const doc = document(request);
    documents.batchUpdate(doc, json(request)['requests'] as never);
    return { documentId: doc.id };
  });
  on('POST', '/google/drive/v3/files/:id/permissions', (request) => {
    bearer(request);
    const id = request.params[0] ?? '';
    const body = json(request);
    const doc = documents.documents.get(id);
    if (doc) {
      doc.permissions.push({
        type: String(body['type']),
        role: String(body['role']),
        ...(typeof body['emailAddress'] === 'string' && { emailAddress: body['emailAddress'] }),
        query: request.url.search,
      });
    } else if (!documents.files.has(id)) {
      throw new HttpError(404, { error: { message: 'File not found' } });
    }
    return { id: 'permission' };
  });
  on('POST', '/google/upload/drive/v3/files', (request) => {
    bearer(request);
    const id = `file-${documents.files.size}`;
    documents.files.add(id);
    return { id };
  });
  on('DELETE', '/google/drive/v3/files/:id', (request) => {
    bearer(request);
    documents.files.delete(request.params[0] ?? '');
    return {};
  });

  on('POST', '/_admin/events', (request) => {
    const body = JSON.parse(request.form.get('json') ?? '{}') as {
      provider: FakeProvider;
      calendar?: string;
      event: FakeEvent;
    };
    store.upsertEvent(
      body.provider,
      body.calendar ?? store.primaryCalendar(body.provider),
      body.event,
    );
    return { ok: true };
  });
  on('POST', '/_admin/events/delete', (request) => {
    const body = JSON.parse(request.form.get('json') ?? '{}') as {
      provider: FakeProvider;
      calendar?: string;
      id: string;
    };
    store.removeEvent(
      body.provider,
      body.calendar ?? store.primaryCalendar(body.provider),
      body.id,
    );
    return { ok: true };
  });
  on('POST', '/_admin/revoke', () => {
    store.revokeAll();
    return { ok: true };
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const method = req.method ?? 'GET';
      const match = (routes.get(method) ?? [])
        .map((r) => ({ r, m: r.pattern.exec(url.pathname) }))
        .find((entry) => entry.m);
      try {
        if (!match?.m) throw new HttpError(404, { error: 'not found' });
        const raw = method === 'POST' || method === 'PATCH' ? await readBody(req) : '';
        const form = url.pathname.startsWith('/_admin')
          ? new URLSearchParams({ json: raw })
          : new URLSearchParams(raw);
        const result = match.r.handler({
          url,
          query: url.searchParams,
          params: match.m.slice(1),
          form,
          body: raw,
          headers: req.headers,
        });
        if (result instanceof Redirect) {
          res.writeHead(302, { location: result.location }).end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
      } catch (error) {
        const failure =
          error instanceof HttpError ? error : new HttpError(500, { error: String(error) });
        res
          .writeHead(failure.status, { 'content-type': 'application/json' })
          .end(JSON.stringify(failure.body));
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    store,
    documents,
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
