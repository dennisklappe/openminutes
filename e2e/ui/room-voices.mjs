// Drives the shared-account flow in headless Chromium against the real web app on a throwaway
// embedded Postgres with synthetic data: the "how many people?" question, the sub-people rows
// under the shared tile in the People card, naming from the card (a new name and an existing
// person), emails per sub-person, "It is one person", the split buttons, the transcript with the
// "via <tile>" note, the People tab with its Unnamed filter and the Shared accounts settings.
// Screenshots go in light and dark at 1440 and 390 px.
// Usage: pnpm -r build && OUT=/path/to/shots node e2e/ui/room-voices.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRealServer } from '../phone/real-server.mjs';

const root = new URL('../../', import.meta.url);
const requireFrom = createRequire(new URL('apps/web/package.json', root));
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const load = (name) => import(pathToFileURL(requireFrom.resolve(name)).href);
const { audioFiles, eq, meetings, participants, people, roomVoices, transcriptSegments } =
  await load('@openminutes/db');
const { applyRoomVoices, rememberCount } = await load('@openminutes/core');
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'room-shots');
mkdirSync(out, { recursive: true });
const step = (name) => console.log(`== ${name}`);

const server = await startRealServer({ uiDir: fileURLToPath(new URL('apps/web/dist/ui', root)) });
const { db } = server;
await db.insert(people).values([{ name: 'Anna Synthetic' }]);

/**
 * A meeting with the tile "Jo and Sam" holding two voices. `asked` leaves the question open (the
 * pipeline asked, nobody answered), else the count is known and the voices are people.
 */
async function meeting(title, { asked, tile = 'Jo and Sam', email = 'room@example.com' }) {
  const [m] = await db
    .insert(meetings)
    .values({
      title,
      platform: 'meet',
      joinUrl: 'https://meet.google.com/aaa-bbbb-ccc',
      status: 'transcribed',
      startedAt: new Date('2026-10-22T09:00:00Z'),
      invitees: [
        { email: 'jo@example.com', name: 'Jo Parker', declined: false },
        { email: 'sam@example.com', name: 'Sam Fixture', declined: false },
      ],
    })
    .returning();
  await db
    .insert(audioFiles)
    .values({ meetingId: m.id, path: 'none.opus', durationMs: 600000, codec: 'opus', size: 1 });
  const [room, rita] = await db
    .insert(participants)
    .values([
      {
        meetingId: m.id,
        displayName: tile,
        email,
        ...(asked ? { roomAskedAt: new Date() } : { roomCount: 2 }),
      },
      { meetingId: m.id, displayName: 'Remote Rita', nameConfirmed: true },
    ])
    .returning();
  const [one, two] = (
    await db
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
      .returning()
  ).toSorted((a, b) => a.number - b.number);
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
  if (!asked) await applyRoomVoices(db, m.id, room.id);
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
const fits = (page, what) =>
  page
    .evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.document.documentElement.clientWidth,
    )
    .then((ok) => assert.ok(ok, `no horizontal scroll: ${what}`));
/** The quiet note about the shared account: its actions sit inside, closed until opened. */
const openNote = async (page) => {
  const note = page.locator('details.shared-note');
  await note.waitFor();
  if (!(await note.evaluate((el) => el.open))) await note.locator('summary').click();
  return note;
};
const sizes = [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
];

step('the question, light and dark, desktop and phone');
const asked = await meeting('Board meeting with the room', { asked: true });
for (const [size, width, height] of sizes) {
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(width, height, scheme);
    await page.goto(`${server.url}/#/meetings/${asked.m.id}`);
    await page.getByText('Jo and Sam sounds like several people. How many?').waitFor();
    assert.equal(
      await page.getByText('via ').count(),
      0,
      'nothing is relabelled before the answer',
    );
    assert.equal(await page.getByText('Voice 1 (Jo and Sam)').count(), 0, 'no sub-people yet');
    await fits(page, `${size} ${scheme} question`);
    await page.screenshot({ path: join(out, `${size}-${scheme}-question.png`), fullPage: true });
    await context.close();
  }
}

step('answer 2: the voices become people under the tile');
{
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${asked.m.id}`);
  await page.getByText('Jo and Sam sounds like several people. How many?').waitFor();
  await page
    .getByRole('group', { name: /How many people in Jo and Sam/ })
    .getByRole('button', { name: '2', exact: true })
    .click();
  await page.getByText('sounds like several people').waitFor({ state: 'detached' });
  await page.getByText('Voice 1 (Jo and Sam)').first().waitFor();
  await page.getByText('Voice 2 (Jo and Sam)').first().waitFor();
  // The voices are first-level rows of the list, like Remote Rita; the tile is a note.
  const items = page.locator('.participant-list:not(.absent-list) > li');
  const heads = (await items.allInnerTexts()).map((t) => t.split('\n')[0]);
  assert.deepEqual(
    heads.map((h) => h.replace(/\s*(via|Unnamed).*$/, '')),
    ['Voice 1 (Jo and Sam)', 'Voice 2 (Jo and Sam)', 'Remote Rita'],
  );
  assert.equal(await page.locator('.sub-people').count(), 0, 'nothing is nested');
  assert.equal(await page.locator('.participant-list:not(.absent-list) > li.voice-row').count(), 2);
  assert.equal((await page.getByText('via Jo and Sam').count()) >= 2, true);
  assert.equal(
    await page.getByText('Joined from one shared account: Jo and Sam, 2 voices').count(),
    1,
  );
  assert.equal(await page.getByText('Unnamed').count(), 2);
  await openNote(page);
  assert.equal(await page.getByRole('button', { name: 'Split into 2 people' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Split into 3 people' }).count(), 1);
  await context.close();
}

step('sub-people rows, light and dark, desktop and phone');
const settled = await meeting('Planning with the room', { asked: false });
for (const [size, width, height] of sizes) {
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(width, height, scheme);
    await page.goto(`${server.url}/#/meetings/${settled.m.id}`);
    await page.getByText('Voice 1 (Jo and Sam)').first().waitFor();
    await openNote(page);
    assert.equal(await page.getByText('sounds like several people').count(), 0, 'no question');
    await fits(page, `${size} ${scheme} sub rows`);
    await page.screenshot({ path: join(out, `${size}-${scheme}-people.png`), fullPage: true });
    await context.close();
  }
}

step('name voice 1 with a new name, voice 2 with a person from People');
{
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${settled.m.id}`);
  const rows = page.locator('.sub-person');
  const first = rows.filter({ hasText: 'Voice 1 (Jo and Sam)' });
  await first.getByRole('button', { name: 'Name', exact: true }).click();
  // The invitees of the meeting are offered first, as "Name (address)".
  const invited = page.getByRole('list', { name: 'Invited to this meeting' });
  await invited.getByRole('button', { name: 'Sam Fixture (sam@example.com)' }).waitFor();
  await invited.getByRole('button', { name: 'Jo Parker (jo@example.com)' }).waitFor();
  await page.screenshot({ path: join(out, 'desktop-light-name-invited.png') });
  await page.getByRole('button', { name: 'New person' }).click();
  await page.getByLabel('Name of the new person').fill('Jo Parker');
  await page.getByRole('button', { name: 'Add and name the voice' }).click();
  await page.getByRole('button', { name: 'Name the voice' }).click();
  await rows.filter({ hasText: 'Jo Parker' }).getByRole('link', { name: 'Jo Parker' }).waitFor();
  await page.screenshot({ path: join(out, 'desktop-light-named-one.png'), fullPage: true });
  const second = rows.filter({ hasText: 'Voice 2 (Jo and Sam)' });
  await second.getByRole('button', { name: 'Name', exact: true }).click();
  await page.getByRole('button', { name: 'People...' }).click();
  await page.getByRole('searchbox').fill('Anna');
  await page.getByRole('button', { name: 'Anna Synthetic' }).click();
  await page.getByRole('dialog').getByText('Email (optional)').waitFor();
  await page.screenshot({ path: join(out, 'desktop-light-name-emails.png') });
  await page.getByRole('button', { name: 'Name the voice' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await rows.filter({ hasText: 'Anna Synthetic' }).getByRole('link').waitFor();
  assert.equal(await page.getByText('Unnamed').count(), 0, 'both are named');
  await openNote(page);
  assert.equal(await page.getByRole('button', { name: 'Split into 2 people' }).count(), 0);
  const href = await rows.filter({ hasText: 'Jo Parker' }).getByRole('link').getAttribute('href');
  assert.match(href ?? '', /^#\/people\//);
  await context.close();
  const [row] = await db.select().from(people).where(eq(people.name, 'Jo Parker'));
  assert.ok(row, 'the new person exists');
  assert.equal(row.unnamed, false);
  const [anna] = await db.select().from(people).where(eq(people.name, 'Anna Synthetic'));
  const voices = await db.select().from(roomVoices).where(eq(roomVoices.meetingId, settled.m.id));
  assert.ok(
    voices.some((v) => v.personId === anna.id),
    'voice 2 belongs to Anna',
  );
  // The transcript shows both with the tile note.
  const { context: c2, page: p2 } = await newPage(1440, 900, 'light');
  await p2.goto(`${server.url}/#/meetings/${settled.m.id}`);
  await p2.getByText('via Jo and Sam').first().waitFor();
  const text = await p2.locator('main').innerText();
  assert.match(text, /Jo Parker[\s\S]*via Jo and Sam/);
  assert.match(text, /Anna Synthetic/);
  await p2.screenshot({ path: join(out, 'desktop-light-transcript.png'), fullPage: true });
  await c2.close();
  const { context: c3, page: p3 } = await newPage(390, 844, 'dark');
  await p3.goto(`${server.url}/#/meetings/${settled.m.id}`);
  await p3.getByText('via Jo and Sam').first().waitFor();
  await fits(p3, 'phone dark transcript');
  await p3.screenshot({ path: join(out, 'phone-dark-transcript.png'), fullPage: true });
  await c3.close();
}

step('emails per sub-person: an invitee goes to one of them only');
{
  const other = await meeting('Email meeting', {
    asked: false,
    tile: 'Pat and Lee',
    email: 'pair@example.com',
  });
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${other.m.id}`);
  const rows = page.locator('.sub-person');
  await rows
    .filter({ hasText: 'Voice 1 (Pat and Lee)' })
    .getByRole('button', { name: /Emails of/ })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Jo Parker/).check();
  await dialog.getByLabel(/address of the account/).check();
  await page.screenshot({ path: join(out, 'desktop-light-emails.png') });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.waitFor({ state: 'detached' });
  await rows
    .filter({ hasText: 'Voice 2 (Pat and Lee)' })
    .getByRole('button', { name: /Emails of/ })
    .click();
  const second = page.getByRole('dialog');
  assert.equal(await second.getByLabel(/Jo Parker/).isDisabled(), false, 'can be moved');
  assert.match(await second.innerText(), /taken by Voice 1 \(Pat and Lee\), tick to move it here/);
  assert.equal(await second.getByLabel(/address of the account/).isDisabled(), true);
  await second.getByLabel(/Jo Parker/).check();
  await second.getByRole('button', { name: 'Save' }).click();
  await second.waitFor({ state: 'detached' });
  const movedTo = await db
    .select()
    .from(participants)
    .where(eq(participants.meetingId, other.m.id));
  assert.deepEqual(
    movedTo.filter((p) => p.inviteeEmails.includes('jo@example.com')).map((p) => p.displayName),
    ['Voice 2 (Pat and Lee)'],
    'the invitee moved to voice 2 and left voice 1',
  );
  await context.close();
}

step('"Unable to attend": They were there offers the people of the tile, not the tile');
{
  const away = await meeting('Absent meeting', {
    asked: false,
    tile: 'Mia and Ben',
    email: 'mb@example.com',
  });
  for (const [size, width, height] of sizes) {
    for (const scheme of ['light', 'dark']) {
      const { context, page } = await newPage(width, height, scheme);
      await page.goto(`${server.url}/#/meetings/${away.m.id}`);
      await page.getByRole('heading', { name: 'Unable to attend' }).waitFor();
      const item = page.locator('.absent-list li', { hasText: 'sam@example.com' });
      await item.getByRole('button', { name: /Options for/ }).click();
      await page.getByRole('menuitem', { name: 'They were there' }).click();
      const dialog = page.getByRole('dialog');
      const options = await dialog.getByRole('option').allInnerTexts();
      assert.ok(options.includes('Voice 1 (Mia and Ben)'), `sub-people are offered: ${options}`);
      assert.ok(!options.includes('Mia and Ben'), 'the tile itself is not');
      assert.ok(options.includes('Someone else...'));
      await fits(page, `${size} ${scheme} they were there`);
      await page.screenshot({
        path: join(out, `${size}-${scheme}-they-were-there.png`),
        fullPage: true,
      });
      await context.close();
    }
  }
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${away.m.id}`);
  const item = page.locator('.absent-list li', { hasText: 'sam@example.com' });
  await item.getByRole('button', { name: /Options for/ }).click();
  await page.getByRole('menuitem', { name: 'They were there' }).click();
  await page
    .getByRole('dialog')
    .getByRole('combobox')
    .selectOption({ label: 'Voice 2 (Mia and Ben)' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const seats = await db.select().from(participants).where(eq(participants.meetingId, away.m.id));
  assert.deepEqual(
    seats.filter((p) => p.inviteeEmails.includes('sam@example.com')).map((p) => p.displayName),
    ['Voice 2 (Mia and Ben)'],
    'linked to the sub-person, not the tile',
  );
  // Someone from People who has no seat yet.
  const item2 = page.locator('.absent-list li', { hasText: 'jo@example.com' });
  await item2.getByRole('button', { name: /Options for/ }).click();
  await page.getByRole('menuitem', { name: 'They were there' }).click();
  const second = page.getByRole('dialog');
  await second.getByRole('combobox').selectOption({ label: 'Someone else...' });
  await second.getByRole('searchbox').fill('Anna');
  await second.getByRole('button', { name: 'Anna Synthetic' }).click();
  await second.getByRole('button', { name: 'Save' }).click();
  await second.waitFor({ state: 'detached' });
  await page.getByRole('listitem').filter({ hasText: 'Anna Synthetic' }).first().waitFor();
  await context.close();
}

step('Change who this is: wrong person, back to unnamed, another person');
{
  await db.insert(people).values({ name: 'Bea Synthetic' });
  const wrong = await meeting('Wrong person meeting', {
    asked: false,
    tile: 'Ann and Sam',
    email: 'bp@example.com',
  });
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${wrong.m.id}`);
  const rows = page.locator('.sub-person');
  const first = rows.filter({ hasText: 'Voice 1 (Ann and Sam)' });
  await first.getByRole('button', { name: 'Name', exact: true }).click();
  await page.getByRole('button', { name: 'People...' }).click();
  await page.getByRole('searchbox').fill('Anna');
  await page.getByRole('button', { name: 'Anna Synthetic' }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/Jo Parker/)
    .check();
  await page.getByRole('button', { name: 'Name the voice' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const annaRow = rows.filter({ hasText: 'Anna Synthetic' });
  await annaRow.getByRole('link', { name: 'Anna Synthetic' }).waitFor();
  assert.match(await annaRow.innerText(), /jo@example\.com/);
  // The pencil changes emails of the person, the menu changes who the voice is.
  await annaRow.getByRole('button', { name: 'More for Anna Synthetic' }).click();
  await page.getByRole('menuitem', { name: 'Change who this is' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: /Change who/ }).waitFor();
  // Anna has jo@example.com, so only the other invitee is offered.
  const offered = dialog.getByRole('list', { name: 'Invited to this meeting' });
  await offered.getByRole('button', { name: 'Sam Fixture (sam@example.com)' }).waitFor();
  assert.equal(await offered.getByRole('button', { name: /jo@example\.com/ }).count(), 0);
  await page.screenshot({ path: join(out, 'desktop-light-change-invited.png') });
  await dialog.getByRole('button', { name: 'People...' }).click();
  await dialog.getByRole('searchbox').fill('Bea');
  await dialog.getByRole('button', { name: 'Bea Synthetic' }).click();
  const effects = dialog.getByRole('list', { name: 'What changes' });
  await effects.waitFor();
  assert.match(
    await effects.innerText(),
    /lines? of this voice move from Anna Synthetic to Bea Synthetic/,
  );
  assert.match(await effects.innerText(), /removed from the voice profile of Anna Synthetic/);
  await dialog.getByText('These emails were linked in this meeting').waitFor();
  assert.equal(await dialog.getByLabel('jo@example.com', { exact: true }).isChecked(), true);
  await page.screenshot({ path: join(out, 'desktop-light-change.png') });
  await dialog.getByRole('button', { name: 'Change who this is' }).click();
  await dialog.waitFor({ state: 'detached' });
  await rows.filter({ hasText: 'Bea Synthetic' }).getByRole('link').waitFor();
  await page.waitForFunction(() => !globalThis.document.body.innerText.includes('Anna Synthetic'));
  assert.equal(await page.getByText('Anna Synthetic').count(), 0, 'Anna is gone from the meeting');
  const [anna] = await db.select().from(people).where(eq(people.name, 'Anna Synthetic'));
  assert.ok(!anna.emails.includes('jo@example.com'), 'the ticked address left Anna');
  // Back to unnamed.
  const samRow = rows.filter({ hasText: 'Bea Synthetic' });
  await samRow.getByRole('button', { name: 'More for Bea Synthetic' }).click();
  await page.getByRole('menuitem', { name: 'Change who this is' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unnamed again' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Change who this is' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await rows.filter({ hasText: 'Voice 1 (Ann and Sam)' }).getByText('Unnamed').waitFor();
  await context.close();
  for (const [size, width, height] of sizes) {
    for (const scheme of ['light', 'dark']) {
      const { context: c, page: p } = await newPage(width, height, scheme);
      await p.goto(`${server.url}/#/meetings/${wrong.m.id}`);
      await p.getByText('Voice 1 (Ann and Sam)').first().waitFor();
      await p.getByRole('button', { name: /Name$/ }).first().waitFor();
      const named = p.locator('.sub-person', { hasText: 'Voice 2 (Ann and Sam)' });
      await named.getByRole('button', { name: 'Name', exact: true }).click();
      await p.getByRole('heading', { name: 'Invited to this meeting' }).waitFor();
      await fits(p, `${size} ${scheme} invited`);
      await p.screenshot({ path: join(out, `${size}-${scheme}-name-invited.png`) });
      await p.getByRole('button', { name: 'New person' }).click();
      await p.getByLabel('Name of the new person').fill(`Zed ${size} ${scheme}`);
      await p.getByRole('button', { name: 'Add and name the voice' }).click();
      await p.getByRole('dialog').getByText('Email (optional)').waitFor();
      await fits(p, `${size} ${scheme} name emails`);
      await p.screenshot({ path: join(out, `${size}-${scheme}-name-emails.png`) });
      await p.getByRole('button', { name: 'Name the voice' }).click();
      await p.getByRole('dialog').waitFor({ state: 'detached' });
      await p
        .locator('.sub-person', { hasText: `Zed ${size} ${scheme}` })
        .getByRole('button', { name: `More for Zed ${size} ${scheme}` })
        .click();
      await p.getByRole('menuitem', { name: 'Change who this is' }).click();
      await p.getByRole('dialog').getByRole('button', { name: 'Unnamed again' }).click();
      await fits(p, `${size} ${scheme} change`);
      await p.screenshot({ path: join(out, `${size}-${scheme}-change.png`) });
      await p.getByRole('dialog').getByRole('button', { name: 'Change who this is' }).click();
      await p.getByRole('dialog').waitFor({ state: 'detached' });
      await c.close();
    }
  }
  // The naming page: a named voice can be changed there too.
  const { context: c4, page: p4 } = await newPage(1440, 900, 'light');
  const tileRow = await db
    .select()
    .from(participants)
    .where(eq(participants.meetingId, wrong.m.id));
  const tile = tileRow.find((p) => p.displayName === 'Ann and Sam');
  await p4.goto(`${server.url}/#/meetings/${wrong.m.id}/room/${tile.id}`);
  await p4.getByRole('heading', { name: 'Who is in Ann and Sam?' }).waitFor();
  // Name voice 1 here, with an email in the same step, then change it.
  const card = p4.locator('section.room-voice', { hasText: 'Voice 1' });
  await card.getByRole('button', { name: 'People...' }).click();
  await card.getByRole('searchbox').fill('Bea');
  await card.getByRole('button', { name: 'Bea Synthetic' }).click();
  await card.getByText('Email (optional)').waitFor();
  await card.getByLabel(/Jo Parker/).check();
  await p4.screenshot({ path: join(out, 'desktop-light-room-page-name.png'), fullPage: true });
  await card.getByRole('button', { name: 'Name the voice' }).click();
  const change = p4.getByRole('button', { name: 'Change who this is' });
  await change.first().waitFor();
  assert.equal(await change.count(), 1, 'only the named voice can be changed');
  await change.click();
  const pageDialog = p4.getByRole('dialog');
  await pageDialog.getByRole('heading', { name: /Change who Voice/ }).waitFor();
  await pageDialog.getByRole('button', { name: 'Unnamed again' }).click();
  await pageDialog.getByText('These emails were linked').count();
  await p4.screenshot({ path: join(out, 'desktop-light-room-page-change.png') });
  await pageDialog.getByRole('button', { name: 'Change who this is' }).click();
  await pageDialog.waitFor({ state: 'detached' });
  await p4.getByText('was changed.').waitFor({ state: 'attached' });
  assert.equal(await p4.getByRole('button', { name: 'Change who this is' }).count(), 0);
  await c4.close();
}

step('"It is one person" removes the sub-people');
{
  const one = await meeting('Another board meeting', {
    asked: false,
    tile: 'Kim and Lee',
    email: 'kl@example.com',
  });
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${one.m.id}`);
  await page.getByText('Voice 1 (Kim and Lee)').first().waitFor();
  await openNote(page);
  assert.equal(await page.getByRole('button', { name: 'Split into 2 people' }).count(), 1);
  await page.getByRole('button', { name: 'It is one person' }).click();
  await page.locator('.voice-row').first().waitFor({ state: 'detached' });
  assert.equal(await page.locator('details.shared-note').count(), 0, 'the note is gone');
  await page.reload();
  await page.getByText('Another board meeting').first().waitFor();
  assert.equal(await page.getByText('Voice 1 (Kim and Lee)').count(), 0);
  await context.close();
}

step('a person who also joined alone keeps their own row, the voice shows its own lines');
{
  const [dennis] = await db.insert(people).values({ name: 'Dennis Synthetic' }).returning();
  const same = await meeting('Same person meeting', {
    asked: false,
    tile: 'Ann and Sam',
    email: 'bpx@example.com',
  });
  const [seat] = await db
    .insert(participants)
    .values({
      meetingId: same.m.id,
      displayName: 'Dennis Synthetic',
      personId: dennis.id,
      nameConfirmed: true,
    })
    .returning();
  await db.insert(transcriptSegments).values(
    [0, 1, 2].map((i) => ({
      meetingId: same.m.id,
      participantId: seat.id,
      startMs: 100000 + i * 5000,
      endMs: 100000 + i * 5000 + 3000,
      text: `Own line ${String(i)} from the laptop.`,
      speakerSource: 'indicator',
    })),
  );
  const post = (path, body) =>
    fetch(`${server.url}/api${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${server.cookie.name}=${server.cookie.value}`,
        origin: server.url,
      },
      body: JSON.stringify(body),
    }).then((r) => assert.equal(r.status, 200, path));
  await post(`/meetings/${same.m.id}/room-voices/${same.one.id}/name`, { personId: dennis.id });
  await post(`/meetings/${same.m.id}/room-voices/${same.two.id}/name`, { newName: 'Pieter' });
  for (const [size, width, height] of sizes) {
    for (const scheme of ['light', 'dark']) {
      const { context, page } = await newPage(width, height, scheme);
      await page.goto(`${server.url}/#/meetings/${same.m.id}`);
      await page.locator('.voice-row', { hasText: 'via Ann and Sam' }).first().waitFor();
      const items = page.locator('.participant-list:not(.absent-list) > li');
      const heads = (await items.allInnerTexts()).map((t) => t.split('\n')[0]);
      assert.deepEqual(heads.slice(0, 3), ['Pieter', 'Dennis Synthetic', 'Dennis Synthetic']);
      const own = items.nth(1);
      assert.match(await own.innerText(), /9s talking/, 'the seat keeps its own time');
      const voice = items.nth(2);
      assert.match(await voice.innerText(), /via Ann and Sam/);
      assert.match(await voice.innerText(), /2 lines/, 'only the lines of the voice');
      assert.match(await voice.innerText(), /Same person as the participant above\. Wrong\?/);
      assert.equal(await items.nth(0).getByText('Same person').count(), 0);
      const talk = page.locator('ul.talk > li');
      const rows = (await talk.allInnerTexts()).map((t) => t.split('\n'));
      const names = rows.map(([name]) => name);
      assert.equal(new Set(names).size, names.length, `talk time lists everyone once: ${names}`);
      assert.ok(!names.includes('Ann and Sam'), 'the shared tile is not a speaker');
      assert.equal(
        names.filter((n) => n === 'Dennis Synthetic').length,
        1,
        'seat and voice merged',
      );
      assert.equal(
        rows.reduce((sum, [, percent]) => sum + Number.parseInt(percent ?? '0', 10), 0),
        100,
        'talk time adds up to 100',
      );
      const quiet = names.find((n) => n.startsWith('Unassigned'));
      if (quiet) assert.equal(quiet, 'Unassigned (Ann and Sam)');
      await fits(page, `${size} ${scheme} same person`);
      await page.screenshot({
        path: join(out, `${size}-${scheme}-same-person.png`),
        fullPage: true,
      });
      await context.close();
    }
  }
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/meetings/${same.m.id}`);
  await page
    .locator('.voice-row', { hasText: 'Same person as the participant above' })
    .getByRole('button', { name: 'Change who this is' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('heading', { name: /Change who/ })
    .waitFor();
  await context.close();
}

step('People tab: Unnamed filter and tags');
{
  const open = await meeting('Meeting with unnamed voices', {
    asked: false,
    tile: 'Ann and Sam',
    email: 'bp@example.com',
  });
  for (const [size, width, height] of sizes) {
    for (const scheme of ['light', 'dark']) {
      const { context, page } = await newPage(width, height, scheme);
      await page.goto(`${server.url}/#/people`);
      await page.getByLabel('Show').selectOption('unnamed');
      await page.getByText('Voice 1 (Ann and Sam)').first().waitFor();
      assert.ok((await page.getByText('Unnamed', { exact: true }).count()) >= 1);
      assert.ok((await page.getByText('via shared account').count()) >= 1);
      await page.getByText('Anna Synthetic').waitFor({ state: 'detached' });
      await fits(page, `${size} ${scheme} people tab`);
      await page.screenshot({
        path: join(out, `${size}-${scheme}-people-tab.png`),
        fullPage: true,
      });
      await context.close();
    }
  }
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/people`);
  await page.getByLabel('Show').selectOption('unnamed');
  const row = page.getByRole('row', { name: /Voice 1 \(Ann and Sam\)/ }).first();
  await row.getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Name' }).click();
  await page.getByRole('dialog').getByRole('textbox').first().fill('Sam Fixture');
  await page.getByRole('button', { name: 'Use this name' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const [sam] = await db.select().from(people).where(eq(people.name, 'Sam Fixture'));
  assert.ok(sam && sam.unnamed === false, 'renamed, no longer unnamed');
  await context.close();
  assert.ok(open.m.id);
}

step('Settings: wait and remembered accounts');
{
  await rememberCount(db, { email: null, displayName: 'Ann and Sam' }, 2);
  for (const [size, width, height] of sizes) {
    for (const scheme of ['light', 'dark']) {
      const { context, page } = await newPage(width, height, scheme);
      await page.goto(`${server.url}/#/settings/summaries`);
      await page.getByText('Ann and Sam, 2 people').waitFor();
      await page.getByLabel(/Wait for how many people/).waitFor();
      await fits(page, `${size} ${scheme} settings`);
      await page.screenshot({ path: join(out, `${size}-${scheme}-settings.png`), fullPage: true });
      await context.close();
    }
  }
  const { context, page } = await newPage(1440, 900, 'light');
  await page.goto(`${server.url}/#/settings/summaries`);
  const input = page.getByLabel(/Wait for how many people/);
  await input.fill('0');
  await page
    .locator('form.panel', { has: input })
    .getByRole('button', { name: 'Save changes' })
    .click();
  await page.getByText('Saved.').first().waitFor();
  assert.equal(await server.settings.get('summary.shared_wait_minutes'), '0');
  await page.getByText('Ann and Sam, 2 people').waitFor();
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await page.getByRole('button', { name: 'Forget' }).click();
  await page.getByText('Ann and Sam, 2 people').waitFor({ state: 'detached' });
  await context.close();
}

await browser.close();
await server.close();
console.log(`screenshots in ${out}`);
