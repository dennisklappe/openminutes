import { describe, expect, it } from 'vitest';
import { extractJoinLink } from './links.js';

const meet = 'https://meet.google.com/abc-defg-hij';
const teams =
  'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZDk4YmQ%40thread.v2/0?context=%7b%22Tid%22%3a%22t%22%7d';
const safelink = (target: string) =>
  `https://eur02.safelinks.protection.outlook.com/?url=${encodeURIComponent(target)}&data=05%7C02%7Cjo%40example.com%7Cabc&sdata=xyz%3D&reserved=0`;

describe('extractJoinLink', () => {
  const cases: [string, string, string, 'meet' | 'teams'][] = [
    ['plain Meet link', `Join: ${meet}`, meet, 'meet'],
    ['Meet link with query', `${meet}?authuser=0&hs=122`, meet, 'meet'],
    [
      'Meet link with meet prefix',
      'https://meet.google.com/meet/abc-defg-hij?authuser=1',
      meet,
      'meet',
    ],
    ['Meet link without scheme', 'Go to meet.google.com/abc-defg-hij now', meet, 'meet'],
    [
      'Meet lookup link',
      'https://meet.google.com/lookup/abc123def',
      'https://meet.google.com/lookup/abc123def',
      'meet',
    ],
    ['Meet link in an HTML anchor', `<a href="${meet}">Join with Google Meet</a>`, meet, 'meet'],
    [
      'Google redirect in HTML with entities',
      `<a href="https://www.google.com/url?q=${meet}&amp;sa=D&amp;ust=1">link</a>`,
      meet,
      'meet',
    ],
    ['trailing punctuation', `Please join (${meet}).`, meet, 'meet'],
    ['Meet link followed by a pin', `${meet}\nPIN: 123 456 7890`, meet, 'meet'],
    ['Teams meetup-join link', `Join the meeting now ${teams}`, teams, 'teams'],
    [
      'Teams short meet link with passcode',
      'https://teams.microsoft.com/meet/123456789012?p=AbCdEf12',
      'https://teams.microsoft.com/meet/123456789012?p=AbCdEf12',
      'teams',
    ],
    [
      'Teams live link',
      'https://teams.live.com/meet/9876543210?p=xyz',
      'https://teams.live.com/meet/9876543210?p=xyz',
      'teams',
    ],
    [
      'Teams link in HTML body',
      `<p><a href="${teams.replaceAll('&', '&amp;')}">Join</a></p>`,
      teams,
      'teams',
    ],
    ['safelinks wrapped Teams link', `<a href="${safelink(teams)}">Join</a>`, teams, 'teams'],
    ['safelinks wrapped Meet link as text', safelink(meet), meet, 'meet'],
    [
      'doubly wrapped link',
      safelink(`https://www.google.com/url?q=${encodeURIComponent(meet)}`),
      meet,
      'meet',
    ],
    [
      'Proofpoint v2 wrapped link',
      'https://urldefense.proofpoint.com/v2/url?u=https-3A__meet.google.com_abc-2Ddefg-2Dhij&d=DwMF&c=x',
      meet,
      'meet',
    ],
    [
      'Proofpoint v3 wrapped link',
      'https://urldefense.com/v3/__https://meet.google.com/abc-defg-hij__;!!ABC$',
      meet,
      'meet',
    ],
  ];

  it.each(cases)('finds a %s', (_name, text, url, platform) => {
    expect(extractJoinLink([text])).toEqual({ platform, url });
  });

  it('prefers earlier candidates', () => {
    expect(extractJoinLink([undefined, teams, meet])?.platform).toBe('teams');
  });

  it.each([
    ['empty input', ''],
    ['a Zoom link', 'https://zoom.us/j/123456789'],
    ['a Meet landing page', 'https://meet.google.com/landing'],
    ['a Teams channel link', 'https://teams.microsoft.com/l/channel/19%3a123/General'],
    ['an unrelated site mentioning meet', 'https://example.com/meet.google.com/abc-defg-hij'],
    ['a safelink to another site', safelink('https://example.com/page')],
    ['a malformed wrapped link', 'https://urldefense.proofpoint.com/v2/url?u=%E0%A4%A'],
  ])('ignores %s', (_name, text) => {
    expect(extractJoinLink([text, null, undefined])).toBeUndefined();
  });
});
