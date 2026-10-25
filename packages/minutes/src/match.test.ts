import { describe, expect, it } from 'vitest';
import { matchInvitees, unmatchedInvitees, type MatchParticipant } from './match.js';

const carla = { email: 'carla.gonzalez@acme.example', name: 'Carla Gonzalez' };
const dana = { email: 'dana@example.com', name: 'Dana Keller' };
const person = (overrides: Partial<MatchParticipant> = {}): MatchParticipant => ({
  displayName: 'Someone',
  email: null,
  ...overrides,
});
type Invitee = { email: string; name: string | null };
const unmatched = (invitees: Invitee[], participants: MatchParticipant[]) =>
  unmatchedInvitees(invitees, participants).map((invitee) => invitee.email);

describe('matching invitees to participants', () => {
  it('matches a shared company account renamed to the invitee first name', () => {
    const shared = person({ displayName: 'Carla', originalName: 'Marketing Acme' });
    expect(unmatched([carla, dana], [shared])).toEqual([dana.email]);
  });

  it('matches on the same email, however it is cased', () => {
    const joined = person({ displayName: 'Guest 4', email: 'Dana@Example.com' });
    expect(unmatched([dana], [joined])).toEqual([]);
  });

  it('matches a full name, or the original name, ignoring case and diacritics', () => {
    const accented = { email: 'rene@example.com', name: 'René Müller' };
    expect(unmatched([accented], [person({ displayName: 'RENE MULLER' })])).toEqual([]);
    expect(
      unmatched([dana], [person({ displayName: 'Dana', originalName: 'Dana Keller' })]),
    ).toEqual([]);
  });

  it('matches a first name when the invitee has no display name, via the email local part', () => {
    const bare = { email: 'carla.gonzalez@acme.example', name: null };
    expect(unmatched([bare], [person({ displayName: 'Carla' })])).toEqual([]);
  });

  it('does not match a one letter first name', () => {
    const initial = { email: 'b@acme.example', name: 'B' };
    expect(unmatched([initial], [person({ displayName: 'B. Smith' })])).toEqual([initial.email]);
  });

  it('leaves both invitees absent when two share the first name of one participant', () => {
    const other = { email: 'carla.smith@elsewhere.com', name: 'Carla Smith' };
    const shared = person({ displayName: 'Carla' });
    expect(unmatched([carla, other], [shared])).toEqual([carla.email, other.email]);
  });

  it('leaves the invitee absent when two participants share the first name', () => {
    const twins = [person({ displayName: 'Carla' }), person({ displayName: 'Carla (2)' })];
    expect(unmatched([carla], twins)).toEqual([carla.email]);
  });

  it('settles a first name clash by full name first', () => {
    const other = { email: 'carla.smith@elsewhere.com', name: 'Carla Smith' };
    const participants = [person({ displayName: 'Carla Smith' }), person({ displayName: 'Carla' })];
    expect(matchInvitees([carla, other], participants)).toEqual([other, carla]);
  });

  it('lets an explicit link win over a name that points at someone else', () => {
    const other = { email: 'carla.smith@elsewhere.com', name: 'Carla Smith' };
    const linked = person({ displayName: 'Carla', inviteeEmail: 'CARLA.SMITH@elsewhere.com' });
    expect(matchInvitees([carla, other], [linked])).toEqual([other]);
    expect(unmatched([carla, other], [linked])).toEqual([carla.email]);
  });

  it('lets an explicit link match a participant with a completely different name', () => {
    const linked = person({ displayName: 'Marketing Acme', inviteeEmail: carla.email });
    expect(unmatched([carla], [linked])).toEqual([]);
  });

  it('ignores a link to someone who was not invited and falls back to names', () => {
    const stale = person({ displayName: 'Carla', inviteeEmail: 'gone@example.com' });
    expect(unmatched([carla], [stale])).toEqual([]);
  });

  it('matches a first name on the same email domain', () => {
    const joined = person({ displayName: 'Carla G', email: 'carla@acme.example' });
    expect(unmatched([carla], [joined])).toEqual([]);
  });
});
