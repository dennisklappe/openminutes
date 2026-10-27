import { describe, expect, it } from 'vitest';
import type { InviteeDto, ParticipantDto } from '../../src/dto.js';
import { likelyInvitee, presence, renameToSave } from './names.js';

const person: ParticipantDto = {
  id: '1',
  name: 'Carla',
  originalName: 'Marketing Acme',
  joinedAt: null,
  leftAt: null,
  talkMs: 0,
  confirmed: true,
  email: null,
  inviteeEmails: [],
};

const invitee = (email: string, name: string | null): InviteeDto => ({
  email,
  name,
  declined: false,
});

describe('renameToSave', () => {
  it('trims and returns a changed name', () => {
    expect(renameToSave('  Bren  ', person, [])).toEqual({
      name: 'Bren',
      inviteeEmails: [],
      email: null,
    });
  });

  it('returns nothing for an empty, unchanged or too long name', () => {
    expect(renameToSave('   ', person, [])).toBeUndefined();
    expect(renameToSave(' Carla ', person, [])).toBeUndefined();
    expect(renameToSave('x'.repeat(81), person, [])).toBeUndefined();
  });

  it('saves a changed invitee link with the same name, and a cleared one as null', () => {
    expect(renameToSave('Carla', person, ['b@x.com'])).toEqual({
      name: 'Carla',
      inviteeEmails: ['b@x.com'],
    });
    const linked = { ...person, inviteeEmails: ['b@x.com'] };
    expect(renameToSave('Carla', linked, [])).toEqual({
      name: 'Carla',
      inviteeEmails: [],
      email: null,
    });
    expect(renameToSave('Carla', linked, ['b@x.com'])).toBeUndefined();
  });

  it('saves several invitees for one person, whatever the order', () => {
    const linked = { ...person, inviteeEmails: ['a@x.com', 'b@x.com'] };
    expect(renameToSave('Carla', linked, ['b@x.com', 'a@x.com'])).toBeUndefined();
    expect(renameToSave('Carla', linked, ['a@x.com', 'b@x.com', 'c@x.com'])?.inviteeEmails).toEqual(
      ['a@x.com', 'b@x.com', 'c@x.com'],
    );
  });

  it('saves a typed email for someone who is not invited, and rejects a bad one', () => {
    expect(renameToSave('Carla', person, [], ' jo@parker.example ')).toEqual({
      name: 'Carla',
      inviteeEmails: [],
      email: 'jo@parker.example',
    });
    expect(renameToSave('Carla', person, [], 'jo@parker')).toBeUndefined();
    const known = { ...person, email: 'jo@parker.example' };
    expect(renameToSave('Carla', known, [], 'jo@parker.example')).toBeUndefined();
    expect(renameToSave('Carla', known, [], '')?.email).toBeNull();
  });
});

describe('likelyInvitee', () => {
  it('picks the only invitee with the same first name, ignoring case and accents', () => {
    const candidates = [invitee('b@x.com', 'Cárlá Gonzalez'), invitee('d@x.com', 'Daan Jansen')];
    expect(likelyInvitee([person.name], candidates)).toBe('b@x.com');
  });

  it('falls back to the email local part when there is no display name', () => {
    expect(likelyInvitee([person.name], [invitee('carla.g@x.com', null)])).toBe('carla.g@x.com');
  });

  it('follows the name being typed and the name used in the meeting', () => {
    const candidates = [invitee('d@x.com', 'Daan Jansen')];
    expect(likelyInvitee(['Daan', 'Guest 7'], candidates)).toBe('d@x.com');
    expect(likelyInvitee(['Guest 7', 'Daan J'], candidates)).toBe('d@x.com');
  });

  it('picks nobody when two invitees share the first name or none does', () => {
    const twins = [invitee('a@x.com', 'Carla One'), invitee('b@x.com', 'Carla Two')];
    expect(likelyInvitee([person.name], twins)).toBe('');
    expect(likelyInvitee([person.name], [invitee('d@x.com', 'Daan')])).toBe('');
  });
});

describe('presence', () => {
  it('describes the time in the meeting', () => {
    expect(presence(person)).toBeUndefined();
    expect(presence({ joinedAt: '2026-10-20T10:00:00Z', leftAt: null })).toMatch(/^Joined /);
    expect(presence({ joinedAt: null, leftAt: '2026-10-20T10:00:00Z' })).toMatch(/^Left /);
    expect(presence({ joinedAt: '2026-10-20T10:00:00Z', leftAt: '2026-10-20T10:30:00Z' })).toMatch(
      / to /,
    );
  });
});
