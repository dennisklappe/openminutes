// Drives the one-at-a-time Review mode in headless Chromium against the real web app on a
// throwaway embedded Postgres with synthetic people and lines: approve, disapprove with the
// meeting roster, the full people fallback, a new person, skip, undo and the empty state, with
// the keyboard shortcuts. It also covers the review order and scopes, Do not track and the merge
// flows. It saves screenshots of the card in light and dark at 1440 and 390 px.
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
const {
  audioFiles,
  eq,
  meetings,
  participants,
  people,
  summaries,
  transcriptSegments,
  voiceSamples,
} = await import(pathToFileURL(requireFrom.resolve('@openminutes/db')).href);
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
  await card(page)
    .getByText(/update the budget sheet/)
    .waitFor();
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
  const empty = page.locator('.empty-state');
  await empty.waitFor();
  assert.match(await empty.innerText(), /All done/);
  await page.getByRole('link', { name: 'Back' }).click();
  await page.waitForTimeout(500);
  await context.close();
}
const [eva] = await db.select().from(people).where(eq(people.name, 'Eva Newcomer'));
assert.ok(eva, 'the new person exists');
// The budget line was skipped earlier and stays skipped, so the vendor line was the only one left.
assert.equal((await owner(texts[3])).who, 'Eva Newcomer');
assert.equal((await owner(texts[1])).source, 'diarization', 'the skipped line stays untouched');

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

step('order, meeting scope, do not track and merging');
const [mia, dennisShort, dennisLong, pimA, pimB, quinn, quincy] = await db
  .insert(people)
  .values([
    { name: 'Mia Mute' },
    { name: 'Dennis', emails: ['dennis@klappe.example'] },
    { name: 'Dennis Klappe', emails: ['dk@klappe.example'] },
    { name: 'Pim Alpha' },
    { name: 'Pim Beta' },
    { name: 'Quinn Source' },
    { name: 'Quincy Target' },
  ])
  .returning();
const [older] = await db
  .insert(meetings)
  .values({
    title: 'Older sync',
    platform: 'meet',
    joinUrl: 'https://meet.google.com/ddd-eeee-fff',
    status: 'transcribed',
    createdAt: new Date('2026-09-01T09:00:00Z'),
  })
  .returning();
const olderSeats = await db
  .insert(participants)
  .values([
    { meetingId: older.id, displayName: mia.name, personId: mia.id, nameConfirmed: true },
    { meetingId: older.id, displayName: anna.name, personId: anna.id, nameConfirmed: true },
  ])
  .returning();
await db.insert(transcriptSegments).values([
  {
    meetingId: older.id,
    participantId: olderSeats[0].id,
    startMs: 1000,
    endMs: 5000,
    text: 'Mia walks through the roadmap for the next quarter.',
    speakerConfidence: 0.05,
    speakerSource: 'diarization',
    speakerCandidates: [{ participantId: olderSeats[1].id, score: 0.4 }],
  },
  {
    meetingId: older.id,
    participantId: olderSeats[1].id,
    startMs: 6000,
    endMs: 9000,
    text: 'Anna answers that the quarter plan is fine.',
    speakerConfidence: 0.3,
    speakerSource: 'diarization',
    speakerCandidates: [{ participantId: olderSeats[0].id, score: 0.4 }],
  },
]);
await db.insert(voiceSamples).values({
  personId: mia.id,
  kind: 'imported',
  embedding: [1, 0],
  weight: 2,
});
const confirmDialog = (page) => page.locator('dialog.confirm-dialog[open]');
{
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/people/review`);
  await card(page).waitFor();
  assert.match(await card(page).innerText(), /Weekly planning/, 'newest meeting first by default');
  const order = page.getByLabel('Order');
  assert.equal(await order.inputValue(), 'newest');
  await order.selectOption('uncertain');
  await page.waitForFunction(() =>
    globalThis.document.querySelector('.review-card')?.textContent?.includes('roadmap'),
  );
  assert.match(await card(page).innerText(), /Older sync/, 'least sure first crosses meetings');

  step('scope to one meeting, the chip leaves it');
  await page.goto(`${server.url}/#/meetings/${older.id}/review`);
  await page.locator('.scope-chip').waitFor();
  assert.match(await page.locator('.scope-chip').innerText(), /Meeting: Older sync/);
  assert.match(await page.locator('.review-progress').innerText(), /1 of 2/);
  assert.ok(!(await card(page).innerText()).includes('Weekly planning'));
  await page.screenshot({ path: join(out, 'desktop-light-scope.png'), fullPage: true });
  await page.getByRole('link', { name: 'Review everyone instead' }).click();
  await page.waitForFunction(() => location.hash === '#/people/review');

  step('do not track from the review card');
  await page.goto(`${server.url}/#/meetings/${older.id}/review`);
  await card(page).waitFor();
  assert.match(await card(page).innerText(), /Mia Mute/);
  await page.getByRole('button', { name: 'Do not track Mia Mute' }).click();
  const dialog = confirmDialog(page);
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /voice samples and voice profile are deleted/);
  await page.screenshot({ path: join(out, 'desktop-light-untrack-confirm.png') });
  await dialog.getByRole('button', { name: 'Stop tracking' }).click();
  await page.waitForFunction(
    () => !globalThis.document.querySelector('.review-card')?.textContent?.includes('Mia walks'),
  );
  const [muted] = await db.select().from(people).where(eq(people.id, mia.id));
  assert.equal(muted.tracking, 'off');
  assert.equal(
    (await db.select().from(voiceSamples).where(eq(voiceSamples.personId, mia.id))).length,
    0,
  );

  step('hidden from the list, shown by the filter, tracked again from the person page');
  await page.goto(`${server.url}/#/people`);
  await page.getByLabel('Search people').fill('Mia');
  await page.getByText('Nobody matches').waitFor();
  await page.getByLabel('Tracking').selectOption('untracked');
  const row = page.getByRole('row', { name: /Mia Mute/ });
  await row.waitFor();
  assert.match(await row.innerText(), /Not tracked/);
  await row.getByRole('link', { name: 'Mia Mute' }).click();
  await page.getByRole('button', { name: 'Track again' }).first().waitFor();
  assert.match(await page.locator('h1').innerText(), /Mia Mute\s*Not tracked/);
  await page.screenshot({ path: join(out, 'desktop-light-untracked-person.png'), fullPage: true });
  await page.getByRole('button', { name: 'Track again' }).first().click();
  await page.getByRole('button', { name: 'Do not track' }).waitFor();
  assert.equal((await db.select().from(people).where(eq(people.id, mia.id)))[0].tracking, 'on');

  step('possible duplicate hint opens the merge dialog');
  await page.goto(`${server.url}/#/people`);
  await page.getByLabel('Search people').fill('Dennis');
  const hints = page.locator('.duplicate-hint');
  await hints.nth(1).waitFor();
  assert.equal(await hints.count(), 2, 'both rows carry the hint');
  await page.screenshot({ path: join(out, 'desktop-light-duplicates.png'), fullPage: true });
  await hints.first().getByRole('button', { name: 'Merge' }).click();
  const merge = page.locator('dialog[open]');
  await merge.getByText('is then removed').waitFor();
  assert.equal(
    await merge.getByRole('radio', { name: /Dennis Klappe/ }).isChecked(),
    true,
    'the fuller name is kept by default',
  );
  await page.screenshot({ path: join(out, 'desktop-light-merge.png') });
  await merge.getByRole('button', { name: /Merge into Dennis Klappe/ }).click();
  await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]'));
  const dennis = (await db.select().from(people)).filter((p) => p.name.startsWith('Dennis'));
  assert.deepEqual(
    dennis.map((p) => p.name),
    ['Dennis Klappe'],
  );
  assert.deepEqual(dennis[0].emails.sort(), ['dennis@klappe.example', 'dk@klappe.example']);
  assert.ok(dennisShort.id !== dennisLong.id);

  step('select two in the list and merge, choosing the name');
  await page.getByLabel('Search people').fill('Pim');
  await page.getByLabel('Select Pim Alpha').check();
  assert.equal(await page.getByRole('button', { name: 'Merge 2 selected' }).isDisabled(), true);
  await page.getByLabel('Select Pim Beta').check();
  await page.getByRole('button', { name: 'Merge 2 selected' }).click();
  const pimDialog = page.locator('dialog[open]');
  await pimDialog.getByRole('radio', { name: /Pim Beta/ }).check();
  await pimDialog.getByRole('button', { name: /Merge into Pim Beta/ }).click();
  await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]'));
  assert.deepEqual(
    (await db.select().from(people)).filter((p) => p.name.startsWith('Pim')).map((p) => p.name),
    ['Pim Beta'],
  );
  assert.ok(pimA.id !== pimB.id);

  step('merge into another person from the person page');
  await page.goto(`${server.url}/#/people/${quinn.id}`);
  await page.getByRole('button', { name: 'Merge into another person' }).click();
  await page.getByLabel('Search people').fill('Quincy');
  await page.getByRole('button', { name: 'Quincy Target' }).click();
  const intoDialog = page.locator('dialog[open]');
  await intoDialog.getByText('is then removed').waitFor();
  await intoDialog.getByRole('radio', { name: /Quincy Target/ }).check();
  await intoDialog.getByRole('button', { name: /Merge into Quincy Target/ }).click();
  await page.waitForFunction((id) => location.hash === `#/people/${id}`, quincy.id);
  assert.equal((await db.select().from(people).where(eq(people.id, quinn.id))).length, 0);
  await context.close();
}

step('screenshots of the new screens');
for (const [size, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
]) {
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(width, height, scheme);
    for (const [name, route, ready] of [
      ['scope', `#/meetings/${older.id}/review`, '.scope-chip'],
      ['people', '#/people', '.people-table'],
      ['person', `#/people/${mia.id}`, '.person-grid'],
    ]) {
      await page.goto(`${server.url}/${route}`);
      await page.locator(ready).waitFor();
      await page.waitForTimeout(200);
      if (name === 'people')
        await page
          .getByLabel(/^Select /)
          .first()
          .check();
      const overflow = await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      );
      assert.ok(
        overflow <= 0,
        `${size} ${scheme} ${name}: horizontal overflow ${String(overflow)}`,
      );
      await page.screenshot({ path: join(out, `${size}-${scheme}-${name}.png`), fullPage: true });
    }
    await context.close();
  }
}

step('skip persists, deep link, gone line notice');
const [sven] = await db.insert(people).values({ name: 'Sven Skip' }).returning();
const [skipMeeting] = await db
  .insert(meetings)
  .values({
    title: 'Skip check',
    platform: 'meet',
    joinUrl: 'https://meet.google.com/ggg-hhhh-iii',
    status: 'transcribed',
    startedAt: new Date('2026-10-25T09:00:00Z'),
  })
  .returning();
const [svenSeat] = await db
  .insert(participants)
  .values({ meetingId: skipMeeting.id, displayName: sven.name, personId: sven.id })
  .returning();
const skipRows = await db
  .insert(transcriptSegments)
  .values(
    ['First skip line about the budget.', 'Second skip line about hiring.'].map((text, index) => ({
      meetingId: skipMeeting.id,
      participantId: svenSeat.id,
      startMs: index * 8000,
      endMs: index * 8000 + 6000,
      text,
      speakerConfidence: 0.1 + index * 0.1,
      speakerSource: 'diarization',
      speakerCandidates: [],
      language: 'en',
    })),
  )
  .returning();
{
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${skipMeeting.id}/review`);
  await card(page).waitFor();
  assert.match(await card(page).innerText(), /First skip line/);
  await page.keyboard.press('s');
  assert.match(await card(page).innerText(), /Second skip line/);
  await page.waitForTimeout(400);
  await page.reload();
  await card(page).waitFor();
  const afterReload = await card(page).innerText();
  assert.ok(!afterReload.includes('First skip line'), 'a skipped line does not return on reload');
  assert.match(afterReload, /Second skip line/);

  step('deep link opens that card, a gone line shows the notice');
  const second = skipRows[1];
  await page.goto(`${server.url}/#/meetings/${skipMeeting.id}/review/${second.id}`);
  await page.reload();
  await card(page).waitFor();
  assert.match(await card(page).innerText(), /Second skip line/);
  assert.equal(
    await page.getByText(/no longer in the queue/).count(),
    0,
    'no notice for a live line',
  );
  await page.goto(`${server.url}/#/meetings/${skipMeeting.id}/review/${skipRows[0].id}`);
  await page.reload();
  await page.getByText(/no longer in the queue/).waitFor();
  await page.screenshot({ path: join(out, 'desktop-light-gone-notice.png') });
  await context.close();
}

step('coverage meter and per-language profile cards');
await db.insert(voiceSamples).values([
  {
    personId: sven.id,
    kind: 'imported',
    embedding: [1, 0],
    weight: 3,
    durationMs: 45000,
    language: 'en',
  },
  {
    personId: sven.id,
    kind: 'meeting',
    meetingId: skipMeeting.id,
    embedding: [0, 1],
    durationMs: 20000,
    language: 'nl',
    source: 'auto',
  },
]);
for (const [size, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
]) {
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(width, height, scheme);
    await page.goto(`${server.url}/#/people/${sven.id}`);
    await page.locator('.language-profile').first().waitFor();
    assert.equal(await page.locator('.language-profile').count(), 2, 'one card per language');
    assert.equal(await page.locator('.language-profile [role="progressbar"]').count(), 2);
    const text = await page.locator('.person-grid').innerText();
    assert.match(text, /English/);
    assert.match(await page.locator('.language-profile').nth(1).innerText(), /Added by itself/);
    const overflow = await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    assert.ok(overflow <= 0, `${size} ${scheme} profiles: overflow ${String(overflow)}`);
    await page.screenshot({ path: join(out, `${size}-${scheme}-profiles.png`), fullPage: true });
    await page.goto(`${server.url}/#/meetings/${skipMeeting.id}/review`);
    await card(page).waitFor();
    assert.ok(
      (await card(page).locator('[role="progressbar"]').count()) === 1,
      'coverage meter on the card',
    );
    await page.screenshot({ path: join(out, `${size}-${scheme}-meter.png`), fullPage: true });
    await context.close();
  }
}

step('speaker change notice with Dismiss');
await db.insert(summaries).values({
  meetingId: skipMeeting.id,
  provider: 'fake',
  model: 'fake',
  status: 'done',
  content: '## Summary\n\nThey talked about the budget.',
  createdAt: new Date(Date.now() - 60000),
});
await db
  .update(meetings)
  .set({ speakersChangedAt: new Date() })
  .where(eq(meetings.id, skipMeeting.id));
for (const [size, width, height] of [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
]) {
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(width, height, scheme);
    await db
      .update(meetings)
      .set({ speakersChangedAt: new Date(), speakersNoticeDismissedAt: null })
      .where(eq(meetings.id, skipMeeting.id));
    await page.goto(`${server.url}/#/meetings/${skipMeeting.id}`);
    await page.getByRole('tab', { name: 'Summary' }).first().click();
    const banner = page.getByText(/Speakers changed in the transcript/);
    await banner.waitFor();
    await page.screenshot({
      path: join(out, `${size}-${scheme}-speakers-notice.png`),
      fullPage: true,
    });
    if (size === 'desktop' && scheme === 'light') {
      await page.getByRole('button', { name: 'Dismiss' }).click();
      await banner.waitFor({ state: 'detached' });
      await page.reload();
      await page.getByRole('tab', { name: 'Summary' }).first().click();
      await page.getByText('They talked about the budget').waitFor();
      assert.equal(await banner.count(), 0, 'dismissed notice stays away after reload');
    }
    await context.close();
  }
}

await browser.close();
await server.close();
console.log(`screenshots in ${out}`);
