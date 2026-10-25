// A list poll that was sent before a delete and answers after it must not bring the row back.
// It holds one pre-delete list response, deletes from the three dots menu, then releases it.
// Usage: pnpm --filter @openminutes/web build && node e2e/ui/stale-list.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startDemo } from './demo-server.mjs';

const root = new URL('../../', import.meta.url);
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const { server } = await startDemo({ summaryVersions: false });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([server.cookie]);
const page = await context.newPage();
const TITLE = 'Billing export and release sync';
const row = page.locator('tbody tr', { hasText: TITLE });

let release;
const held = new Promise((resolve) => {
  release = resolve;
});
let armed = false;
let stale;
const isList = (url) => new URL(url).pathname === '/api/meetings';
const staleHeld = new Promise((resolve) => {
  stale = resolve;
});
await page.route(isList, async (route) => {
  if (!armed) return route.continue();
  armed = false;
  const response = await route.fetch();
  stale();
  await held;
  await route.fulfill({ response });
});

await page.goto(`${server.url}/#/`);
await row.waitFor();
armed = true;
await staleHeld;
await row.getByRole('button', { name: `Actions for ${TITLE}` }).click();
await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Move to bin' }).click();
await page.getByRole('status').getByText('1 meeting moved to the bin').waitFor();
await row.waitFor({ state: 'detached' });
release();
await page.waitForTimeout(500);
assert.equal(await row.count(), 0, 'a stale list response brought the deleted meeting back');

await browser.close();
await server.close();
console.log('stale list check passed');
