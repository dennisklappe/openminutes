import { describe, expect, it } from 'vitest';
import {
  canReplay,
  countsText,
  emptyWebhookForm,
  eventLabel,
  filterIsEmpty,
  filterSummary,
  filterToForm,
  formProblem,
  formToFilter,
  formToInput,
  hostOf,
  payloadText,
  resultText,
  splitLines,
} from './webhooks.js';
import type { DeliveryDto, WebhookDto } from '../src/dto.js';

const delivery: DeliveryDto = {
  id: 'd1',
  event: 'meeting.transcribed',
  eventId: 'e1',
  meetingId: null,
  kind: 'event',
  status: 'dead',
  attempts: 6,
  maxAttempts: 6,
  nextAttemptAt: null,
  lastAttemptAt: '2026-01-01T00:00:00Z',
  lastStatusCode: 500,
  lastError: null,
  lastDurationMs: 120,
  createdAt: '2026-01-01T00:00:00Z',
  completedAt: null,
  payload: { a: 1 },
};

describe('filter form', () => {
  it('splits lines, trims and removes blanks and repeats', () => {
    expect(splitLines(' Standup \n\nstandup\r\nSales ')).toEqual(['Standup', 'Sales']);
  });
  it('turns an empty form into an empty filter', () => {
    expect(formToFilter(filterToForm(undefined))).toEqual({});
    expect(filterIsEmpty({ titleContains: [] })).toBe(true);
  });
  it('round trips a filter', () => {
    const filter = {
      titleContains: ['billable'],
      titleNotContains: ['internal'],
      participantContains: ['@acme.com'],
      companies: ['Acme'],
      platforms: ['meet' as const, 'teams' as const],
    };
    expect(formToFilter(filterToForm(filter))).toEqual(filter);
    expect(filterIsEmpty(filter)).toBe(false);
  });
  it('keeps platforms in a fixed order', () => {
    const form = { ...filterToForm({}), platforms: ['teams' as const, 'meet' as const] };
    expect(formToFilter(form).platforms).toEqual(['meet', 'teams']);
  });
  it('summarises active criteria', () => {
    expect(filterSummary({})).toBeNull();
    expect(filterSummary({ titleContains: ['a', 'b'], platforms: ['meet'] })).toBe(
      'title has "a" or "b", Google Meet',
    );
  });
});

describe('webhook form', () => {
  const ok = { ...emptyWebhookForm(), name: 'Chat', url: 'https://example.com/hook' };
  it('accepts a complete form', () => {
    expect(formProblem(ok)).toBeUndefined();
  });
  it('says what is missing', () => {
    expect(formProblem({ ...ok, name: ' ' })).toMatch(/name/);
    expect(formProblem({ ...ok, url: '' })).toMatch(/address/);
    expect(formProblem({ ...ok, url: 'not a url' })).toMatch(/full address/);
    expect(formProblem({ ...ok, url: 'ftp://x.test' })).toMatch(/https/);
    expect(formProblem({ ...ok, url: 'https://u:p@x.test' })).toMatch(/username/);
    expect(formProblem({ ...ok, events: [] })).toMatch(/event/);
  });
  it('allows http only with private addresses', () => {
    expect(formProblem({ ...ok, url: 'http://10.0.0.5/hook' })).toMatch(/Allow private/);
    expect(formProblem({ ...ok, url: 'http://10.0.0.5/hook', allowPrivate: true })).toBeUndefined();
  });
  it('builds the request body', () => {
    expect(
      formToInput({ ...ok, name: ' Chat ', events: ['meeting.summarized', 'meeting.transcribed'] }),
    ).toEqual({
      name: 'Chat',
      url: 'https://example.com/hook',
      events: ['meeting.transcribed', 'meeting.summarized'],
      filter: {},
      allowPrivate: false,
      active: true,
    });
  });
});

describe('delivery text', () => {
  it('labels events', () => {
    expect(eventLabel('webhook.test')).toBe('Test ping');
    expect(eventLabel('meeting.deleted')).toBe('Meeting deleted');
    expect(eventLabel('x.y')).toBe('x.y');
  });
  it('describes the last result', () => {
    expect(resultText(delivery)).toBe('HTTP 500 in 120 ms');
    expect(
      resultText({ ...delivery, attempts: 0, lastAttemptAt: null, lastStatusCode: null }),
    ).toBe('Not tried yet');
    expect(resultText({ ...delivery, lastStatusCode: null, lastError: 'timeout' })).toBe(
      'No response',
    );
  });
  it('only replays settled deliveries', () => {
    expect(canReplay(delivery)).toBe(true);
    expect(canReplay({ ...delivery, status: 'pending' })).toBe(false);
  });
  it('formats counts, hosts and payloads', () => {
    const health = { succeeded24h: 3, failed24h: 1, pending: 2 } as WebhookDto['health'];
    expect(countsText(health)).toBe('3 delivered, 1 failed in 24 hours, 2 waiting');
    expect(hostOf('https://a.example.com/x?y=1')).toBe('a.example.com');
    expect(hostOf('nonsense')).toBe('nonsense');
    expect(payloadText({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
