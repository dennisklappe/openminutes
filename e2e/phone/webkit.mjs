/* global atob, AudioContext, Blob, clearInterval, document, DOMException, EventTarget, innerHeight, isSecureContext, Navigator, setInterval, window */
// Drives the Record screen in Playwright WebKit (the closest engine to iOS Safari that runs here)
// with an iPhone viewport, in light and dark. Linux WebKit has no microphone and no MediaRecorder,
// so a stub plays Safari: audio/mp4 only, no webm, no Wake Lock, and it hands out the chunks of a
// real fragmented AAC-in-mp4 file. The chunks go through the real upload, ffmpeg merge and local
// whisper. Needs the local stack: `pnpm build`, whisper on WHISPER_URL (default 127.0.0.1:8765),
// and `npx playwright install webkit`. Usage: OUT=/path/to/shots node e2e/phone/webkit.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startStack } from './stack.mjs';

const { webkit, devices } = createRequire(new URL('../../apps/bot/package.json', import.meta.url))(
  'playwright-core',
);
const wav = process.env.FAKE_AUDIO ?? join(homedir(), '.cache/openminutes-e2e/phone/meeting.wav');
const out = process.env.OUT ?? join(process.env.TMPDIR ?? '.', 'phone-webkit-shots');
const whisper = process.env.WHISPER_URL ?? 'http://127.0.0.1:8765';
const cache = join(homedir(), '.cache/openminutes-e2e/phone');
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

// Fragmented mp4 with one moof+mdat per ~2 s, like Safari's MediaRecorder. The first chunk carries
// ftyp+moov, the rest are bare fragments.
function safariChunks() {
  const file = join(cache, 'safari.m4a');
  execFileSync('ffmpeg', [
    ...['-v', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '64k', '-ac', '1'],
    ...['-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000'],
    ...['-f', 'mp4', file],
  ]);
  const bytes = readFileSync(file);
  const chunks = [];
  let start = 0;
  let head = true;
  for (let at = 0; at < bytes.length;) {
    const size = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    at += size;
    if (type === 'mdat') {
      chunks.push(bytes.subarray(start, at).toString('base64'));
      start = at;
      head = false;
    }
  }
  assert.ok(!head && chunks.length > 5, 'fragmented mp4 split into chunks');
  return chunks;
}

const safariStub = ({ chunks, denyMic, noRecorder }) => {
  delete Navigator.prototype.wakeLock;
  if (noRecorder) return;
  const asBlob = (b64) =>
    new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'audio/mp4' });
  window.__asked = [];
  navigator.mediaDevices.getUserMedia = async () => {
    if (denyMic) throw new DOMException('denied', 'NotAllowedError');
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    context.createOscillator().connect(destination);
    return destination.stream;
  };
  window.MediaRecorder = class extends EventTarget {
    static isTypeSupported(type) {
      window.__asked.push(type);
      return type === 'audio/mp4';
    }
    constructor(stream, options) {
      super();
      window.__recorderOptions = options ?? null;
      this.mimeType = options?.mimeType ?? '';
      this.state = 'inactive';
      this.next = 0;
    }
    emit() {
      if (this.next >= chunks.length) return;
      const data = asBlob(chunks[this.next++]);
      this.ondataavailable?.({ data });
    }
    start() {
      this.state = 'recording';
      this.timer = setInterval(() => this.state === 'recording' && this.emit(), 400);
    }
    pause() {
      this.state = 'paused';
    }
    resume() {
      this.state = 'recording';
    }
    stop() {
      clearInterval(this.timer);
      while (this.next < chunks.length) this.emit();
      this.state = 'inactive';
      setTimeout(() => this.onstop?.(), 0);
    }
  };
};

const { server, api, close } = await startStack(whisper);
const browser = await webkit.launch();
const phone = devices['iPhone 14'];
const newPage = async (scheme, stub) => {
  const context = await browser.newContext({
    ...phone,
    viewport: { width: 390, height: 844 },
    colorScheme: scheme,
    serviceWorkers: 'allow',
  });
  await context.addCookies([server.cookie]);
  await context.addInitScript(safariStub, stub);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
  return { context, page };
};
const startFlow = async (page) => {
  await page.goto(`${server.url}/#/record`);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('dialog').waitFor();
};
let exitCode = 0;
try {
  const chunks = safariChunks();

  console.log('== head tags, safe area, tap targets, service worker, consent');
  for (const scheme of ['light', 'dark']) {
    const { context, page } = await newPage(scheme, { chunks });
    await page.goto(`${server.url}/#/record`);
    await page.getByRole('button', { name: 'Start recording' }).waitFor();
    if (scheme === 'light') {
      const head = await page.evaluate(() => ({
        secure: isSecureContext,
        viewport: document.querySelector('meta[name=viewport]')?.content,
        capable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content,
        status: document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.content,
        icon: document.querySelector('link[rel=apple-touch-icon]')?.href,
        manifest: document.querySelector('link[rel=manifest]')?.href,
      }));
      console.log(JSON.stringify(head));
      assert.equal(head.secure, true, 'secure context');
      assert.equal(head.capable, 'yes');
      assert.match(head.viewport, /viewport-fit=cover/);
      for (const url of [head.icon, head.manifest]) {
        const response = await fetch(url, { headers: { cookie: '' } });
        assert.equal(response.status, 200, url);
      }
      const registered = await until(
        'service worker',
        () => page.evaluate(async () => (await navigator.serviceWorker?.ready)?.active?.state),
        20,
      );
      console.log(`service worker: ${registered}`);
    }
    const box = await page.getByRole('button', { name: 'Start recording' }).boundingBox();
    const inner = await page.evaluate(() => innerHeight);
    console.log(`${scheme}: record button ${JSON.stringify(box)} viewport height ${inner}`);
    assert.ok(box.width >= 44 && box.height >= 44, 'record button is a 44 px target');
    assert.ok(box.y + box.height <= inner - 24, 'record button clear of the bottom edge');
    await page.screenshot({ path: join(out, `webkit-record-${scheme}.png`) });
    await page.getByRole('button', { name: 'Start recording' }).click();
    await page.getByRole('dialog').waitFor();
    for (const name of ['I understand, start recording', 'Cancel']) {
      const target = await page.getByRole('button', { name }).boundingBox();
      assert.ok(target.height >= 44, `${name} is at least 44 px tall (${target.height})`);
    }
    await page.screenshot({ path: join(out, `webkit-consent-${scheme}.png`) });
    await context.close();
  }

  console.log('== no MediaRecorder, mic denied');
  for (const [label, stub, text] of [
    ['no recorder', { chunks, noRecorder: true }, /cannot record audio/],
    ['mic denied', { chunks, denyMic: true }, /Microphone access was blocked/],
  ]) {
    const { context, page } = await newPage('light', stub);
    await startFlow(page);
    await page.getByRole('button', { name: 'I understand, start recording' }).click();
    await page.getByText(text).waitFor({ timeout: 10_000 });
    assert.ok((await page.locator('body').innerText()).length > 50, 'page not blank');
    await page.screenshot({ path: join(out, `webkit-${label.replace(' ', '-')}.png`) });
    console.log(`${label}: ${await page.locator('.notice.error').innerText()}`);
    await context.close();
  }

  console.log('== Safari-like recording: mime choice, wake lock hint, IndexedDB, upload');
  const { context, page } = await newPage('light', { chunks });
  await startFlow(page);
  await page.getByRole('button', { name: 'I understand, start recording' }).click();
  await page.getByText('Recording', { exact: true }).waitFor();
  await page.getByText(/Keep this screen on while recording/).waitFor();
  const options = await page.evaluate(() => ({
    asked: window.__asked,
    used: window.__recorderOptions,
  }));
  console.log(JSON.stringify(options));
  assert.equal(options.used?.mimeType, 'audio/mp4');
  await sleep(4000);
  const stored = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('openminutes-recorder');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const names = [...db.objectStoreNames];
          const all = db.transaction(names, 'readonly');
          const counts = names.map(
            (name) =>
              new Promise((done) => {
                const request = all.objectStore(name).getAll();
                request.onsuccess = () => done([name, request.result]);
              }),
          );
          Promise.all(counts).then((rows) =>
            resolve(
              rows.map(([name, list]) => ({
                name,
                count: list.length,
                types: [...new Set(list.map((r) => r.type ?? r.mimeType))],
              })),
            ),
          );
        };
      }),
  );
  console.log(JSON.stringify(stored));
  assert.ok(
    stored.some((s) => s.types.includes('audio/mp4') && s.count > 0),
    'audio/mp4 chunks persisted in IndexedDB',
  );
  await page.screenshot({ path: join(out, 'webkit-recording.png') });
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.waitForFunction(() => /^#\/meetings\/[\w-]+$/.test(location.hash), undefined, {
    timeout: 60_000,
  });
  const id = page.url().split('/').pop();
  console.log(`meeting ${id}, processing`);
  await until('transcript', async () => {
    const row = await api(`/meetings/${id}`);
    if (row.meeting?.status === 'failed') throw new Error(`failed: ${row.meeting.error}`);
    return row.segments?.length > 3 && row.summaries?.some((x) => x.status === 'done');
  });
  const detail = await api(`/meetings/${id}`);
  console.log(`segments=${detail.segments.length} first="${detail.segments[0].text}"`);
  await page.reload();
  await sleep(1500);
  await page.screenshot({ path: join(out, 'webkit-result.png'), fullPage: true });
  await context.close();
  console.log('WEBKIT OK');
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await browser.close();
  await close();
}
process.exit(exitCode);
