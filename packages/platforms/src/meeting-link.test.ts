import { describe, expect, it } from 'vitest';
import { defaultMeetingTitle, parseMeetingLink } from './meeting-link.js';

const meetCanonical = 'https://meet.google.com/eyv-umah-wyh';
const thread = '19%3ameeting_ZDk4YmQ%40thread.v2';

describe('parseMeetingLink for Google Meet', () => {
  it.each([
    'https://meet.google.com/eyv-umah-wyh',
    'https://meet.google.com/meet/eyv-umah-wyh',
    'https://meet.google.com/_meet/eyv-umah-wyh',
    'https://meet.google.com/_meet/eyv-umah-wyh?authuser=1',
    'https://meet.google.com/eyv-umah-wyh?authuser=0&hs=122',
    'https://meet.google.com/eyv-umah-wyh/',
    'https://meet.google.com/meet/eyv-umah-wyh/?authuser=3',
    'https://meet.google.com/EYV-UMAH-WYH',
    'https://MEET.GOOGLE.COM/Meet/EYV-UMAH-WYH#frag',
    'http://meet.google.com/eyv-umah-wyh',
    'meet.google.com/eyv-umah-wyh',
    'meet.google.com/meet/eyv-umah-wyh?hs=224',
    '  https://meet.google.com/eyv-umah-wyh  ',
    'https://www.google.com/url?q=https://meet.google.com/meet/eyv-umah-wyh&sa=D',
  ])('reads %s', (raw) => {
    expect(parseMeetingLink(raw)).toEqual({
      platform: 'meet',
      code: 'eyv-umah-wyh',
      canonicalUrl: meetCanonical,
      key: 'meet:eyv-umah-wyh',
    });
  });

  it('reads lookup links', () => {
    expect(parseMeetingLink('https://meet.google.com/lookup/ABC123def?authuser=1')).toMatchObject({
      platform: 'meet',
      code: 'abc123def',
      canonicalUrl: 'https://meet.google.com/lookup/abc123def',
      key: 'meet:lookup/abc123def',
    });
  });

  it.each([
    'https://meet.google.com/',
    'https://meet.google.com/new',
    'https://meet.google.com/meet',
    'https://meet.google.com/meet/new',
    'https://meet.google.com/eyv-umah-wyh/extra',
    'https://meet.google.com/meet/meet/eyv-umah-wyh',
    'https://meet.google.com.evil.example/eyv-umah-wyh',
    'https://example.com/meet/eyv-umah-wyh',
    'not a url at all',
    '',
  ])('rejects %s', (raw) => {
    expect(parseMeetingLink(raw)).toBeUndefined();
  });
});

describe('parseMeetingLink for Teams', () => {
  it('keeps the whole meetup-join link', () => {
    const raw = `https://teams.microsoft.com/l/meetup-join/${thread}/1700?context=%7b%22Tid%22%3a%22t%22%7d`;
    expect(parseMeetingLink(raw)).toEqual({
      platform: 'teams',
      code: undefined,
      canonicalUrl: raw,
      key: 'teams:19:meeting_zdk4ymq@thread.v2',
    });
  });

  it.each([
    [
      'teams.microsoft.com/meet/123456789012?p=AbC',
      'https://teams.microsoft.com/meet/123456789012?p=AbC',
    ],
    [
      'http://teams.microsoft.com/meet/123456789012/?p=AbC',
      'https://teams.microsoft.com/meet/123456789012?p=AbC',
    ],
    [
      'https://teams.microsoft.com/meet/123456789012',
      'https://teams.microsoft.com/meet/123456789012',
    ],
    [
      'https://teams.live.com/meet/9876543210?p=xyz#x',
      'https://teams.live.com/meet/9876543210?p=xyz',
    ],
    [
      'https://teams.microsoft.com/v2/?meetingjoin=true#/meet/123456789012?p=AbC&anon=true',
      'https://teams.microsoft.com/meet/123456789012?p=AbC&anon=true',
    ],
    [
      'https://teams.microsoft.com/dl/launcher/launcher.html?url=%2F_%23%2Fmeet%2F123456789012%3Fp%3DAbC&type=meetup-join',
      'https://teams.microsoft.com/meet/123456789012?p=AbC',
    ],
  ])('reads short link %s', (raw, canonicalUrl) => {
    expect(parseMeetingLink(raw)).toMatchObject({ platform: 'teams', canonicalUrl });
  });

  it('reads a v2 meetup-join link', () => {
    const link = parseMeetingLink(
      `https://teams.microsoft.com/v2/?meetingjoin=true#/l/meetup-join/${thread}/0?anon=true`,
    );
    expect(link).toMatchObject({
      platform: 'teams',
      canonicalUrl: `https://teams.microsoft.com/l/meetup-join/${thread}/0?anon=true`,
      key: 'teams:19:meeting_zdk4ymq@thread.v2',
    });
  });

  it('gives short links the same key regardless of form', () => {
    const keys = [
      'https://teams.microsoft.com/meet/123456789012?p=a',
      'teams.microsoft.com/meet/123456789012/',
      'https://teams.microsoft.com/v2/?meetingjoin=true#/meet/123456789012?p=b',
    ].map((raw) => parseMeetingLink(raw)?.key);
    expect(new Set(keys)).toEqual(new Set(['teams-meet:teams.microsoft.com/123456789012']));
  });

  it.each([
    'https://teams.microsoft.com/meet/',
    'https://teams.microsoft.com/v2/?meetingjoin=true',
    'https://teams.microsoft.com/v2/?meetingjoin=true#/calendar',
    'https://teams.microsoft.com.evil.example/meet/123',
    'https://teams.microsoft.com/l/meetup-join/%E0%A4%A/0',
  ])('rejects %s', (raw) => {
    expect(parseMeetingLink(raw)).toBeUndefined();
  });
});

describe('defaultMeetingTitle', () => {
  it('names a Meet meeting after its code', () => {
    const link = parseMeetingLink('https://meet.google.com/meet/eyv-umah-wyh?authuser=1');
    expect(link && defaultMeetingTitle('Google Meet', link)).toBe('Google Meet eyv-umah-wyh');
  });

  it('names a Teams short link after its id', () => {
    const link = parseMeetingLink('https://teams.live.com/meet/9876543210?p=x');
    expect(link && defaultMeetingTitle('Microsoft Teams', link)).toBe('Microsoft Teams 9876543210');
  });

  it('uses the label alone when there is no readable code', () => {
    const link = parseMeetingLink(`https://teams.microsoft.com/l/meetup-join/${thread}/0`);
    expect(link && defaultMeetingTitle('Microsoft Teams', link)).toBe('Microsoft Teams');
  });
});
