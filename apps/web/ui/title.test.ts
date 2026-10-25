import { describe, expect, it } from 'vitest';
import { titleToSave, TITLE_MAX } from './title.js';

describe('titleToSave', () => {
  it('trims and returns a changed title', () => {
    expect(titleToSave('  Call with Anna ', 'Phone recording')).toBe('Call with Anna');
  });

  it('ignores empty, unchanged and overlong titles', () => {
    expect(titleToSave('   ', 'Weekly')).toBeUndefined();
    expect(titleToSave('Weekly ', 'Weekly')).toBeUndefined();
    expect(titleToSave('x'.repeat(TITLE_MAX + 1), 'Weekly')).toBeUndefined();
  });
});
