import { localPart, normalise, sameEmail } from './people.js';

export interface MatchInvitee {
  email: string;
  name: string | null;
}

export interface MatchParticipant {
  displayName: string;
  originalName?: string | null;
  email: string | null;
  /** Explicit links to invitees, set by the owner: one person may have several emails. They always win over guessing. */
  inviteeEmails?: readonly string[] | null;
}

const MIN_FIRST_NAME = 2;

const domainOf = (email: string) => email.slice(email.indexOf('@') + 1).toLowerCase();
const firstName = (name: string) => normalise(name).split(' ')[0] ?? '';

const participantNames = (person: MatchParticipant) =>
  [person.displayName, person.originalName].filter((name): name is string => !!name);
const inviteeNames = (invitee: MatchInvitee) =>
  [invitee.name, localPart(invitee.email)].filter((name): name is string => !!name);

const sharesFirstName = (person: MatchParticipant, invitee: MatchInvitee) => {
  const wanted = new Set(inviteeNames(invitee).map(firstName));
  return participantNames(person)
    .map(firstName)
    .some((name) => name.length >= MIN_FIRST_NAME && wanted.has(name));
};

/** A name-less invitee's local part often glues first and last name together: dennisklappe for Dennis. */
const MIN_PREFIX_NAME = 4;
const localPartStartsWithFirstName = (person: MatchParticipant, invitee: MatchInvitee) => {
  const local = normalise(localPart(invitee.email)).replace(/ /g, '');
  return (
    invitee.name === null &&
    participantNames(person)
      .map(firstName)
      .some((name) => name.length >= MIN_PREFIX_NAME && local.startsWith(name))
  );
};

const sameFullName = (person: MatchParticipant, invitee: MatchInvitee) => {
  const wanted = new Set(inviteeNames(invitee).map(normalise));
  return participantNames(person).some((name) => wanted.has(normalise(name)));
};

const sameFirstNameAndDomain = (person: MatchParticipant, invitee: MatchInvitee) =>
  person.email !== null &&
  domainOf(person.email) === domainOf(invitee.email) &&
  sharesFirstName(person, invitee);

/** Every invitee the owner linked to this person. */
const linkedInvitees = <I extends MatchInvitee>(
  invitees: readonly I[],
  person: MatchParticipant,
): I[] =>
  invitees.filter((invitee) =>
    (person.inviteeEmails ?? []).some((email) => sameEmail(invitee.email, email)),
  );

/**
 * Which invitee each participant is, by index (undefined: nobody). In order of trust: an explicit
 * link, the same email, the same full name or first name on the same email domain, and last a
 * shared first name that only counts when it is unambiguous on both sides. Two participants may
 * be the same invitee (someone who rejoined), so the surer passes may reuse one.
 */
export function matchInvitees<I extends MatchInvitee>(
  invitees: readonly I[],
  participants: readonly MatchParticipant[],
): (I | undefined)[] {
  const matches: (I | undefined)[] = participants.map(
    (person) => linkedInvitees(invitees, person)[0],
  );
  const claimed = new Set(matches.filter((invitee): invitee is I => invitee !== undefined));
  const candidates = (
    index: number,
    test: (p: MatchParticipant, i: MatchInvitee) => boolean,
    reuse = true,
  ) => {
    const person = participants[index];
    if (!person || matches[index]) return [];
    return invitees.filter((invitee) => (reuse || !claimed.has(invitee)) && test(person, invitee));
  };
  const take = (index: number, invitee: I | undefined) => {
    if (!invitee) return;
    matches[index] = invitee;
    claimed.add(invitee);
  };

  const greedy = (test: (p: MatchParticipant, i: MatchInvitee) => boolean) => {
    participants.forEach((_, index) => {
      take(index, candidates(index, test)[0]);
    });
  };
  greedy((person, invitee) => sameEmail(person.email, invitee.email));
  greedy(
    (person, invitee) => sameFullName(person, invitee) || sameFirstNameAndDomain(person, invitee),
  );

  const options = participants.map((_, index) =>
    candidates(
      index,
      (person, invitee) =>
        sharesFirstName(person, invitee) || localPartStartsWithFirstName(person, invitee),
      false,
    ),
  );
  options.forEach((own, index) => {
    const [only] = own;
    if (own.length === 1 && only && options.filter((other) => other.includes(only)).length === 1) {
      take(index, only);
    }
  });
  return matches;
}

export function unmatchedInvitees<I extends MatchInvitee>(
  invitees: readonly I[],
  participants: readonly MatchParticipant[],
): I[] {
  const matched = new Set([
    ...matchInvitees(invitees, participants),
    ...participants.flatMap((person) => linkedInvitees(invitees, person)),
  ]);
  return invitees.filter((invitee) => !matched.has(invitee));
}
