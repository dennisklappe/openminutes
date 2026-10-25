// Demo data for screenshots and local previews. Never runs unless --confirm is passed.
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const usage =
  'usage: DATABASE_URL=... OPENMINUTES_DATA_DIR=... node scripts/seed-demo.mjs --confirm';
if (!process.argv.includes('--confirm')) {
  console.error(`Refusing to insert demo data without --confirm\n${usage}`);
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
const dataDir = process.env.OPENMINUTES_DATA_DIR;
if (!databaseUrl || !dataDir) {
  console.error(usage);
  process.exit(1);
}

const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
const pg = require('pg');

const people = ['Priya Nair', 'Tom Becker', 'Jonas Weber', 'Mei Lin'];
const pitch = [210, 120, 150, 250];

const script = [
  [
    0,
    0,
    6.2,
    "Okay, we're all here. Let's start with the billing export, since that blocks the EU rollout.",
  ],
  [
    1,
    6.8,
    21.5,
    'The staging run finished last night. Two accounts failed on currency rounding, and I have a fix in review.',
  ],
  [0, 22.1, 27.4, 'Which accounts? Are they the ones on the legacy price list?'],
  [
    1,
    28,
    36.9,
    'Yes, both. The legacy list stores prices as integers in cents, and we round twice on the way out.',
  ],
  [
    2,
    37.6,
    48.2,
    'Do we need to freeze invoices while that rolls out? Finance closes the month on the thirty-first.',
  ],
  [
    0,
    48.9,
    60.3,
    "Only for the EU entity, for about an hour. I'll post the window in the channel once Tom confirms the deploy slot.",
  ],
  [
    3,
    61,
    78.4,
    'On the support side, nine tickets came in this week about missing invoice PDFs. I think that is the same bug, but I want to check before we reply to them.',
  ],
  [1, 79, 86.1, 'Send me the ticket ids and I will match them against the failed jobs.'],
  [3, 86.7, 90.8, 'Sending them right after this call.'],
  [
    2,
    92,
    109.5,
    'Next topic. The calendar sync. Google works end to end now, and Outlook is blocked on the app registration for the tenant.',
  ],
  [
    0,
    110.2,
    119.9,
    'Who owns the Azure side? I do not want this waiting on someone being out of office.',
  ],
  [
    2,
    120.5,
    131.3,
    'I do. I asked the tenant admin on Monday and I have a slot with them on Thursday.',
  ],
  [
    1,
    132,
    148.6,
    'One question on the join rules. If a meeting has no external guests, do we still join by default, or only when the organiser opts in?',
  ],
  [
    0,
    149.2,
    163.8,
    'Opt in. Joining every internal standup would surprise people. The default should be only meetings with external guests.',
  ],
  [3, 164.4, 175, 'That matches what customers told us. Nobody wants a notetaker in a one-to-one.'],
  [
    2,
    175.8,
    190.2,
    'Agreed. I will make the rule per calendar, with the default set to external guests only.',
  ],
  [
    1,
    191,
    207.4,
    'On storage, we are at about eighteen gigabytes of audio for the month. I propose deleting audio after thirty days and keeping transcripts.',
  ],
  [
    0,
    208,
    218.9,
    'Fine by me as a default. Make it a setting, and say clearly in the docs what gets deleted and when.',
  ],
  [
    3,
    219.6,
    236.1,
    'Can we also export a meeting as Markdown? Two customers asked for it so they can paste notes into their wiki.',
  ],
  [1, 236.8, 244.7, 'That exists already. Markdown and JSON, both from the meeting page.'],
  [
    0,
    245.4,
    262.9,
    'Good. Last item, the release. Are we comfortable tagging the first version on Friday, or do we wait for the Teams fixtures?',
  ],
  [
    2,
    263.6,
    281.5,
    'Teams can follow in a patch release. The Meet path is solid and the lobby handling is covered by the end to end test.',
  ],
  [
    1,
    282.2,
    291.3,
    'I would still like one more full day of soak testing with real meetings before we tag.',
  ],
  [
    0,
    292,
    306.8,
    'Then we tag on Monday. Tom runs the soak over the weekend, Jonas takes the Azure meeting, Mei sends the ticket ids.',
  ],
  [3, 307.5, 312, 'Done. Thanks, everyone.'],
];

const durationS = 318;
const summary = [
  '## Summary',
  '',
  'The team reviewed the billing export and the first release. The export is almost ready and the first version is tagged on Monday after a weekend soak test. Calendar auto-join and audio retention are settled, and the Azure app registration is still to be sorted out.',
  '',
  '## Decisions',
  '',
  '- Calendar auto-join defaults to meetings with external guests, set per calendar.',
  '- Audio is deleted after 30 days by default, transcripts stay. Both are settings.',
  '- The first version is tagged on Monday, after a weekend soak test.',
  '',
  '## Action items',
  '',
  '- Tom: run the soak test over the weekend.',
  '- Jonas: meet the tenant admin on Thursday about the Azure app registration.',
  '- Mei: send the ticket ids to Tom so he can match them to the failed jobs.',
  '- Priya: post the EU invoice freeze window in the channel.',
  '',
  '## Notes',
  '',
  'The billing export is almost ready. Two legacy-price accounts fail on double rounding and the fix is in review.',
].join('\n');

const fmt = (s) => Math.round(s * 1000);
const pool = new pg.Pool({ connectionString: databaseUrl });
const q = (text, params) => pool.query(text, params);

const demoId = (
  await q(
    `insert into meetings (title, platform, join_url, started_at, ended_at, status)
   values ($1, 'meet', 'https://meet.google.com/qfx-wkpd-rzt', now() - interval '2 days', now() - interval '2 days' + interval '318 seconds', 'transcribed')
   returning id`,
    ['Billing export and release sync'],
  )
).rows[0].id;

const personIds = [];
for (const name of people) {
  const row = await q(
    'insert into participants (meeting_id, display_name) values ($1, $2) returning id',
    [demoId, name],
  );
  personIds.push(row.rows[0].id);
}
for (const [who, from, to, text] of script) {
  await q(
    `insert into transcript_segments (meeting_id, participant_id, start_ms, end_ms, text)
     values ($1, $2, $3, $4, $5)`,
    [demoId, personIds[who], fmt(from), fmt(to), text],
  );
}
await q(
  `insert into summaries (meeting_id, provider, model, status, content) values ($1, 'demo', 'demo', 'done', $2)`,
  [demoId, summary],
);

const relative = `meetings/${demoId}/merged.opus`;
const target = join(dataDir, relative);
mkdirSync(dirname(target), { recursive: true });
const inputs = script.flatMap(([who, from, to], i) => {
  const rate = 3.4 + (i % 4) * 0.7;
  const source =
    `anoisesrc=d=${(to - from).toFixed(2)}:c=pink:r=24000:a=0.5,` +
    `bandpass=f=${pitch[who] * 6}:w=${pitch[who] * 3},tremolo=f=${rate}:d=0.9`;
  return ['-f', 'lavfi', '-i', source];
});
const delays = script
  .map(([, from], i) => `[${i}:a]adelay=${fmt(from)}|${fmt(from)}[v${i}]`)
  .join(';');
const mix = script.map((_, i) => `[v${i}]`).join('');
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    `${delays};${mix}amix=inputs=${script.length}:normalize=0,apad=whole_dur=${durationS},alimiter=limit=0.9`,
    '-t',
    String(durationS),
    '-c:a',
    'libopus',
    '-b:a',
    '24k',
    '-f',
    'ogg',
    target,
  ],
  { stdio: 'inherit' },
);
const size = statSync(target).size;
await q(
  `insert into audio_files (meeting_id, path, duration_ms, codec, size) values ($1, $2, $3, 'opus', $4)`,
  [demoId, relative, fmt(durationS), size],
);

// [title, platform, status, age, error, minutes, people]
const others = [
  ['Weekly planning', 'teams', 'transcribed', '1 hour', null, 47, 6],
  ['Customer call: Hartmann Logistics', 'meet', 'transcribed', '3 days', null, 38, 3],
  ['Design review', 'meet', 'transcribed', '4 days', null, 62, 5],
  [
    'Vendor security questionnaire',
    'teams',
    'failed',
    '30 minutes',
    'The tenant blocks anonymous guests. Allow guests in Teams meeting policy, or invite the bot account.',
    null,
    0,
  ],
  ['Hiring sync', 'meet', 'transcribed', '6 days', null, 25, 4],
  ['Quarterly roadmap review', 'meet', 'transcribed', '9 days', null, 84, 8],
  ['Support escalation: Northwind', 'teams', 'cancelled', '10 days', null, null, 0],
];
for (const [title, platform, status, age, error, minutes, people] of others) {
  const meeting = await q(
    `insert into meetings (title, platform, join_url, started_at, ended_at, status, error, created_at)
     values ($1, $2, $3, now() - $4::interval, case when $7::int is null then null else now() - $4::interval + make_interval(mins => $7::int) end, $5, $6, now() - $4::interval)
     returning id`,
    [title, platform, `https://example.invalid/${platform}`, age, status, error, minutes],
  );
  for (let i = 0; i < people; i++) {
    await q('insert into participants (meeting_id, display_name) values ($1, $2)', [
      meeting.rows[0].id,
      `Guest ${i + 1}`,
    ]);
  }
}
await q(
  `insert into meetings (title, platform, join_url, started_at, status)
   values ('Sprint demo', 'meet', 'https://meet.google.com/abc-defg-hij', now() - interval '12 minutes', 'recording')`,
);
const upcoming = [
  ['Standup', 'meet', '2 hours'],
  ['Customer onboarding: Fjord Energy', 'teams', '5 hours'],
  ['Product sync', 'meet', '1 day'],
];
for (const [title, platform, ahead] of upcoming) {
  await q(
    `insert into meetings (title, platform, join_url, scheduled_start, status)
     values ($1, $2, $3, now() + $4::interval, 'scheduled')`,
    [title, platform, `https://example.invalid/${platform}/${title}`, ahead],
  );
}
await q(
  `insert into meetings (title, platform, join_url, scheduled_start, status, series_key)
   values ('Weekly priorities', 'meet', 'https://meet.google.com/pri-orit-ies', now() + interval '3 days', 'skipped', 'google:priorities'),
          ('Weekly priorities', 'meet', 'https://meet.google.com/pri-orit-ies', now() + interval '10 days', 'skipped', 'google:priorities')`,
);
await q(
  `insert into skipped_series (series_key, title) values ('google:priorities', 'Weekly priorities') on conflict do nothing`,
);
await q(
  `insert into meetings (title, platform, join_url, scheduled_start, status, series_key)
   values ('Design review', 'teams', 'https://example.invalid/teams/design', now() + interval '2 days', 'scheduled', 'google:design')`,
);
const account = await q(
  `insert into calendar_accounts (provider, account_email, encrypted_tokens, last_synced_at)
   values ('google', 'priya@northwind.example', 'demo', now() - interval '4 minutes')
   on conflict (provider, account_email) do update set last_synced_at = excluded.last_synced_at
   returning id`,
);
for (const [externalId, name, primary, rule] of [
  ['primary', 'Priya Nair', true, 'external'],
  ['team', 'Platform team', false, 'organizer'],
  ['holidays', 'Public holidays', false, 'never'],
]) {
  await q(
    `insert into calendars (account_id, external_id, name, is_primary, join_rule)
     values ($1, $2, $3, $4, $5) on conflict (account_id, external_id) do nothing`,
    [account.rows[0].id, externalId, name, primary, rule],
  );
}

const team = ['Priya Nair', 'Tom Becker', 'Jonas Weber', 'Mei Lin', 'Lena Hartmann', 'Sven Dahl'];
const folderIds = {};
for (const [key, name, parent] of [
  ['clients', 'Clients', null],
  ['hartmann', 'Hartmann Logistics', 'clients'],
  ['fjord', 'Fjord Energy', 'clients'],
  ['internal', 'Internal', null],
  ['hiring', 'Hiring', null],
]) {
  const row = await q('insert into minute_folders (name, parent_id) values ($1, $2) returning id', [
    name,
    parent ? folderIds[parent] : null,
  ]);
  folderIds[key] = row.rows[0].id;
}

// [title, platform, days ago, minutes, company, source, people, folder, summary]
const minutes = [
  [
    'Customer call: Hartmann Logistics',
    'meet',
    3,
    38,
    'Hartmann Logistics',
    'calendar',
    [0, 1, 4],
    'hartmann',
    'Hartmann confirmed the pilot for the Hamburg depot. Open question is the pallet label format, Lena sends samples by Friday.',
  ],
  [
    'Hartmann pilot kickoff',
    'meet',
    17,
    52,
    'Hartmann Logistics',
    'calendar',
    [0, 2, 4],
    'hartmann',
    'Scope, timeline and the two integration contacts agreed. Pilot starts on 3 November with the Hamburg depot.',
  ],
  [
    'Hartmann contract review',
    'teams',
    41,
    35,
    'Hartmann Logistics',
    'ai',
    [0, 4],
    'hartmann',
    'Legal changes to the data processing clause were accepted. Signature expected before the end of the month.',
  ],
  [
    'Customer onboarding: Fjord Energy',
    'teams',
    6,
    44,
    'Fjord Energy',
    'calendar',
    [0, 3, 5],
    'fjord',
    'Fjord Energy walked through their metering data. We agreed on a weekly sync and a shared channel for questions.',
  ],
  [
    'Fjord Energy quarterly check-in',
    'teams',
    58,
    29,
    'Fjord Energy',
    'ai',
    [0, 5],
    'fjord',
    'Usage is up 18 percent. They asked for CSV exports of monthly totals and a longer retention window.',
  ],
  [
    'Kestrel meeting',
    'meet',
    11,
    31,
    'Kestrel B.V.',
    'ai',
    [0, 1],
    null,
    'Kestrel wants single sign-on before rolling out to the second department. Tom estimates two weeks of work.',
  ],
  [
    'Kestrel security questionnaire',
    'meet',
    74,
    47,
    'Kestrel',
    'calendar',
    [1, 2],
    null,
    'Walked through 40 questions on data location and subprocessors. Three answers need input from the hosting provider.',
  ],
  [
    'Kestrel renewal',
    'teams',
    120,
    26,
    'Kestrel',
    'manual',
    [0, 3],
    null,
    'Renewal at the same price for twelve months, with a quarterly review of seat counts.',
  ],
  [
    'Weekly planning',
    'teams',
    1,
    47,
    null,
    null,
    [0, 1, 2, 3],
    'internal',
    'Sprint scope trimmed to the billing export and the calendar rules. Soak test planned for the weekend.',
  ],
  [
    'Weekly planning',
    'teams',
    8,
    44,
    null,
    null,
    [0, 1, 2, 3],
    'internal',
    'Retrospective on the last release. Decided to add a staging check for currency rounding.',
  ],
  [
    'Weekly planning',
    'teams',
    15,
    41,
    null,
    null,
    [0, 1, 2, 3],
    'internal',
    'Review of open bugs, two moved to next sprint. Priya owns the release notes.',
  ],
  [
    'Weekly planning',
    'teams',
    22,
    43,
    null,
    null,
    [0, 1, 2],
    'internal',
    'Calendar sync status and the plan for the Outlook app registration.',
  ],
  [
    'Design review',
    'meet',
    4,
    62,
    null,
    null,
    [1, 3, 5],
    'internal',
    'Reviewed the new minutes library layout. Folders and company sorting agreed, avatars stay small.',
  ],
  [
    'Hiring sync',
    'meet',
    7,
    25,
    null,
    null,
    [0, 2, 3],
    'hiring',
    'Two strong candidates for the backend role. Final interviews scheduled for next week.',
  ],
  [
    'Hiring sync',
    'meet',
    35,
    22,
    null,
    null,
    [0, 2],
    'hiring',
    'Job post live. First screening calls start on Monday.',
  ],
  [
    'Quarterly roadmap review',
    'meet',
    9,
    84,
    null,
    null,
    [0, 1, 2, 3, 4, 5],
    'internal',
    'Roadmap for the next quarter: minutes library, shared folders and better speaker detection.',
  ],
  [
    'Quarterly roadmap review',
    'meet',
    101,
    78,
    null,
    null,
    [0, 1, 2, 3],
    'internal',
    'Priorities agreed for the autumn: Teams stability, export destinations and the phone recorder.',
  ],
  [
    'Northwind all hands',
    'teams',
    29,
    55,
    null,
    null,
    [0, 1, 2, 3, 4, 5],
    null,
    'Company update: revenue on plan, two new hires, and the office move in January.',
  ],
  [
    'Sven intro call',
    'meet',
    52,
    33,
    'Dahl Consulting',
    'manual',
    [0, 5],
    null,
    'Dahl Consulting offers help with onboarding workshops. Sven sends a proposal.',
  ],
  [
    'Phone recording',
    'recording',
    2,
    12,
    null,
    null,
    [0],
    null,
    'Notes on the Hartmann depot visit: layout, shift times and who to talk to about the label printers.',
  ],
  [
    'Supplier call: Brightline',
    'meet',
    66,
    28,
    'Brightline',
    'ai',
    [1, 2],
    null,
    'Brightline will deliver the replacement scanners in two batches. First batch arrives in week 47.',
  ],
  [
    'Brightline invoice question',
    'meet',
    83,
    14,
    'Brightline',
    'ai',
    [1],
    null,
    'The October invoice double counted the freight. A credit note is on its way.',
  ],
  [
    'Board update',
    'teams',
    138,
    61,
    null,
    null,
    [0, 4],
    null,
    'Board approved the budget for the next half year and asked for monthly KPI mails.',
  ],
  [
    'Customer call: Fjord Energy',
    'teams',
    150,
    36,
    'Fjord Energy',
    'calendar',
    [0, 3],
    'fjord',
    'First conversation with Fjord Energy: needs, timeline and the data they can share.',
  ],
  [
    'Planning offsite',
    'meet',
    176,
    90,
    null,
    null,
    [0, 1, 2, 3, 4, 5],
    'internal',
    'Two days of planning condensed: focus on reliability, fewer features, better docs.',
  ],
  [
    'Hartmann discovery call',
    'meet',
    198,
    42,
    'Hartmann Logistics',
    'calendar',
    [0, 4],
    'hartmann',
    'Discovery call with Hartmann. They run three depots and want per-depot reporting.',
  ],
];
let seeded = 0;
for (const [title, platform, daysAgo, mins, company, source, who, folder, text] of minutes) {
  const row = await q(
    `insert into meetings (title, platform, join_url, started_at, ended_at, status, company, company_source, folder_id, created_at)
     values ($1, $2, $3, now() - make_interval(days => $4::int) - interval '3 hours', now() - make_interval(days => $4::int) - interval '3 hours' + make_interval(mins => $5::int), 'transcribed', $6, $7, $8, now() - make_interval(days => $4::int))
     returning id`,
    [
      title,
      platform,
      `https://example.invalid/${platform}/${seeded}`,
      daysAgo,
      mins,
      company,
      source,
      folder ? folderIds[folder] : null,
    ],
  );
  const id = row.rows[0].id;
  let start = 0;
  for (const person of who) {
    const speaker = await q(
      'insert into participants (meeting_id, display_name) values ($1, $2) returning id',
      [id, team[person]],
    );
    await q(
      `insert into transcript_segments (meeting_id, participant_id, start_ms, end_ms, text) values ($1, $2, $3, $4, $5)`,
      [id, speaker.rows[0].id, start, start + 20000, text],
    );
    start += 21000;
  }
  await q(
    `insert into audio_files (meeting_id, path, duration_ms, codec, size) values ($1, $2, $3, 'opus', 1000)`,
    [id, `meetings/${id}/merged.opus`, mins * 60000],
  );
  await q(
    `insert into summaries (meeting_id, provider, model, status, content) values ($1, 'demo', 'demo', 'done', $2)`,
    [id, `## Summary\n\n${text}`],
  );
  seeded += 1;
}

await pool.end();
console.log(`Seeded demo meeting ${demoId} and ${seeded} minutes`);
