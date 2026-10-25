// Drives "Edit with AI" on the meeting page in headless Chromium against the real web app and a
// fake OpenAI-compatible model: collapsed bar, chips, the diff after an edit, undo, the follow-up
// log, the shrink confirmation and the regenerate dialog with the re-apply choice. It saves
// screenshots at 1440 and 390 px, light and dark.
// Usage: pnpm --filter @openminutes/web build && OUT=/path/to/shots node e2e/ui/summary-chat.mjs
/* global document, window */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startRealServer } from '../phone/real-server.mjs';

const root = new URL('../../', import.meta.url);
const requireFrom = createRequire(new URL('apps/web/package.json', root));
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');
const { meetings, summaries, transcriptSegments } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/db')).href
);
const { saveProviderSettings } = await import(
  pathToFileURL(requireFrom.resolve('@openminutes/core')).href
);
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'summary-chat-shots');
mkdirSync(out, { recursive: true });
const step = (name) => console.log(`== ${name}`);

const SUMMARY = `### Summary

The team agreed to ship the new onboarding flow next week.

### Open questions

- Who owns the billing migration?
- When does the feature freeze start?

### Decisions

- Ship onboarding on Friday (the full reasoning is in the notes)

### Action items

| Owner | Task | Due |
| --- | --- | --- |
| Sam | Prepare the release notes | Wednesday (28 Oct) |
| Priya | Review the pricing page | Not specified |
`;

const section = (text, tag) =>
  new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(text)?.[1] ?? '';

const model = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const user = JSON.parse(body).messages.at(-1).content;
  const summary = section(user, 'summary');
  const instruction = section(user, 'instruction');
  const answers = {
    'Remove open questions': summary.replace(/### Open questions[\s\S]*?(?=### Decisions)/, ''),
    'Make it shorter': summary.replace(/ \(the full reasoning is in the notes\)/, ''),
    'Delete everything': 'Gone.',
  };
  const content = answers[instruction] ?? `${summary}\n\n- ${instruction}`;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}).listen(0);
const modelUrl = `http://127.0.0.1:${model.address().port}/v1`;

const server = await startRealServer({
  uiDir: fileURLToPath(new URL('apps/web/dist/ui', root)),
});
const { db, settings } = server;
const [meeting] = await db
  .insert(meetings)
  .values({
    title: 'Quarterly planning',
    platform: 'meet',
    joinUrl: 'https://meet.google.com/eyv-umah-wyh',
    status: 'transcribed',
    startedAt: new Date('2026-10-22T09:00:00Z'),
    endedAt: new Date('2026-10-22T09:45:00Z'),
  })
  .returning();
await db.insert(transcriptSegments).values({
  meetingId: meeting.id,
  startMs: 0,
  endMs: 4000,
  text: 'Shall we ship onboarding next week?',
});
await db.insert(summaries).values({
  meetingId: meeting.id,
  provider: 'seed',
  model: 'seed',
  status: 'done',
  content: SUMMARY,
});

const browser = await chromium.launch();
const fail = [];
const shots = [];
const shot = async (page, name) => {
  const path = join(out, `${name}.png`);
  shots.push(path);
  await page.screenshot({ path, fullPage: true });
};
const open = async (width, height, colorScheme) => {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme });
  await context.addCookies([server.cookie]);
  const page = await context.newPage();
  page.on('pageerror', (error) => fail.push(error.message));
  await page.goto(`${server.url}/#/meetings/${meeting.id}`);
  await page.getByRole('heading', { name: 'Quarterly planning' }).waitFor();
  return page;
};
const until = async (check) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('condition not met in time');
};
const activeContent = async (page) => {
  const detail = await (await page.request.get(`${server.url}/api/meetings/${meeting.id}`)).json();
  return detail.summaries.find((summary) => summary.active).content;
};

step('hidden with a hint until a summary provider is configured');
let page = await open(1440, 900, 'light');
await page.getByText('Edit with AI needs a summary provider').waitFor();
assert.equal(await page.getByRole('button', { name: /Edit with AI/ }).count(), 0);
await page.context().close();
await saveProviderSettings(settings, 'summary', 'openai-compatible', {
  baseUrl: modelUrl,
  model: 'test-model',
});

for (const [width, height, size] of [
  [1440, 900, 'desktop'],
  [390, 844, 'phone'],
]) {
  for (const scheme of ['light', 'dark']) {
    const tag = `${size}-${scheme}`;
    step(`edit, diff and undo ${tag}`);
    page = await open(width, height, scheme);
    const bar = page.getByRole('button', { name: /Edit with AI/ });
    await bar.waitFor();
    await shot(page, `collapsed-${tag}`);
    await bar.click();
    await page.getByRole('button', { name: 'Remove open questions' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.locator('details[open] .diff-del', { hasText: 'Who owns the billing' }).waitFor();
    await page.getByRole('status').getByText('Changed: Remove open questions.').waitFor();
    assert.ok(!(await activeContent(page)).includes('Open questions'));
    await shot(page, `edited-${tag}`);
    await page.getByRole('button', { name: 'Undo' }).click();
    await until(async () => (await activeContent(page)).includes('Who owns the billing'));
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 0),
      true,
      `${tag} scrolls sideways`,
    );
    await page.context().close();
  }
}

step('follow-up, shrink confirmation and the regenerate choice');
page = await open(1440, 900, 'light');
await page.getByRole('button', { name: /Edit with AI/ }).click();
await page.getByLabel('Instruction for the AI').fill('Make it shorter');
await page.getByRole('button', { name: 'Apply' }).click();
await page.locator('.ai-log li').first().waitFor();
await page.getByLabel('Instruction for the AI').fill('Add a risks line');
await page.getByRole('button', { name: 'Apply' }).click();
await page.locator('.ai-log li').nth(1).waitFor();
await page.getByLabel('Instruction for the AI').fill('Delete everything');
await page.getByRole('button', { name: 'Apply' }).click();
const dialog = page.getByRole('dialog');
await dialog.getByText('less than 15 percent').waitFor();
await shot(page, 'shrink-confirm');
await dialog.getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('button', { name: 'Regenerate' }).click();
await dialog.getByLabel('Regenerate and re-apply my edits').check();
await dialog.getByText('Make it shorter').waitFor();
await shot(page, 'regenerate-reapply');
await dialog.getByRole('button', { name: 'Cancel' }).click();

await browser.close();
model.close();
await server.close();
assert.deepEqual(fail, [], 'page errors');
console.log(`ok, ${String(shots.length)} screenshots in ${out}`);
