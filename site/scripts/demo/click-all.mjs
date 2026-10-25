// Clicks every [data-act] control of the hero demo on every screen and fails on a console error,
// a page error or the old "is not part of the demo" answer. Menus and dialogs a click opens are
// explored one level deeper, each click starting from a fresh page.
// Usage: node scripts/demo/click-all.mjs [site url] [--phone]. Without a url it serves the built dist folder.
import console from 'node:console';
import process from 'node:process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));

function serve() {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = join(dist, path.endsWith('/') ? `${path}index.html` : path);
    readFile(file).then(
      (body) => {
        response.writeHead(200, {
          'content-type': types[extname(file)] ?? 'application/octet-stream',
        });
        response.end(body);
      },
      () => {
        response.writeHead(404).end();
      },
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

const given = process.argv.slice(2).find((arg) => arg.startsWith('http'));
const local = given ? undefined : await serve();
const url = given ?? local.url;
const phone = process.argv.includes('--phone');

const nav = (name) => `.sidebar .nav-item:has-text("${name}")`;
const open = (id) => `[data-act="open"][data-id="${id}"]`;
const summary = '[role="tab"][data-key="summary"]';
const sections = [
  'General',
  'Bot identity',
  'Minutes',
  'Email',
  'Calendar accounts',
  'Google Meet sign-in',
  'Phone recorder',
  'Transcription',
  'Summaries',
  'Storage and retention',
  'Access and updates',
];
const screens = {
  meetings: [],
  'meeting-launch': [nav('Meetings'), open('launch')],
  'meeting-launch-summary': [nav('Meetings'), open('launch'), summary],
  'meeting-kickoff': [nav('Meetings'), open('kickoff')],
  'meeting-kickoff-summary': [nav('Meetings'), open('kickoff'), summary],
  library: [nav('Minutes')],
  record: [nav('Record')],
  'record-live': [nav('Record'), '[data-act="rec-start"]', '[data-act="rec-consent"]'],
  ...Object.fromEntries(
    sections.map((name) => [
      `settings-${name}`,
      [nav('Settings'), `[data-act="section"]:has-text("${name}")`],
    ]),
  ),
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: phone ? { width: 390, height: 900 } : { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const problems = [];
let clicks = 0;

async function fresh(steps, label) {
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${label}: console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`${label}: page error: ${error.message}`));
  await page.goto(url);
  await page.waitForSelector('.omd .shell');
  await page.locator('.omd .shell').scrollIntoViewIfNeeded();
  for (const step of steps) await page.locator(step).first().click({ timeout: 5000 });
  return page;
}

const CONTROLS =
  '.omd:has(dialog[open]) dialog[open] [data-act]:visible, .omd:not(:has(dialog[open])) [data-act]:visible';
const controls = (page) => page.locator(CONTROLS);

async function press(page, locator) {
  const tag = await locator.evaluate((element) => element.tagName);
  if (tag === 'FORM') {
    await locator.evaluate((form) => {
      for (const input of form.querySelectorAll('input[required]')) {
        input.value = 'https://meet.google.com/abc-defg-hij';
      }
      form.requestSubmit();
    });
  } else if (tag === 'SELECT') {
    await locator.selectOption({ index: 1 });
  } else {
    const handle = await locator.elementHandle();
    const underMenu = await handle.evaluate(
      (element) =>
        !element.closest('[role="menu"], .join-menu') &&
        element.ownerDocument.querySelector('.omd [role="menu"], .omd .join-menu') !== null,
    );
    if (underMenu) await handle.dispatchEvent('click');
    else await handle.click({ timeout: 5000 });
  }
}

async function check(page, label) {
  clicks += 1;
  const text = await page.locator('.omd').innerText();
  const note = await page.locator('[data-demo-note]').innerText();
  if (/not part of the demo/i.test(`${text} ${note}`))
    problems.push(`${label}: says it is not part of the demo`);
}

async function explore(name, steps, path, depth) {
  const first = await fresh([...steps, ...path], name);
  const count = await controls(first).count();
  await first.close();
  for (let index = 0; index < count; index++) {
    const page = await fresh([...steps, ...path], name);
    const target = controls(page).nth(index);
    const label = `${name} > ${[...path, index].join(' > ')} ${(await target.evaluate((element) => element.outerHTML)).slice(0, 90)}`;
    try {
      const before = await page.locator('.omd').innerHTML();
      await press(page, target);
      await page.waitForTimeout(60);
      await check(page, label);
      const opened = await page
        .locator('.omd [role="menu"], .omd dialog[open], .omd .join-menu')
        .count();
      if (opened && depth < 1) {
        await page.close();
        await explore(name, steps, [...path, `${CONTROLS} >> nth=${index}`], depth + 1);
        continue;
      }
      if ((await page.locator('.omd').innerHTML()) === before && !opened) {
        const note = await page.locator('[data-demo-note]').innerText();
        if (!note) console.log(`note: no visible change for ${label}`);
      }
    } catch (error) {
      problems.push(`${label}: ${error.message.split('\n')[0]}`);
    }
    await page.close();
  }
}

for (const [name, steps] of Object.entries(screens)) {
  await explore(name, steps, [], 0);
  console.log(`${name}: done`);
}
await browser.close();
local?.server.close();
console.log(`${clicks} clicks`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
