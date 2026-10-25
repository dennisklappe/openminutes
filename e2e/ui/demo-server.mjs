// Throwaway embedded Postgres plus the demo seed and a few extra states (lobby, processing, phone
// recording, summary versions, chat, a share link, invitees, email configured).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRealServer } from '../phone/real-server.mjs';

const root = new URL('../../', import.meta.url);
const requireFrom = createRequire(new URL('apps/web/package.json', root));
const load = (name) => import(pathToFileURL(requireFrom.resolve(name)).href);
const {
  calendarAccounts,
  chatMessages,
  eq,
  knownVoices,
  meetings,
  participants,
  shareEmails,
  shareLinks,
  summaries,
  transcriptSegments,
} = await load('@openminutes/db');
const { encryptSecret, saveProviderSettings } = await load('@openminutes/core');

export async function startDemo({ summaryVersions = true, extras = false } = {}) {
  const server = await startRealServer({
    uiDir: process.env.UI_DIR ?? fileURLToPath(new URL('apps/web/dist/ui', root)),
  });
  const { db, settings } = server;
  // The minutes pages print times in the instance timezone, so pick a real one instead of UTC.
  await settings.set('instance.timezone', 'Europe/Amsterdam');
  execFileSync('node', [fileURLToPath(new URL('scripts/seed-demo.mjs', root)), '--confirm'], {
    env: { ...process.env, DATABASE_URL: server.databaseUrl, OPENMINUTES_DATA_DIR: server.dataDir },
    stdio: 'inherit',
  });

  const sealed = encryptSecret(
    JSON.stringify({
      accessToken: 'demo',
      refreshToken: 'demo',
      expiresAt: Date.now() + 3_600_000_000,
      scope: '',
    }),
    'e2e-secret-0123456789abcdef',
  );
  await db.update(calendarAccounts).set({ encryptedTokens: sealed });

  const all = await db.select().from(meetings);
  const demo = all.find(
    (m) => m.title !== 'Sprint demo' && m.status === 'transcribed' && m.joinUrl.includes('qfx'),
  );
  const byTitle = (title) => all.find((m) => m.title === title);
  const failed = byTitle('Vendor security questionnaire');
  const skipped = all.find((m) => m.status === 'skipped');
  const scheduled = all.find((m) => m.status === 'scheduled');

  await saveProviderSettings(settings, 'summary', 'anthropic', {
    apiKey: 'sk-demo',
    model: 'claude-demo',
  });
  const [lobby] = await db
    .insert(meetings)
    .values({
      title: 'Board prep with a very long title that has to wrap or truncate somewhere sensible',
      platform: 'meet',
      joinUrl: 'https://meet.google.com/lob-byyy-zzz',
      status: 'in_lobby',
      startedAt: new Date(),
    })
    .returning();
  const [processing] = await db
    .insert(meetings)
    .values({
      title: 'Retro',
      platform: 'teams',
      joinUrl: 'https://example.invalid/teams/retro',
      status: 'processing',
      startedAt: new Date(Date.now() - 3_600_000),
      endedAt: new Date(Date.now() - 1_800_000),
    })
    .returning();
  const [phone] = await db
    .insert(meetings)
    .values({
      title: 'Kitchen table chat',
      platform: 'recording',
      joinUrl: '',
      status: 'transcribed',
      startedAt: new Date(Date.now() - 86_400_000),
      endedAt: new Date(Date.now() - 86_000_000),
    })
    .returning();
  await db.insert(participants).values([
    { meetingId: phone.id, displayName: 'Speaker 1' },
    { meetingId: phone.id, displayName: 'Speaker 2' },
  ]);
  if (summaryVersions) {
    await db.insert(summaries).values([
      {
        meetingId: demo.id,
        provider: 'anthropic',
        model: 'claude-demo',
        status: 'done',
        origin: 'edit',
        content: 'Edited by hand.',
      },
      {
        meetingId: demo.id,
        provider: 'anthropic',
        model: 'claude-demo',
        status: 'failed',
        error: 'The summary model returned an empty answer.',
      },
    ]);
  }
  const at = (offset) => new Date(Date.parse('2026-10-20T09:00:00Z') + offset);
  await db.insert(chatMessages).values([
    {
      meetingId: demo.id,
      dedupeKey: 'a',
      sender: 'Tom Becker',
      text: 'Runbook: https://example.com/runbooks/billing-export',
      links: ['https://example.com/runbooks/billing-export'],
      sentAt: at(30_000),
      offsetMs: 30_000,
    },
    {
      meetingId: demo.id,
      dedupeKey: 'b',
      sender: 'Mei Lin',
      text: 'Can someone paste the invoice ids?',
      links: [],
      sentAt: at(90_000),
      offsetMs: 90_000,
    },
  ]);
  const token = randomBytes(32).toString('base64url');
  await db.insert(shareLinks).values({
    meetingId: demo.id,
    token,
    includeTranscript: true,
    includeChat: true,
    includeLinks: true,
  });
  await db.insert(knownVoices).values({ name: 'Priya Nair', embedding: [0.1, 0.2], samples: 3 });
  await db.insert(shareEmails).values({
    meetingId: demo.id,
    recipient: 'priya@northwind.example',
    items: ['minutes'],
    subject: 'Minutes: Billing export',
    status: 'sent',
  });
  await settings.set('minutes.links_tab', 'true');
  await saveProviderSettings(settings, 'email', 'emailit', { apiKey: 'em-demo' });
  await settings.set('email.from_address', 'minutes@northwind.example');
  await settings.set('email.from_name', 'Priya Nair');
  await db
    .update(meetings)
    .set({
      invitees: [
        { email: 'priya@northwind.example', name: 'Priya Nair', declined: false },
        { email: 'tom@northwind.example', name: 'Tom Becker', declined: false },
        { email: 'jonas@partner.example', name: 'Jonas Weber', declined: false },
        { email: 'mei@partner.example', name: null, declined: true },
      ],
    })
    .where(eq(meetings.id, demo.id));
  let review;
  if (extras) {
    await db.insert(meetings).values([
      {
        title: 'Old vendor call',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/old-vend-zzz',
        status: 'transcribed',
        startedAt: new Date(Date.now() - 20 * 86_400_000),
        endedAt: new Date(Date.now() - 20 * 86_400_000 + 1_800_000),
        archivedAt: new Date(Date.now() - 2 * 86_400_000),
      },
      {
        title: 'Archived planning notes with a rather long title that needs to truncate',
        platform: 'teams',
        joinUrl: 'https://example.invalid/teams/planning',
        status: 'transcribed',
        startedAt: new Date(Date.now() - 30 * 86_400_000),
        endedAt: new Date(Date.now() - 30 * 86_400_000 + 3_600_000),
        archivedAt: new Date(Date.now() - 5 * 86_400_000),
      },
      {
        title: 'Test run',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/tes-trun-zzz',
        status: 'transcribed',
        startedAt: new Date(Date.now() - 3 * 86_400_000),
        endedAt: new Date(Date.now() - 3 * 86_400_000 + 600_000),
        deletedAt: new Date(Date.now() - 86_400_000),
      },
    ]);
    [review] = await db
      .insert(meetings)
      .values({
        title: 'Roadmap review with uncertain speakers',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/rev-iewx-yzq',
        status: 'transcribed',
        startedAt: new Date(Date.now() - 7_200_000),
        endedAt: new Date(Date.now() - 5_400_000),
        invitees: [
          { email: 'priya@northwind.example', name: 'Priya Nair', declined: false },
          { email: 'sam@northwind.example', name: 'Sam Ortega', declined: false },
          { email: 'lena@partner.example', name: 'Lena Fischer', declined: false },
          { email: 'omar@partner.example', name: 'Omar Haddad', declined: true },
        ],
      })
      .returning();
    const [rPriya, rSam, rGuest] = await db
      .insert(participants)
      .values([
        { meetingId: review.id, displayName: 'Priya Nair' },
        { meetingId: review.id, displayName: 'Sam Ortega' },
        { meetingId: review.id, displayName: 'Guest 7' },
      ])
      .returning();
    const dialog = [
      [rPriya, 'Good morning everyone, shall we start with the roadmap for next quarter?', 0.95],
      [rSam, 'Yes, I went through the open items and the list is shorter than last time.', 0.9],
      [rPriya, 'Great, what is at the top?', 0.62, 'diarization'],
      [rSam, 'The onboarding flow for new customers, it is behind schedule.', 0.92],
      [rSam, 'I think we need two more people for that.', 0.55, 'diarization'],
      [rGuest, 'We can lend you two engineers from the platform team in November.', 0.9],
      [rPriya, 'That works, I will plan a call with them this afternoon.', 0.93],
      [rSam, 'Fine, then I will send her the numbers.', 0.8, 'ai', rPriya],
      [rPriya, 'And the pricing page?', 0.4, 'guess'],
      [rSam, 'I review it on Thursday, the copy is almost done.', 0.9],
    ];
    await db.insert(transcriptSegments).values(
      dialog.map(([who, text, confidence, source = 'indicator', previous], index) => ({
        meetingId: review.id,
        participantId: who.id,
        startMs: index * 6000,
        endMs: index * 6000 + 5000,
        text,
        speakerConfidence: confidence,
        speakerSource: source,
        ...(previous && { previousParticipantId: previous.id }),
      })),
    );
  }
  return {
    server,
    token,
    ids: { demo, failed, skipped, scheduled, lobby, processing, phone, review },
  };
}
