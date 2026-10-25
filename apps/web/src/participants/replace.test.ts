import { describe, expect, it } from 'vitest';
import { renameInText } from './replace.js';

describe('renameInText', () => {
  it('replaces the full name and the first name', () => {
    expect(
      renameInText(
        'Marketing Acme asked for a budget. Marketing agreed with the plan.',
        'Marketing Acme',
        'Carla',
      ),
    ).toBe('Carla asked for a budget. Carla agreed with the plan.');
  });

  it('leaves partial overlaps, other words and the company name alone', () => {
    const text = 'Acme signs. The marketing team and Marketing Acme met Acmeers.';
    expect(renameInText(text, 'Marketing Acme', 'Carla')).toBe(
      'Acme signs. The marketing team and Carla met Acmeers.',
    );
  });

  it('keeps a first name that is also an ordinary word out of the replacement', () => {
    expect(
      renameInText('Marketing is late. We need more marketing.', 'Marketing Acme', 'Carla'),
    ).toBe('Marketing is late. We need more marketing.');
  });

  it('keeps possessives and punctuation', () => {
    expect(renameInText("Dana Keller's idea, said Dana Keller.", 'Dana Keller', 'Dana')).toBe(
      "Dana's idea, said Dana.",
    );
    expect(renameInText('Het plan van Jan-Willem.', 'Jan-Willem', 'Jan')).toBe('Het plan van Jan.');
  });

  it('uses the first name of the new name for first name matches', () => {
    expect(renameInText('Anna de Vries spoke. Anna agreed.', 'Anna de Vries', 'Anne Jansen')).toBe(
      'Anne Jansen spoke. Anne agreed.',
    );
  });

  it('handles diacritics and case', () => {
    expect(renameInText('Zoë Müller zei dat ZOË MÜLLER akkoord is.', 'Zoë Müller', 'Zoe')).toBe(
      'Zoe zei dat ZOE akkoord is.',
    );
    expect(renameInText('Zoëtrope', 'Zoë Müller', 'Zoe')).toBe('Zoëtrope');
  });

  it('skips the first name when another participant shares it', () => {
    expect(
      renameInText('Tom Smit and Tom Berg met. Tom Smit left.', 'Tom Smit', 'Thomas', ['Tom Berg']),
    ).toBe('Thomas and Tom Berg met. Thomas left.');
    expect(renameInText('Tom talked.', 'Tom Smit', 'Thomas', ['Tom Berg'])).toBe('Tom talked.');
  });

  it('treats several speakers independently and applies in sequence', () => {
    const text = 'Marketing Acme and Dana Keller agreed.';
    const once = renameInText(text, 'Marketing Acme', 'Carla');
    expect(renameInText(once, 'Dana Keller', 'Dana')).toBe('Carla and Dana agreed.');
  });

  it('does nothing for an identical or empty name', () => {
    expect(renameInText('Anna', 'Anna', 'Anna')).toBe('Anna');
    expect(renameInText('Anna', '', 'Bo')).toBe('Anna');
  });
});
