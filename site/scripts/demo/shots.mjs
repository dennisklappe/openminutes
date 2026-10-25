// Saves the no-JS fallback screenshots of the hero demo, light and dark, wide and narrow.
// Usage: node scripts/demo/shots.mjs <site url>, with the site built and served, for example by `astro preview`.
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/demo/shots.mjs <site url>');
  process.exit(1);
}
const images = fileURLToPath(new URL('../../public/images/', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'demo-shots-'));
const browser = await chromium.launch();
for (const [name, width] of [
  ['demo', 1440],
  ['demo-m', 390],
]) {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 2,
      colorScheme: scheme,
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForSelector('.omd .shell');
    await page.locator('[data-demo]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const png = join(work, `${name}-${scheme}.png`);
    await page.locator('[data-demo]').screenshot({ path: png });
    execFileSync('cwebp', [
      '-q',
      '80',
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
rmSync(work, { recursive: true });
