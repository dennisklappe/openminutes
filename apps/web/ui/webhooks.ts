import type {
  DeliveryDto,
  DeliveryStatus,
  WebhookDto,
  WebhookEventName,
  WebhookFilter,
  WebhookHealthState,
  WebhookInput,
  WebhookPlatform,
} from '../src/dto.js';
import { formatDate } from './format.js';

export const EVENT_CHOICES: { id: WebhookEventName; label: string; hint: string }[] = [
  {
    id: 'meeting.transcribed',
    label: 'Meeting transcribed',
    hint: 'The transcript is ready.',
  },
  {
    id: 'meeting.summarized',
    label: 'Summary written',
    hint: 'An AI summary finished. Manual edits do not count.',
  },
  {
    id: 'meeting.deleted',
    label: 'Meeting deleted',
    hint: 'A meeting was moved to the bin or removed.',
  },
  {
    id: 'meeting.participants_updated',
    label: 'Participants changed',
    hint: 'Names were assigned or edited. Quick edits arrive as one event.',
  },
  {
    id: 'meeting.updated',
    label: 'Title changed',
    hint: 'The meeting was renamed.',
  },
];

export const PLATFORM_CHOICES: { id: WebhookPlatform; label: string }[] = [
  { id: 'meet', label: 'Google Meet' },
  { id: 'teams', label: 'Microsoft Teams' },
  { id: 'whereby', label: 'Whereby' },
  { id: 'recording', label: 'Phone recording' },
  { id: 'imported', label: 'Imported' },
];

export const eventLabel = (event: string): string =>
  event === 'webhook.test'
    ? 'Test ping'
    : (EVENT_CHOICES.find((choice) => choice.id === event)?.label ?? event);

export const HEALTH_LABELS: Record<WebhookHealthState, string> = {
  healthy: 'Healthy',
  degraded: 'Retrying',
  failing: 'Failing',
  disabled: 'Disabled',
  idle: 'No deliveries yet',
};

/** The existing status pill class that carries the colour for a health state. */
export const HEALTH_PILL: Record<WebhookHealthState, string> = {
  healthy: 'pill-transcribed',
  degraded: 'pill-processing',
  failing: 'pill-failed',
  disabled: 'pill-cancelled',
  idle: 'pill-scheduled',
};

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Queued',
  delivering: 'Sending',
  succeeded: 'Delivered',
  failed: 'Will retry',
  dead: 'Gave up',
};

export const DELIVERY_PILL: Record<DeliveryStatus, string> = {
  pending: 'pill-scheduled',
  delivering: 'pill-processing',
  succeeded: 'pill-transcribed',
  failed: 'pill-processing',
  dead: 'pill-failed',
};

export const DELIVERY_FILTERS: { value: '' | DeliveryStatus; label: string }[] = [
  { value: '', label: 'All deliveries' },
  { value: 'succeeded', label: 'Delivered' },
  { value: 'failed', label: 'Will retry' },
  { value: 'dead', label: 'Gave up' },
  { value: 'pending', label: 'Queued' },
];

export const kindLabel = (kind: DeliveryDto['kind']): string =>
  kind === 'test' ? 'Test' : kind === 'replay' ? 'Replay' : '';

/** "12 delivered, 1 failed in 24 hours" and the queued count when there is one. */
export function countsText(health: WebhookDto['health']): string {
  const parts = [`${health.succeeded24h} delivered`, `${health.failed24h} failed`];
  const text = `${parts.join(', ')} in 24 hours`;
  return health.pending > 0 ? `${text}, ${health.pending} waiting` : text;
}

export function lastAttemptsText(health: WebhookDto['health']): string {
  const ok = health.lastSuccessAt
    ? `Last success ${formatDate(health.lastSuccessAt)}`
    : 'No success yet';
  return health.lastFailureAt ? `${ok} · Last failure ${formatDate(health.lastFailureAt)}` : ok;
}

/** The result of the last attempt in a few words: "200 in 120 ms", "timeout", "not tried yet". */
export function resultText(delivery: DeliveryDto): string {
  if (delivery.attempts === 0 && delivery.lastAttemptAt === null) return 'Not tried yet';
  const code = delivery.lastStatusCode;
  const duration = delivery.lastDurationMs;
  const timing = duration === null ? '' : ` in ${duration} ms`;
  if (code !== null) return `HTTP ${code}${timing}`;
  return delivery.lastError ? 'No response' : `Tried${timing}`;
}

export const attemptsText = (delivery: DeliveryDto) =>
  `${delivery.attempts} of ${delivery.maxAttempts}`;

export const canReplay = (delivery: DeliveryDto) =>
  delivery.status !== 'pending' && delivery.status !== 'delivering';

/** The raw payload as shown in the log, indented. */
export function payloadText(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Text fields on the form hold one value per line. */
export interface FilterForm {
  titleContains: string;
  titleNotContains: string;
  participantContains: string;
  companies: string;
  platforms: WebhookPlatform[];
}

export const emptyFilterForm = (): FilterForm => ({
  titleContains: '',
  titleNotContains: '',
  participantContains: '',
  companies: '',
  platforms: [],
});

export function splitLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}

export function filterToForm(filter: WebhookFilter | null | undefined): FilterForm {
  return {
    titleContains: (filter?.titleContains ?? []).join('\n'),
    titleNotContains: (filter?.titleNotContains ?? []).join('\n'),
    participantContains: (filter?.participantContains ?? []).join('\n'),
    companies: (filter?.companies ?? []).join('\n'),
    platforms: [...(filter?.platforms ?? [])],
  };
}

/** Only the criteria that are filled in: an empty filter is `{}`, which matches everything. */
export function formToFilter(form: FilterForm): WebhookFilter {
  const filter: WebhookFilter = {};
  const titleContains = splitLines(form.titleContains);
  const titleNotContains = splitLines(form.titleNotContains);
  const participantContains = splitLines(form.participantContains);
  const companies = splitLines(form.companies);
  if (titleContains.length) filter.titleContains = titleContains;
  if (titleNotContains.length) filter.titleNotContains = titleNotContains;
  if (participantContains.length) filter.participantContains = participantContains;
  if (companies.length) filter.companies = companies;
  if (form.platforms.length)
    filter.platforms = PLATFORM_CHOICES.map((p) => p.id).filter((id) =>
      form.platforms.includes(id),
    );
  return filter;
}

export const filterIsEmpty = (filter: WebhookFilter): boolean =>
  Object.keys(formToFilter(filterToForm(filter))).length === 0;

/** A short summary of the active filters for the list, or null when there are none. */
export function filterSummary(filter: WebhookFilter): string | null {
  const parts: string[] = [];
  const list = (values: string[] | undefined) => (values ?? []).map((v) => `"${v}"`).join(' or ');
  if (filter.titleContains?.length) parts.push(`title has ${list(filter.titleContains)}`);
  if (filter.titleNotContains?.length) parts.push(`title lacks ${list(filter.titleNotContains)}`);
  if (filter.participantContains?.length) parts.push(`with ${list(filter.participantContains)}`);
  if (filter.companies?.length) parts.push(`company ${filter.companies.join(' or ')}`);
  if (filter.platforms?.length) {
    parts.push(
      filter.platforms
        .map((id) => PLATFORM_CHOICES.find((p) => p.id === id)?.label ?? id)
        .join(' or '),
    );
  }
  return parts.length ? parts.join(', ') : null;
}

export interface WebhookForm {
  name: string;
  url: string;
  events: WebhookEventName[];
  filter: FilterForm;
  allowPrivate: boolean;
  active: boolean;
}

export const emptyWebhookForm = (): WebhookForm => ({
  name: '',
  url: '',
  events: ['meeting.transcribed'],
  filter: emptyFilterForm(),
  allowPrivate: false,
  active: true,
});

export const webhookToForm = (hook: WebhookDto): WebhookForm => ({
  name: hook.name,
  url: hook.url,
  events: [...hook.events],
  filter: filterToForm(hook.filter),
  allowPrivate: hook.allowPrivate,
  active: hook.active,
});

export const formToInput = (form: WebhookForm): WebhookInput => ({
  name: form.name.trim(),
  url: form.url.trim(),
  events: EVENT_CHOICES.map((e) => e.id).filter((id) => form.events.includes(id)),
  filter: formToFilter(form.filter),
  allowPrivate: form.allowPrivate,
  active: form.active,
});

/** The first problem with the form as a sentence, or undefined when it can be saved. */
export function formProblem(form: WebhookForm): string | undefined {
  if (!form.name.trim()) return 'Give the webhook a name.';
  const raw = form.url.trim();
  if (!raw) return 'Enter the address that should receive the events.';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Enter a full address, starting with https://.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'The address must start with https://.';
  }
  if (url.username || url.password) return 'Leave the username and password out of the address.';
  if (url.protocol === 'http:' && !form.allowPrivate) {
    return 'Plain http is only allowed together with "Allow private addresses". Use https.';
  }
  if (form.events.length === 0) return 'Pick at least one event.';
  return undefined;
}
