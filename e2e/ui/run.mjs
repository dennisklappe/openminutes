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
const { eq, meetings, participants, transcriptSegments, summaries } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/db')).href
);
const { saveProviderSettings } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/core')).href
);

const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'ui-shots');
const uiDir = fileURLToPath(new URL('apps/web/dist/ui', new URL('../../', import.meta.url)));
mkdirSync(out, { recursive: true });
const step = (name) => console.log(`== ${name}`);

const AI_V1 = `### Summary

The team agreed to ship the new onboarding flow next week.

### Action items

| Owner | Task | Due |
| --- | --- | --- |
| Sam | Prepare the release notes | Wednesday (28 Oct) |
| Priya | Review the pricing page | Not specified |
`;
const AI_V3 = '### Summary\n\nA freshly generated summary of the planning meeting.\n';

const server = await startRealServer({ uiDir });
const { db, settings } = server;
await saveProviderSettings(settings, 'summary', 'anthropic', {
  apiKey: 'sk-test',
  model: 'model-test',
});

const [meeting] = await db
  .insert(meetings)
  .values({
    title: 'Quarterly planning',
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
await db.insert(transcriptSegments).values([
  {
    meetingId: meeting.id,
    participantId: alex.id,
    startMs: 0,
    endMs: 4000,
    text: 'Shall we ship onboarding next week?',
  },
  {
    meetingId: meeting.id,
    participantId: sam.id,
    startMs: 4500,
    endMs: 9000,
    text: 'Yes, I will prepare the release notes by Wednesday.',
  },
]);
const [first] = await db
  .insert(summaries)
  .values({
    meetingId: meeting.id,
    provider: 'openai',
    model: 'gpt-test',
    status: 'done',
    content: AI_V1,
  })
  .returning();

const browser = await chromium.launch();
const fail = [];
const shots = [];

async function session(width, height, colorScheme) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme });
  await context.addCookies([server.cookie]);
  const page = await context.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  return page;
}
const shot = async (page, name) => {
  const path = join(out, `${name}.png`);
  shots.push(path);
  await page.screenshot({ path, fullPage: true });
};

async function checkPairs(page, label) {
  const bad = await page.evaluate(() =>
    // eslint-disable-next-line no-undef
    [...document.querySelectorAll('.field-row')].flatMap((row) => {
      const fields = [...row.querySelectorAll(':scope > .field')];
      const boxes = fields.map((field) => ({
        label: field.querySelector('span')?.getBoundingClientRect(),
        input: field.querySelector('input, select, textarea')?.getBoundingClientRect(),
      }));
      return boxes.flatMap((a, i) =>
        boxes.slice(i + 1).flatMap((b) => {
          if (!a.label || !b.label || !a.input || !b.input) return [];
          if (Math.abs(a.label.top - b.label.top) > 1) return [];
          const same =
            Math.abs(a.input.top - b.input.top) < 1 &&
            Math.abs(a.input.height - b.input.height) < 1;
          return same
            ? []
            : [`${a.input.top}/${a.input.height} vs ${b.input.top}/${b.input.height}`];
        }),
      );
    }),
  );
  assert.deepEqual(bad, [], `paired fields are misaligned on ${label}`);
}

for (const [width, height, size] of [
  [1440, 900, 'desktop'],
  [390, 844, 'phone'],
]) {
  for (const scheme of ['light', 'dark']) {
    const tag = `${size}-${scheme}`;
    step(`settings alignment ${tag}`);
    const page = await session(width, height, scheme);
    for (const section of ['email', 'bot', 'calendars', 'storage', 'minutes', 'general']) {
      await page.goto(`${server.url}/#/settings/${section}`);
      await page.locator('.card').first().waitFor();
      await page.waitForTimeout(300);
      await checkPairs(page, `${section} ${tag}`);
      if (section === 'email') await shot(page, `settings-email-${tag}`);
    }
    await page.context().close();
  }
}

for (const [width, height, size, scheme] of [
  [1440, 900, 'desktop', 'light'],
  [390, 844, 'phone', 'dark'],
]) {
  step(`settings cards share one save pattern, ${size}`);
  const page = await session(width, height, scheme);
  const goto = async (section) => {
    await page.goto(`${server.url}/#/settings/${section}`);
    await page.reload();
    await page.locator('.card').first().waitFor();
    await page.waitForTimeout(400);
  };
  for (const section of [
    'general',
    'bot',
    'minutes',
    'email',
    'summaries',
    'phone',
    'storage',
    'access',
    'transcription',
    'google-meet',
  ]) {
    await goto(section);
    const cards = await page.locator('.card').evaluateAll((nodes) =>
      nodes.map((node) => ({
        title: node.querySelector('h3')?.textContent ?? '',
        editable: Boolean(
          node.querySelector('input[type=checkbox], select, textarea, input:not([type=file])'),
        ),
        save: [...node.querySelectorAll('button')].find((b) => b.textContent === 'Save changes'),
        saveDisabled: [...node.querySelectorAll('button')].find(
          (b) => b.textContent === 'Save changes',
        )?.disabled,
        form: node.tagName === 'FORM',
      })),
    );
    for (const card of cards) {
      if (card.save) {
        assert.ok(card.form, `${section}: ${card.title} has Save changes outside a form`);
        assert.equal(card.saveDisabled, true, `${section}: ${card.title} starts dirty`);
      }
    }
    assert.equal(
      await page
        .getByRole('button', { name: /^Save (and use|credentials|sign-in details)$/ })
        .count(),
      0,
      `${section}: an old save label is left`,
    );
    const overflow = await page
      .locator('html')
      .evaluate((root) => root.scrollWidth - root.clientWidth);
    assert.ok(overflow <= 0, `${section} scrolls sideways on ${size}`);
  }

  await goto('summaries');
  const chat = page.getByLabel('Give the summary model the meeting chat');
  const chatCard = page.locator('form.card', { has: chat });
  const save = chatCard.getByRole('button', { name: 'Save changes' });
  assert.ok(await save.isDisabled(), 'Save changes waits for an edit');
  const before = await chat.isChecked();
  await chat.setChecked(!before);
  assert.ok(await save.isEnabled(), 'an edit enables Save changes');
  await goto('summaries');
  assert.equal(await chat.isChecked(), before, 'a checkbox must not save by itself');
  await chat.setChecked(!before);
  await save.click();
  await chatCard.getByText('Saved.').waitFor();
  assert.ok(await save.isDisabled(), 'Save changes is off again once saved');
  await goto('summaries');
  assert.equal(await chat.isChecked(), !before, 'the saved value stays');
  await chat.setChecked(before);
  await save.click();
  await chatCard.getByText('Saved.').waitFor();

  await goto('general');
  const limit = page.getByLabel('Parallel meetings');
  const limits = page.locator('form.card', { has: limit });
  await limit.fill(String(Number(await limit.inputValue()) + 1));
  await limit.press('Enter');
  await limits.getByText('Saved.').waitFor();
  assert.ok(await limits.getByRole('button', { name: 'Save changes' }).isDisabled());

  await goto('minutes');
  assert.equal(await page.getByText('Minutes link in the calendar').count(), 0, 'one Export card');
  const exportCard = page.locator('form.card', { has: page.getByLabel('Export target') });
  const auto = exportCard.getByLabel('Create the minutes automatically when a summary is ready');
  const link = exportCard.getByLabel('Add the minutes link to the calendar event');
  assert.ok(await link.isDisabled(), 'the link switch waits for the main switch');
  await auto.setChecked(true);
  assert.ok((await link.isEnabled()) && (await link.isChecked()), 'switching on ticks the link');
  await exportCard.getByRole('button', { name: 'Save changes' }).click();
  await exportCard.getByText('Saved.').waitFor();
  await goto('minutes');
  assert.ok((await auto.isChecked()) && (await link.isChecked()), 'the export switches persist');
  await auto.setChecked(false);
  await exportCard.getByRole('button', { name: 'Save changes' }).click();
  await exportCard.getByText('Saved.').waitFor();
  await goto('minutes');
  assert.ok(!(await auto.isChecked()) && !(await link.isChecked()), 'off means nothing automatic');
  await shot(page, `settings-export-${size}-${scheme}`);
  await page.context().close();
}

step('summary versions flow');
const page = await session(1440, 900, 'light');
await page.goto(`${server.url}/#/meetings/${meeting.id}`);
await page.getByRole('tab', { name: 'Summary' }).click();
await page.getByText('Version 1').first().waitFor();
await shot(page, 'summary-v1-light');

await page.getByRole('button', { name: 'Edit summary' }).click();
await page.getByLabel('Summary in Markdown').first().fill('### Summary\n\nEdited by hand.\n');
await shot(page, 'summary-editing-light');
await page.getByRole('button', { name: 'Save as new version' }).click();
await page.getByText('Version 2').first().waitFor();
await page.getByText('edited by you').first().waitFor();
assert.equal(await page.locator('.history-list li').count(), 2);

step('regenerate asks first and keeps history');
await page.getByRole('button', { name: 'Regenerate' }).click();
const dialog = page.getByRole('dialog');
await dialog.waitFor();
assert.match(
  await dialog.innerText(),
  /Your edited version stays in History and you can restore it\. Shared links will show the new version\./,
);
await shot(page, 'regenerate-confirm-light');
await dialog.getByRole('button', { name: 'Cancel' }).click();
assert.equal(await page.locator('.history-list li').count(), 2);
await page.getByRole('button', { name: 'Regenerate' }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Regenerate as new version' }).click();
await page.getByText('Summarising, this can take a minute.').waitFor();
assert.equal(await page.getByRole('button', { name: 'Edit summary' }).isDisabled(), true);
await db
  .update(summaries)
  .set({ status: 'done', content: AI_V3 })
  .where(eq(summaries.status, 'pending'));
await page.getByText('Version 3').first().waitFor({ timeout: 20_000 });
await page.getByText('AI (model-test)').first().waitFor();
assert.equal(await page.locator('.history-list li').count(), 3);
await shot(page, 'summary-v3-light');

step('restore');
await page.locator('.history-list li').nth(2).getByRole('button', { name: 'View' }).click();
await page.getByText('You are looking at an older version').waitFor();
await page.locator('.history-list li').nth(2).getByRole('button', { name: 'Restore' }).click();
const restore = page.getByRole('dialog');
await restore.waitFor();
await shot(page, 'restore-confirm-light');
await restore.getByRole('button', { name: 'Restore as new version' }).click();
await page.getByText('restored from version 1').first().waitFor();
const rows = await db.select().from(summaries).where(eq(summaries.meetingId, meeting.id));
assert.equal(rows.length, 4);
assert.ok(rows.some((row) => row.id === first.id && row.content === AI_V1));
await shot(page, 'summary-restored-light');

step('transcript card menus');
await page.getByRole('tab', { name: 'Transcript' }).click();
await page.getByRole('button', { name: 'Download' }).last().click();
const items = await page.getByRole('menuitem').allInnerTexts();
assert.deepEqual(items, [
  'HTML',
  'Markdown',
  'Word',
  'Transcript only (Markdown)',
  'Transcript only (JSON)',
]);
await page.keyboard.press('Escape');
await shot(page, 'transcript-menus-light');
await page.getByRole('button', { name: 'More' }).click();
assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['Archive', 'Delete meeting']);
await page.context().close();

for (const [width, height, size] of [
  [1440, 900, 'desktop'],
  [390, 844, 'phone'],
]) {
  for (const scheme of ['light', 'dark']) {
    const view = await session(width, height, scheme);
    await view.goto(`${server.url}/#/meetings/${meeting.id}`);
    await view.getByRole('tab', { name: 'Summary' }).click();
    await view.getByText('Version 4').first().waitFor();
    await shot(view, `meeting-summary-${size}-${scheme}`);
    await view.getByRole('tab', { name: 'Transcript' }).click();
    await view.getByRole('button', { name: 'Download' }).last().click();
    await shot(view, `meeting-transcript-menu-${size}-${scheme}`);
    await view.context().close();
  }
}

await browser.close();
await server.close();
assert.deepEqual(fail, [], 'page errors');
console.log(`ok, ${String(shots.length)} screenshots in ${out}`);
