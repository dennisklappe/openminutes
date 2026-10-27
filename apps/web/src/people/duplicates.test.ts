import { describe, expect, it } from 'vitest';
import { findDuplicates } from './duplicates.js';

const p = (id: string, name: string, ...emails: string[]) => ({ id, name, emails });

describe('findDuplicates', () => {
  it('pairs people who share an email', () => {
    const found = findDuplicates([p('a', 'Anna', 'a@x.com'), p('b', 'A. Synthetic', 'a@x.com')]);
    expect(found.get('a')).toEqual(['b']);
    expect(found.get('b')).toEqual(['a']);
  });

  it('pairs a first name with the full name on the same company domain', () => {
    const found = findDuplicates([
      p('a', 'Dennis', 'dennis@acme.example'),
      p('b', 'Dennis Klappe', 'd.klappe@acme.example'),
      p('c', 'Dennis Other', 'dennis@elsewhere.org'),
    ]);
    expect(found.get('a')).toEqual(['b']);
    expect(found.get('b')).toEqual(['a']);
    expect(found.has('c')).toBe(false);
  });

  it('ignores free mail domains, other first names and people without emails', () => {
    const found = findDuplicates([
      p('a', 'Anna', 'anna@gmail.com'),
      p('b', 'Anna de Vries', 'ad@gmail.com'),
      p('c', 'Annabel', 'x@corp.com'),
      p('d', 'Anna', 'anna@corp.com'),
      p('e', 'Anna Smit'),
    ]);
    expect(found.size).toBe(0);
  });

  it('matches without regard to case and accents', () => {
    const found = findDuplicates([
      p('a', 'RENE', 'r@corp.com'),
      p('b', 'René van Dam', 'rvd@corp.com'),
    ]);
    expect(found.get('a')).toEqual(['b']);
  });
});
