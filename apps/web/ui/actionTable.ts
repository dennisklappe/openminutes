export interface ActionTable {
  header: string[];
  rows: string[][];
}

export interface SplitSummary {
  before: string;
  table: ActionTable;
  after: string;
}

const RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());

const row = (values: string[]) =>
  `| ${values
    .map((value) =>
      value
        .replace(/\|/g, '\\|')
        .replace(/\s*\n\s*/g, ' ')
        .trim(),
    )
    .join(' | ')} |`;

/** Finds the first Markdown table in a summary, normally the action items, and splits the text around it. */
export function splitActionTable(markdown: string): SplitSummary | null {
  const lines = markdown.split('\n');
  const start = lines.findIndex(
    (line, index) => line.includes('|') && RULE.test(lines[index + 1] ?? '') && line.trim() !== '',
  );
  if (start < 0) return null;
  let end = start + 2;
  while (end < lines.length && (lines[end] ?? '').includes('|')) end += 1;
  const header = cells(lines[start] ?? '');
  const rows = lines.slice(start + 2, end).map((line) => {
    const values = cells(line);
    return header.map((_, column) => values[column] ?? '');
  });
  return {
    before: lines.slice(0, start).join('\n').trim(),
    table: { header, rows },
    after: lines.slice(end).join('\n').trim(),
  };
}

export function joinActionTable({ before, table, after }: SplitSummary): string {
  const rule = `| ${table.header.map(() => '---').join(' | ')} |`;
  const body = table.rows.filter((values) => values.some((value) => value.trim() !== ''));
  return [before, [row(table.header), rule, ...body.map(row)].join('\n'), after]
    .filter((part) => part !== '')
    .join('\n\n');
}
