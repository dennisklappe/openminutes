import { describe, expect, it } from 'vitest';
import { joinKey } from './join-key.js';

const thread = '19%3ameeting_ZDk4YmQ%40thread.v2';
const safelink = (target: string) =>
  `https://eur02.safelinks.protection.outlook.com/?url=${encodeURIComponent(target)}&data=05%7C02&sdata=x%3D&reserved=0`;

describe('joinKey', () => {
  const same: [string, string[]][] = [
    [
      'meet:abc-defg-hij',
      [
        'https://meet.google.com/abc-defg-hij',
        'https://meet.google.com/abc-defg-hij?authuser=2&hs=122',
        'https://meet.google.com/abc-defg-hij/',
        'https://meet.google.com/ABC-DEFG-HIJ',
        'https://MEET.GOOGLE.COM/abc-defg-hij#fragment',
        'http://meet.google.com/abc-defg-hij',
        'meet.google.com/abc-defg-hij',
        'https://meet.google.com/meet/abc-defg-hij',
        'https://meet.google.com/_meet/abc-defg-hij?authuser=1',
        'meet.google.com/meet/ABC-DEFG-HIJ/?hs=224',
        '  https://meet.google.com/abc-defg-hij  ',
        'https://www.google.com/url?q=https://meet.google.com/abc-defg-hij&sa=D',
        safelink('https://meet.google.com/abc-defg-hij?authuser=0'),
        safelink(safelink('https://meet.google.com/abc-defg-hij')),
      ],
    ],
    [
      'teams:19:meeting_zdk4ymq@thread.v2',
      [
        `https://teams.microsoft.com/l/meetup-join/${thread}/0`,
        `https://teams.microsoft.com/l/meetup-join/${thread}/1700000000000?context=%7b%22Tid%22%3a%22t%22%7d`,
        `https://teams.microsoft.com/l/meetup-join/${thread.toLowerCase()}/0`,
        `https://teams.microsoft.com/l/meetup-join/19:meeting_ZDk4YmQ@thread.v2/0?anon=true`,
        `https://gov.teams.microsoft.us/l/meetup-join/${thread}/0`,
        safelink(`https://teams.microsoft.com/l/meetup-join/${thread}/0?context=%7b%7d`),
      ],
    ],
    [
      'teams-meet:teams.microsoft.com/123456789012',
      [
        'https://teams.microsoft.com/meet/123456789012?p=AbCdEf12',
        'https://teams.microsoft.com/meet/123456789012',
        'https://teams.microsoft.com/meet/123456789012/?p=other',
        'teams.microsoft.com/meet/123456789012',
        'https://teams.microsoft.com/v2/?meetingjoin=true#/meet/123456789012?p=x',
      ],
    ],
    ['teams-meet:teams.live.com/9876543210', ['https://teams.live.com/meet/9876543210?p=xyz']],
    ['meet:lookup/abc123def', ['https://meet.google.com/lookup/ABC123DEF?authuser=1']],
  ];

  it.each(same.flatMap(([key, urls]) => urls.map((url) => [url, key] as const)))(
    'maps %s to one key',
    (url, key) => {
      expect(joinKey(url)).toBe(key);
    },
  );

  it('tells different conferences apart', () => {
    const keys = [
      'https://meet.google.com/abc-defg-hij',
      'https://meet.google.com/abc-defg-hik',
      'https://meet.google.com/lookup/abc-defg-hij',
      `https://teams.microsoft.com/l/meetup-join/${thread}/0`,
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_other%40thread.v2/0',
      'https://teams.microsoft.com/meet/123456789012',
      'https://teams.live.com/meet/123456789012',
    ].map(joinKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never throws on odd input', () => {
    expect(joinKey('not a url at all')).toBe('url:not a url at all');
    expect(joinKey('https://teams.microsoft.com/l/meetup-join/%E0%A4%A/0')).toMatch(/^url:/);
    expect(joinKey('https://example.com/Room/One?x=1')).toBe('url:example.com/room/one');
  });
});
