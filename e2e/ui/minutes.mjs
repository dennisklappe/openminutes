// Drives the Minutes tab in headless Chromium against the real web app on the demo data: the four
// views, search, folders, the company prompt and the rename/merge tool. It saves screenshots at
// 1440 and 390 px, light and dark.
// Usage: pnpm --filter @openminutes/web build && OUT=/path/to/shots node e2e/ui/minutes.mjs
/* global document, window, DataTransfer */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { startDemo } from './demo-server.mjs';

const root = new URL('../../', import.meta.url);
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'minutes-shots');
mkdirSync(out, { recursive: true });
const step = (name) => console.log(`== ${name}`);

const { server } = await startDemo({ summaryVersions: false });
const browser = await chromium.launch();
const at = (path) => `${server.url}${path}`;

async function open(scheme, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
  await context.addCookies([server.cookie]);
  return { context, page: await context.newPage() };
}

for (const scheme of ['light', 'dark']) {
  for (const [name, viewport] of [
    ['1440', { width: 1440, height: 900 }],
    ['390', { width: 390, height: 844 }],
  ]) {
    const shot = await open(scheme, viewport);
    for (const view of ['date', 'company', 'person', 'folders']) {
      step(`screenshot ${view} ${scheme} ${name}`);
      await shot.page.goto(at(`/#/minutes/${view}`));
      await shot.page.locator('.group').first().waitFor();
      await shot.page.waitForTimeout(300);
      const overflow = await shot.page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      assert.ok(overflow <= 0, `${view} ${scheme} ${name} scrolls sideways by ${overflow}px`);
      await shot.page.screenshot({ path: join(out, `${view}-${scheme}-${name}.png`) });
    }
    await shot.context.close();
  }
}

const { context, page } = await open('light', { width: 1440, height: 900 });
const group = (name) => page.locator('.group', { has: page.getByRole('button', { name }) }).first();
const rowTitles = () => page.locator('.minute .minute-title').allInnerTexts();
const dialog = () => page.getByRole('dialog');

step('lists only transcribed minutes');
await page.goto(at('/#/minutes'));
await page.getByRole('heading', { name: 'Minutes' }).waitFor();
await page.locator('.minute').first().waitFor();
const titles = await rowTitles();
assert.ok(titles.includes('Billing export and release sync'), 'the seeded demo minute is listed');
for (const hidden of ['Vendor security questionnaire', 'Standup', 'Sprint demo']) {
  assert.ok(!titles.includes(hidden), `${hidden} has no transcript and stays out`);
}
assert.equal(
  await page
    .getByRole('link', { name: 'Minutes', exact: true })
    .first()
    .getAttribute('aria-current'),
  'page',
);

step('search and filters');
await page.getByLabel('Search minutes').fill('brightline');
await page.waitForFunction(() => document.querySelectorAll('.minute').length === 2);
assert.deepEqual((await rowTitles()).sort(), [
  'Brightline invoice question',
  'Supplier call: Brightline',
]);
await page.getByLabel('Search minutes').fill('');
await page.getByRole('group', { name: 'Platform' }).getByRole('button', { name: 'Phone' }).click();
await page.waitForFunction(() => document.querySelectorAll('.minute').length === 1);
await page.getByRole('group', { name: 'Platform' }).getByRole('button', { name: 'All' }).click();
await page.waitForFunction(() => document.querySelectorAll('.minute').length > 20);

step('date view groups per month when there are many');
const month = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
await page.getByLabel('Group by').selectOption('month');
await group(new RegExp(month)).waitFor();
await page.getByLabel('Group by').selectOption('auto');

step('company view with an unknown bucket');
await page.goto(at('/#/minutes/company'));
await group(/Hartmann Logistics/).waitFor();
await group(/Unknown company/).waitFor();

step('answer which company inline');
const unknown = group(/Unknown company/);
await unknown.getByRole('button', { name: 'Which company?' }).first().click();
await dialog().getByLabel('Company').fill('Acme');
await dialog().getByRole('button', { name: 'Save' }).click();
await dialog().waitFor({ state: 'detached' });
await group(/Acme/).waitFor();

step('merge two spellings of a company');
assert.ok(await page.getByText('Kestrel B.V.', { exact: true }).first().isVisible());
await group(/Kestrel B\.V\./)
  .getByRole('button', { name: /Actions for Kestrel B\.V\./ })
  .click();
await page.getByRole('menuitem', { name: 'Rename or merge' }).click();
await dialog().getByLabel('New name').fill('Kestrel');
await dialog().getByRole('button', { name: 'Rename' }).click();
await dialog().waitFor({ state: 'detached' });
await page.waitForFunction(
  () =>
    ![...document.querySelectorAll('.group-title')].some((t) => t.textContent === 'Kestrel B.V.'),
);
assert.equal(await page.locator('.group-title', { hasText: /^Kestrel$/ }).count(), 1);

step('person view lists a minute under every person');
await page.goto(at('/#/minutes/person'));
await group(/Priya Nair/).waitFor();

step('folders: create, move through the menu, drag, delete');
await page.goto(at('/#/minutes/folders'));
await group(/Clients/).waitFor();
await group(/Unfiled/).waitFor();
await page.getByRole('button', { name: 'New folder' }).click();
await dialog().getByLabel('Folder name').fill('Archive');
await dialog().getByRole('button', { name: 'Create' }).click();
await dialog().waitFor({ state: 'detached' });
await group(/Archive/).waitFor();

const board = page.locator('.minute', { hasText: 'Board update' });
await board.getByRole('button', { name: /Actions for Board update/ }).click();
await page.getByRole('menuitem', { name: 'Move to folder' }).click();
await dialog().getByRole('button', { name: 'Archive' }).click();
await dialog().waitFor({ state: 'detached' });
await group(/Archive/)
  .locator('.minute', { hasText: 'Board update' })
  .waitFor();

const offsite = page.locator('.minute', { hasText: 'Northwind all hands' });
const transfer = await page.evaluateHandle(() => new DataTransfer());
const archiveHead = group(/Archive/)
  .locator('.group-head')
  .first();
await offsite.dispatchEvent('dragstart', { dataTransfer: transfer });
await archiveHead.dispatchEvent('dragover', { dataTransfer: transfer });
await archiveHead.dispatchEvent('drop', { dataTransfer: transfer });
await group(/Archive/)
  .locator('.minute', { hasText: 'Northwind all hands' })
  .waitFor();

await group(/Archive/)
  .getByRole('button', { name: /Actions for folder Archive/ })
  .click();
await page.getByRole('menuitem', { name: 'Delete folder' }).click();
await page.getByRole('button', { name: 'Delete folder', exact: true }).click();
await page.waitForFunction(
  () => ![...document.querySelectorAll('.group-title')].some((t) => t.textContent === 'Archive'),
);
await group(/Unfiled/)
  .locator('.minute', { hasText: 'Board update' })
  .waitFor();

step('the meeting page asks for a missing company');
await page.goto(at('/#/minutes/company'));
await group(/Unknown company/)
  .locator('.minute-main')
  .first()
  .click();
await page.getByRole('heading', { name: 'Which company is this?' }).waitFor();
await page.getByRole('combobox', { name: 'Company' }).fill('Globex');
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('Globex', { exact: true }).waitFor();
await page.getByText('set by you').waitFor();
await context.close();

await browser.close();
await server.close();
console.log(`minutes library UI checks passed, screenshots in ${out}`);
