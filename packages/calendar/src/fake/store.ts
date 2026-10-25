import { randomUUID } from 'node:crypto';

export type FakeProvider = 'google' | 'microsoft';

export interface FakeEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  conferenceUrl?: string | undefined;
  organizerSelf?: boolean;
  seriesId?: string;
  guests?: string[];
  readOnly?: boolean;
}

export interface RecordedPatch {
  provider: FakeProvider;
  calendar: string;
  eventId: string;
  query: string;
}

interface Change {
  provider: FakeProvider;
  calendar: string;
  eventId: string;
}

export interface FakeOptions {
  email?: string;
  pageSize?: number;
  expiresInSeconds?: number;
}

export class FakeStore {
  readonly email: string;
  readonly pageSize: number;
  readonly expiresInSeconds: number;
  private readonly events = new Map<string, FakeEvent>();
  private readonly changes: Change[] = [];
  readonly patches: RecordedPatch[] = [];
  private readonly accessTokens = new Map<string, number>();
  private readonly refreshTokens = new Set<string>();
  private readonly codes = new Map<
    string,
    { challenge: string; redirectUri: string; scope: string }
  >();

  constructor(options: FakeOptions = {}) {
    this.email = options.email ?? 'fake.user@example.com';
    this.pageSize = options.pageSize ?? 100;
    this.expiresInSeconds = options.expiresInSeconds ?? 3600;
  }

  get version(): number {
    return this.changes.length;
  }

  calendarsOf(provider: FakeProvider): { id: string; name: string; primary: boolean }[] {
    return [
      {
        id: provider === 'google' ? this.email : 'primary-calendar',
        name: 'Primary',
        primary: true,
      },
      { id: `${provider}-team-calendar`, name: 'Team', primary: false },
    ];
  }

  primaryCalendar(provider: FakeProvider): string {
    return this.calendarsOf(provider)[0]?.id ?? '';
  }

  private key = (provider: FakeProvider, calendar: string, id: string) =>
    `${provider}\u0000${calendar}\u0000${id}`;

  upsertEvent(provider: FakeProvider, calendar: string, event: FakeEvent): void {
    this.events.set(this.key(provider, calendar, event.id), event);
    this.changes.push({ provider, calendar, eventId: event.id });
  }

  getEvent(provider: FakeProvider, calendar: string, id: string): FakeEvent | undefined {
    return this.events.get(this.key(provider, calendar, id));
  }

  removeEvent(provider: FakeProvider, calendar: string, id: string): void {
    this.events.delete(this.key(provider, calendar, id));
    this.changes.push({ provider, calendar, eventId: id });
  }

  eventsIn(provider: FakeProvider, calendar: string, from: Date, to: Date): FakeEvent[] {
    return [...this.events.entries()]
      .filter(([key]) => key.startsWith(`${provider}\u0000${calendar}\u0000`))
      .map(([, event]) => event)
      .filter((event) => new Date(event.end) > from && new Date(event.start) < to);
  }

  changedSince(
    provider: FakeProvider,
    calendar: string,
    version: number,
  ): { id: string; event: FakeEvent | undefined }[] {
    const ids = new Set(
      this.changes
        .slice(version)
        .filter((c) => c.provider === provider && c.calendar === calendar)
        .map((c) => c.eventId),
    );
    return [...ids].map((id) => ({
      id,
      event: this.events.get(this.key(provider, calendar, id)),
    }));
  }

  issueCode(challenge: string, redirectUri: string, scope: string): string {
    const code = randomUUID();
    this.codes.set(code, { challenge, redirectUri, scope });
    return code;
  }

  redeemCode(code: string): { challenge: string; redirectUri: string; scope: string } | undefined {
    const grant = this.codes.get(code);
    this.codes.delete(code);
    return grant;
  }

  issueAccessToken(): string {
    const token = randomUUID();
    this.accessTokens.set(token, Date.now() + this.expiresInSeconds * 1000);
    return token;
  }

  issueRefreshToken(): string {
    const token = randomUUID();
    this.refreshTokens.add(token);
    return token;
  }

  isAccessTokenValid(token: string): boolean {
    return (this.accessTokens.get(token) ?? 0) > Date.now();
  }

  consumeRefreshToken(token: string, rotate: boolean): boolean {
    if (!this.refreshTokens.has(token)) return false;
    if (rotate) this.refreshTokens.delete(token);
    return true;
  }

  revokeAll(): void {
    this.refreshTokens.clear();
    this.accessTokens.clear();
  }
}
