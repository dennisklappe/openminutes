import type { VoicePrototype } from '@openminutes/db';
import { companyFromInvitees } from './company.js';
import { normalizeEmail } from './people.js';
import { profileScore } from './voice-profile.js';
import { VOICE_MATCH_THRESHOLD } from './voices.js';

/**
 * A voice fitting a saved profile at least this well is "sure" when it also leads clearly.
 * Same bar as the voice check uses to raise the confidence of a label.
 */
export const SURE_SCORE = 0.7;
/** The lead over the next best saved voice a "sure" match needs, as the voice check's doubt margin. */
export const SURE_MARGIN = 0.1;

export type Certainty = 'sure' | 'probable';

export interface CheckPerson {
  id: string;
  name: string;
  emails: readonly string[];
  prototypes: readonly VoicePrototype[];
}

export interface CheckVoice {
  id: string;
  embedding: readonly number[] | null;
}

export interface VoiceFit {
  personId: string;
  name: string;
  score: number;
  certainty: Certainty;
}

/**
 * Matches each voice of a meeting to a saved voice profile with the same score the voice check
 * uses. One person is given to one voice only, the better fit keeps them. A voice no profile
 * fits at the match threshold gets nobody.
 */
export function assignVoices(
  voices: readonly CheckVoice[],
  people: readonly CheckPerson[],
  language: string | null,
): Map<string, VoiceFit> {
  const fits = voices.flatMap(({ id, embedding }) => {
    if (!embedding) return [];
    const ranked = people
      .filter((candidate) => candidate.prototypes.length > 0)
      .map((candidate) => ({
        voiceId: id,
        candidate,
        score: profileScore(embedding, candidate.prototypes, language),
      }))
      .sort((a, b) => b.score - a.score);
    const margin = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
    return ranked
      .filter((fit) => fit.score >= VOICE_MATCH_THRESHOLD)
      .map((fit) => ({ ...fit, leads: fit === ranked[0] ? margin : 0 }));
  });
  const result = new Map<string, VoiceFit>();
  const taken = new Set<string>();
  for (const fit of fits.sort((a, b) => b.score - a.score)) {
    if (result.has(fit.voiceId) || taken.has(fit.candidate.id)) continue;
    taken.add(fit.candidate.id);
    result.set(fit.voiceId, {
      personId: fit.candidate.id,
      name: fit.candidate.name,
      score: fit.score,
      certainty: fit.score >= SURE_SCORE && fit.leads >= SURE_MARGIN ? 'sure' : 'probable',
    });
  }
  return result;
}

export interface Attendee {
  name: string | null;
  email: string;
}

/**
 * When exactly one voice and exactly one attendee of the calendar event are left after the voice
 * matching, they are probably each other. With more left over nothing is guessed.
 */
export function fillFromCalendar(
  voiceIds: readonly string[],
  matched: ReadonlyMap<string, { personId: string }>,
  attendees: readonly Attendee[],
  people: readonly Pick<CheckPerson, 'id' | 'emails'>[],
): Map<string, { name: string; email: string }> {
  const left = voiceIds.filter((id) => !matched.has(id));
  const taken = new Set(
    [...matched.values()].flatMap(({ personId }) => {
      const found = people.find((p) => p.id === personId);
      return found ? found.emails.map(normalizeEmail) : [];
    }),
  );
  const open = attendees.filter((attendee) => !taken.has(normalizeEmail(attendee.email)));
  const [voiceId] = left;
  const [attendee] = open;
  if (left.length !== 1 || open.length !== 1 || !voiceId || !attendee) return new Map();
  return new Map([[voiceId, { name: attendee.name ?? attendee.email, email: attendee.email }]]);
}

export interface CompanyHint {
  name: string;
  /** Where the hint comes from: an email domain, or the company of earlier meetings. */
  source: 'email' | 'earlier';
}

/**
 * A guess at the company of someone, never stored: a work email domain first, else the company
 * the most earlier meetings with them had. Free mail, your own domains and a tie give nothing.
 */
export function companyHint(input: {
  emails: readonly string[];
  earlier: readonly (string | null)[];
  ownDomains: ReadonlySet<string>;
}): CompanyHint | undefined {
  for (const email of input.emails) {
    const name = companyFromInvitees([{ email }], input.ownDomains);
    if (name) return { name, source: 'email' };
  }
  const counts = new Map<string, number>();
  for (const company of input.earlier) {
    if (company) counts.set(company, (counts.get(company) ?? 0) + 1);
  }
  const [top, next] = [...counts].sort((a, b) => b[1] - a[1]);
  if (!top || top[1] === next?.[1]) return undefined;
  return { name: top[0], source: 'earlier' };
}
