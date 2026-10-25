// Runs the real Google Docs exporter (packages/minutes dist) against the REAL Google Docs and
// Drive APIs, with a service account access token, so no human sign-in is needed.
//
//   pnpm --filter @openminutes/minutes build
//   export GOOGLE_ACCESS_TOKEN=$(GOOGLE_SA_KEY="$(cat service-account.json)" node e2e/gdocs/mint-token.mjs)
//   node e2e/gdocs/real-api.mjs
//
// Env:
//   GOOGLE_ACCESS_TOKEN  required, scopes documents + drive. Never printed or written.
//   OUT_DIR              where PDFs, PNGs and the request log go (default ./gdocs-out)
//   SHARE_WITH           email that gets reader access to the classic doc via grantAccess (no mail)
//   KEEP                 which variant stays in Drive (default custom); all others are deleted
//   LOGO_URL             public https PNG fetched and uploaded as the logo
// Needs pdftoppm (poppler) for the PNG previews.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGoogleDocsExporter, demoMinutes } from '../../packages/minutes/dist/index.js';

const token = process.env.GOOGLE_ACCESS_TOKEN;
if (!token) throw new Error('Set GOOGLE_ACCESS_TOKEN');
const out = process.env.OUT_DIR ?? './gdocs-out';
const keep = process.env.KEEP ?? 'custom';
const shareWith = process.env.SHARE_WITH;
const logoUrl =
  process.env.LOGO_URL ??
  'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png';
mkdirSync(out, { recursive: true });

const log = [];
const created = new Set();
// On any failure: write the request log, delete every doc this run created, then fail.
process.on('uncaughtException', async (error) => {
  console.error(String(error.message ?? error));
  writeFileSync(join(out, 'requests.json'), JSON.stringify(log, null, 2));
  for (const id of created) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
  }
  process.exit(1);
});
const loggingFetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input.href ?? input.url);
  const response = await fetch(input, init);
  const entry = { method: init?.method ?? 'GET', url, status: response.status };
  if (url.endsWith('/v1/documents') && response.ok)
    created.add((await response.clone().json()).documentId);
  if (!response.ok)
    entry.body = typeof init?.body === 'string' ? init.body.slice(0, 1500) : undefined;
  if (!response.ok) entry.error = (await response.clone().text()).slice(0, 600);
  else if (typeof init?.body === 'string' && url.endsWith(':batchUpdate')) {
    entry.requests = JSON.parse(init.body).requests.map((r) => Object.keys(r)[0]);
  }
  log.push(entry);
  return response;
};

const exporter = createGoogleDocsExporter({
  fetch: loggingFetch,
  endpoints: {
    docs: 'https://docs.googleapis.com/v1',
    drive: 'https://www.googleapis.com/drive/v3',
    upload: 'https://www.googleapis.com/upload/drive/v3',
  },
  resolve: async () => ({
    accessToken: token,
    accountEmail: 'service-account',
    ownerEmail: undefined,
  }),
});

const auth = { authorization: `Bearer ${token}` };
const drive = (path, init = {}) =>
  fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...init,
    headers: { ...auth, ...(init.headers ?? {}) },
  });
const docGet = async (id) => {
  const r = await fetch(`https://docs.googleapis.com/v1/documents/${id}?includeTabsContent=true`, {
    headers: auth,
  });
  if (!r.ok) throw new Error(`documents.get ${r.status}`);
  return r.json();
};

const logoResponse = await fetch(logoUrl);
const logo = { contentType: 'image/png', data: new Uint8Array(await logoResponse.arrayBuffer()) };

const custom = {
  version: 1,
  name: 'Custom',
  accent: '#b4232a',
  font: 'Georgia',
  header: { logo: 'center', organisation: 'Example BV' },
  sections: ['details', 'attendees', 'absent', 'summary', 'actions', 'transcript'].map((id) => ({
    id,
    enabled: true,
    title: {
      details: '',
      attendees: 'Present',
      absent: 'Apologies',
      summary: 'Notes',
      actions: 'To do',
      transcript: 'Transcript',
    }[id],
  })),
  extraBefore: 'Confidential, internal use only.',
  extraAfter: 'Questions? Reply to the organiser.',
  dateFormat: 'long',
  timeFormat: '24h',
  locale: 'en-GB',
  labels: { date: 'Date', time: 'Time', location: 'Location', meeting: 'Meeting' },
};
const base = {
  includeTranscript: true,
  linksTab: true,
  links: [{ label: 'Share link', url: 'https://openminutes.example/s/abc123' }],
  logo,
};
const variants = {
  modern: { ...base, template: 'modern' },
  classic: { ...base, template: 'classic' },
  compact: { ...base, template: 'compact' },
  custom: { ...base, template: 'custom', custom },
};

const results = {};
const verdicts = [];
const note = (ok, text) => verdicts.push(`${ok ? 'OK  ' : 'FAIL'} ${text}`);

for (const [name, options] of Object.entries(variants)) {
  const minutes = { ...demoMinutes, title: `OpenMinutes test ${name}` };
  const outcome = await exporter.export({ meetingId: `e2e-${name}`, minutes, options });
  if (outcome.kind !== 'link') throw new Error(`${name}: ${JSON.stringify(outcome)}`);
  const id = outcome.ref;
  results[name] = id;
  const doc = await docGet(id);
  const tabs = (doc.tabs ?? []).map((t) => t.tabProperties.title);
  const meta = await (await drive(`/files/${id}?fields=name,owners(emailAddress)`)).json();
  note(doc.title === minutes.title && meta.name === minutes.title, `${name}: title "${doc.title}"`);
  note(tabs.join('|') === 'Minutes|Transcript|Links', `${name}: tabs ${tabs.join('|')}`);
  const first = doc.tabs[0].documentTab;
  const tables = first.body.content.filter((c) => c.table).length;
  note(tables >= 1, `${name}: ${tables} table(s) in the Minutes tab`);
  const footers = doc.tabs.map((t) => Object.keys(t.documentTab.footers ?? {}).length);
  note(
    footers.every((n) => n === 1),
    `${name}: footers per tab ${footers.join(',')}`,
  );
  const footerText = doc.tabs.map((t) => JSON.stringify(t.documentTab.footers ?? {})).join('');
  note(footerText.includes('OpenMinutes'), `${name}: footer text contains "OpenMinutes"`);
  note(
    JSON.stringify(first.inlineObjects ?? {}).includes('contentUri'),
    `${name}: logo inline image present`,
  );
  note(
    Boolean(outcome.note) === false,
    `${name}: no export notes${outcome.note ? ` (${outcome.note})` : ''}`,
  );

  const pdf = await drive(`/files/${id}/export?mimeType=application/pdf`);
  if (!pdf.ok) throw new Error(`${name}: pdf export ${pdf.status} ${await pdf.text()}`);
  const pdfPath = join(out, `${name}.pdf`);
  writeFileSync(pdfPath, Buffer.from(await pdf.arrayBuffer()));
  execFileSync('pdftoppm', ['-png', '-r', '60', pdfPath, join(out, name)]);
}

// Re-export updates the same document (and renames it).
{
  const id = results[keep];
  const minutes = { ...demoMinutes, title: `OpenMinutes test ${keep} (updated)` };
  const outcome = await exporter.export({
    meetingId: `e2e-${keep}`,
    minutes,
    options: variants[keep],
    previous: { ref: id, url: `https://docs.google.com/document/d/${id}/edit` },
  });
  const doc = await docGet(id);
  const name = (await (await drive(`/files/${id}?fields=name`)).json()).name;
  note(outcome.ref === id, 'update: same document id reused');
  note(name === minutes.title && doc.title === minutes.title, `update: renamed to "${name}"`);
  note(
    doc.tabs.map((t) => t.tabProperties.title).join('|') === 'Minutes|Transcript|Links',
    'update: still exactly three tabs',
  );
  const pdf = await drive(`/files/${id}/export?mimeType=application/pdf`);
  const pdfPath = join(out, `${keep}-updated.pdf`);
  writeFileSync(pdfPath, Buffer.from(await pdf.arrayBuffer()));
  execFileSync('pdftoppm', ['-png', '-r', '60', pdfPath, join(out, `${keep}-updated`)]);
}

// grantAccess, then clean up every doc except KEEP.
if (shareWith) {
  const id = results.classic;
  const granted = await exporter.grantAccess({
    meetingId: 'e2e',
    url: `https://docs.google.com/document/d/${id}/edit`,
    emails: [shareWith],
  });
  note(granted.failed.length === 0, `grantAccess: ${JSON.stringify(granted)}`);
}
for (const [name, id] of Object.entries(results)) {
  if (name === keep) continue;
  const r = await drive(`/files/${id}`, { method: 'DELETE' });
  created.delete(id);
  note(r.status === 204, `cleanup: deleted ${name} (${r.status})`);
}
writeFileSync(join(out, 'requests.json'), JSON.stringify(log, null, 2));
console.log(verdicts.join('\n'));
console.log(`kept: https://docs.google.com/document/d/${results[keep]}/edit`);
console.log(`failed HTTP calls: ${log.filter((e) => e.status >= 400).length} (see requests.json)`);
