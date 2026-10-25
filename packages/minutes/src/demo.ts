import type { Minutes } from './types.js';

export const demoMinutes: Minutes = {
  title: 'Product sync',
  startedAt: '2026-03-12T09:30:00.000Z',
  endedAt: '2026-03-12T10:12:00.000Z',
  platform: 'meet',
  joinUrl: 'https://meet.google.com/abc-defg-hij',
  location: 'Amsterdam office, room Kanaal',
  attendees: [
    { name: 'Anna de Vries', email: 'anna@example.com' },
    { name: 'Ben Carter', email: 'ben@example.com' },
    { name: 'Chloe Martin', email: null },
  ],
  absent: [
    { name: 'Daan Jansen', email: 'daan@example.com', declined: true },
    { name: 'Eva Rossi', email: 'eva@example.com', declined: false },
  ],
  summary: [
    '### Decisions',
    '',
    '- Ship the new onboarding flow on **15 April**.',
    '- Keep the free tier limited to *three* meetings per month.',
    '',
    '### Action items',
    '',
    '| Owner | Action | Due |',
    '| --- | --- | --- |',
    '| Anna | Finish the pricing page copy | Friday |',
    '| Ben | Confirm the launch date with support | Not specified |',
    '| Chloe | Share the research notes | Done |',
  ].join('\n'),
  transcript: [
    {
      startMs: 2_000,
      endMs: 9_000,
      speaker: 'Anna de Vries',
      text: 'Thanks for joining. Let us start with the onboarding flow.',
    },
    {
      startMs: 10_000,
      endMs: 21_000,
      speaker: 'Ben Carter',
      text: 'Testing went well. I would like to ship it on the fifteenth.',
    },
    {
      startMs: 22_000,
      endMs: 30_000,
      speaker: 'Chloe Martin',
      text: 'Agreed, the research notes support that.',
    },
  ],
  chat: [
    {
      sender: 'Chloe Martin',
      text: 'Research notes: https://example.com/research',
      links: ['https://example.com/research'],
      offsetMs: 24_000,
    },
  ],
};
