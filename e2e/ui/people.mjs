// Drives the People card in headless Chromium against the real web app on a throwaway embedded
// Postgres: the "Which invitee is this?" choice in the rename dialog, the Unable to attend menu
// ("They were there", "Remove from list") and that the minutes preview shows no email address.
// It saves screenshots of the dialog and the card at 1440 and 390 px.
// Usage: pnpm --filter @openminutes/web build && OUT=/path/to/shots node e2e/ui/people.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRealServer } from '../phone/real-server.mjs';

const root = new URL('../../', import.meta.url);
const requireFrom = createRequire(new URL('apps/web/package.json', root));
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const { eq, meetings, participants, transcriptSegments } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/db')).href
);
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'people-shots');
mkdirSync(out, { recursive: true });
const step = (name) => console.log(`== ${name}`);

const server = await startRealServer({ uiDir: fileURLToPath(new URL('apps/web/dist/ui', root)) });
const { db } = server;
const [meeting] = await db
  .insert(meetings)
  .values({
    title: 'Acme sync',
    platform: 'meet',
    joinUrl: 'https://meet.google.com/eyv-umah-wyh',
    status: 'transcribed',
    startedAt: new Date('2026-10-22T09:00:00Z'),
    endedAt: new Date('2026-10-22T09:45:00Z'),
    invitees: [
      { email: 'carla.gonzalez@acme.example', name: 'Carla Gonzalez', declined: false },
      { email: 'carla.smith@elsewhere.com', name: 'Carla Smith', declined: false },
      { email: 'dana@example.com', name: 'Dana Keller', declined: false },
      { email: 'carla@acme.example', name: 'Carla Jansen', declined: false },
    ],
  })
  .returning();
const people = await db
  .insert(participants)
  .values(
    ['Marketing Acme', 'Dana Keller', 'Guest 7'].map((displayName) => ({
      meetingId: meeting.id,
      displayName,
    })),
  )
  .returning();
await db.insert(transcriptSegments).values(
  people.map((person, index) => ({
    meetingId: meeting.id,
    participantId: person.id,
    startMs: index * 4000,
    endMs: index * 4000 + 3000,
    text: 'Hello everyone.',
  })),
);

const browser = await chromium.launch();
const absent = (page) => page.locator('.absent-list li');
const reset = async () => {
  await db.update(meetings).set({ dismissedInvitees: null }).where(eq(meetings.id, meeting.id));
  await db
    .update(participants)
    .set({ inviteeEmail: null, inviteeEmails: [], displayName: 'Marketing Acme' })
    .where(eq(participants.id, people[0].id));
  await db
    .update(participants)
    .set({ displayName: 'Guest 7', originalName: null, inviteeEmail: null, inviteeEmails: [] })
    .where(eq(participants.id, people[2].id));
};

for (const [width, height, size] of [
  [1440, 900, 'desktop'],
  [390, 844, 'phone'],
]) {
  await reset();
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([server.cookie]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  step(`${size}: unmatched invitees are listed`);
  await page.goto(`${server.url}/#/meetings/${meeting.id}`);
  await page.getByRole('heading', { name: 'Unable to attend' }).waitFor();
  assert.deepEqual(await absent(page).allInnerTexts(), [
    'Carla Gonzalez (carla.gonzalez@acme.example)',
    'Carla Smith (carla.smith@elsewhere.com)',
    'Carla Jansen (carla@acme.example)',
  ]);

  step(
    `${size}: the rename dialog offers the invitees and preselects nothing when first names are ambiguous`,
  );
  await page.getByRole('button', { name: 'Rename Guest 7' }).click();
  const dialog = page.getByRole('dialog');
  const boxes = dialog.getByRole('group').getByRole('checkbox');
  await dialog.getByLabel('Name', { exact: true }).fill('Carla');
  assert.equal(await boxes.evaluateAll((all) => all.filter((b) => b.checked).length), 0);
  await dialog.getByRole('checkbox', { name: /carla@acme\.example/ }).check();
  await page.screenshot({ path: join(out, `${size}-rename-dialog.png`) });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page
    .locator('.absent-list')
    .getByText('Carla Jansen (carla@acme.example)')
    .waitFor({ state: 'detached' });

  step(`${size}: They were there links an invitee to a participant`);
  await absent(page).first().getByRole('button').click();
  await page.getByRole('menuitem', { name: 'They were there' }).click();
  await page.getByLabel('Participant').selectOption({ label: 'Marketing Acme' });
  await page.screenshot({ path: join(out, `${size}-they-were-there.png`) });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page
    .locator('.absent-list')
    .getByText('Carla Gonzalez (carla.gonzalez@acme.example)')
    .waitFor({ state: 'detached' });

  step(`${size}: Remove from list`);
  await absent(page).first().getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Remove from list' }).click();
  await page.getByRole('heading', { name: 'Unable to attend' }).waitFor({ state: 'detached' });
  await page.screenshot({ path: join(out, `${size}-people-card.png`), fullPage: true });

  step(`${size}: the minutes preview shows names only`);
  const preview = await context.request.get(`${server.url}/api/meetings/${meeting.id}/minutes`);
  const html = await preview.text();
  assert.match(html, /Marketing Acme/);
  assert.doesNotMatch(html, /[\w.-]+@[\w-]+\.\w+/);
  assert.deepEqual(errors, []);
  await context.close();
}
await browser.close();
await server.close();
console.log(`screenshots in ${out}`);
