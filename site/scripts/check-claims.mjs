#!/usr/bin/env node
/**
 * Lists every sourced fact on the comparison pages with its source URLs and verification date.
 * Warns when the data is older than `reverifyAfterDays` (re-verify with the vendor pages, then bump the date).
 *
 *   node scripts/check-claims.mjs            list everything
 *   node scripts/check-claims.mjs --urls     print only unique source URLs
 *   node scripts/check-claims.mjs --probe    also HEAD-request each URL and report non-2xx/3xx (needs network)
 */
import {
  competitorList,
  om,
  omLimits,
  reverifyAfterDays,
  rows,
  verifiedOn,
} from '../src/facts/seo-facts.mjs';

const args = new Set(process.argv.slice(2));
const ageDays = Math.floor((Date.now() - new Date(verifiedOn).getTime()) / 86_400_000);
const urls = new Set();

const line = (s = '') => console.log(s);
const collect = (src) => src.forEach((u) => urls.add(u));

if (!args.has('--urls')) {
  line(
    `Facts verified on ${verifiedOn} (${ageDays} days ago). Re-verify after ${reverifyAfterDays} days.`,
  );
  line();
  line('OpenMinutes (own docs)');
  for (const r of rows) {
    line(`  ${r.label}: ${om[r.key].value}`);
    om[r.key].src.forEach((u) => line(`      ${u}`));
  }
  for (const l of omLimits) line(`  limit: ${l.text} -> ${l.href}`);
  for (const c of competitorList) {
    line();
    line(`${c.name} (verified ${c.verified})`);
    for (const r of rows) {
      const f = c.rows[r.key];
      line(`  ${r.label}: ${f.value}`);
      f.src.forEach((u) => line(`      ${u}`));
    }
    for (const s of c.strengths) {
      line(`  strength: ${s.text}`);
      s.src.forEach((u) => line(`      ${u}`));
    }
  }
}

for (const r of rows) collect(om[r.key].src);
for (const c of competitorList) {
  for (const r of rows) collect(c.rows[r.key].src);
  c.strengths.forEach((s) => collect(s.src));
}

if (args.has('--urls')) [...urls].sort().forEach((u) => line(u));

if (args.has('--probe')) {
  const bad = [];
  for (const u of urls) {
    try {
      const res = await fetch(u, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'user-agent': 'openminutes-claim-check' },
      });
      if (!res.ok) bad.push(`${res.status} ${u}`);
    } catch (e) {
      bad.push(`ERR ${u} ${e.message}`);
    }
  }
  line();
  line(bad.length ? `Problems:\n${bad.join('\n')}` : 'All source URLs answered.');
}

line();
if (ageDays > reverifyAfterDays) {
  line(
    `STALE: facts are ${ageDays} days old. Re-read every source above, fix the data module and bump verifiedOn.`,
  );
  process.exitCode = 1;
} else {
  line(
    `OK: ${urls.size} unique source URLs. Re-verify by ${new Date(new Date(verifiedOn).getTime() + reverifyAfterDays * 86_400_000).toISOString().slice(0, 10)}.`,
  );
}
