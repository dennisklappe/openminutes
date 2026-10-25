#!/usr/bin/env node
// Signs a dedicated Google account in with a visible browser and saves the session as a
// Playwright storage state, which you then import under Settings, Google Meet sign-in in OpenMinutes.
// Usage: node scripts/google-login.mjs [output.json] [--channel chrome|msedge|chromium]
// Needs playwright-core (pnpm install in this repo, or npm install playwright-core) and a browser.
import console from 'node:console';
import { chmod, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const args = process.argv.slice(2);
const channelAt = args.indexOf('--channel');
const channel = channelAt === -1 ? 'chrome' : args.splice(channelAt, 2)[1];
const output = resolve(args[0] ?? 'google-session.json');
const TIMEOUT_MS = 10 * 60_000;

function loadPlaywright() {
  for (const base of ['../apps/bot/package.json', import.meta.url]) {
    try {
      return createRequire(new URL(base, import.meta.url))('playwright-core');
    } catch {
      continue;
    }
  }
  throw new Error(
    'playwright-core not found, run "pnpm install" here or "npm install playwright-core"',
  );
}

const hasSignIn = async (context) =>
  (await context.cookies('https://accounts.google.com')).some((c) => c.name === 'SID');

const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  headless: false,
  ...(channel !== 'chromium' && { channel }),
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({ locale: 'en-US' });
const page = await context.newPage();
await page.goto('https://accounts.google.com/');
console.log('Sign in with the dedicated bot account in the browser window, including 2FA.');
console.log('Never use a personal account. The window closes by itself when you are signed in.');

const deadline = Date.now() + TIMEOUT_MS;
while (!(await hasSignIn(context))) {
  if (Date.now() > deadline) {
    await browser.close();
    throw new Error('Timed out waiting for the sign-in');
  }
  await page.waitForTimeout(1000);
}
await page.goto('https://meet.google.com/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

await writeFile(output, JSON.stringify(await context.storageState(), null, 2), { mode: 0o600 });
await chmod(output, 0o600);
await browser.close();
console.log(
  `Saved ${output}. Import it under Settings, Google Meet sign-in, then delete the file.`,
);
