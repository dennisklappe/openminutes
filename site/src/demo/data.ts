import timings from '../../public/demo/timings.json';

export interface Line {
  speaker: number;
  text: string;
  start: number;
  end: number;
}

export interface ChatMessage {
  who: number;
  text: string;
  at: number;
  href: string;
}

export interface Row {
  id: string;
  title: string;
  platform: 'meet' | 'teams' | 'phone';
  status: 'transcribed' | 'joining' | 'processing';
  hoursAgo: number;
  minutes: number;
  people: number[];
  company: string;
  folder: string;
  snippet: string;
  link: string;
}

export const people = [
  'Priya Nair',
  'Tom Becker',
  'Jonas Weber',
  'Mei Lin',
  'Lena Hartmann',
  'Sven Dahl',
];

export const MEETING_ID = 'launch';
export const LINK = 'https://meet.google.com/qfx-wkpd-rzt';
export const TITLE = 'Hartmann pilot launch planning';
export const COMPANY = 'Hartmann Logistics';
export const AUDIO_SRC = '/demo/meeting.mp3';
export const DURATION = timings.duration;
export const START_HOURS_AGO = 27;

export const lines: Line[] = timings.lines.map(({ speaker, text, start, end }) => ({
  speaker: people.indexOf(speaker),
  text,
  start,
  end,
}));

export const chat: ChatMessage[] = [
  {
    who: 3,
    text: 'Pallet label format:',
    at: 38,
    href: 'https://example.com/hartmann/pallet-labels.pdf',
  },
  { who: 1, text: 'Rollback runbook:', at: 58, href: 'https://example.com/runbooks/pilot-launch' },
];

export const OPEN_QUESTIONS = '## Open questions';

export const summary = [
  '## Summary',
  '',
  'The team confirmed the Hartmann pilot launch for the third of November after a two day soak test without crashes. Google calendars go first and Outlook follows in a patch, because the Azure app registration is still pending. Hartmann asked for their pallet label format in the export, and the support inbox cover for launch week is not settled yet.',
  '',
  '## Decisions',
  '',
  '- Launch the Hartmann pilot on the third of November with Google calendars only.',
  '- Outlook calendars follow in a patch.',
  '',
  '## Action items',
  '',
  '| Owner | Action | Due |',
  '| --- | --- | --- |',
  '| Mei | Send Hartmann a short note about the Outlook delay | Tomorrow |',
  '| Tom | Ship the pallet label format in the export | Before the launch |',
  '| Tom | Write the rollback steps in the runbook | Not set |',
  '| Jonas | Meet the tenant admin about the Azure app registration and report back in the channel | Thursday |',
  '| Priya | Ask Sven about covering the support inbox in the afternoons | Friday |',
  '',
  OPEN_QUESTIONS,
  '',
  '- Who answers the support inbox during launch week? Mei can cover the mornings, the afternoons are open.',
  '',
  '## Notes',
  '',
  'Tom ran the soak test for two days without crashes. Hartmann asked for their pallet label format in the export.',
].join('\n');

export const rows: Row[] = [
  {
    id: MEETING_ID,
    title: TITLE,
    platform: 'meet',
    status: 'transcribed',
    hoursAgo: START_HOURS_AGO,
    minutes: DURATION / 60,
    people: [0, 1, 2, 3],
    company: COMPANY,
    folder: 'Clients',
    snippet:
      'Launch on the third of November with Google calendars only. Outlook follows in a patch.',
    link: LINK,
  },
  {
    id: 'kickoff',
    title: 'Hartmann pilot kickoff',
    platform: 'meet',
    status: 'transcribed',
    hoursAgo: 17 * 24,
    minutes: 52,
    people: [0, 2, 4],
    company: COMPANY,
    folder: 'Clients',
    snippet:
      'Scope, timeline and the two integration contacts agreed. Pilot starts on 3 November with the Hamburg depot.',
    link: 'https://meet.google.com/hrt-kcko-ffa',
  },
  {
    id: 'contract',
    title: 'Hartmann contract review',
    platform: 'teams',
    status: 'transcribed',
    hoursAgo: 41 * 24,
    minutes: 35,
    people: [0, 4],
    company: COMPANY,
    folder: 'Clients',
    snippet:
      'Legal changes to the data processing clause were accepted. Signature expected before the end of the month.',
    link: 'https://teams.microsoft.com/l/meetup-join/hartmann-contract',
  },
  {
    id: 'fjord',
    title: 'Customer onboarding: Fjord Energy',
    platform: 'teams',
    status: 'transcribed',
    hoursAgo: 6 * 24,
    minutes: 44,
    people: [0, 3, 5],
    company: 'Fjord Energy',
    folder: 'Clients',
    snippet:
      'Fjord Energy walked through their metering data. We agreed on a weekly sync and a shared channel for questions.',
    link: 'https://teams.microsoft.com/l/meetup-join/fjord-onboarding',
  },
  {
    id: 'checkin',
    title: 'Fjord Energy quarterly check-in',
    platform: 'teams',
    status: 'transcribed',
    hoursAgo: 58 * 24,
    minutes: 29,
    people: [0, 5],
    company: 'Fjord Energy',
    folder: 'Clients',
    snippet:
      'Usage is up 18 percent. They asked for CSV exports of monthly totals and a longer retention window.',
    link: 'https://teams.microsoft.com/l/meetup-join/fjord-checkin',
  },
  {
    id: 'planning',
    title: 'Weekly planning',
    platform: 'teams',
    status: 'transcribed',
    hoursAgo: 3,
    minutes: 47,
    people: [0, 1, 2, 3, 4, 5],
    company: 'Internal',
    folder: 'Internal',
    snippet: 'Sprint scope agreed. The export fix goes first, the calendar work follows.',
    link: 'https://teams.microsoft.com/l/meetup-join/weekly-planning',
  },
];

export interface Upcoming {
  title: string;
  platform: 'meet' | 'teams';
  hoursAhead: number;
  link: string;
}

export const upcoming: Upcoming[] = [
  {
    title: 'Standup',
    platform: 'meet',
    hoursAhead: 15,
    link: 'https://meet.google.com/std-upda-ily',
  },
  {
    title: 'Customer onboarding: Fjord Energy',
    platform: 'teams',
    hoursAhead: 20,
    link: 'https://teams.microsoft.com/l/meetup-join/fjord-onboarding-2',
  },
  {
    title: 'Design review',
    platform: 'teams',
    hoursAhead: 52,
    link: 'https://teams.microsoft.com/l/meetup-join/design-review',
  },
];
