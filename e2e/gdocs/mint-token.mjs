// Mints a Google access token for a service account (JWT bearer flow) and prints it.
// Input: the service account JSON key in env GOOGLE_SA_KEY (never a file, never committed).
// Alternative: GOOGLE_USER_TOKEN_FILE (a stored OAuth refresh token JSON) + GOOGLE_OAUTH_CLIENT_FILE
// make it exchange that refresh token instead, so the docs belong to that user (real Docs quota).
// Usage: GOOGLE_ACCESS_TOKEN=$(GOOGLE_SA_KEY="$(cat service-account.json)" node e2e/gdocs/mint-token.mjs)
import { createSign } from 'node:crypto';
import { URLSearchParams } from 'node:url';

// Accepts raw JSON or base64 JSON. Parse errors never include the input.
function readKey(raw = '') {
  for (const text of [raw, Buffer.from(raw, 'base64').toString('utf8')]) {
    try {
      return JSON.parse(text);
    } catch {
      // try the next form
    }
  }
  console.error('GOOGLE_SA_KEY is neither JSON nor base64 JSON');
  process.exit(1);
}
if (process.env.GOOGLE_USER_TOKEN_FILE) {
  const { readFileSync } = await import('node:fs');
  const client = JSON.parse(readFileSync(process.env.GOOGLE_OAUTH_CLIENT_FILE ?? '', 'utf8'));
  const { client_id, client_secret } = client.installed ?? client.web;
  const { refresh_token } = JSON.parse(readFileSync(process.env.GOOGLE_USER_TOKEN_FILE, 'utf8'));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id,
      client_secret,
      refresh_token,
    }),
  });
  const b = await r.json();
  if (!b.access_token) {
    console.error(`Refresh failed: ${r.status} ${b.error ?? ''}`);
    process.exit(1);
  }
  process.stdout.write(b.access_token);
  process.exit(0);
}
const key = readKey(process.env.GOOGLE_SA_KEY);
const scope = 'https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: key.client_email,
  scope,
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
})}`;
const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
const response = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${signature}`,
  }),
});
const body = await response.json();
if (!body.access_token) {
  console.error(`Token request failed: ${response.status} ${body.error ?? ''}`);
  process.exit(1);
}
process.stdout.write(body.access_token);
