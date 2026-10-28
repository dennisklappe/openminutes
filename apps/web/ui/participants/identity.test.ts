import { describe, expect, it } from 'vitest';
import {
  addTypedEmail,
  identityToSave,
  inviteeSuggestions,
  matchNote,
  peopleHref,
  withoutEmail,
} from './identity.js';

const identity = { name: 'Tnf', emails: ['jo@parker.example'] };

describe('identityToSave', () => {
  it('returns nothing when the name and the addresses are as they were', () => {
    expect(identityToSave(' Tnf ', ['JO@parker.example'], identity)).toBeUndefined();
  });
  it('returns the change, with addresses lower case', () => {
    expect(identityToSave('Jo Parker', ['Jo@Parker.example'], identity)).toEqual({
      name: 'Jo Parker',
      emails: ['jo@parker.example'],
    });
    expect(identityToSave('Tnf', [], identity)).toEqual({ name: 'Tnf', emails: [] });
  });
  it('refuses an empty or too long name', () => {
    expect(identityToSave('  ', [], identity)).toBeUndefined();
    expect(identityToSave('x'.repeat(81), [], identity)).toBeUndefined();
  });
});

describe('addTypedEmail', () => {
  it('adds a clean address once', () => {
    expect(addTypedEmail(['a@acme.example'], ' Ann@Acme.example ')).toEqual({
      emails: ['a@acme.example', 'ann@acme.example'],
    });
    expect(addTypedEmail(['ann@acme.example'], 'ANN@acme.example').error).toBeDefined();
  });
  it('rejects a bad address and ignores an empty one', () => {
    expect(addTypedEmail([], 'ann').error).toBeDefined();
    expect(addTypedEmail(['a@b.example'], '  ')).toEqual({ emails: ['a@b.example'] });
  });
});

describe('suggestions', () => {
  it('hides bound invitees and puts taken ones last', () => {
    const invitees = [
      { email: 'ann@acme.example', name: 'Ann Lee', declined: false, takenBy: 'Ann Lee' },
      { email: 'jo@parker.example', name: 'Jo Parker', declined: false, takenBy: null },
      { email: 'bo@parker.example', name: null, declined: false, takenBy: null },
    ];
    expect(inviteeSuggestions(invitees, ['bo@parker.example']).map((i) => i.email)).toEqual([
      'jo@parker.example',
      'ann@acme.example',
    ]);
  });
  it('removes an address', () => {
    expect(withoutEmail(['a@b.example', 'c@d.example'], 'A@b.example')).toEqual(['c@d.example']);
  });
});

describe('links and notes', () => {
  it('links to People only for a known person', () => {
    expect(peopleHref('p1')).toBe('#/people/p1');
    expect(peopleHref(null)).toBeUndefined();
  });
  it('explains a matching name', () => {
    expect(matchNote({ personId: 'p1', name: 'Jo Parker' })).toContain('Jo Parker');
    expect(matchNote(null)).toBeUndefined();
  });
});
