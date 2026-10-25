import { esc } from './format';

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => esc(cell.trim()));

function table(rows: string[]): string {
  const [head = [], , ...body] = rows.map(cells);
  const row = (tag: string, values: string[]) =>
    `<tr>${values.map((value) => `<${tag}>${value}</${tag}>`).join('')}</tr>`;
  return `<div class="table-wrap"><table class="table"><thead>${row('th', head)}</thead><tbody>${body.map((values) => row('td', values)).join('')}</tbody></table></div>`;
}

/** The small subset of Markdown the demo summary uses: headings, bullets, a table and text. */
export function markdown(source: string): string {
  const out: string[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('## ')) out.push(`<h3>${esc(line.slice(3))}</h3>`);
    else if (line.startsWith('|')) {
      const end = lines.findIndex((other, index) => index > i && !other.startsWith('|'));
      const stop = end < 0 ? lines.length : end;
      out.push(table(lines.slice(i, stop)));
      i = stop - 1;
    } else if (line.startsWith('- ')) {
      const items = [esc(line.slice(2))];
      while ((lines[i + 1] ?? '').startsWith('- ')) items.push(esc((lines[++i] ?? '').slice(2)));
      out.push(`<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`);
    } else if (line.trim() !== '') out.push(`<p>${esc(line)}</p>`);
  }
  return out.join('');
}

/** Drops a section, from its heading to the next heading. */
export function withoutSection(source: string, heading: string): string {
  const lines = source.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) return source;
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return [...lines.slice(0, start), ...(next < 0 ? [] : lines.slice(next))].join('\n');
}
