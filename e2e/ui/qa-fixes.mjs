// Drives the QA fixes in headless Chromium against the real web app on a throwaway embedded
// Postgres with synthetic data: deleting one voice asks first and clears the voice vector kept on
// the participants, the People list has one Invited only control, tables have no empty header,
// the import file input has a name, and an invitee address shows in lower case.
// Usage: pnpm -r build && node e2e/ui/qa-fixes.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRealServer } from '../phone/real-server.mjs';

const root = new URL('../../', import.meta.url);
const requireFrom = createRequire(new URL('apps/web/package.json', root));
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const { eq, meetings, participants, people, voiceSamples } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/db')).href
);
const step = (name) => console.log(`== ${name}`);

const server = await startRealServer({ uiDir: fileURLToPath(new URL('apps/web/dist/ui', root)) });
const { db } = server;
const [mia] = await db.insert(people).values({ name: 'Mia Synthetic' }).returning();
await db
  .insert(voiceSamples)
  .values({ personId: mia.id, kind: 'imported', embedding: [1, 0], weight: 2 });
const [meeting] = await db
  .insert(meetings)
  .values({
    title: 'Casing',
    platform: 'meet',
    joinUrl: 'https://meet.google.com/aaa-bbbb-ccc',
    status: 'transcribed',
    invitees: [{ email: 'Dana.Keller@Example.COM', name: 'Dana Keller', declined: false }],
  })
  .returning();
const [seat] = await db
  .insert(participants)
  .values({
    meetingId: meeting.id,
    displayName: 'Mia Synthetic',
    personId: mia.id,
    voiceEmbedding: [1, 0],
  })
  .returning();

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([server.cookie]);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

step('deleting one voice asks first');
await page.goto(`${server.url}/#/settings/summaries`);
const del = page.getByRole('button', { name: 'Delete the voice data of Mia Synthetic' });
await del.click();
const dialog = page.locator('dialog.confirm-dialog[open]');
await dialog.waitFor();
await dialog.getByRole('button', { name: 'Cancel' }).click();
assert.equal((await db.select().from(voiceSamples)).length, 1, 'cancel keeps the samples');
await del.click();
await dialog.getByRole('button', { name: 'Delete voice data' }).click();
await del.waitFor({ state: 'detached' });
assert.equal((await db.select().from(voiceSamples)).length, 0);
const [after] = await db.select().from(participants).where(eq(participants.id, seat.id));
assert.equal(after.voiceEmbedding, null, 'the participant voice vector is gone too');

step('People: one Invited only control, no empty header');
await page.goto(`${server.url}/#/people`);
await page.getByLabel('Show').waitFor();
assert.equal(await page.getByRole('button', { name: /Invited only/ }).count(), 0);
assert.equal(await page.getByRole('option', { name: /Invited only/ }).count(), 1);
for (const route of ['people', 'meetings']) {
  await page.goto(`${server.url}/#/${route}`);
  await page.locator('table th').first().waitFor();
  const empty = await page
    .locator('table th')
    .evaluateAll((all) => all.filter((th) => !th.textContent.trim()).length);
  assert.equal(empty, 0, `${route}: every header has text`);
}

step('Import: the file input has a name');
await page.goto(`${server.url}/#/import`);
await page.getByLabel('Choose the export file to import').waitFor({ state: 'attached' });

step('the invitee address shows in lower case');
await page.goto(`${server.url}/#/meetings/${meeting.id}`);
await page.getByText('Dana Keller (dana.keller@example.com)').waitFor();

assert.deepEqual(errors, []);
await browser.close();
await server.close();
console.log('ok');
