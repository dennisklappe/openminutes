// Regenerates docs/images from the demo data: optimised webp, light and dark.
// Usage: pnpm --filter @openminutes/web build && node e2e/ui/docs-shots.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startDemo } from './demo-server.mjs';

const requireFrom = createRequire(
  new URL('apps/web/package.json', new URL('../../', import.meta.url)),
);
const { eq, inArray, meetings } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/db')).href
);

const root = new URL('../../', import.meta.url);
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const images = fileURLToPath(new URL('docs/images/', root));
const work = join(tmpdir(), 'docs-shots');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const { server, token, ids } = await startDemo({ summaryVersions: false });
// The long title fixture of the sweep is not a good example in the docs.
await server.db.delete(meetings).where(inArray(meetings.id, [ids.lobby.id]));
await server.db.delete(meetings).where(eq(meetings.title, 'Sprint demo'));
await server.db
  .update(meetings)
  .set({ company: 'Hartmann Logistics', companySource: 'manual' })
  .where(eq(meetings.id, ids.demo.id));
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const at = (path) => `${server.url}${path}`;
const click = (page, role, name) => page.getByRole(role, { name }).first().click();

async function shoot(name, { width, height, scale = 2, auth = true }, scheme, prepare) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: scheme,
    permissions: ['microphone'],
  });
  if (auth) await context.addCookies([server.cookie]);
  const page = await context.newPage();
  await prepare(page);
  await page.waitForTimeout(1200);
  const png = join(work, `${name}.png`);
  await page.screenshot({ path: png });
  execFileSync('cwebp', ['-q', '82', '-m', '6', '-quiet', png, '-o', join(images, `${name}.webp`)]);
  await context.close();
}

const desktop = { width: 1128, height: 720 };
const tall = { width: 1128, height: 1000 };
const phone = { width: 390, height: 700 };
const summaryTab = async (page) => {
  await page.goto(at(`/#/meetings/${ids.demo.id}`));
  await click(page, 'tab', 'Summary');
};
const transcriptTab = async (page) => {
  await page.goto(at(`/#/meetings/${ids.demo.id}`));
  await click(page, 'tab', 'Transcript');
};

for (const scheme of ['light', 'dark']) {
  await shoot(`minutes-library-${scheme}`, { width: 1128, height: 800 }, scheme, (p) =>
    p.goto(at('/#/minutes/company')),
  );
  await shoot(`minutes-library-m-${scheme}`, phone, scheme, (p) =>
    p.goto(at('/#/minutes/folders')),
  );
}
for (const scheme of ['light', 'dark']) {
  await shoot(`list-${scheme}`, desktop, scheme, (p) => p.goto(at('/#/')));
  await shoot(`list-narrow-${scheme}`, { width: 520, height: 520 }, scheme, (p) =>
    p.goto(at('/#/')),
  );
  await shoot(`meeting-${scheme}`, tall, scheme, summaryTab);
  await shoot(`transcript-${scheme}`, desktop, scheme, transcriptTab);
  await shoot(`meeting-m-${scheme}`, phone, scheme, summaryTab);
  await shoot(`transcript-m-${scheme}`, phone, scheme, transcriptTab);
  await shoot(`settings-${scheme}`, { width: 1128, height: 600 }, scheme, (p) =>
    p.goto(at('/#/settings/bot')),
  );
  await shoot(`phone-who-is-who-${scheme}`, { width: 390, height: 1000 }, scheme, async (p) => {
    await p.goto(at(`/#/meetings/${ids.demo.id}`));
    await p
      .getByRole('button', { name: 'Edit speakers' })
      .click({ timeout: 3000 })
      .catch(() => {});
  });
}
await shoot('summary-light', tall, 'light', summaryTab);
await shoot('summary-dark', tall, 'dark', summaryTab);
for (const scheme of ['light', 'dark']) {
  await shoot(
    `phone-record-${scheme}`,
    { width: 390, height: 844, scale: 1 },
    scheme,
    async (p) => {
      await p.goto(at('/#/record'));
      await click(p, 'button', 'Start recording');
      await click(p, 'button', 'I understand, start recording');
      await p.getByText('Recording', { exact: true }).waitFor();
    },
  );
  await shoot(`minutes-settings-${scheme}`, { width: 1200, height: 1400, scale: 1 }, scheme, (p) =>
    p.goto(at('/#/settings/minutes')),
  );
  await shoot(`email-settings-${scheme}`, { width: 1000, height: 1240, scale: 1 }, scheme, (p) =>
    p.goto(at('/#/settings/email')),
  );
  await shoot(
    `minutes-share-${scheme}`,
    { width: 1200, height: 1170, scale: 1 },
    scheme,
    async (p) => {
      await p.goto(at(`/#/meetings/${ids.demo.id}`));
      await p.waitForTimeout(500);
    },
  );
  for (const template of ['classic', 'modern', 'compact']) {
    await server.settings.set('minutes.template', template);
    await shoot(
      `minutes-${template}-${scheme}`,
      { width: 980, height: 1000, scale: 1 },
      scheme,
      (p) => p.goto(at(`/s/${token}`)),
    );
  }
  await shoot(
    `email-share-${scheme}`,
    { width: 1000, height: 917, scale: 1 },
    scheme,
    async (p) => {
      await p.goto(at(`/#/meetings/${ids.demo.id}`));
      await click(p, 'button', 'Share');
      await p.getByRole('dialog').waitFor();
    },
  );
  await shoot(
    `email-share-preview-${scheme}`,
    { width: 1000, height: 917, scale: 1 },
    scheme,
    async (p) => {
      await p.goto(at(`/#/meetings/${ids.demo.id}`));
      await click(p, 'button', 'Share');
      await p.getByRole('dialog').waitFor();
      await click(p, 'button', 'Preview email');
      await p.getByLabel('Preview').waitFor();
    },
  );
}
await browser.close();
await server.close();
console.log(`images written to ${images}`);
