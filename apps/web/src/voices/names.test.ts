import { describe, expect, it } from 'vitest';
import { isGenericName, mergeSuggestions, replaceName } from './names.js';

describe('replaceName', () => {
  it('replaces whole names only', () => {
    expect(
      replaceName('Speaker 1 agreed. Speaker 10 did not, Speaker 1.', 'Speaker 1', 'Anna'),
    ).toBe('Anna agreed. Speaker 10 did not, Anna.');
    expect(replaceName('Anna and Annabel', 'Anna', 'Anne')).toBe('Anne and Annabel');
  });

  it('treats the name literally', () => {
    expect(replaceName('Call J. (Jo) back', 'J. (Jo)', '$& Jo')).toBe('Call $& Jo back');
  });
});

describe('isGenericName', () => {
  it('matches only automatic labels', () => {
    expect(isGenericName('Speaker 2')).toBe(true);
    expect(isGenericName('Speaker 2 Anna')).toBe(false);
    expect(isGenericName('Anna')).toBe(false);
  });
});

describe('mergeSuggestions', () => {
  it('keeps the first source per name, ignoring case and the own name', () => {
    expect(
      mergeSuggestions(
        [
          [{ name: 'Anna', source: 'conversation' }],
          [
            { name: 'anna', source: 'calendar' },
            { name: 'Daan', source: 'calendar' },
            { name: 'Speaker 1', source: 'participant' },
          ],
        ],
        'speaker 1',
      ),
    ).toEqual([
      { name: 'Anna', source: 'conversation' },
      { name: 'Daan', source: 'calendar' },
    ]);
  });
});
