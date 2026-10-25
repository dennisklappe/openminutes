import {
  AUDIO_SRC,
  chat,
  DURATION,
  lines,
  MEETING_ID,
  summary,
  type ChatMessage,
  type Line,
} from './data';

export interface Talk {
  lines: Line[];
  chat: ChatMessage[];
  summary: string;
  duration: number;
  src: string | null;
}

type Script = [speaker: number, text: string][];

interface Entry {
  script: Script;
  overview: string;
  notes: string[];
}

const joined: Entry = {
  script: [
    [0, 'Thanks for letting the bot in. Can everyone see the agenda?'],
    [2, 'Yes. Let us start with the open items from last week.'],
    [0, 'First the status update, then the plan for next week.'],
  ],
  overview:
    'The meeting opened with the agenda and the open items from last week. A status update comes first, followed by the plan for next week.',
  notes: ['The agenda is shared.', 'Open items from last week come first.'],
};

const scripts: Partial<Record<string, Entry>> = {
  kickoff: {
    script: [
      [
        0,
        'Welcome everyone. Today we fix the scope, the timeline and the two integration contacts.',
      ],
      [4, 'Our depot in Hamburg goes first. The other sites can follow once the pilot is stable.'],
      [2, 'On our side Jonas owns the calendar connection and Priya the rollout.'],
      [0, 'Then the pilot starts on the third of November with the Hamburg depot.'],
      [4, 'That works for us. We will send the depot contact list this week.'],
    ],
    overview:
      'Hartmann and the team fixed the scope, the timeline and the two integration contacts. The pilot starts on the third of November with the Hamburg depot only. Hartmann sends the depot contact list this week.',
    notes: [
      'Pilot scope: the Hamburg depot only.',
      'Start date: the third of November.',
      'Hartmann sends the depot contact list this week.',
    ],
  },
  contract: {
    script: [
      [4, 'Legal went through the data processing clause and accepted the changes.'],
      [0, 'Good. Anything left open before signature?'],
      [4, 'Only the annex with the sub-processors. They will send it tomorrow.'],
      [0, 'Then we expect the signature before the end of the month.'],
    ],
    overview:
      'Legal accepted the changes to the data processing clause. Only the sub-processor annex is still open and arrives tomorrow. Signature is expected before the end of the month.',
    notes: [
      'The data processing clause changes are accepted.',
      'The sub-processor annex arrives tomorrow.',
      'Signature expected before the end of the month.',
    ],
  },
  fjord: {
    script: [
      [3, 'Thanks for joining. Let us start with how your metering data is organised.'],
      [5, 'We have one export per site, every night, as CSV files in a shared bucket.'],
      [0, 'We can read that directly. A weekly sync would keep us aligned on changes.'],
      [5, 'Weekly works. Can we also get a shared channel for questions?'],
      [3, 'Yes, I will set that up today.'],
    ],
    overview:
      'Fjord Energy explained that their metering data arrives as one CSV export per site, every night. The team can read it directly and agreed on a weekly sync. Mei sets up a shared channel for questions today.',
    notes: [
      'Metering data arrives as one CSV export per site, every night.',
      'A weekly sync is agreed.',
      'Mei sets up a shared channel today.',
    ],
  },
  checkin: {
    script: [
      [5, 'Usage is up eighteen percent compared to last quarter.'],
      [0, 'That is great to hear. What would help you most now?'],
      [5, 'CSV exports of the monthly totals, and a longer retention window.'],
      [0, 'Both are on the list. I will come back with dates next week.'],
    ],
    overview:
      'Fjord Energy reported that usage is up 18 percent compared to last quarter. They asked for CSV exports of the monthly totals and a longer retention window. Both are on the list and dates follow next week.',
    notes: [
      'Usage is up 18 percent.',
      'Fjord Energy asks for CSV exports of monthly totals.',
      'A longer retention window is requested.',
    ],
  },
  planning: {
    script: [
      [0, 'Sprint scope for this week. The export fix goes first.'],
      [1, 'It is almost done. I need one more review and then it can ship.'],
      [2, 'The calendar work follows. I will start on the Outlook sync tomorrow.'],
      [3, 'I will prepare the note for customers about the next release.'],
      [4, 'Anything blocking? Not from my side.'],
    ],
    overview:
      'The team set the sprint scope, with the export fix first and the calendar work after it. Jonas starts on the Outlook sync tomorrow. Mei prepares the release note for customers.',
    notes: [
      'The export fix goes first.',
      'The calendar work follows, starting with the Outlook sync.',
      'Mei prepares the release note for customers.',
    ],
  },
  recorded: {
    script: [
      [0, 'This is a test of the phone recorder. Can you hear me from over there?'],
      [3, 'Loud and clear. Let us talk through the plan for the day.'],
      [0, 'We start with the visit at ten, then lunch, then the follow-up call.'],
    ],
    overview:
      'A test of the phone recorder, followed by the plan for the day. The visit is at ten, then lunch, then the follow-up call.',
    notes: ['The visit is at ten.', 'Lunch follows, then the follow-up call.'],
  },
};

const GAP = 0.6;

function timed(script: Script): Line[] {
  let start = 0;
  return script.map(([speaker, text]) => {
    const end = start + 1.5 + text.split(' ').length * 0.38;
    const line = { speaker, text, start, end };
    start = end + GAP;
    return line;
  });
}

function minutes({ overview, notes }: Entry): string {
  return [
    '## Summary',
    '',
    overview,
    '',
    '## Decisions',
    '',
    ...notes.map((note) => `- ${note}`),
  ].join('\n');
}

export function talkOf(id: string): Talk {
  if (id === MEETING_ID) return { lines, chat, summary, duration: DURATION, src: AUDIO_SRC };
  const found = scripts[id] ?? scripts[id.replace(/-\d+$/, '')] ?? joined;
  const spoken = timed(found.script);
  return {
    lines: spoken,
    chat: [],
    summary: minutes(found),
    duration: spoken.at(-1)?.end ?? 0,
    src: null,
  };
}

export const speakersOf = (talk: Talk): number[] =>
  [...new Set(talk.lines.map((line) => line.speaker))].sort((a, b) => a - b);
