import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRealServer } from '../phone/real-server.mjs';

const web = new URL('../../apps/web/', import.meta.url);
const requireFrom = createRequire(new URL('package.json', web));
const { chromium } = createRequire(new URL('../../apps/bot/package.json', import.meta.url))(
  'playwright-core',
);
const { eq, meetings, participants, transcriptSegments } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/db')).href
);

const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'speaker-review-shots');
const uiDir = fileURLToPath(new URL('apps/web/dist/ui', new URL('../../', import.meta.url)));
mkdirSync(out, { recursive: true });
const step = (name) => console.log(`== ${name}`);

const jobs = [];
const server = await startRealServer({
  uiDir,
  onJob: (name) => {
    jobs.push(name);
    return Promise.resolve();
  },
});
const { db } = server;

const [meeting] = await db
  .insert(meetings)
  .values({
    title: 'Weekplanning',
    platform: 'meet',
    joinUrl: 'https://meet.google.com/eyv-umah-wyh',
    status: 'transcribed',
    startedAt: new Date('2026-10-22T09:00:00Z'),
    endedAt: new Date('2026-10-22T09:45:00Z'),
  })
  .returning();
const [alex, sam] = await db
  .insert(participants)
  .values([
    { meetingId: meeting.id, displayName: 'Alex' },
    { meetingId: meeting.id, displayName: 'Sam' },
  ])
  .returning();

const DIALOG = [
  [alex, 'Goedemorgen allemaal, zullen we beginnen met de planning voor volgende week?', 0.95],
  [sam, 'Ja graag, ik heb de lijst met openstaande punten al doorgelopen.', 0.9],
  [alex, 'Mooi, wat staat er bovenaan?', 0.62, 'diarization'],
  [sam, 'De onboarding van de nieuwe klanten, die loopt achter op schema.', 0.92],
  [sam, 'Ik denk dat we daar twee extra mensen voor nodig hebben.', 0.55, 'diarization'],
  [sam, 'Maar dat moeten we nog met Priya bespreken.', 0.9],
  [alex, 'Dat klopt, ik plan daar vanmiddag een gesprek voor in.', 0.93],
  [sam, 'Prima, dan stuur ik haar de cijfers.', 0.8, 'ai', alex],
  [alex, 'En de prijzenpagina?', 0.4, 'guess'],
  [sam, 'Die review ik donderdag, de teksten zijn bijna klaar.', 0.9],
  [alex, 'Top, dan hebben we alles besproken.', 0.66, 'diarization'],
  [sam, 'Fijne dag nog en tot volgende week.', 0.9],
];
await db.insert(transcriptSegments).values(
  DIALOG.map(([who, text, confidence, source = 'indicator', previous], index) => ({
    meetingId: meeting.id,
    participantId: who.id,
    startMs: index * 5000,
    endMs: index * 5000 + 4500,
    text,
    speakerConfidence: confidence,
    speakerSource: source,
    ...(previous && { previousParticipantId: previous.id }),
  })),
);

const browser = await chromium.launch();
const fail = [];
const shots = [];
const url = `${server.url}/#/meetings/${meeting.id}`;

async function session(width, height, colorScheme) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme });
  await context.addCookies([server.cookie]);
  const page = await context.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.goto(url);
  await page.locator('.transcript > li').first().waitFor();
  return page;
}

const until = async (check, what) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};

const rows = (page) => page.locator('.transcript > li');
const label = (page, n) =>
  rows(page)
    .nth(n - 1)
    .locator('.speaker-name');
const names = async (page) => rows(page).locator('.speaker-name').allInnerTexts();
const expectNames = (page, expected) =>
  until(async () => (await names(page)).join() === expected.join(), `speakers ${expected.join()}`);
const undoButton = (page) => page.getByRole('status').getByRole('button', { name: 'Undo' });
const count = (page) => page.locator('.review-count');

const ORIGINAL = DIALOG.map(([who]) => who.displayName);
const set = (base, from, to, name) =>
  base.map((value, i) => (i + 1 >= from && i + 1 <= to ? name : value));

async function pick(page, n, speaker, scope) {
  await label(page, n).click();
  const menu = page.getByRole('menu', { name: 'Change speaker' });
  await menu.waitFor();
  if (scope) await menu.getByRole('menuitemradio', { name: scope }).click();
  await menu.getByRole('menuitemradio', { name: new RegExp(`^${speaker}`) }).click();
  await menu.waitFor({ state: 'detached' });
}

step('markers and tooltips');
const page = await session(1440, 900, 'light');
assert.equal(await count(page).innerText(), '4 uncertain lines');
const dot = rows(page).nth(2).locator('.uncertain-dot');
assert.equal(await dot.getAttribute('aria-label'), 'Speaker uncertain: 62%');
assert.equal(await dot.getAttribute('title'), 'Speaker uncertain: 62%');
assert.equal(await rows(page).nth(1).locator('.uncertain-dot').count(), 0);
const ai = rows(page).nth(7).locator('.source-badge');
assert.equal(await ai.innerText(), 'AI');
assert.match(
  await ai.getAttribute('title'),
  /Speaker chosen by AI from the conversation, originally Alex/,
);
assert.equal(await rows(page).nth(8).locator('.source-badge').innerText(), 'Guess');
assert.deepEqual(await names(page), ORIGINAL);

step('menu by click and keyboard');
await label(page, 2).click();
const menu = page.getByRole('menu', { name: 'Change speaker' });
await menu.waitFor();
assert.deepEqual(await menu.getByRole('menuitemradio').allInnerTexts(), ['Alex\n1', 'Sam\n2']);
assert.equal(
  await menu.getByRole('menuitemradio', { name: /^Sam/ }).getAttribute('aria-checked'),
  'true',
);
assert.equal(await menu.getByRole('menuitem', { name: 'Merge with previous line' }).count(), 1);
await page.keyboard.press('Escape');
await menu.waitFor({ state: 'detached' });
// eslint-disable-next-line no-undef
assert.equal(await label(page, 2).evaluate((el) => el === document.activeElement), true);
await label(page, 1).click();
assert.equal(await page.getByRole('menuitem', { name: 'Merge with previous line' }).count(), 0);
await page.keyboard.press('Escape');
await label(page, 3).focus();
await page.keyboard.press('Enter');
await page.getByRole('menu').waitFor();
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('Escape');
await page.getByRole('menu').waitFor({ state: 'detached' });

step('only this line, then undo with the toast');
await pick(page, 5, 'Alex');
await expectNames(page, set(ORIGINAL, 5, 5, 'Alex'));
assert.equal(await count(page).innerText(), '3 uncertain lines');
assert.equal(await rows(page).nth(4).locator('.source-badge').innerText(), 'edited');
await page.getByRole('status').getByText('Speaker changed.').waitFor();
await undoButton(page).click();
await expectNames(page, ORIGINAL);
assert.equal(await count(page).innerText(), '4 uncertain lines');

step('following lines, then undo with Ctrl+Z');
await pick(page, 4, 'Alex', 'This and following lines until the speaker changes');
await expectNames(page, set(ORIGINAL, 4, 6, 'Alex'));
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+z');
await expectNames(page, ORIGINAL);

step('whole block, digit shortcut');
await label(page, 5).click();
await page.getByRole('menuitemradio', { name: 'All lines in this block' }).click();
await page.keyboard.press('1');
await expectNames(page, set(ORIGINAL, 4, 6, 'Alex'));
await undoButton(page).click();
await expectNames(page, ORIGINAL);

step('split with the mouse');
await label(page, 4).click();
await page.getByRole('menuitem', { name: 'Split line...' }).click();
await shotFor(page, 'split-gaps');
await page.getByRole('button', { name: 'Split before die' }).click();
await page.locator('.split-speakers').getByRole('button', { name: 'Alex' }).click();
await until(async () => (await rows(page).count()) === 13, '13 lines');
assert.equal(
  await rows(page).nth(3).locator('.seek-text').innerText(),
  'De onboarding van de nieuwe klanten,',
);
assert.equal(
  await rows(page).nth(4).locator('.seek-text').innerText(),
  'die loopt achter op schema.',
);
assert.equal(await label(page, 5).innerText(), 'Alex');
await undoButton(page).click();
await until(async () => (await rows(page).count()) === 12, '12 lines');
await expectNames(page, ORIGINAL);

step('split with the keyboard');
await label(page, 10).focus();
await page.keyboard.press('Enter');
await page.getByRole('menuitem', { name: 'Split line...' }).click();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await until(async () => (await rows(page).count()) === 13, '13 lines after keyboard split');
await undoButton(page).click();
await until(async () => (await rows(page).count()) === 12, '12 lines again');

step('split can be cancelled');
await label(page, 10).click();
await page.getByRole('menuitem', { name: 'Split line...' }).click();
await page.keyboard.press('Escape');
await page.locator('.split-line').waitFor({ state: 'detached' });
assert.equal(await rows(page).count(), 12);

step('merge');
await label(page, 2).click();
await page.getByRole('menuitem', { name: 'Merge with next line' }).click();
await until(async () => (await rows(page).count()) === 11, '11 lines after merge');
await undoButton(page).click();
await until(async () => (await rows(page).count()) === 12, '12 lines after undo of merge');

step('revert an AI line');
await label(page, 8).click();
await page.getByRole('menuitem', { name: 'Back to Alex' }).click();
await expectNames(page, set(ORIGINAL, 8, 8, 'Alex'));
assert.equal(await rows(page).nth(7).locator('.source-badge').count(), 0);
await undoButton(page).click();
await expectNames(page, ORIGINAL);
assert.equal(await rows(page).nth(7).locator('.source-badge').innerText(), 'AI');

step('review: next, previous, filter');
// eslint-disable-next-line no-undef
const focused = () => page.evaluate(() => document.activeElement?.closest('li')?.textContent ?? '');
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press(']');
assert.match(await focused(), /Mooi, wat staat er bovenaan/);
await page.keyboard.press(']');
assert.match(await focused(), /twee extra mensen/);
await page.keyboard.press('[');
assert.match(await focused(), /Mooi, wat staat er bovenaan/);
await page.keyboard.press('[');
assert.match(await focused(), /alles besproken/);
await page.getByRole('button', { name: /^Next/ }).click();
assert.match(await focused(), /Mooi, wat staat er bovenaan/);
await page.getByLabel('Only uncertain lines').check();
assert.equal(await rows(page).count(), 4);
await shotFor(page, 'filtered');
await page.getByLabel('Only uncertain lines').uncheck();
assert.equal(await rows(page).count(), 12);

step('re-check with the model');
const recheck = page.getByRole('button', { name: 'Re-check speakers' });
await recheck.click();
await page.getByRole('button', { name: 'Checking...' }).waitFor();
assert.equal(await page.getByRole('button', { name: 'Checking...' }).isDisabled(), true);
await until(() => jobs.includes('meeting.review-speakers'), 'review job');
await db
  .update(meetings)
  .set({ speakerCheckedAt: new Date(Date.now() + 1000), speakerCheckError: 'The model is down' })
  .where(eq(meetings.id, meeting.id));
await page.getByText('The model is down').waitFor({ timeout: 10_000 });
await db.update(meetings).set({ speakerCheckError: null }).where(eq(meetings.id, meeting.id));
await recheck.waitFor();
await page.context().close();

async function shotFor(target, name) {
  const path = join(out, `${name}.png`);
  shots.push(path);
  await target.screenshot({ path });
}

for (const [width, height, size] of [
  [1440, 900, 'desktop'],
  [390, 844, 'phone'],
]) {
  for (const scheme of ['light', 'dark']) {
    const tag = `${size}-${scheme}`;
    step(`screenshots ${tag}`);
    const view = await session(width, height, scheme);
    await shotFor(view, `review-bar-${tag}`);
    await rows(view).nth(2).scrollIntoViewIfNeeded();
    await shotFor(view, `markers-${tag}`);
    await label(view, 5).click();
    await view.getByRole('menu').waitFor();
    await view.getByRole('menuitemradio', { name: /following/ }).waitFor();
    await shotFor(view, `menu-${tag}`);
    await view.context().close();
  }
}

await browser.close();
await server.close();
assert.deepEqual(fail, [], 'page errors');
console.log(`ok, ${String(shots.length)} screenshots in ${out}`);
