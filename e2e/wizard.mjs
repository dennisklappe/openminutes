import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const { chromium } = createRequire(new URL('../apps/bot/package.json', import.meta.url))(
  'playwright-core',
);
const { BASE, HOST, COMPOSE, OUT } = process.env;
const PASSWORD = 'e2e-password-123';
// Meet links lose their query string when a meeting is created, so the fixture options travel in a lookup id.
const meetUrl = (label, query) =>
  `https://meet.google.com/lookup/${label}-${Buffer.from(query).toString('hex')}`;
mkdirSync(OUT, { recursive: true });

const remote = (command, input) =>
  execFileSync('ssh', [HOST, `${COMPOSE} ${command}`], { encoding: 'utf8', input }).trim();
const sql = (query) =>
  remote(`exec -T db psql -U openminutes -d openminutes -tA -c ${JSON.stringify(query)}`);
const until = async (describe, check, seconds = 120) => {
  for (let i = 0; i < seconds; i += 2) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`timed out waiting for ${describe}`);
};

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1180, height: 900 } })).newPage();
let shot = 0;
const screenshot = async (name) => {
  await page.screenshot({
    path: join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`),
    fullPage: true,
  });
};
const step = (name) => console.log(`== ${name}`);
const joinNow = async (url) => {
  await page.goto(`${BASE}/#/`);
  await page.getByLabel('Meeting link').fill(url);
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/meetings') && r.request().method() === 'POST',
  );
  await click('Join meeting');
  assert.equal((await created).status(), 201);
};
const click = (name) => page.getByRole('button', { name, exact: true }).click();

step('password step on a fresh install');
await page.goto(BASE);
await page.getByRole('heading', { name: 'Set up OpenMinutes' }).waitFor();
await screenshot('password');
await page.getByLabel('Admin password').fill(PASSWORD);
await click('Create admin');

step('transcription, with Test connection');
await page.getByRole('heading', { name: 'Transcription', level: 1 }).waitFor();
await page.getByLabel('Service URL').fill('http://stt:8000');
await page.getByLabel('Access token').fill('wrong');
await click('Test connection');
await page.locator('.error').first().waitFor();
await page.getByLabel('Access token').fill('e2e-token');
await click('Test connection');
await page.getByText('Connection works').waitFor();
await click('Save changes');
await page.getByText('Saved.').waitFor();
await screenshot('transcription');
await click('Next');

step('summary provider');
await page.getByRole('heading', { name: 'Summaries', level: 1 }).waitFor();
await page.getByLabel('Provider').selectOption('openai-compatible');
await page.getByLabel('Base URL').fill('http://llm:8000/v1');
await page.getByLabel('Model').first().fill('stub-model');
await page.getByLabel('API key').fill('e2e-llm-key');
await click('Test connection');
await page.getByText('Connection works').waitFor();
await click('Save changes');
await page.getByText('Saved.').waitFor();
await screenshot('summary');
await click('Next');

step('calendar step shows the redirect URI and guides, and survives a reload');
await page.getByRole('heading', { name: 'Calendar', level: 1 }).waitFor();
assert.match(
  await page.locator('.copy code').first().innerText(),
  /\/api\/oauth\/google\/callback$/,
);
assert.ok(
  await page
    .locator('a[href="https://github.com/dennisklappe/openminutes/blob/main/docs/azure-app.md"]')
    .count(),
);
await screenshot('calendar');
await page.reload();
await page.getByRole('heading', { name: 'Calendar', level: 1 }).waitFor();
await click('Next');

step('bot step');
await page.getByRole('heading', { name: 'The bot', level: 1 }).waitFor();
await screenshot('bot');
await click('Next');

step('storage: a bad key is reported, the MinIO bucket passes');
await page.getByRole('heading', { name: 'Storage and retention', level: 1 }).waitFor();
await page.getByLabel('Store audio on').selectOption('s3');
await page.getByLabel('Endpoint').fill('http://minio:9000');
await page.getByRole('textbox', { name: 'Bucket *' }).fill('openminutes');
await page.getByLabel('Region').fill('us-east-1');
await page.getByLabel('Access key ID').fill('e2eaccesskey');
await page.getByLabel('Secret access key').fill('wrong-secret');
await click('Test connection');
await page.locator('.error').first().waitFor();
await page.getByLabel('Secret access key').fill('e2e-secret-key-0123');
await click('Test connection');
await page.getByText('Bucket works').waitFor();
await page.getByLabel('Delete audio after').fill('1');
await click('Save changes');
await page.getByText('Saved.').first().waitFor();
await screenshot('storage');
await click('Next');

step('finish: join a fake meeting from the done page');
await page.getByRole('heading', { name: 'You are set up' }).waitFor();
await screenshot('done');
await page
  .getByLabel('Meeting link')
  .fill(meetUrl('first', 'lobby=500&leaveAfter=8000&speakers=Alice:1000-4000,Bob:5000-8000'));
await click('Join meeting');
await page.waitForURL(/#\/meetings\/[\w-]+$/);
const meetingId = page.url().split('/').pop();
await page.locator('.pill-transcribed').first().waitFor({ timeout: 150_000 });
await screenshot('meeting');
await page.getByRole('tab', { name: 'Transcript' }).click();
await page.getByText('Hello from the fake meeting.').waitFor();

step('the audio moved to MinIO and still plays');
const objects = remote(`exec -T minio ls /bitnami/minio/data/openminutes/meetings/${meetingId}`);
assert.match(objects, /merged\.opus/);
assert.doesNotMatch(
  remote(`exec -T worker sh -c "ls /data/meetings/${meetingId} || true"`),
  /opus/,
);
const audio = await page.request.get(`${BASE}/api/meetings/${meetingId}/audio`, {
  headers: { range: 'bytes=0-3' },
});
assert.equal(audio.status(), 206);
assert.equal((await audio.body()).toString(), 'OggS');

step('wizard is finished and the normal app shows');
await page.goto(`${BASE}/#/`);
await page.getByRole('heading', { name: 'Meetings', level: 1 }).waitFor();

step('search and filters');
await page.getByLabel('Search meetings').fill('nothing matches this');
await page.getByText('No meetings match').waitFor();
await page.getByLabel('Search meetings').fill('fake meeting');
await page.locator('tbody tr').first().waitFor();
await page.getByRole('group', { name: 'Platform' }).getByRole('button', { name: 'Teams' }).click();
await page.getByText('No meetings match').waitFor();
await page.getByRole('group', { name: 'Platform' }).getByRole('button', { name: 'Meet' }).click();
await page.getByRole('button', { name: 'Status' }).click();
await page.getByRole('menuitem', { name: 'Reset' }).waitFor();
await page.keyboard.press('Escape');
await page.locator('tbody tr').first().waitFor();
await screenshot('list-filtered');

step('retention deletes audio, keeps the transcript, shows Audio deleted');
sql(`update meetings set ended_at = now() - interval '3 days' where id = '${meetingId}'`);
remote(
  'exec -T worker node --input-type=module',
  `import { JobQueue } from '@openminutes/core';
const queue = await JobQueue.start(process.env.DATABASE_URL);
await queue.send('audio.retention', {});
await queue.stop();`,
);
await until(
  'retention',
  () => sql(`select audio_deleted_at is not null from meetings where id = '${meetingId}'`) === 't',
);
assert.equal(sql(`select count(*) from audio_files where meeting_id = '${meetingId}'`), '0');
assert.ok(
  Number(sql(`select count(*) from transcript_segments where meeting_id = '${meetingId}'`)) > 0,
);
assert.doesNotMatch(
  remote(`exec -T minio sh -c "ls /bitnami/minio/data/openminutes/meetings || true"`),
  new RegExp(meetingId),
);
await page.goto(`${BASE}/#/meetings/${meetingId}`);
await page.getByText('Audio deleted').first().waitFor();
await page.getByRole('tab', { name: 'Transcript' }).click();
await page.getByText('Hello from the fake meeting.').waitFor();
await screenshot('audio-deleted');

step('meeting limit: the second meeting waits for a free slot');
const slotUrl = (tag, seconds) =>
  meetUrl(tag, `lobby=500&leaveAfter=${seconds}&speakers=Alice:1000-4000`);
for (const tag of ['one', 'two']) {
  await joinNow(slotUrl(tag, tag === 'one' ? 80_000 : 20_000));
}
await until('a waiting meeting', () =>
  sql(`select error from meetings where join_url like '%lookup/two-%'`).startsWith(
    'Waiting for a free slot',
  ),
);
assert.equal(
  sql(`select count(*) from meetings where status in ('joining','in_lobby','recording')`),
  '1',
);
await page.goto(`${BASE}/#/`);
await screenshot('waiting-for-slot');
for (const tag of ['one', 'two']) {
  await until(
    `${tag} transcribed`,
    () =>
      sql(`select status from meetings where join_url like '%lookup/${tag}-%'`) === 'transcribed',
    240,
  );
}

step('limit of 2: both record at once and both recordings carry audio');
await page.goto(`${BASE}/#/settings`);
await page.getByLabel('Parallel meetings').fill('2');
await page
  .locator('form', { has: page.getByLabel('Parallel meetings') })
  .getByRole('button', { name: 'Save changes' })
  .click();
await page.getByText('Saved.').first().waitFor();
for (const tag of ['three', 'four']) {
  await joinNow(slotUrl(tag, 20_000));
}
await until(
  'two meetings recording together',
  () => sql(`select count(*) from meetings where status = 'recording'`) === '2',
);
for (const tag of ['three', 'four']) {
  await until(
    `${tag} transcribed`,
    () =>
      sql(`select status from meetings where join_url like '%lookup/${tag}-%'`) === 'transcribed',
    240,
  );
  const id = sql(`select id from meetings where join_url like '%lookup/${tag}-%'`);
  const file = join(OUT, `${tag}.opus`);
  writeFileSync(file, await (await page.request.get(`${BASE}/api/meetings/${id}/audio`)).body());
  const volume = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' },
  ).stderr;
  const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(volume)?.[1]);
  console.log(`${tag}: mean volume ${mean} dB`);
  rmSync(file);
  assert.ok(mean > -50, `${tag} recording is silent`);
}

step('crash recovery: a meeting left recording is failed when the bot starts');
sql(
  `insert into meetings (title, platform, join_url, status) values ('Stuck', 'meet', 'https://meet.google.com/stu-ckst-uck', 'recording')`,
);
remote('restart bot');
await until(
  'recovery',
  () => sql(`select status from meetings where title = 'Stuck'`) === 'failed',
);
assert.match(
  sql(`select error from meetings where title = 'Stuck'`),
  /bot stopped while this meeting was in progress/,
);
await page.goto(`${BASE}/#/`);
await page.getByText('The bot stopped while this meeting was in progress').first().waitFor();
await screenshot('recovered');

step('login rate limit');
const attempt = () =>
  page.request.post(`${BASE}/api/login`, { data: { password: 'not the password' } });
for (let i = 0; i < 10; i++) assert.equal((await attempt()).status(), 401);
const blocked = await attempt();
assert.equal(blocked.status(), 429);
console.log(`blocked, retry-after ${blocked.headers()['retry-after']}s`);

step('delete a meeting: it moves to the bin, then goes for good with its audio');
const doomed = sql(`select id from meetings where join_url like '%lookup/three-%'`);
await page.goto(`${BASE}/#/meetings/${doomed}`);
await page.getByRole('button', { name: 'More', exact: true }).first().click();
await page.getByRole('menuitem', { name: 'Delete meeting' }).click();
await page.getByRole('button', { name: 'Move to bin', exact: true }).click();
await page.waitForURL(`${BASE}/#/`);
await page.goto(`${BASE}/#/bin`);
await page.getByRole('checkbox', { name: /^Select .*three-/ }).check();
await page.getByRole('button', { name: 'Delete forever', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Delete forever', exact: true }).click();
await until(
  'the meeting is gone',
  () => sql(`select count(*) from meetings where id = '${doomed}'`) === '0',
);
assert.equal(sql(`select count(*) from meetings where id = '${doomed}'`), '0');
assert.equal(
  remote(`exec -T worker sh -c "find /data/meetings/${doomed} -name '*.opus' 2>/dev/null || true"`),
  '',
);
assert.doesNotMatch(
  remote(`exec -T minio sh -c "ls /bitnami/minio/data/openminutes/meetings || true"`),
  new RegExp(doomed),
);

step('reopen the wizard from settings');
await page.goto(`${BASE}/#/settings`);
await click('Open the setup wizard');
await page.getByRole('heading', { name: 'Transcription', level: 1 }).waitFor();
await screenshot('wizard-reopened');

await browser.close();
console.log(`all checks passed, screenshots in ${OUT}`);
