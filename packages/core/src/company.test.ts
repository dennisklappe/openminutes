import { describe, expect, it } from 'vitest';
import {
  canonicalCompany,
  cleanCompany,
  companyFromDomain,
  companyFromInvitees,
  companyFromTitle,
  companyKey,
  detectCompanyFromCalendar,
  exactKey,
} from './company.js';

const own = new Set(['northwind.example']);
const guest = (email: string) => ({ email, name: null });

describe('company names', () => {
  it('turns a domain into a company name', () => {
    expect(companyFromDomain('hartmann-logistics.de')).toBe('Hartmann Logistics');
    expect(companyFromDomain('kestrel.nl')).toBe('Kestrel');
    expect(companyFromDomain('mail.acme.co.uk')).toBe('Acme');
    expect(companyFromDomain('ing.nl')).toBe('ING');
  });

  it('matches names across legal suffixes and punctuation', () => {
    expect(companyKey('Kestrel B.V.')).toBe(companyKey('Kestrel'));
    expect(companyKey('Acme Inc.')).toBe(companyKey('acme'));
    expect(companyKey('Co')).toBe('co');
    expect(canonicalCompany('Kestrel', ['Kestrel B.V.'], companyKey)).toBe('Kestrel B.V.');
    expect(canonicalCompany('kestrel', ['Kestrel'])).toBe('Kestrel');
    expect(canonicalCompany('Kestrel', ['Kestrel B.V.'])).toBe('Kestrel');
    expect(exactKey('  Acme   Corp ')).toBe('acme corp');
  });

  it('rejects empty, long and control character names', () => {
    expect(cleanCompany('  Acme   Corp ')).toBe('Acme Corp');
    expect(cleanCompany('   ')).toBeUndefined();
    expect(cleanCompany('x'.repeat(81))).toBeUndefined();
    expect(cleanCompany('Acme\u0000')).toBeUndefined();
    expect(cleanCompany(4)).toBeUndefined();
  });
});

describe('company from the calendar', () => {
  it('ignores free mail, own domains and calendar resources', () => {
    expect(
      companyFromInvitees(
        [
          guest('me@northwind.example'),
          guest('a@gmail.com'),
          guest('room@resource.calendar.google.com'),
          guest('lena@hartmann-logistics.de'),
          guest('kai@hartmann-logistics.de'),
        ],
        own,
      ),
    ).toBe('Hartmann Logistics');
  });

  it('gives up when two outside companies are equally present', () => {
    expect(companyFromInvitees([guest('a@acme.com'), guest('b@globex.com')], own)).toBeUndefined();
    expect(companyFromInvitees([guest('me@northwind.example')], own)).toBeUndefined();
  });

  it('reads the company from titles such as "Kestrel meeting"', () => {
    expect(companyFromTitle('Kestrel meeting', own)).toBe('Kestrel');
    expect(companyFromTitle('Customer call: Hartmann Logistics', own)).toBe('Hartmann Logistics');
    expect(companyFromTitle('Support escalation: Northwind', new Set(['northwind.com']))).toBe(
      undefined,
    );
    expect(companyFromTitle('Team meeting', own)).toBeUndefined();
    expect(companyFromTitle('weekly planning meeting', own)).toBeUndefined();
    expect(companyFromTitle('Design review', own)).toBeUndefined();
  });

  it('prefers the invitees over the title', () => {
    expect(
      detectCompanyFromCalendar({ title: 'Globex meeting', invitees: [guest('x@acme.com')] }, own),
    ).toBe('Acme');
    expect(detectCompanyFromCalendar({ title: 'Lunch', invitees: null }, own)).toBeUndefined();
  });
});
