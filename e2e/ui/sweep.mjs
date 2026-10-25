// Visual sweep: every page and state of the web app at 1440 and 390 px, light and dark, on a
// throwaway embedded Postgres with the demo seed. Writes PNGs, defects.json (overflow, small tap
// targets, em dashes, console errors) and an index.html contact sheet.
// Usage: pnpm --filter @openminutes/web build && node e2e/ui/sweep.mjs
// Env: UI_DIR (built ui, default apps/web/dist/ui), OUT (default $TMPDIR/ui-sweep), ONLY (comma separated scenario ids), SIZES, SCHEMES.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDemo } from './demo-server.mjs';

const root = new URL('../../', import.meta.url);
const { chromium } = createRequire(new URL('apps/bot/package.json', root))('playwright-core');

const out = process.env.OUT ?? join(tmpdir(), 'ui-sweep');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const only = process.env.ONLY?.split(',');
const log = (text) => console.log(`== ${text}`);

const VIEWS = [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
].filter(([name]) => !process.env.SIZES || process.env.SIZES.split(',').includes(name));
const SCHEMES = (process.env.SCHEMES ?? 'light,dark').split(',');

const { server, token, ids: meetingIds } = await startDemo({ extras: true });
const { demo, failed, skipped, scheduled, lobby, processing, phone, review } = meetingIds;
log('demo data ready');

const SECTIONS = [
  'general',
  'bot',
  'minutes',
  'email',
  'calendars',
  'google-meet',
  'phone',
  'transcription',
  'summaries',
  'storage',
  'access',
];
const hash = (path) => (page) => page.goto(`${server.url}/#${path}`);
const settle = (page) => page.waitForTimeout(500);
const click = (page, role, name) => page.getByRole(role, { name }).first().click({ timeout: 4000 });
/** Set the Meetings status menu to exactly these labels, then close it. */
const pickStatuses = async (page, labels) => {
  await page.getByRole('button', { name: 'Status' }).click();
  const items = page.getByRole('menuitemcheckbox');
  const all = await items.all();
  const named = async (item) => ((await item.textContent()) ?? '').trim();
  // Check the wanted ones first: the last checked status cannot be unchecked.
  for (const wanted of [true, false]) {
    for (const item of all) {
      const checked = (await item.getAttribute('aria-checked')) === 'true';
      if (labels.includes(await named(item)) === wanted && checked !== wanted) await item.click();
    }
  }
  await page.keyboard.press('Escape');
};
const maybe = async (action) => {
  try {
    await action();
    return true;
  } catch {
    return false;
  }
};
const route = (page, pattern, body, status = 200) =>
  page.route(pattern, (r) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );

const scenarios = [
  {
    id: 'login',
    auth: false,
    go: async (page) => {
      await page.goto(server.url);
    },
  },
  {
    id: 'setup-password',
    auth: false,
    go: async (page) => {
      await route(page, '**/api/session', { authenticated: false, setupRequired: true });
      await page.goto(server.url);
    },
  },
  {
    id: 'offline-recorder',
    go: async (page) => {
      await page.route('**/api/session', (r) => r.abort());
      await page.goto(`${server.url}/#/record`);
    },
  },
  ...['transcription', 'summary', 'calendar', 'bot', 'storage', 'done'].map((step) => ({
    id: `wizard-${step}`,
    go: async (page) => {
      await route(page, '**/api/settings/wizard', { completed: false, step });
      await page.goto(`${server.url}/#/`);
    },
  })),
  { id: 'meetings', go: hash('/') },
  {
    id: 'meetings-empty',
    go: async (page) => {
      await route(page, '**/api/meetings*', []);
      await page.goto(`${server.url}/#/`);
    },
  },
  {
    id: 'meetings-search',
    go: async (page) => {
      await page.goto(`${server.url}/#/`);
      await page.getByLabel('Search meetings').fill('review');
    },
  },
  {
    id: 'meetings-filter-teams-failed',
    go: async (page) => {
      await page.goto(`${server.url}/#/`);
      await click(page, 'button', 'Teams');
      await pickStatuses(page, ['Failed']);
    },
  },
  {
    id: 'meetings-status-menu',
    go: async (page) => {
      await page.goto(`${server.url}/#/`);
      await page.getByRole('button', { name: 'Status' }).click();
    },
  },
  {
    id: 'meetings-join-menu',
    go: async (page) => {
      await page.goto(`${server.url}/#/`);
      await page.locator('.list .join-choice-trigger').first().click();
    },
  },
  {
    id: 'meetings-skipped-filter',
    go: async (page) => {
      await page.goto(`${server.url}/#/`);
      await pickStatuses(page, ['Skipped']);
      await page.locator('.table .join-choice-trigger').first().click();
    },
  },
  {
    id: 'meetings-no-match',
    go: async (page) => {
      await page.goto(`${server.url}/#/`);
      await page.getByLabel('Search meetings').fill('zzzzqqq');
    },
  },
  {
    id: 'meeting-transcript',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'tab', 'Transcript');
    },
  },
  {
    id: 'meeting-transcript-chat',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'tab', 'Transcript');
      await maybe(() => page.getByLabel('Show chat').check({ timeout: 3000 }));
    },
  },
  {
    id: 'meeting-summary',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'tab', 'Summary');
    },
  },
  {
    id: 'meeting-summary-edit',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'tab', 'Summary');
      await click(page, 'button', 'Edit summary');
    },
  },
  {
    id: 'meeting-summary-regenerate',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'tab', 'Summary');
      await click(page, 'button', 'Regenerate');
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'meeting-who-is-who',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${phone.id}`);
      await maybe(() => click(page, 'button', 'Edit speakers'));
    },
  },
  {
    id: 'meeting-who-is-who-demo',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await maybe(() => click(page, 'button', 'Edit speakers'));
    },
  },
  {
    id: 'meeting-download-menu',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'tab', 'Transcript');
      await click(page, 'button', 'Download');
    },
  },
  {
    id: 'meeting-more-menu',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'button', 'More');
    },
  },
  {
    id: 'meeting-share-dialog',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await settle(page);
      await click(page, 'button', 'Share');
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'meeting-share-attendees',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await settle(page);
      await click(page, 'button', 'Share');
      await page.getByRole('dialog').waitFor();
      await click(page, 'button', 'Preview email');
      await page.getByLabel('Preview').waitFor();
    },
  },
  {
    id: 'meeting-delete-confirm',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'button', 'More');
      await click(page, 'menuitem', 'Delete meeting');
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'meeting-title-edit',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'button', /Edit title/);
    },
  },
  { id: 'meeting-failed', go: hash(`/meetings/${failed.id}`) },
  { id: 'meeting-skipped', go: hash(`/meetings/${skipped.id}`) },
  { id: 'meeting-scheduled', go: hash(`/meetings/${scheduled.id}`) },
  { id: 'meeting-lobby', go: hash(`/meetings/${lobby.id}`) },
  { id: 'meeting-processing', go: hash(`/meetings/${processing.id}`) },
  { id: 'meeting-phone', go: hash(`/meetings/${phone.id}`) },
  {
    id: 'meeting-not-found',
    go: hash('/meetings/00000000-0000-4000-8000-000000000000'),
  },
  { id: 'archive', go: hash('/archive') },
  { id: 'bin', go: hash('/bin') },
  { id: 'record', go: hash('/record') },
  {
    id: 'record-consent',
    go: async (page) => {
      await page.goto(`${server.url}/#/record`);
      await click(page, 'button', 'Start recording');
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'record-live',
    fake: true,
    go: async (page) => {
      await page.goto(`${server.url}/#/record`);
      await click(page, 'button', 'Start recording');
      await click(page, 'button', 'I understand, start recording');
      await page.getByText('Recording', { exact: true }).waitFor();
      await page.waitForTimeout(1500);
    },
  },
  ...SECTIONS.map((id) => ({
    id: `settings-${id}`,
    go: async (page) => {
      await page.goto(`${server.url}/#/settings/${id}`);
      if (id === 'minutes') await page.waitForTimeout(1500);
    },
  })),
  {
    id: 'settings-minutes-custom',
    go: async (page) => {
      await page.goto(`${server.url}/#/settings/minutes`);
      await maybe(() =>
        page
          .getByLabel(/Custom/)
          .first()
          .check({ timeout: 3000 }),
      );
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'settings-voices',
    go: async (page) => {
      await page.goto(`${server.url}/#/settings/summaries`);
      await settle(page);
      await maybe(() =>
        page.getByLabel('Remember voices of people I name').check({ timeout: 3000 }),
      );
    },
  },
  {
    id: 'settings-voices-confirm',
    go: async (page) => {
      await page.goto(`${server.url}/#/settings/summaries`);
      await maybe(() =>
        page.getByLabel('Remember voices of people I name').check({ timeout: 3000 }),
      );
      await settle(page);
      await click(page, 'button', 'Forget all');
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'settings-calendars-disconnect',
    go: async (page) => {
      await page.goto(`${server.url}/#/settings/calendars`);
      await click(page, 'button', 'Disconnect');
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'share-summary',
    auth: false,
    go: async (page) => {
      await page.goto(`${server.url}/s/${token}`);
    },
  },
  {
    id: 'share-transcript-tab',
    auth: false,
    go: async (page) => {
      await page.goto(`${server.url}/s/${token}`);
      await maybe(() => page.locator('label[for="tab-transcript"]').click({ timeout: 3000 }));
    },
  },
  {
    id: 'share-links-tab',
    auth: false,
    go: async (page) => {
      await page.goto(`${server.url}/s/${token}`);
      await maybe(() => page.locator('label[for="tab-links"]').click({ timeout: 3000 }));
    },
  },
  {
    id: 'share-unavailable',
    auth: false,
    go: async (page) => {
      await page.goto(`${server.url}/s/${'x'.repeat(43)}`);
    },
  },
  ...['date', 'company', 'person', 'folders'].map((view) => ({
    id: `minutes-${view}`,
    go: async (page) => {
      await page.goto(`${server.url}/#/minutes/${view}`);
      await page.locator('.group').first().waitFor({ timeout: 5000 });
    },
  })),
  {
    id: 'minutes-search',
    go: async (page) => {
      await page.goto(`${server.url}/#/minutes/date`);
      await page.getByLabel('Search minutes').fill('billing');
    },
  },
  {
    id: 'minutes-no-match',
    go: async (page) => {
      await page.goto(`${server.url}/#/minutes/date`);
      await page.getByLabel('Search minutes').fill('zzzzqqq');
    },
  },
  {
    id: 'minutes-empty',
    go: async (page) => {
      await route(page, '**/api/minutes*', []);
      await page.goto(`${server.url}/#/minutes/date`);
    },
  },
  {
    id: 'minutes-select',
    go: async (page) => {
      await page.goto(`${server.url}/#/minutes/company`);
      await page.locator('.group').first().waitFor();
      await click(page, 'button', 'Select');
      await page.locator('.minute input[type=checkbox], .minute [role=checkbox]').first().click();
    },
  },
  {
    id: 'minutes-row-menu',
    go: async (page) => {
      await page.goto(`${server.url}/#/minutes/date`);
      await page.locator('.group').first().waitFor();
      await page
        .getByRole('button', { name: /Actions for/ })
        .first()
        .click();
    },
  },
  {
    id: 'minutes-group-menu',
    go: async (page) => {
      await page.goto(`${server.url}/#/minutes/company`);
      await page.locator('.group').first().waitFor();
      await maybe(() => page.locator('.group').first().getByRole('button').last().click());
    },
  },
  {
    id: 'minutes-folder-new',
    go: async (page) => {
      await page.goto(`${server.url}/#/minutes/folders`);
      await page.locator('.group').first().waitFor();
      await maybe(() => click(page, 'button', /New folder/));
    },
  },
  {
    id: 'meeting-minutes-card',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await settle(page);
      await page.getByRole('heading', { name: 'Minutes' }).first().scrollIntoViewIfNeeded();
    },
  },
  {
    id: 'meeting-people-link-dialog',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${review.id}`);
      await click(page, 'button', 'Rename Guest 7');
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    id: 'meeting-absent-menu',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${review.id}`);
      await page.locator('.absent-list li').first().getByRole('button').click();
    },
  },
  {
    id: 'meeting-review',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${review.id}`);
      await click(page, 'tab', 'Transcript');
      await page.locator('.transcript > li').first().waitFor();
    },
  },
  {
    id: 'meeting-review-only-uncertain',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${review.id}`);
      await click(page, 'tab', 'Transcript');
      await page.getByLabel('Only uncertain lines').check();
    },
  },
  {
    id: 'meeting-speaker-menu',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${review.id}`);
      await click(page, 'tab', 'Transcript');
      await page.locator('.transcript > li').nth(2).locator('.speaker-name').click();
      await page.getByRole('menu').waitFor();
    },
  },
  {
    id: 'meeting-split-line',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${review.id}`);
      await click(page, 'tab', 'Transcript');
      await page.locator('.transcript > li').nth(3).locator('.speaker-name').click();
      await page.getByRole('menuitem', { name: /Split line/ }).click();
    },
  },
  {
    id: 'meeting-summary-history-view',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'tab', 'Summary');
      await maybe(() => page.getByRole('button', { name: 'View' }).last().click());
    },
  },
  {
    id: 'meeting-ai-edit',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await click(page, 'tab', 'Summary');
      await click(page, 'button', /Edit with AI/);
      await page.getByLabel('Instruction for the AI').fill('Shorten the decisions and add owners.');
    },
  },
  {
    id: 'record-speakers',
    go: async (page) => {
      await page.goto(`${server.url}/#/record`);
      await maybe(() => page.getByLabel(/speakers/i).selectOption({ index: 2 }));
    },
  },
  {
    id: 'archive-empty',
    go: async (page) => {
      await route(page, '**/api/meetings?*archived*', []);
      await page.goto(`${server.url}/#/archive`);
    },
  },
  {
    id: 'bin-empty',
    go: async (page) => {
      await route(page, '**/api/meetings?*deleted*', []);
      await page.goto(`${server.url}/#/bin`);
    },
  },
  {
    id: 'api-error',
    go: async (page) => {
      await route(page, '**/api/meetings*', { error: 'Something broke on our side.' }, 500);
      await page.goto(`${server.url}/#/`);
    },
  },
  {
    id: 'share-summary-nojs',
    auth: false,
    js: false,
    go: async (page) => {
      await page.goto(`${server.url}/s/${token}`);
    },
  },
  {
    id: 'share-transcript-nojs',
    auth: false,
    js: false,
    go: async (page) => {
      await page.goto(`${server.url}/s/${token}#transcript`);
    },
  },
  {
    id: 'share-chat-tab',
    auth: false,
    go: async (page) => {
      await page.goto(`${server.url}/s/${token}`);
      await maybe(() => page.locator('label[for="tab-chat"]').click({ timeout: 3000 }));
    },
  },
  {
    id: 'not-found-server',
    auth: false,
    go: async (page) => {
      await page.goto(`${server.url}/definitely/not/here`);
    },
  },
  {
    id: 'not-found-route',
    go: hash('/no/such/page'),
  },
  // Creates the shareable link, so keep it last: it changes what the share page offers.
  {
    id: 'meeting-link-created',
    go: async (page) => {
      await page.goto(`${server.url}/#/meetings/${demo.id}`);
      await settle(page);
      // The link exists after the first pass, so the button is only there once.
      await maybe(() => click(page, 'button', /Create shareable link/));
      await page.waitForTimeout(1200);
      await page.getByRole('heading', { name: 'Minutes' }).first().scrollIntoViewIfNeeded();
    },
  },
].filter((s) => !only || only.includes(s.id));

async function audit(page, phoneView) {
  return page.evaluate((isPhone) => {
    /* eslint-disable no-undef */
    const issues = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      issues.push(`horizontal overflow ${root.scrollWidth} > ${root.clientWidth}`);
    }
    const label = (el) =>
      (
        el.getAttribute('aria-label') ||
        el.textContent ||
        el.getAttribute('placeholder') ||
        el.tagName
      )
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 40);
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    if (isPhone) {
      const small = new Set();
      for (const el of document.querySelectorAll(
        'button, a[href], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [role=tab], summary',
      )) {
        if (!visible(el) || el.closest('p, li > span, dd, .md, .minutes')) continue;
        if (el.matches('a') && el.parentElement.textContent.trim() !== el.textContent.trim())
          continue;
        if (el.matches('.timeline, .seek-text')) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 44)
          small.add(`${label(el)} (${Math.round(r.width)}x${Math.round(r.height)})`);
      }
      if (small.size) issues.push(`tap targets under 44px: ${[...small].slice(0, 12).join(' | ')}`);
    }
    const clipped = [];
    for (const el of document.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (
        r.right > window.innerWidth + 1 &&
        !el.closest('[style*="overflow"], .scroll, .subnav, nav, pre, table, dialog:not([open])')
      ) {
        clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
      }
      if (clipped.length > 5) break;
    }
    if (clipped.length) issues.push(`extends past the viewport: ${clipped.join(' | ')}`);
    const text = document.body.innerText;
    if (/[\u2013\u2014]/.test(text)) issues.push('dash character in visible text');
    if (
      /\b[a-z]+(\.[a-z_]+){1,3}\b/.test(
        text.replace(/https?:\/\/\S+|\S+@\S+|\S+\.(com|dev|example|invalid|json)\S*/g, ''),
      )
    ) {
      issues.push('possible untranslated key or dotted identifier in text');
    }
    return issues;
  }, phoneView);
}

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const results = [];
for (const [size, width, height] of VIEWS) {
  for (const scheme of SCHEMES) {
    log(`${size} ${scheme}`);
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: scheme,
        permissions: ['microphone'],
        javaScriptEnabled: scenario.js !== false,
      });
      if (scenario.auth !== false) await context.addCookies([server.cookie]);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
          errors.push(`console: ${m.text()}`);
      });
      let note = '';
      try {
        await scenario.go(page);
        await page.waitForTimeout(700);
      } catch (error) {
        note = `scenario failed: ${String(error.message).split('\n')[0]}`;
      }
      if (scenario.js !== false)
        await page.evaluate(async () => {
          /* eslint-disable no-undef */
          for (let y = 0; y < document.body.scrollHeight; y += 600) {
            window.scrollTo(0, y);
            await new Promise((resolve) => setTimeout(resolve, 40));
          }
          window.scrollTo(0, 0);
        });
      await page.waitForTimeout(200);
      const file = `${scenario.id}__${size}-${scheme}.png`;
      const modal = (await page.locator('dialog[open]').count()) > 0;
      await page.screenshot({ path: join(out, file), fullPage: !modal });
      const issues = [
        ...(note ? [note] : []),
        ...(scenario.js === false ? [] : await audit(page, size === 'phone')),
        ...errors,
      ];
      results.push({ id: scenario.id, size, scheme, file, issues });
      await context.close();
    }
  }
}
await browser.close();
await server.close();

const ids = [...new Set(results.map((r) => r.id))];
const cell = (r) =>
  `<figure><a href="${r.file}"><img loading="lazy" src="${r.file}" alt="${r.id} ${r.size} ${r.scheme}"></a><figcaption>${r.size} ${r.scheme}${
    r.issues.length
      ? `<ul>${r.issues.map((i) => `<li>${i.replace(/</g, '&lt;')}</li>`).join('')}</ul>`
      : ''
  }</figcaption></figure>`;
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>UI sweep</title><style>body{font:14px system-ui;margin:16px;background:#eee}section{margin:0 0 32px}h2{margin:0 0 8px}div{display:flex;gap:12px;align-items:flex-start;overflow-x:auto}figure{margin:0;flex:none}img{max-height:520px;border:1px solid #999;background:#fff}figcaption{font-size:12px;max-width:360px}li{color:#b42318}</style><h1>UI sweep</h1>${ids
    .map(
      (id) =>
        `<section><h2>${id}</h2><div>${results
          .filter((r) => r.id === id)
          .map(cell)
          .join('')}</div></section>`,
    )
    .join('')}`,
);
writeFileSync(
  join(out, 'defects.json'),
  JSON.stringify(
    results.filter((r) => r.issues.length),
    null,
    1,
  ),
);
const bad = results.filter((r) => r.issues.length);
console.log(`${results.length} shots, ${bad.length} with issues. Open ${join(out, 'index.html')}`);
