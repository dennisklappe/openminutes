import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startStack } from './stack.mjs';

const requireFrom = (path) => createRequire(new URL(path, import.meta.url));
const { chromium } = requireFrom('../../apps/bot/package.json')('playwright-core');
const wav = process.env.FAKE_AUDIO ?? join(homedir(), '.cache/openminutes-e2e/phone/meeting.wav');
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'phone-pipeline-shots');
const whisper = process.env.WHISPER_URL ?? 'http://127.0.0.1:8765';
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (describe, check, seconds = 300) => {
  for (let i = 0; i < seconds * 2; i++) {
    const value = await check();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${describe}`);
};

const { server, api, close } = await startStack(whisper);

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
  ],
});
let exitCode = 0;
try {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: scheme,
      permissions: ['microphone'],
    });
    await context.addCookies([server.cookie]);
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
    await page.goto(`${server.url}/#/record`);
    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.getByRole('button', { name: 'I understand, start recording' }).click();
    await page.getByText('Recording', { exact: true }).waitFor();
    await sleep(40_000);
    if (scheme === 'light') await page.screenshot({ path: join(out, `record-${scheme}.png`) });
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await page.waitForFunction(() => /^#\/meetings\/[\w-]+$/.test(location.hash));
    const id = page.url().split('/').pop();
    console.log(`meeting ${id}, processing`);

    await until('summary and auto title', async () => {
      const row = await (
        await fetch(`${server.url}/api/meetings/${id}`, {
          headers: { cookie: `${server.cookie.name}=${server.cookie.value}` },
        })
      ).json();
      if (row.meeting?.status === 'failed') throw new Error(`failed: ${row.meeting.error}`);
      return (
        row.summaries?.some((x) => x.status === 'done') &&
        row.meeting.title === 'Garden plans and the budget'
      );
    });
    const detail = await api(`/meetings/${id}`);
    const voices = await api(`/meetings/${id}/voices`);
    console.log(
      `${scheme}: title="${detail.meeting.title}" segments=${detail.segments.length} voices=${voices.voices.length} needsNaming=${voices.needsNaming}`,
    );
    console.log(
      voices.voices
        .map((v) => `${v.name} ${Math.round(v.durationMs / 1000)}s snippets=${v.snippets.length}`)
        .join(' | '),
    );
    assert.ok(detail.segments.length > 3, 'transcript exists');
    assert.ok(voices.voices.length >= 2, 'at least two voices found');
    assert.equal(voices.needsNaming, true);

    await page.reload();
    await page.getByText('Who is who?').first().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(out, `who-is-who-${scheme}.png`), fullPage: true });
    await page.getByLabel('Who is this?').first().fill('Anna');
    await page.getByRole('button', { name: /^Save/ }).first().click();
    await page.getByText(/Saved/).first().waitFor({ timeout: 10_000 });
    const after = await api(`/meetings/${id}`);
    assert.ok(
      after.segments.some((s) => s.speaker === 'Anna'),
      'name applied to transcript',
    );
    await page.reload();
    await sleep(1_500);
    await page.screenshot({ path: join(out, `result-${scheme}.png`), fullPage: true });
    await context.close();
  }
  console.log('PIPELINE OK');
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await browser.close();
  await close();
}
process.exit(exitCode);
