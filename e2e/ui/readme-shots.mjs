// Regenerates the README screenshots from the demo data: optimised webp, light and dark.
// Usage: pnpm build && node e2e/ui/readme-shots.mjs
/* global document, window */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startDemo } from './demo-server.mjs';

const root = new URL('../../', import.meta.url);
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const images = fileURLToPath(new URL('docs/images/readme/', root));
const work = join(tmpdir(), 'readme-shots');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(images, { recursive: true });

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
  .set({ company: 'Kestrel' })
  .where(eq(meetings.company, 'Kestrel B.V.'));
await server.db
  .update(meetings)
  .set({ company: 'Hartmann Logistics', companySource: 'manual' })
  .where(eq(meetings.id, ids.demo.id));
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const at = (path) => `${server.url}${path}`;
const click = (page, role, name) => page.getByRole(role, { name }).first().click();

async function shoot(name, viewport, scheme, prepare) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: scheme,
    permissions: ['microphone'],
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

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };
// Tall enough to show the whole Minutes card in the right column.
const tallDesktop = { width: 1440, height: 1160 };
const meeting = (tab) => async (page) => {
  await page.goto(at(`/#/meetings/${ids.demo.id}`));
  await click(page, 'tab', tab);
};

for (const scheme of ['light', 'dark']) {
  await shoot('meetings', desktop, scheme, (p) => p.goto(at('/#/')));
  await shoot('transcript', tallDesktop, scheme, meeting('Transcript'));
  await shoot('summary', tallDesktop, scheme, meeting('Summary'));
  await shoot('share', desktop, scheme, async (p) => {
    await meeting('Summary')(p);
    await click(p, 'button', 'Share');
    await p.getByRole('dialog').waitFor();
  });
  await shoot('library', desktop, scheme, (p) => p.goto(at('/#/minutes/company')));
  await shoot('settings-bot', desktop, scheme, (p) => p.goto(at('/#/settings/bot')));
  await shoot('settings-transcription', desktop, scheme, (p) =>
    p.goto(at('/#/settings/transcription')),
  );
  await shoot('mobile-meetings', phone, scheme, (p) => p.goto(at('/#/')));
  await shoot('mobile-transcript', phone, scheme, async (p) => {
    await meeting('Transcript')(p);
    await p.locator('.transcript > li').first().waitFor();
    await p.evaluate(() => {
      const top = document.querySelector('.transcript')?.getBoundingClientRect().top ?? 0;
      window.scrollTo(0, top + window.scrollY - 112);
    });
  });
  await shoot('mobile-who-is-who', { width: 390, height: 1000 }, scheme, async (p) => {
    await p.goto(at(`/#/meetings/${ids.demo.id}`));
    await p
      .getByRole('button', { name: 'Edit speakers' })
      .click({ timeout: 3000 })
      .catch(() => {});
  });
  await shoot('mobile-recorder', phone, scheme, async (p) => {
    await p.goto(at('/#/record'));
    await click(p, 'button', 'Start recording');
    await click(p, 'button', 'I understand, start recording');
    await p.getByText('Recording', { exact: true }).waitFor();
  });
}
await browser.close();
await server.close();
console.log(`images written to ${images}`);
