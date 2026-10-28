// Drives the shared-room flow in headless Chromium against the real web app on a throwaway
// embedded Postgres with synthetic lines: the quiet notice on the meeting page, naming the voices
// of a participant tile with the meeting's people, People and a new person, "It is one person"
// and the "via <tile>" note in the transcript. It saves screenshots in light and dark at 1440 and
// 390 px.
// Usage: pnpm --filter @openminutes/web build && OUT=/path/to/shots node e2e/ui/room-voices.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRealServer } from '../phone/real-server.mjs';

const root = new URL('../../', import.meta.url);
const requireFrom = createRequire(new URL('apps/web/package.json', root));
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const { audioFiles, eq, meetings, participants, people, roomVoices, transcriptSegments } =
  await import(pathToFileURL(requireFrom.resolve('@openminutes/db')).href);
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'room-shots');
mkdirSync(out, { recursive: true });
const step = (name) => console.log(`== ${name}`);

const server = await startRealServer({ uiDir: fileURLToPath(new URL('apps/web/dist/ui', root)) });
const { db } = server;
await db
  .insert(people)
  .values([{ name: 'Anna Synthetic' }])
  .returning();

async function meeting(title) {
  const [m] = await db
    .insert(meetings)
    .values({
      title,
      platform: 'meet',
      joinUrl: 'https://meet.google.com/aaa-bbbb-ccc',
      status: 'transcribed',
      startedAt: new Date('2026-10-22T09:00:00Z'),
    })
    .returning();
  await db
    .insert(audioFiles)
    .values({ meetingId: m.id, path: 'none.opus', durationMs: 600000, codec: 'opus', size: 1 });
  const [room, rita] = await db
    .insert(participants)
    .values([
      { meetingId: m.id, displayName: 'Meeting room' },
      { meetingId: m.id, displayName: 'Remote Rita', nameConfirmed: true },
    ])
    .returning();
  const [one, two] = await db
    .insert(roomVoices)
    .values([
      {
        meetingId: m.id,
        participantId: room.id,
        number: 1,
        centroid: [1, 0],
        lines: 4,
        durationMs: 24000,
      },
      {
        meetingId: m.id,
        participantId: room.id,
        number: 2,
        centroid: [0, 1],
        lines: 3,
        durationMs: 16000,
      },
    ])
    .returning();
  const plan = [
    [one.id, room.id, 'We should move the launch to the second week of November.'],
    [two.id, room.id, 'The vendor still has not answered our security questionnaire.'],
    [one.id, room.id, 'I can take the action to update the budget sheet before Friday.'],
    [null, room.id, 'Yes, sure, we both agree on that part.'],
    [null, rita.id, 'Thanks all, I will send the notes tomorrow.'],
  ];
  await db.insert(transcriptSegments).values(
    plan.map(([roomVoiceId, participantId, text], i) => ({
      meetingId: m.id,
      participantId,
      roomVoiceId,
      startMs: i * 7000,
      endMs: i * 7000 + 6000,
      text,
      speakerConfidence: 0.95,
      speakerSource: 'indicator',
    })),
  );
  return { m, room, rita, one, two };
}

const browser = await chromium.launch();
const newPage = async (width, height, colorScheme) => {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme });
  await context.addCookies([server.cookie]);
  const page = await context.newPage();
  page.on('pageerror', (error) => assert.fail(`page error: ${error.message}`));
  return { context, page };
};

step('notice, naming page and transcript, light and dark, desktop and phone');
const shots = await meeting('Board meeting with the room');
for (const [size, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
]) {
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(width, height, scheme);
    await page.goto(`${server.url}/#/meetings/${shots.m.id}`);
    const notice = page.getByText('Meeting room appears to have 2 voices.');
    await notice.waitFor();
    const noMargin = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.document.documentElement.clientWidth,
    );
    assert.ok(noMargin, `${size} ${scheme}: no horizontal scroll on the meeting page`);
    assert.equal(await page.getByText('via ').count(), 0, 'nothing is relabelled before naming');
    await page.screenshot({ path: join(out, `${size}-${scheme}-notice.png`), fullPage: true });
    await page.getByRole('link', { name: 'Name them' }).click();
    await page.getByRole('heading', { name: 'Who is in Meeting room?' }).waitFor();
    assert.equal(await page.locator('.room-voice').count(), 2);
    assert.match(await page.locator('.room-voice').first().innerText(), /Who is this\?/);
    assert.deepEqual(
      await page.locator('.room-voice').first().locator('.review-options button').allInnerTexts(),
      ['Remote Rita'],
      'the meeting people come first',
    );
    const fits = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.document.documentElement.clientWidth,
    );
    assert.ok(fits, `${size} ${scheme}: no horizontal scroll on the naming page`);
    await page.screenshot({ path: join(out, `${size}-${scheme}-name.png`), fullPage: true });
    await context.close();
  }
}

step('name voice 1 from People, voice 2 as a new person, see the via note');
{
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${shots.m.id}/room/${shots.room.id}`);
  const first = page.locator('.room-voice').first();
  await first.getByRole('button', { name: 'People...' }).click();
  await first.getByRole('searchbox').fill('Anna');
  await first.getByRole('button', { name: 'Anna Synthetic' }).click();
  await page.getByText('Voice 1 is now Anna Synthetic.').waitFor({ state: 'attached' });
  await page.locator('.room-voice[data-named]').waitFor();
  const second = page.locator('.room-voice:not([data-named])').first();
  await second.getByRole('button', { name: 'New person' }).click();
  await second.getByLabel('Name of the new person').fill('Bram Fixture');
  await second.getByRole('button', { name: 'Add and name the voice' }).click();
  await page.getByRole('link', { name: 'All named, back to the meeting' }).click();
  await page.getByText('via Meeting room').first().waitFor();
  assert.equal(await page.getByText('Meeting room appears').count(), 0, 'the notice is gone');
  const transcript = await page.locator('.transcript, main').first().innerText();
  assert.match(transcript, /Anna Synthetic[\s\S]*via Meeting room/);
  assert.match(transcript, /Bram Fixture/);
  // The line that fits neither voice stays with the tile and is uncertain.
  assert.match(transcript, /Meeting room/);
  await page.screenshot({ path: join(out, 'desktop-light-transcript.png'), fullPage: true });
  await context.close();
  const [row] = await db.select().from(people).where(eq(people.name, 'Bram Fixture'));
  assert.ok(row, 'the new person exists');
}
{
  const { context, page } = await newPage(390, 844, 'dark');
  await page.goto(`${server.url}/#/meetings/${shots.m.id}`);
  await page.getByText('via Meeting room').first().waitFor();
  await page.screenshot({ path: join(out, 'phone-dark-transcript.png'), fullPage: true });
  await context.close();
}

step('"It is one person" hides the notice and stays hidden after a reload');
{
  const other = await meeting('Another board meeting');
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${other.m.id}`);
  await page.getByText('Meeting room appears to have 2 voices.').waitFor();
  await page.getByRole('button', { name: 'It is one person' }).click();
  await page.getByText('Meeting room appears').waitFor({ state: 'detached' });
  await page.reload();
  await page.getByText('Another board meeting').first().waitFor();
  assert.equal(await page.getByText('Meeting room appears').count(), 0);
  await page.goto(`${server.url}/#/meetings/${other.m.id}/room/${other.room.id}`);
  await page.getByText('No shared voices here').waitFor();
  await page.screenshot({ path: join(out, 'desktop-light-dismissed.png'), fullPage: true });
  await context.close();
}

await browser.close();
await server.close();
console.log(`screenshots in ${out}`);
