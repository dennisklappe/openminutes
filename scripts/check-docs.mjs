// Parses every ```mermaid block in docs/ and README.md so a broken diagram fails CI.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const mermaid = (await import('mermaid')).default;

async function markdownFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith('.md')) out.push(path);
  }
  return out;
}

const files = [...(await markdownFiles('docs')), 'README.md'];
let blocks = 0;
let failed = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/^```mermaid\n([\s\S]*?)^```/gm)) {
    blocks += 1;
    const line = text.slice(0, match.index).split('\n').length;
    try {
      await mermaid.parse(match[1]);
    } catch (error) {
      failed += 1;
      console.error(
        `${file}:${line}: ${String(error.message ?? error)
          .split('\n')
          .slice(0, 4)
          .join(' | ')}`,
      );
    }
  }
}
// Every guide is in docs/_nav.json (or hidden), every nav page exists and is listed in the docs index.
const nav = JSON.parse(await readFile('docs/_nav.json', 'utf8'));
const overview = await readFile('docs/README.md', 'utf8');
const listed = new Set(nav.hidden);
for (const group of nav.groups) {
  for (const { file } of group.pages) {
    listed.add(file);
    if (!files.includes(join('docs', `${file}.md`))) {
      failed += 1;
      console.error(`docs/_nav.json: ${file}.md does not exist`);
    } else if (file !== 'README' && !overview.includes(`](${file}.md)`)) {
      failed += 1;
      console.error(`docs/README.md: ${file}.md is in the nav but missing from All guides`);
    }
  }
}
for (const file of files.filter((f) => f.startsWith('docs/') && !f.slice(5).includes('/'))) {
  const name = file.slice(5, -3);
  if (!listed.has(name)) {
    failed += 1;
    console.error(`${file}: not in docs/_nav.json, add it to a group or to hidden`);
  }
}

console.log(`${blocks} mermaid blocks in ${files.length} files, ${failed} failed`);
process.exit(failed ? 1 : 0);
