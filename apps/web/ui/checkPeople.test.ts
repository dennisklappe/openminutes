import { describe, expect, it } from 'vitest';
import type { CheckMatchDto, CheckVoiceDto } from '../src/dto.js';
import {
  canConfirm,
  companyText,
  confirmInput,
  headline,
  initialChoices,
  matchText,
  type Choice,
} from './checkPeople.js';

const match = (values: Partial<CheckMatchDto> = {}): CheckMatchDto => ({
  name: 'Jo Parker',
  personId: 'p1',
  email: null,
  certainty: 'sure',
  source: 'voice',
  onCalendar: false,
  company: null,
  ...values,
});
const voice = (id: string, m: CheckMatchDto | null, label = 'Speaker 1'): CheckVoiceDto => ({
  id,
  label,
  durationMs: 5000,
  match: m,
  attendees: [],
});

describe('headline', () => {
  it('says how many people and who they probably are', () => {
    expect(
      headline([
        voice('a', match()),
        voice('b', match({ name: 'Ann Lee', certainty: 'probable', personId: 'p2' })),
      ]),
    ).toBe('2 people detected: Jo Parker (sure), Ann Lee (probable). Is that right?');
  });

  it('says so for a voice nobody was matched to, and for one person', () => {
    expect(headline([voice('a', match()), voice('b', null, 'Speaker 2')])).toBe(
      '2 people detected: Jo Parker (sure), Speaker 2 (no match yet). Is that right?',
    );
    expect(headline([voice('a', match())])).toBe(
      '1 person detected: Jo Parker (sure). Is that right?',
    );
  });
});

describe('matchText and companyText', () => {
  it('words the certainty and where it came from', () => {
    expect(matchText(match())).toBe('Sounds like Jo Parker, sure');
    expect(matchText(match({ source: 'calendar', certainty: 'probable' }))).toBe(
      'Invited to this meeting: Jo Parker, probable',
    );
    expect(matchText(match({ source: 'label' }))).toBe('Already called Jo Parker, sure');
  });

  it('hints a company only as a guess', () => {
    expect(companyText(match({ company: { name: 'Acme', source: 'email' } }))).toBe(
      'probably Acme',
    );
    expect(companyText(match())).toBeUndefined();
  });
});

describe('confirm', () => {
  const voices = [voice('a', match()), voice('b', null, 'Speaker 2')];

  it('starts from the matches and leaves a voice without one unnamed', () => {
    expect(initialChoices(voices)).toEqual({ a: { kind: 'match' }, b: { kind: 'none' } });
  });

  it('sends the person of a match, a picked person and a new name', () => {
    const choices: Record<string, Choice> = {
      a: { kind: 'match' },
      b: { kind: 'new', name: ' Ann Lee ', email: 'ann@acme.example' },
    };
    expect(confirmInput(voices, choices)).toEqual({
      voices: [
        { participantId: 'a', personId: 'p1' },
        { participantId: 'b', name: 'Ann Lee', email: 'ann@acme.example' },
      ],
    });
    expect(
      confirmInput(voices, {
        a: { kind: 'person', personId: 'p9', name: 'Sam Roe' },
        b: { kind: 'none' },
      }),
    ).toEqual({ voices: [{ participantId: 'a', personId: 'p9' }] });
  });

  it('names a match that is not in People yet by its name and email', () => {
    const calendar = [voice('a', match({ personId: null, email: 'jo@parker.example' }))];
    expect(confirmInput(calendar, { a: { kind: 'match' } })).toEqual({
      voices: [{ participantId: 'a', name: 'Jo Parker', email: 'jo@parker.example' }],
    });
  });

  it('needs something to send and no name left empty', () => {
    expect(canConfirm(voices, { a: { kind: 'none' }, b: { kind: 'none' } })).toBe(false);
    expect(canConfirm(voices, initialChoices(voices))).toBe(true);
    expect(canConfirm(voices, { a: { kind: 'match' }, b: { kind: 'new', name: '  ' } })).toBe(
      false,
    );
  });

  it('refuses the same person twice', () => {
    const both = [voice('a', match()), voice('b', match({ name: 'jo parker' }))];
    expect(canConfirm(both, initialChoices(both))).toBe(false);
  });
});
