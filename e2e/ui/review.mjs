// Drives the one-at-a-time Review mode in headless Chromium against the real web app on a
// throwaway embedded Postgres with synthetic people and lines: approve, disapprove with the
// meeting roster, the full people fallback, a new person, skip, undo and the empty state, with
// the keyboard shortcuts. It saves screenshots of the card in light and dark at 1440 and 390 px.
// Usage: pnpm --filter @openminutes/web build && OUT=/path/to/shots node e2e/ui/review.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRealServer } from '../phone/real-server.mjs';

const root = new URL('../../', import.meta.url);
const requireFrom = createRequire(new URL('apps/web/package.json', root));
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const { audioFiles, eq, meetings, participants, people, transcriptSegments } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/db')).href
);
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'review-shots');
mkdirSync(out, { recursive: true });
const step = (name) => console.log(`== ${name}`);

const server = await startRealServer({ uiDir: fileURLToPath(new URL('apps/web/dist/ui', root)) });
const { db } = server;
const [anna, bram, cleo, dana] = await db
  .insert(people)
  .values(
    ['Anna Synthetic', 'Bram Fixture', 'Cleo Example', 'Dana Unrelated'].map((name) => ({ name })),
  )
  .returning();
const [meeting] = await db
  .insert(meetings)
  .values({
    title: 'Weekly planning with a fairly long title to check wrapping',
    platform: 'meet',
    joinUrl: 'https://meet.google.com/aaa-bbbb-ccc',
    status: 'transcribed',
    startedAt: new Date('2026-10-22T09:00:00Z'),
  })
  .returning();
await db
  .insert(audioFiles)
  .values({ meetingId: meeting.id, path: 'none.opus', durationMs: 600000, codec: 'opus', size: 1 });
const seats = await db
  .insert(participants)
  .values([
    { meetingId: meeting.id, displayName: anna.name, personId: anna.id, nameConfirmed: true },
    { meetingId: meeting.id, displayName: bram.name, personId: bram.id, nameConfirmed: true },
    { meetingId: meeting.id, displayName: cleo.name, personId: cleo.id, nameConfirmed: true },
    { meetingId: meeting.id, displayName: 'Notetaker', isBot: true },
  ])
  .returning();
const seat = (id) => seats.find((s) => s.personId === id);
const texts = [
  'I think we should move the launch to the second week of November.',
  'Can someone take the action to update the budget sheet before Friday?',
  'That works for me, let us keep the current plan.',
  'The vendor still has not answered our security questionnaire.',
];
const rows = await db
  .insert(transcriptSegments)
  .values(
    texts.map((text, index) => ({
      meetingId: meeting.id,
      participantId: seat(anna.id).id,
      startMs: 60000 + index * 8000,
      endMs: 60000 + index * 8000 + 6000,
      text,
      speakerConfidence: 0.2 + index * 0.1,
      speakerSource: 'diarization',
      speakerCandidates: [
        { participantId: seat(anna.id).id, score: 0.6 },
        { participantId: seat(bram.id).id, score: 0.35 },
      ],
    })),
  )
  .returning();
const byText = (text) => rows.find((r) => r.text === text);
const owner = async (text) => {
  const [row] = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.id, byText(text).id));
  const [who] = await db.select().from(participants).where(eq(participants.id, row.participantId));
  return { who: who.displayName, source: row.speakerSource };
};

const browser = await chromium.launch();
const newPage = async (width, height, colorScheme) => {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme });
  await context.addCookies([server.cookie]);
  const page = await context.newPage();
  page.on('pageerror', (error) => assert.fail(`page error: ${error.message}`));
  return { context, page };
};
const card = (page) => page.locator('.review-card');
const status = (page) => page.locator('[role="status"][aria-live="polite"]');

step('People page shows the count and opens Review');
{
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/people`);
  const link = page.getByRole('link', { name: /Review 4 lines/ });
  await link.waitFor();
  await link.click();
  await card(page).waitFor();
  assert.match(await page.locator('.review-progress').innerText(), /1 of 4/);
  assert.match(await card(page).innerText(), /second week of November/, 'least sure line first');
  assert.match(await card(page).innerText(), /Anna Synthetic/);
  assert.match(await card(page).innerText(), /Bram Fixture 35%/);

  step('keyboard: A approves, S skips, U undoes');
  await page.keyboard.press('a');
  await page.waitForFunction(() =>
    globalThis.document.querySelector('.review-progress')?.textContent?.includes('2 of 4'),
  );
  assert.match(await status(page).innerText(), /Approved: Anna Synthetic/);
  await page.keyboard.press('s');
  assert.match(await card(page).innerText(), /keep the current plan/);
  await page.keyboard.press('u');
  assert.match(await card(page).innerText(), /update the budget sheet/);
  await page.keyboard.press('s');

  step('disapprove: only the meeting roster, numbers pick');
  await page.keyboard.press('d');
  const picker = page.locator('.review-picker');
  await picker.waitFor();
  const names = await picker.locator('.review-options button').allInnerTexts();
  assert.deepEqual(
    names.map((n) => n.replace(/^\d\s*/, '')),
    ['Bram Fixture', 'Cleo Example'],
  );
  assert.ok(!(await picker.innerText()).includes('Dana Unrelated'), 'not everyone');
  assert.ok(!(await picker.innerText()).includes('Notetaker'), 'no bots');
  await page.screenshot({ path: join(out, 'desktop-light-picker.png') });
  await page.keyboard.press('Escape');
  assert.equal(await picker.count(), 0, 'Escape closes the picker first');
  await page.keyboard.press('d');
  await page.getByRole('button', { name: 'Someone else...' }).click();
  await page.getByLabel('Search people').fill('dana');
  await page.getByRole('button', { name: 'Dana Unrelated' }).click();
  await page.waitForTimeout(100);
  assert.match(await card(page).innerText(), /vendor still has not answered/);
  await page.evaluate(() => {
    location.hash = '#/people';
  });
  await context.close();
}

step('everything committed reaches the database');
await new Promise((resolve) => setTimeout(resolve, 500));
assert.deepEqual(await owner(texts[0]), { who: anna.name, source: 'user' });
assert.deepEqual(await owner(texts[2]), { who: dana.name, source: 'user' });
assert.equal((await owner(texts[3])).source, 'diarization');
assert.equal((await owner(texts[1])).source, 'diarization', 'skipped lines are untouched');

step('a new person, then the empty state');
{
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/people/${anna.id}/review`);
  await card(page).waitFor();
  await page.keyboard.press('d');
  await page.getByRole('button', { name: 'New person' }).click();
  await page.getByLabel('Name of the new person').fill('Eva Newcomer');
  await page.getByRole('button', { name: 'Add and move the line' }).click();
  await page.waitForTimeout(200);
  await page.keyboard.press('d');
  await page.keyboard.press('1');
  const empty = page.locator('.empty-state');
  await empty.waitFor();
  assert.match(await empty.innerText(), /All done/);
  await page.getByRole('link', { name: 'Back' }).click();
  await page.waitForTimeout(500);
  await context.close();
}
const [eva] = await db.select().from(people).where(eq(people.name, 'Eva Newcomer'));
assert.ok(eva, 'the new person exists');
assert.equal((await owner(texts[1])).who, 'Eva Newcomer');
assert.equal((await owner(texts[3])).who, bram.name);

step('screenshots of the card');
await db
  .update(transcriptSegments)
  .set({ speakerSource: 'diarization', participantId: seat(anna.id).id });
for (const [size, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
]) {
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(width, height, scheme);
    await page.goto(`${server.url}/#/people/review`);
    await card(page).waitFor();
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    assert.ok(overflow <= 0, `${size} ${scheme}: horizontal overflow ${String(overflow)}`);
    await page.screenshot({ path: join(out, `${size}-${scheme}-card.png`), fullPage: true });
    await page.keyboard.press('d');
    await page.screenshot({ path: join(out, `${size}-${scheme}-picker.png`), fullPage: true });
    await context.close();
  }
}

await browser.close();
await server.close();
console.log(`screenshots in ${out}`);
