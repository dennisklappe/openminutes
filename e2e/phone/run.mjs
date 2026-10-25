import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRealServer } from './real-server.mjs';

const { chromium } = createRequire(new URL('../../apps/bot/package.json', import.meta.url))(
  'playwright-core',
);
const wav = process.env.FAKE_AUDIO ?? join(homedir(), '.cache/openminutes-e2e/phone/meeting.wav');
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'phone-shots');
const uiDir = fileURLToPath(new URL('../../apps/web/dist/ui', import.meta.url));
mkdirSync(out, { recursive: true });

const step = (name) => console.log(`== ${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (describe, check, seconds = 60) => {
  for (let i = 0; i < seconds * 4; i++) {
    const value = await check();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${describe}`);
};

const server = await startRealServer({ uiDir });
const state = () => server.state();
const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const newContext = async (colorScheme = 'light') => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme,
    permissions: ['microphone'],
    serviceWorkers: 'allow',
  });
  await context.addCookies([server.cookie]);
  return context;
};

const startRecording = async (page) => {
  await page.goto(`${server.url}/#/record`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('dialog').waitFor();
  return async () => {
    await page.getByRole('button', { name: 'I understand, start recording' }).click();
    await page.getByText('Recording', { exact: true }).waitFor();
  };
};
const onMeeting = (page) =>
  page.waitForFunction(() => /^#\/meetings\/[\w-]+$/.test(location.hash), undefined, {
    timeout: 60_000,
  });
const timer = (page) => page.getByRole('timer').innerText();

let page;
try {
  const context = await newContext();
  page = await context.newPage();
  page.on('response', (response) => {
    if (response.status() >= 400) console.log(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on('pageerror', (error) => {
    throw error;
  });

  step('record screen, consent, recording, offline drop, stop');
  await page.goto(`${server.url}/#/record`);
  await page.getByRole('button', { name: 'Start recording' }).waitFor();
  await page.getByRole('button', { name: 'Start recording' }).click();
  const consent = page.getByRole('dialog');
  await consent.waitFor();
  assert.match(await consent.innerText(), /Tell everyone/);
  await page.getByRole('button', { name: 'I understand, start recording' }).click();
  await page.getByText('Recording', { exact: true }).waitFor();
  await sleep(11_000);
  assert.notEqual(await timer(page), '0:00');
  await until('first chunks uploaded', async () => (await state())[0]?.chunks.length >= 2);

  await context.setOffline(true);
  await page.getByText(/You are offline/).waitFor();
  const before = (await state())[0].chunks.length;
  await sleep(12_000);
  assert.equal(
    (await state())[0].chunks.length,
    before,
    'nothing reaches the server while offline',
  );
  await context.setOffline(false);
  await sleep(6_000);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByText('Paused', { exact: true }).waitFor();
  const paused = await timer(page);
  await sleep(3_000);
  assert.equal(await timer(page), paused, 'the timer stands still while paused');
  await page.getByRole('button', { name: 'Resume' }).click();
  await sleep(6_000);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await onMeeting(page);

  const [first] = await state();
  assert.ok(first.finish, 'finish was called');
  assert.equal(first.chunks.length, first.finish.chunks);
  assert.deepEqual(first.chunks, [...first.chunks.keys()], 'chunk indexes are contiguous');
  assert.ok(first.bytes > 20_000, `audio arrived (${first.bytes} bytes)`);
  assert.match(page.url(), new RegExp(first.id));
  console.log(
    `uploaded ${first.chunks.length} chunks, ${first.bytes} bytes, ${first.finish.durationMs} ms`,
  );
  const leftover = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('openminutes-recorder');
        open.onsuccess = () => {
          const request = open.result.transaction('recordings').objectStore('recordings').count();
          request.onsuccess = () => resolve(request.result);
        };
      }),
  );
  assert.equal(leftover, 0, 'the device is clean after finish');

  step('open the app offline from the service worker, record, upload when back online');
  await page.goto(`${server.url}/#/record`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await until('service worker controls the page', () =>
    page.evaluate(() => !!navigator.serviceWorker.controller),
  );
  await context.setOffline(true);
  await page.reload();
  await page.getByText(/cannot be reached/).waitFor();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'I understand, start recording' }).click();
  await page.getByText('Recording', { exact: true }).waitFor();
  await sleep(9_000);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByText(/Uploading/).waitFor();
  assert.equal((await state()).length, 1, 'nothing was uploaded while offline');
  await context.setOffline(false);
  await until(
    'offline recording uploaded',
    async () => (await state()).length === 2 && (await state())[1].finish,
  );
  console.log('offline recording uploaded after reconnecting');

  step('crash recovery: upload and discard');
  for (const action of ['Upload', 'Discard']) {
    const crashed = await context.newPage();
    const ready = await startRecording(crashed);
    await ready();
    await sleep(8_000);
    await crashed.close({ runBeforeUnload: false });
    page = await context.newPage();
    await page.goto(`${server.url}/#/`);
    await page.getByText(/Upload unfinished recording\?/).waitFor();
    const count = (await state()).length;
    await page.getByRole('button', { name: action, exact: true }).click();
    if (action === 'Discard') {
      await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
    }
    if (action === 'Upload') {
      await onMeeting(page);
      const recordings = await state();
      const recovered = recordings[recordings.length - 1];
      assert.ok(
        recovered.finish && recovered.finish.chunks === recovered.chunks.length,
        'recovered recording was finished',
      );
    } else {
      await page.getByText(/Upload unfinished recording\?/).waitFor({ state: 'detached' });
      const recordings = await state();
      assert.ok(
        recordings.slice(count - 1).every((r) => r.discarded || !r.finish),
        'discarded recording is not finished',
      );
    }
    await page.close();
  }
  await context.close();

  for (const scheme of ['light', 'dark']) {
    step(`screenshots (${scheme})`);
    const themed = await newContext(scheme);
    const view = await themed.newPage();
    const shot = (name) => view.screenshot({ path: join(out, `${scheme}-${name}.png`) });
    await view.goto(`${server.url}/#/record`);
    await view.getByRole('button', { name: 'Start recording' }).waitFor();
    await shot('1-idle');
    await view.getByRole('button', { name: 'Start recording' }).click();
    await view.getByRole('dialog').waitFor();
    await shot('2-consent');
    await view.getByRole('button', { name: 'I understand, start recording' }).click();
    await view.getByText('Recording', { exact: true }).waitFor();
    await sleep(7_000);
    await shot('3-recording');
    await view.close({ runBeforeUnload: false });
    const banner = await themed.newPage();
    await banner.goto(`${server.url}/#/`);
    await banner.getByText(/Upload unfinished recording\?/).waitFor();
    await banner.screenshot({ path: join(out, `${scheme}-4-banner.png`) });
    await themed.close();
  }
  console.log(`screenshots in ${out}`);
} catch (error) {
  console.log(JSON.stringify(await state()));
  console.log(
    await page
      ?.locator('body')
      .innerText()
      .catch(() => ''),
  );
  throw error;
} finally {
  await browser.close();
  await server.close();
}
