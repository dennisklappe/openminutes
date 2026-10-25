// Regenerates the product screenshots of the website from the demo data: webp, light and dark.
// Usage: pnpm build && node e2e/ui/site-shots.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import console from 'node:console';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startDemo } from './demo-server.mjs';

const root = new URL('../../', import.meta.url);
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const images = fileURLToPath(new URL('site/public/images/', root));
const work = join(tmpdir(), 'site-shots');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const requireFrom = createRequire(new URL('apps/web/package.json', root));
const { eq, inArray, meetings } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/db')).href
);

const { server, ids } = await startDemo({ summaryVersions: false });
await server.db
  .delete(meetings)
  .where(inArray(meetings.id, [ids.lobby.id, ids.processing.id, ids.failed.id]));
await server.db.delete(meetings).where(eq(meetings.title, 'Sprint demo'));
await server.db
  .update(meetings)
  .set({ company: 'Hartmann Logistics', companySource: 'manual' })
  .where(eq(meetings.id, ids.demo.id));
const browser = await chromium.launch();

const desktop = { width: 1128 };
const phone = { width: 390, height: 700 };
const meeting = (tab) => async (page) => {
  await page.goto(`${server.url}/#/meetings/${ids.demo.id}`);
  await page.getByRole('tab', { name: tab }).first().click();
};
const shots = [
  ['list', { ...desktop, height: 720 }, (page) => page.goto(`${server.url}/#/`)],
  ['transcript', { ...desktop, height: 720 }, meeting('Transcript')],
  [
    'settings',
    { ...desktop, height: 600 },
    (page) => page.goto(`${server.url}/#/settings/transcription`),
  ],
  ['meeting', { ...desktop, height: 880 }, meeting('Summary')],
  ['meeting-m', phone, meeting('Summary')],
  ['transcript-m', phone, meeting('Transcript')],
  [
    'minutes-library',
    { ...desktop, height: 800 },
    (page) => page.goto(`${server.url}/#/minutes/company`),
  ],
  ['minutes-library-m', phone, (page) => page.goto(`${server.url}/#/minutes/company`)],
];

for (const scheme of ['light', 'dark']) {
  for (const [name, viewport, prepare] of shots) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      colorScheme: scheme,
    });
    await context.addCookies([server.cookie]);
    const page = await context.newPage();
    await prepare(page);
    await page.waitForTimeout(1200);
    const png = join(work, `${name}-${scheme}.png`);
    await page.screenshot({ path: png });
    execFileSync('cwebp', [
      '-q',
      '78',
      '-m',
      '6',
      '-quiet',
      png,
      '-o',
      join(images, `${name}-${scheme}.webp`),
    ]);
    await context.close();
  }
}
await browser.close();
await server.close();
console.log(`images written to ${images}`);
