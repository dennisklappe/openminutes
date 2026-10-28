import type { ReviewOrder } from '../src/dto.js';

/** What a review address says: the scope, the order and the card on screen. */
export interface ReviewRoute {
  personId?: string | undefined;
  meetingId?: string | undefined;
  order?: ReviewOrder | undefined;
  lineId?: string | undefined;
  /** An environment card, a voice that does not match its label. */
  voiceId?: string | undefined;
}

const ID = '[\\w-]+';
/** An optional card: `/voice/<id>` for a voice, `/<id>` for a line. */
const CARD = `(?:/voice/(${ID})|/(${ID}))?`;
const PATHS = [
  new RegExp(`^/people/review${CARD}$`),
  new RegExp(`^/people/(${ID})/review${CARD}$`),
  new RegExp(`^/meetings/(${ID})/review${CARD}$`),
];

const card = (voice: string | undefined, line: string | undefined): ReviewRoute => ({
  ...(voice && { voiceId: voice }),
  ...(line && { lineId: line }),
});

/**
 * Reads a hash route such as `/people/review/<lineId>?personId=...&meetingId=...&order=uncertain`.
 * A voice card is `/people/review/voice/<voiceId>`.
 * The older forms `/people/<id>/review` and `/meetings/<id>/review` still work, with or without a
 * card. Undefined when the route is not a review route.
 */
export function parseReviewRoute(route: string): ReviewRoute | undefined {
  const [path = '', query = ''] = route.split('?', 2);
  const params = new URLSearchParams(query);
  const order = params.get('order');
  const base: ReviewRoute = {
    ...(order === 'newest' || order === 'uncertain' ? { order } : {}),
  };
  const scope = (key: 'personId' | 'meetingId') => {
    const value = params.get(key);
    return value && new RegExp(`^${ID}$`).test(value) ? value : undefined;
  };
  const everyone = PATHS[0]?.exec(path);
  if (everyone) {
    const personId = scope('personId');
    const meetingId = scope('meetingId');
    return {
      ...base,
      ...(personId && { personId }),
      ...(meetingId && { meetingId }),
      ...card(everyone[1], everyone[2]),
    };
  }
  const person = PATHS[1]?.exec(path);
  if (person?.[1]) {
    return { ...base, personId: person[1], ...card(person[2], person[3]) };
  }
  const meeting = PATHS[2]?.exec(path);
  if (meeting?.[1]) {
    return { ...base, meetingId: meeting[1], ...card(meeting[2], meeting[3]) };
  }
  return undefined;
}

/**
 * The address of a card, or of the start of the review when there is no line. One scope keeps
 * its own path (`/people/<id>/review`, `/meetings/<id>/review`), the rest goes in the query.
 */
export function buildReviewRoute({
  personId,
  meetingId,
  order,
  lineId,
  voiceId,
}: ReviewRoute): string {
  const params = new URLSearchParams();
  if (order && order !== 'newest') params.set('order', order);
  let path = '/people/review';
  if (personId && !meetingId) path = `/people/${personId}/review`;
  else if (meetingId && !personId) path = `/meetings/${meetingId}/review`;
  else {
    if (personId) params.set('personId', personId);
    if (meetingId) params.set('meetingId', meetingId);
  }
  const query = params.toString();
  const tail = voiceId ? `/voice/${voiceId}` : lineId ? `/${lineId}` : '';
  return `${path}${tail}${query ? `?${query}` : ''}`;
}
