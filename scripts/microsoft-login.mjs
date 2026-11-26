#!/usr/bin/env node
// Signs a dedicated Microsoft account in to Teams with a visible browser and saves the session as
// a Playwright storage state (cookies, localStorage and IndexedDB), then reopens it in a fresh
// headless browser to check that Teams is still signed in there, the way the bot will use it.
// Usage: node scripts/microsoft-login.mjs [output.json] [--channel chrome|msedge|chromium]
// Needs playwright-core 1.51 or newer (pnpm install in this repo, or npm install playwright-core).
import console from 'node:console';
import { chmod, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const args = process.argv.slice(2);
const channelAt = args.indexOf('--channel');
const channel = channelAt === -1 ? 'chrome' : args.splice(channelAt, 2)[1];
const output = resolve(args[0] ?? 'microsoft-session.json');
const TIMEOUT_MS = 10 * 60_000;
const TEAMS_URL = 'https://teams.microsoft.com/v2/';
const LOGIN_HOSTS = ['login.microsoftonline.com', 'login.live.com', 'login.microsoft.com'];
const AUTH_COOKIES = new Set(['ESTSAUTHPERSISTENT', 'ESTSAUTH']);

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

const onLoginPage = (page) => LOGIN_HOSTS.includes(new URL(page.url()).hostname);
// Teams moves between teams.microsoft.com and teams.cloud.microsoft.
const TEAMS_HOSTS = ['teams.microsoft.com', 'teams.cloud.microsoft'];
const onTeams = (page) => TEAMS_HOSTS.includes(new URL(page.url()).hostname);

const hasSignIn = async (context) =>
  (await context.cookies(['https://login.microsoftonline.com', 'https://login.live.com'])).some(
    (c) => AUTH_COOKIES.has(c.name),
  );

const { chromium } = loadPlaywright();
const launchOptions = {
  ...(channel !== 'chromium' && { channel }),
  args: ['--disable-blink-features=AutomationControlled'],
};
const browser = await chromium.launch({ headless: false, ...launchOptions });
const context = await browser.newContext({ locale: 'en-US' });
const page = await context.newPage();
await page.goto(TEAMS_URL);
console.log('Sign in with the dedicated bot account in the browser window, including MFA.');
console.log('Answer Yes to "Stay signed in?", that keeps the session alive for weeks.');
console.log('Never use a personal account. The window closes by itself once Teams has loaded.');

const deadline = Date.now() + TIMEOUT_MS;
while (!((await hasSignIn(context)) && onTeams(page) && !onLoginPage(page))) {
  if (Date.now() > deadline) {
    await browser.close();
    throw new Error('Timed out waiting for the sign-in');
  }
  await page.waitForTimeout(1000);
}
// Let Teams store its tokens before the state is read.
await page.waitForTimeout(10_000);
const state = await context.storageState({ indexedDB: true });
await browser.close();

await writeFile(output, JSON.stringify(state, null, 2), { mode: 0o600 });
await chmod(output, 0o600);

const check = await chromium.launch({ headless: true, ...launchOptions });
const fresh = await check.newContext({ locale: 'en-US', storageState: state });
const probe = await fresh.newPage();
await probe.goto(TEAMS_URL, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
await probe.waitForTimeout(15_000);
const signedIn = onTeams(probe) && !onLoginPage(probe);
const landed = new URL(probe.url()).hostname;
await check.close();

console.log(`Saved ${output}.`);
if (signedIn) {
  console.log('Checked: a fresh headless browser opens Teams signed in with this file.');
  process.exit(0);
}
console.log(`Warning: a fresh headless browser with this file ended on ${landed}, not Teams.`);
console.log('The bot would probably not join signed in. Report this on issue #50.');
process.exit(1);
