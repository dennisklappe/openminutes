import { meetingPlatforms, type MeetingPlatform, type WebhookFilter } from '@openminutes/db';
import { z } from 'zod';

export type { WebhookFilter };

const terms = z.array(z.string().trim().min(1).max(200)).max(50);

/** What the API accepts as a filter. Empty lists are dropped, so `{}` means every meeting. */
export const webhookFilterSchema = z
  .strictObject({
    titleContains: terms.optional(),
    titleNotContains: terms.optional(),
    participantContains: terms.optional(),
    companies: terms.optional(),
    platforms: z.array(z.enum(meetingPlatforms)).max(meetingPlatforms.length).optional(),
  })
  .transform((filter): WebhookFilter => {
    const clean: WebhookFilter = {};
    for (const [key, value] of Object.entries(filter) as [keyof WebhookFilter, string[]][]) {
      const unique = [...new Set(value)];
      if (unique.length > 0) Object.assign(clean, { [key]: unique });
    }
    return clean;
  });

/** What a filter is matched against: the facts in the payload plus the participant emails. */
export interface WebhookMeetingFacts {
  title: string;
  participants: { name: string; email?: string | null | undefined }[];
  company: string | null;
  platform: MeetingPlatform;
}

const lower = (value: string) => value.toLocaleLowerCase();
const given = (list: readonly unknown[] | undefined): list is readonly string[] =>
  list !== undefined && list.length > 0;

/** True when every criterion the filter sets holds for the meeting. */
export function matchesWebhookFilter(
  filter: WebhookFilter | null | undefined,
  meeting: WebhookMeetingFacts,
): boolean {
  if (!filter) return true;
  const title = lower(meeting.title);
  if (given(filter.titleContains) && !filter.titleContains.some((t) => title.includes(lower(t)))) {
    return false;
  }
  if (
    given(filter.titleNotContains) &&
    filter.titleNotContains.some((t) => title.includes(lower(t)))
  ) {
    return false;
  }
  if (given(filter.participantContains)) {
    const haystack = meeting.participants.flatMap((p) =>
      [p.name, p.email ?? ''].filter(Boolean).map(lower),
    );
    const wanted = filter.participantContains.map(lower);
    if (!wanted.some((term) => haystack.some((value) => value.includes(term)))) return false;
  }
  if (given(filter.companies)) {
    const company = meeting.company === null ? null : lower(meeting.company.trim());
    if (company === null || !filter.companies.some((c) => lower(c.trim()) === company)) {
      return false;
    }
  }
  if (given(filter.platforms) && !filter.platforms.includes(meeting.platform)) return false;
  return true;
}
