import { describe, expect, it } from 'vitest';
import { cleanSummaryText } from './summary-text.js';

describe('cleanSummaryText', () => {
  it('replaces em and en dashes used as punctuation with a comma', () => {
    expect(cleanSummaryText('We agreed \u2014 for now \u2013 to wait')).toBe(
      'We agreed, for now, to wait',
    );
  });

  it('turns numeric ranges into hyphens', () => {
    expect(cleanSummaryText('Pages 3\u20135')).toBe('Pages 3-5');
  });

  it('leaves text without dashes untouched', () => {
    expect(cleanSummaryText('| Owner | Action |\n| --- | --- |\nwell-known')).toBe(
      '| Owner | Action |\n| --- | --- |\nwell-known',
    );
  });

  it('drops dashes at line ends and inside table cells without leaving them', () => {
    expect(cleanSummaryText('| A | \u2014 |')).toBe('| A | |');
    expect(cleanSummaryText('Done \u2014\nNext')).toBe('Done\nNext');
  });
});
