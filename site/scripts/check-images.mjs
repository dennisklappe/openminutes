#!/usr/bin/env node
/* global document, window, getComputedStyle */
/**
 * Fails when a docs image or diagram is wrong in one of the two themes.
 *
 *   1. Source check (always): every image in README.md and docs/*.md is a <picture> with a
 *      prefers-color-scheme: dark source, its light and dark files exist, differ and the dark one is dark.
 *   2. Browser check (needs `astro build` first, --no-browser skips it): loads every docs page
 *      in light and dark (OS setting and the manual toggle) at 1440 and 390 wide, requires every image
 *      to load, to swap with the theme, and every mermaid label to fit inside its node.
 *
 *   node scripts/check-images.mjs [--no-browser] [--base https://openminut.es] [--shots dir]
 */
import { execFileSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = fileURLToPath(new URL('..', import.meta.url));
const repo = resolve(siteDir, '..');
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const problems = [];
const fail = (msg) => problems.push(msg);

// 1. Source check -----------------------------------------------------------------------------
const files = [
  'README.md',
  ...readdirSync(join(repo, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
];
for (const file of files) {
  const text = readFileSync(join(repo, file), 'utf8');
  const dir = join(repo, file.includes('/') ? 'docs' : '');
  const noCode = text.replace(/^```[\s\S]*?^```/gm, '');
  for (const m of noCode.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g))
    fail(`${file}: markdown image ${m[1]} is not a light and dark <picture>`);
  const pictures = [...noCode.matchAll(/<picture>[\s\S]*?<\/picture>/g)].map((m) => m[0]);
  const loose = noCode.replace(/<picture>[\s\S]*?<\/picture>/g, '');
  for (const m of loose.matchAll(/<img\b(?![^>]*src="https?:)[^>]*>/g))
    fail(`${file}: ${m[0].slice(0, 80)} is outside a <picture>`);
  for (const pic of pictures) {
    const source = /<source[^>]*prefers-color-scheme: dark[^>]*srcset="([^"]+)"/.exec(pic)?.[1];
    const light = /<img[^>]*\ssrc="([^"]+)"/.exec(pic)?.[1];
    if (!source || !light) {
      fail(`${file}: <picture> needs a dark <source> and an <img> (${pic.slice(0, 60)})`);
      continue;
    }
    if (source === light) fail(`${file}: ${light} is used for both themes`);
    if (!/alt="[^"]+"/.test(pic)) fail(`${file}: ${light} has no alt text`);
    const paths = [light, source].map((p) => join(dir, p));
    for (const p of paths)
      if (!existsSync(p)) fail(`${file}: ${p.replace(repo + '/', '')} is missing`);
    if (paths.every(existsSync)) {
      if (readFileSync(paths[0]).equals(readFileSync(paths[1])))
        fail(`${file}: ${light} and ${source} are identical`);
      if (paths.every((p) => p.endsWith('.webp')) && !args.includes('--no-luma')) {
        const [l, d] = paths.map(luma);
        if (l !== null && d !== null && d >= l)
          fail(`${file}: dark ${source} (${d}) is not darker than ${light} (${l})`);
      }
    }
  }
}
function luma(path) {
  try {
    const out = execFileSync('dwebp', ['-pgm', '-o', '-', path], {
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [, w, h] = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(out.subarray(0, 40).toString('latin1'));
    const body = out.subarray(out.length - w * h * 1);
    let sum = 0;
    for (let i = 0; i < body.length; i += 37) sum += body[i];
    return Math.round(sum / Math.ceil(body.length / 37));
  } catch {
    return null;
  }
}

// 2. Browser check ----------------------------------------------------------------------------
if (!args.includes('--no-browser')) await browserCheck();

async function browserCheck() {
  const { chromium } = await import('playwright');
  let base = flag('--base');
  let server;
  if (!base) {
    const dist = join(siteDir, 'dist');
    if (!existsSync(dist)) {
      fail('site/dist is missing: run astro build first');
      return;
    }
    const types = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.txt': 'text/plain',
    };
    server = createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = join(dist, p);
      if (!existsSync(file) || statSync(file).isDirectory())
        file = existsSync(file + '.html') ? file + '.html' : join(dist, 'index.html');
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    }).listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  }
  const pages = readdirSync(join(repo, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .map((n) => (n === 'README' ? '/docs' : `/docs/${n}`));
  const shots = flag('--shots');
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  const snapshot = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('.prose img')].map((img) => ({
        src: img.currentSrc.replace(location.origin, ''),
        ok: img.complete && img.naturalWidth > 0,
      })),
    );
  for (const width of [1440, 390]) {
    for (const path of pages) {
      const seen = {};
      for (const mode of ['os-light', 'os-dark', 'toggle-light', 'toggle-dark']) {
        const scheme = mode.endsWith('dark') ? 'dark' : 'light';
        // The toggle runs against the opposite OS setting so the toggle has to win.
        const ctx = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: mode.startsWith('os') ? scheme : scheme === 'dark' ? 'light' : 'dark',
        });
        const page = await ctx.newPage();
        await page.goto(base + path, { waitUntil: 'load' });
        if (mode.startsWith('toggle')) {
          await page.evaluate((s) => window.omTheme.set(s), scheme);
        }
        await page.evaluate(() =>
          Promise.all(
            [...document.images].map((i) =>
              i.loading === 'lazy'
                ? ((i.loading = 'eager'), i.decode().catch(() => {}))
                : i.decode().catch(() => {}),
            ),
          ),
        );
        await page.waitForTimeout(150);
        seen[mode] = await snapshot(page);
        const label = `${path} @${width} ${mode}`;
        for (const i of seen[mode]) if (!i.ok) fail(`${label}: image ${i.src} did not load`);
        const effective = await page.evaluate(
          () => getComputedStyle(document.body).backgroundColor,
        );
        const dark =
          effective
            .match(/\d+/g)
            .slice(0, 3)
            .map(Number)
            .reduce((a, b) => a + b, 0) < 300;
        if (dark !== (scheme === 'dark')) fail(`${label}: page is ${dark ? 'dark' : 'light'}`);
        const clipped = await page.evaluate(overflowing);
        for (const c of clipped) fail(`${label}: diagram ${c}`);
        if (shots && mode === 'os-dark' && (await page.$('.prose svg[id^=mermaid-]'))) {
          for (const [i, el] of (await page.$$('.prose .diagram')).entries())
            await el.screenshot({
              path: join(shots, `${path.split('/').pop()}-${width}-${i}-${scheme}.png`),
            });
        }
        await ctx.close();
      }
      for (const theme of ['light', 'dark']) {
        const a = seen[`os-${theme}`].map((i) => i.src).join('|');
        const b = seen[`toggle-${theme}`].map((i) => i.src).join('|');
        if (a !== b)
          fail(
            `${path} @${width}: toggle ${theme} shows other images than the OS ${theme} setting`,
          );
      }
      seen['os-light'].forEach((img, i) => {
        if (img.src === seen['os-dark'][i]?.src)
          fail(`${path} @${width}: ${img.src} does not change with the theme`);
      });
    }
  }
  await browser.close();
  server?.close();
}

/** Runs in the page: labels wider than their node, or clipped by their foreignObject. */
function overflowing() {
  const out = [];
  const diagrams = document.querySelectorAll('.prose svg[id^="mermaid-"]');
  diagrams.forEach((svg, n) => {
    const where = `#${n + 1} (${svg.closest('article, main')?.querySelector('h1, h2')?.textContent ?? ''})`;
    svg.querySelectorAll('foreignObject').forEach((fo) => {
      const inner = fo.firstElementChild;
      if (!inner) return;
      const text = inner.textContent.trim().slice(0, 40);
      const box = fo.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(inner);
      const t = range.getBoundingClientRect();
      if (
        t.width &&
        (t.left < box.left - 1 ||
          t.right > box.right + 1 ||
          t.bottom > box.bottom + 1 ||
          t.top < box.top - 1 ||
          inner.scrollHeight > fo.height.baseVal.value + 1 ||
          inner.scrollWidth > fo.width.baseVal.value + 1)
      )
        out.push(`${where} label "${text}" is clipped`);
      const node = fo.closest('.node, .cluster');
      const shape = node?.querySelector('rect, polygon, circle, ellipse, path');
      if (shape) {
        const s = shape.getBoundingClientRect();
        if (t.width && (t.left < s.left - 1 || t.right > s.right + 1))
          out.push(`${where} label "${text}" is wider than its box`);
      }
    });
    svg
      .querySelectorAll('.node .label, .cluster .label, .messageText, .noteText, .node text')
      .forEach((el) => {
        const group = el.closest('.node, .cluster, .note') ?? el.closest('g');
        const shape = group?.querySelector('rect, polygon, circle, ellipse, path');
        if (!shape || shape.contains(el)) return;
        const t = el.getBoundingClientRect();
        const s = shape.getBoundingClientRect();
        if (
          t.width &&
          (t.left < s.left - 1 ||
            t.right > s.right + 1 ||
            t.top < s.top - 1 ||
            t.bottom > s.bottom + 1)
        )
          out.push(`${where} text "${el.textContent.trim().slice(0, 40)}" is wider than its box`);
      });
  });
  return out;
}

if (problems.length) {
  console.error(`${problems.length} image problem(s):`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exit(1);
}
console.log(
  'docs images ok: every image is a light and dark pair, swaps with both theme controls, diagrams fit',
);
