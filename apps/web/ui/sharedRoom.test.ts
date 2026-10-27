import { describe, expect, it } from 'vitest';
import type { ParticipantDto, RoomGroupDto, SubPersonDto } from '../src/dto.js';
import {
  accountText,
  flattenPeople,
  noteText,
  holdersOf,
  inviteeChoices,
  invitedOptions,
  linkTargets,
  needsMove,
  nameBody,
  orderSubs,
  parseWaitMinutes,
  personHref,
  questionOpen,
  questionText,
  splitOptions,
  splitProgress,
  subMeta,
  tileEmailState,
  waitSettingText,
  waitText,
  SPLIT_GIVE_UP_MS,
} from './sharedRoom.js';

const sub = (over: Partial<SubPersonDto> = {}): SubPersonDto => ({
  voiceId: 'v1',
  personId: 'p1',
  participantId: 's1',
  number: 1,
  name: 'Voice 1 (Jo and Sam)',
  unnamed: true,
  lines: 4,
  talkMs: 125_000,
  seatSeparate: false,
  snippets: [],
  emails: [],
  inviteeEmails: [],
  email: null,
  ...over,
});
const room = (over: Partial<RoomGroupDto> = {}): RoomGroupDto => ({
  count: 2,
  detected: 2,
  subs: [sub(), sub({ voiceId: 'v2', personId: 'p2', number: 2, name: 'Voice 2 (Jo and Sam)' })],
  hasAudio: true,
  canSplit: true,
  tileEmail: 'room@example.com',
  splitting: false,
  ...over,
});

describe('question and splits', () => {
  it('asks while the count is unknown and voices were found', () => {
    expect(questionOpen({ count: null, detected: 2 })).toBe(true);
    expect(questionOpen({ count: 2, detected: 2 })).toBe(false);
    expect(questionOpen({ count: null, detected: 0 })).toBe(false);
    expect(questionText({ name: 'Jo and Sam' })).toBe(
      'Jo and Sam sounds like several people. How many?',
    );
  });

  it('offers a split into 2 or 3 only when allowed and no question is open', () => {
    expect(splitOptions(room())).toEqual([2, 3]);
    expect(splitOptions(room({ canSplit: false }))).toEqual([]);
    expect(splitOptions(room({ count: null }))).toEqual([]);
  });

  it('follows a split until it is done or gives up', () => {
    const now = 1_000_000;
    expect(splitProgress(undefined, now, now + 3000)).toBe('working');
    expect(splitProgress(room({ splitting: true }), now, now + 3000)).toBe('working');
    expect(splitProgress(room(), now, now + 3000)).toBe('done');
    expect(splitProgress(room({ subs: [] }), now, now + SPLIT_GIVE_UP_MS)).toBe('failed');
  });
});

describe('texts', () => {
  it('tells when the summary waits', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    expect(waitText('2026-10-27T10:15:00Z', now)).toMatch(/summary waits until/);
    expect(waitText('2026-10-27T09:00:00Z', now)).toBeUndefined();
    expect(waitText(null, now)).toBeUndefined();
    expect(waitText('nonsense', now)).toBeUndefined();
  });

  it('describes a sub-person', () => {
    expect(subMeta(sub())).toBe('2m talking, 4 lines');
    expect(subMeta(sub({ talkMs: 0, lines: 1 }))).toBe('1 line');
    expect(personHref(sub())).toBeUndefined();
    expect(personHref(sub({ unnamed: false }))).toBe('#/people/p1');
    expect(orderSubs([sub({ number: 2 }), sub({ number: 1 })]).map((s) => s.number)).toEqual([
      1, 2,
    ]);
  });

  it('describes the wait setting and reads the field', () => {
    expect(waitSettingText(0)).toMatch(/never waits/);
    expect(waitSettingText(1)).toMatch(/1 minute /);
    expect(waitSettingText(15)).toMatch(/15 minutes/);
    expect(parseWaitMinutes('15')).toBe(15);
    expect(parseWaitMinutes('0')).toBe(0);
    expect(parseWaitMinutes('-1')).toBeUndefined();
    expect(parseWaitMinutes('2000')).toBeUndefined();
    expect(parseWaitMinutes('')).toBeUndefined();
    expect(accountText({ label: 'Jo and Sam', count: 2 })).toBe('Jo and Sam, 2 people');
  });
});

describe('emails of sub-people', () => {
  it('shows which invitee the other sub-person has', () => {
    const a = sub({ inviteeEmails: ['jo@example.com'] });
    const b = sub({
      voiceId: 'v2',
      name: 'Voice 2 (Jo and Sam)',
      inviteeEmails: ['sam@example.com'],
    });
    const invitees = [
      { email: 'jo@example.com', name: 'Jo Parker', declined: false },
      { email: 'sam@example.com', name: 'Sam Fixture', declined: false },
      { email: 'kim@example.com', name: null, declined: false },
    ];
    expect(inviteeChoices(invitees, a, [a, b]).map((c) => [c.mine, c.takenBy])).toEqual([
      [true, null],
      [false, 'Voice 2 (Jo and Sam)'],
      [false, null],
    ]);
  });

  it('gives the account address to one sub-person at most', () => {
    const [a, b] = [sub({ email: 'ROOM@example.com' }), sub({ voiceId: 'v2', name: 'Two' })];
    const r = room({ subs: [a, b] });
    expect(tileEmailState(r, a)).toEqual({ kind: 'mine', email: 'room@example.com' });
    expect(tileEmailState(r, b)).toEqual({
      kind: 'taken',
      email: 'room@example.com',
      by: a.name,
    });
    expect(tileEmailState(room({ tileEmail: null }), a)).toEqual({ kind: 'none' });
    expect(tileEmailState(room({ subs: [b] }), b)).toEqual({
      kind: 'free',
      email: 'room@example.com',
    });
  });

  it('names with a person or a typed name', () => {
    expect(nameBody({ personId: 'p', name: 'Jo' })).toEqual({ personId: 'p' });
    expect(nameBody({ personId: null, name: 'Jo' })).toEqual({ name: 'Jo' });
  });
});

describe('every invitee for a sub-person', () => {
  const invitees = [
    { email: 'jo@example.com', name: 'Jo Parker', declined: false },
    { email: 'rita@example.com', name: 'Rita Fixture', declined: false },
    { email: 'kim@example.com', name: null, declined: false },
  ];

  it('marks an invitee linked to a plain participant and can move it', () => {
    const a = sub();
    const choices = inviteeChoices(
      invitees,
      a,
      [a],
      [{ name: 'Remote Rita', inviteeEmails: ['RITA@example.com'] }],
    );
    expect(choices.map((c) => [c.invitee.email, c.mine, c.takenBy])).toEqual([
      ['jo@example.com', false, null],
      ['rita@example.com', false, 'Remote Rita'],
      ['kim@example.com', false, null],
    ]);
    expect(needsMove(choices, ['jo@example.com'])).toBe(false);
    expect(needsMove(choices, ['Rita@example.com'])).toBe(true);
  });
});

describe('who an invitee can be', () => {
  const person = (over: Partial<ParticipantDto>): ParticipantDto => ({
    id: 'x',
    name: 'Remote Rita',
    originalName: null,
    joinedAt: null,
    leftAt: null,
    talkMs: 0,
    confirmed: true,
    email: null,
    inviteeEmails: [],
    canSplit: false,
    ...over,
  });

  it('offers the people of a shared tile instead of the tile', () => {
    const tile = person({ id: 't', name: 'Jo and Sam', room: room() });
    const rita = person({ id: 'r', name: 'Remote Rita', originalName: 'rita-phone' });
    const targets = linkTargets([tile, rita]);
    expect(targets.groups).toEqual([
      {
        tile: 'Jo and Sam',
        targets: [
          { participantId: 's1', label: 'Voice 1 (Jo and Sam)' },
          { participantId: 's1', label: 'Voice 2 (Jo and Sam)' },
        ],
      },
    ]);
    expect(targets.singles).toEqual([{ participantId: 'r', label: 'Remote Rita (rita-phone)' }]);
  });

  it('keeps a tile that still waits for its question as a participant', () => {
    const waiting = person({ id: 't', name: 'Jo and Sam', room: room({ subs: [] }) });
    expect(linkTargets([waiting]).singles.map((t) => t.participantId)).toEqual(['t']);
  });

  it('lists the invitee links of every participant, a tile too', () => {
    const tile = person({
      id: 't',
      name: 'Jo and Sam',
      inviteeEmails: ['room@example.com'],
      room: room(),
    });
    const rita = person({ id: 'r', inviteeEmails: ['rita@example.com'] });
    expect(holdersOf([tile, rita])).toEqual([
      { name: 'Jo and Sam', inviteeEmails: ['room@example.com'] },
      { name: 'Remote Rita', inviteeEmails: ['rita@example.com'] },
    ]);
  });
});

describe('invitedOptions', () => {
  const invitees = [
    { email: 'bart@acme.example', name: null, declined: false },
    { email: 'jo.parker@example.com', name: 'Jo Parker', declined: false },
    { email: 'rita@example.com', name: 'Rita Fixture', declined: false },
    { email: 'me@example.com', name: 'Me Fixture', declined: false },
  ];
  const choices = inviteeChoices(
    invitees,
    { voiceId: '', inviteeEmails: [] },
    [],
    [{ name: 'Remote Rita', inviteeEmails: ['rita@example.com'] }],
  );
  const known = [{ id: 'p-jo', name: 'Joanna Parker', emails: ['JO.PARKER@example.com'] }];

  it('names an invitee from the invite, the address, or the person who has the address', () => {
    const labels = invitedOptions(choices, known, { inviteeEmails: ['me@example.com'] }).map(
      (o) => [o.label, o.option.personId],
    );
    expect(labels).toEqual([
      ['Bart (bart@acme.example)', null],
      ['Joanna Parker (jo.parker@example.com)', 'p-jo'],
    ]);
  });

  it('leaves out invitees linked to someone else until moving is allowed', () => {
    expect(invitedOptions(choices, known).some((o) => o.email === 'rita@example.com')).toBe(false);
    const taken = invitedOptions(choices, known, {}, true).find(
      (o) => o.email === 'rita@example.com',
    );
    expect(taken?.takenBy).toBe('Remote Rita');
    expect(taken?.option.email).toBe('rita@example.com');
  });

  it('leaves out the person being changed', () => {
    expect(invitedOptions(choices, known, { personId: 'p-jo' }).map((o) => o.email)).not.toContain(
      'jo.parker@example.com',
    );
  });
});

describe('the flat People list', () => {
  const person = (over: Partial<ParticipantDto>): ParticipantDto => ({
    id: 'x',
    name: 'Remote Rita',
    originalName: null,
    joinedAt: null,
    leftAt: null,
    talkMs: 0,
    confirmed: true,
    email: null,
    inviteeEmails: [],
    canSplit: false,
    ...over,
  });
  const named = (over: Partial<SubPersonDto>) => sub({ unnamed: false, ...over });

  it('lists the voices of a tile as people in its place and keeps the tile as a note', () => {
    const tile = person({ id: 't', name: 'Jo and Sam', room: room() });
    const rita = person({ id: 'r' });
    const { rows, notes } = flattenPeople([rita, tile]);
    expect(rows.map((row) => (row.kind === 'voice' ? row.sub.name : row.person.name))).toEqual([
      'Remote Rita',
      'Voice 1 (Jo and Sam)',
      'Voice 2 (Jo and Sam)',
    ]);
    expect(notes).toEqual([tile]);
    expect(noteText(tile, 2)).toBe('Joined from one shared account: Jo and Sam, 2 voices');
  });

  it('hides the note for a tile with one voice, and leaves a question or a dismissed tile alone', () => {
    const one = person({ id: 't', room: room({ subs: [sub()] }) });
    expect(flattenPeople([one]).notes).toEqual([]);
    expect(flattenPeople([one]).rows).toHaveLength(1);
    const asking = person({ id: 'q', room: room({ count: null, detected: 2 }) });
    const flat = flattenPeople([asking, person({ id: 'd' })]);
    expect(flat.rows.map((row) => row.kind)).toEqual(['person', 'person']);
    expect(flat.notes).toEqual([]);
  });

  it('puts a voice of a person who also joined alone right under that participant', () => {
    const pieter = person({ id: 'seat-pieter', name: 'Pieter' });
    const tile = person({
      id: 't',
      name: 'Ann and Sam',
      room: room({
        subs: [
          named({
            voiceId: 'v1',
            participantId: 'seat-pieter',
            name: 'Pieter',
            seatSeparate: true,
          }),
          named({ voiceId: 'v2', participantId: 'seat-bart', number: 2, name: 'Bart' }),
        ],
      }),
    });
    const { rows } = flattenPeople([tile, pieter]);
    expect(
      rows.map((row) => (row.kind === 'voice' ? `voice ${row.sub.name}` : row.person.name)),
    ).toEqual(['voice Bart', 'Pieter', 'voice Pieter']);
  });
});
