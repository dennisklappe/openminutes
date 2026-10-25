export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em' | 'code'; text: string }
  | { type: 'link'; text: string; href: string };

export type Block =
  | { type: 'heading'; level: number; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] };

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/;
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  const body = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

const startsTable = (line: string, next: string | undefined) =>
  line.includes('|') && next !== undefined && next.includes('-') && TABLE_RULE.test(next);

const SHORT_CELL = 32;

function plainLength(cell: Inline[]): number {
  return cell.reduce((total, part) => total + part.text.length, 0);
}

/**
 * Column sizing hint shared with the share page: the column with the longest
 * text takes the remaining width ('col-text'), short columns hug their content ('col-fit')
 * and other long columns are capped at 16rem ('col-cap').
 */
export function tableColumnClasses(header: Inline[][], rows: Inline[][][]): string[] {
  const widths = header.map((cell, column) =>
    Math.max(plainLength(cell), ...rows.map((row) => plainLength(row[column] ?? []))),
  );
  if (widths.length < 2) return widths.map(() => '');
  const text = widths.indexOf(Math.max(...widths));
  return widths.map((width, column) =>
    column === text ? 'col-text' : width <= SHORT_CELL ? 'col-fit' : 'col-cap',
  );
}

export function parseInline(text: string): Inline[] {
  return text
    .split(INLINE)
    .filter((part) => part !== '')
    .map((part): Inline => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return { type: 'strong', text: part.slice(2, -2) };
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return { type: 'code', text: part.slice(1, -1) };
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return { type: 'em', text: part.slice(1, -1) };
      }
      const link = LINK.exec(part);
      if (link?.[1] && link[2]) return { type: 'link', text: link[1], href: link[2] };
      return { type: 'text', text: part };
    });
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ')) });
    }
    paragraph = [];
  };
  const addItem = (ordered: boolean, text: string) => {
    const last = blocks.at(-1);
    const item = parseInline(text);
    if (last?.type === 'list' && last.ordered === ordered) last.items.push(item);
    else blocks.push({ type: 'list', ordered, items: [item] });
  };

  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (startsTable(line, lines[index + 1])) {
      flushParagraph();
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|')) {
        rows.push(tableCells(lines[index] ?? ''));
        index += 1;
      }
      index -= 1;
      const fit = (cells: string[]) => header.map((_, column) => parseInline(cells[column] ?? ''));
      blocks.push({ type: 'table', header: fit(header), rows: rows.map(fit) });
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (line.trim() === '') flushParagraph();
    else if (heading?.[1] !== undefined) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        inline: parseInline(heading[2] ?? ''),
      });
    } else if (bullet?.[1] !== undefined) {
      flushParagraph();
      addItem(false, bullet[1]);
    } else if (numbered?.[1] !== undefined) {
      flushParagraph();
      addItem(true, numbered[1]);
    } else paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}
