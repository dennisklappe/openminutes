// Drives archive and bin in headless Chromium against the real web app on the demo data: the three
// dots menus on the Meetings list, the Minutes library and the meeting page, bulk selection, the
// confirmation texts, restore, delete forever, and that a binned meeting's share link stops working.
// It saves screenshots at 1440 and 390 px, light and dark.
// Usage: pnpm --filter @openminutes/web build && OUT=/path/to/shots node e2e/ui/archive.mjs
/* global document, window */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startDemo } from './demo-server.mjs';

const root = new URL('../../', import.meta.url);
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'archive-shots');
mkdirSync(out, { recursive: true });
const step = (name) => console.log(`== ${name}`);

const requireFrom = createRequire(new URL('apps/web/package.json', root));
const { eq, meetings } = await import(pathToFileURL(requireFrom.resolve('@openminutes/db')).href);
const { server, token, ids } = await startDemo({ summaryVersions: false });
const browser = await chromium.launch();
const at = (path) => `${server.url}${path}`;

async function open(scheme, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
  await context.addCookies([server.cookie]);
  return { context, page: await context.newPage() };
}

const { context, page } = await open('light', { width: 1440, height: 900 });
const dialog = () => page.getByRole('dialog');
const row = (title) => page.locator('tbody tr', { hasText: title });
const minute = (title) => page.locator('.minute', { hasText: title });
const rowMenu = async (locator, title, item) => {
  await locator.getByRole('button', { name: `Actions for ${title}` }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
};
const overflow = (label, target = page) =>
  target
    .evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    .then((px) => {
      assert.ok(px <= 0, `${label} scrolls sideways by ${px}px`);
    });
const BILLING = 'Billing export and release sync';

step('a running meeting has no archive or delete');
await page.goto(at('/#/'));
await row('Board prep').waitFor();
await row('Board prep')
  .getByRole('button', { name: /Actions for/ })
  .click();
await page.getByRole('menuitem', { name: 'Open' }).waitFor();
assert.equal(await page.getByRole('menuitem', { name: 'Archive' }).count(), 0);
assert.equal(await page.getByRole('menuitem', { name: 'Delete' }).count(), 0);
await page.keyboard.press('Escape');
await page.goto(at(`/#/meetings/${ids.processing.id}`));
await page.getByRole('heading', { name: 'Retro' }).waitFor();
assert.equal(await page.getByRole('button', { name: 'More' }).count(), 0);

step('archive from the Meetings list, find it in the Archive, unarchive');
await page.goto(at('/#/'));
await row(BILLING).waitFor();
await rowMenu(row(BILLING), BILLING, 'Archive');
await page.getByRole('status').getByText('1 meeting archived').waitFor();
await row(BILLING).waitFor({ state: 'detached' });
await page.getByRole('link', { name: 'Archive', exact: true }).first().click();
await page.getByRole('heading', { name: 'Archive' }).waitFor();
await page.locator('tbody tr', { hasText: BILLING }).waitFor();
assert.equal(
  await page
    .getByRole('link', { name: 'Archive', exact: true })
    .first()
    .getAttribute('aria-current'),
  'page',
);

step('an archived meeting stays whole and its share link keeps working');
await page.getByRole('link', { name: BILLING }).click();
await page.getByText('This meeting is in the archive').waitFor();
assert.equal((await page.request.get(at(`/s/${token}`))).status(), 200);
await page.getByRole('button', { name: 'Unarchive' }).first().click();
await page.getByText('This meeting is in the archive').waitFor({ state: 'detached' });
await page.goto(at('/#/minutes'));
await minute(BILLING).waitFor();

step('archive from the Minutes library, hidden from search');
await rowMenu(minute(BILLING), BILLING, 'Archive');
await minute(BILLING).waitFor({ state: 'detached' });
await page.getByLabel('Search minutes').fill('release sync');
await page.getByText('No minutes match').waitFor();
await page.getByLabel('Search minutes').fill('');
await page.goto(at('/#/archive'));
await page.locator('tbody tr', { hasText: BILLING }).waitFor();
await rowMenu(page.locator('tbody tr', { hasText: BILLING }), BILLING, 'Unarchive');
await page.getByText('The archive is empty').waitFor();

step('delete asks first and says what happens');
await page.goto(at('/#/'));
await rowMenu(row(BILLING), BILLING, 'Delete');
await dialog().getByRole('heading', { name: 'Delete this meeting?' }).waitFor();
const text = await dialog().innerText();
assert.match(
  text,
  /moves to the bin for 30 days, then deleted forever\. The share link\s+stops working now\./,
);
assert.match(text, /calendar events/);
await dialog().getByRole('button', { name: 'Cancel' }).click();
await row(BILLING).waitFor();
assert.equal((await page.request.get(at(`/s/${token}`))).status(), 200);

step('delete moves it to the bin and the share link stops at once');
await rowMenu(row(BILLING), BILLING, 'Delete');
await dialog().getByRole('button', { name: 'Move to bin' }).click();
await row(BILLING).waitFor({ state: 'detached' });
assert.equal((await page.request.get(at(`/s/${token}`))).status(), 404);
await page.getByRole('link', { name: /^Bin/ }).first().click();
await page.getByRole('heading', { name: 'Bin' }).waitFor();
const binned = page.locator('tbody tr', { hasText: BILLING });
await binned.getByText('30 days', { exact: true }).waitFor();
assert.equal(await binned.getByRole('link').count(), 0, 'a binned meeting does not open');
await page.goto(at(`/#/meetings/${ids.demo.id}`));
await page.locator('.error').waitFor();

step('restore brings it back');
await page.goto(at('/#/bin'));
await rowMenu(page.locator('tbody tr', { hasText: BILLING }), BILLING, 'Restore');
await page.getByText('The bin is empty').waitFor();
await page.goto(at('/#/'));
await row(BILLING).waitFor();

step('delete from the meeting page, then delete forever from the bin');
await page.goto(at(`/#/meetings/${ids.phone.id}`));
await page.getByRole('heading', { name: 'Kitchen table chat' }).waitFor();
await page.getByRole('button', { name: 'More' }).click();
await page.getByRole('menuitem', { name: 'Delete meeting' }).click();
await dialog().getByRole('button', { name: 'Move to bin' }).click();
await page.getByRole('heading', { name: 'Meetings' }).waitFor();
await page.goto(at('/#/bin'));
const phone = page.locator('tbody tr', { hasText: 'Kitchen table chat' });
await phone.waitFor();
await rowMenu(phone, 'Kitchen table chat', 'Delete forever');
await dialog().getByRole('heading', { name: 'Delete forever?' }).waitFor();
assert.match(await dialog().innerText(), /cannot be undone/);
await dialog().getByRole('button', { name: 'Delete forever' }).click();
await page.getByText('The bin is empty').waitFor();

step('select several in the Meetings list and archive them together');
await page.goto(at('/#/'));
await row(BILLING).waitFor();
await page.getByRole('button', { name: 'Select', exact: true }).click();
await page.getByLabel(`Select ${BILLING}`).check();
await page.getByLabel('Select Northwind all hands').check();
await page.getByText('2 selected').waitFor();
await page.getByRole('toolbar').getByRole('button', { name: 'Archive' }).click();
await page.getByText('2 meetings archived').waitFor();
await page.goto(at('/#/archive'));
await page.locator('tbody tr').nth(1).waitFor();

step('select all in the archive and delete, then empty the bin');
await page.getByLabel('Select all meetings').check();
await page.getByRole('toolbar').getByRole('button', { name: 'Delete' }).click();
await dialog().getByRole('button', { name: 'Move to bin' }).click();
await page.getByText('The archive is empty').waitFor();
await page.goto(at('/#/bin'));
await page.locator('tbody tr').nth(1).waitFor();
await page.getByLabel('Select all meetings').check();
await page.getByRole('toolbar').getByRole('button', { name: 'Delete forever' }).click();
await dialog().getByRole('heading', { name: 'Delete forever?' }).waitFor();
await dialog().getByRole('button', { name: 'Delete forever' }).click();
await page.getByText('The bin is empty').waitFor();

step('select and delete in the Minutes library');
await page.goto(at('/#/minutes'));
await minute('Board update').waitFor();
await page.getByRole('button', { name: 'Select', exact: true }).click();
await page.getByLabel('Select Board update').check();
await page.getByRole('toolbar').getByRole('button', { name: 'Delete' }).click();
await dialog().getByRole('button', { name: 'Move to bin' }).click();
await minute('Board update').waitFor({ state: 'detached' });
await context.close();

step('screenshots of a filled archive and bin');
const DAY_MS = 86_400_000;
const rows = (await server.db.select().from(meetings)).filter(
  (m) => m.status === 'transcribed' && !m.archivedAt && !m.deletedAt,
);
const flag = (list, make) =>
  Promise.all(
    list.map((m, index) =>
      server.db.update(meetings).set(make(index)).where(eq(meetings.id, m.id)),
    ),
  );
await flag(rows.slice(0, 4), (index) => ({
  archivedAt: new Date(Date.now() - (index + 1) * 9 * DAY_MS),
}));
await flag(rows.slice(4, 7), (index) => ({
  deletedAt: new Date(Date.now() - [2, 12, 29][index] * DAY_MS),
}));
const archivedTitle = rows[0].title;

for (const scheme of ['light', 'dark']) {
  for (const [name, viewport] of [
    ['1440', { width: 1440, height: 900 }],
    ['390', { width: 390, height: 844 }],
  ]) {
    const shot = await open(scheme, viewport);
    const p = shot.page;
    const snap = async (label) => {
      await p.waitForTimeout(300);
      await p.screenshot({ path: join(out, `${label}-${scheme}-${name}.png`) });
      await overflow(`${label} ${scheme} ${name}`, p);
    };
    await p.goto(at('/#/archive'));
    await p.locator('tbody tr').nth(3).waitFor();
    await snap('archive');
    await p.locator('tbody input[type="checkbox"]').first().check();
    await snap('archive-selected');
    await p.goto(at('/#/bin'));
    await p.locator('tbody tr').nth(2).waitFor();
    await p
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: /Actions for/ })
      .click();
    await snap('bin-menu');
    await p.keyboard.press('Escape');
    await p.locator('tbody input[type="checkbox"]').first().check();
    await snap('bin-selected');
    await p.goto(at('/#/'));
    await p.locator('tbody tr').first().waitFor();
    await p
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: /Actions for/ })
      .click();
    await snap('meetings-menu');
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'Select', exact: true }).click();
    await snap('meetings-select');
    await p.goto(at('/#/minutes'));
    await p.locator('.minute').first().waitFor();
    await p
      .locator('.minute')
      .first()
      .getByRole('button', { name: /Actions for/ })
      .click();
    await snap('minutes-menu');
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: 'Select', exact: true }).click();
    await p.locator('.minute-check').first().check();
    await snap('minutes-select');
    await p.locator('.selection-bar').getByRole('button', { name: 'Delete' }).click();
    await p.getByRole('dialog').waitFor();
    await snap('confirm-delete');
    await p.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await p.goto(at('/#/archive'));
    await p.getByRole('link', { name: archivedTitle }).first().click();
    await p.getByText('This meeting is in the archive').waitFor();
    await snap('detail-archived');
    await shot.context.close();
  }
}

await browser.close();
await server.close();
console.log(`archive and bin UI checks passed, screenshots in ${out}`);
