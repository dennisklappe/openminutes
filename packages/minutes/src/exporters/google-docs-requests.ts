import { tableColumnShares, type DocBlock, type Run, type TableBlock } from '../document.js';
import type { DocumentStyle } from '../document-style.js';

export type DocItem = DocBlock | { type: 'pageBreak' };

type Json = Record<string, unknown>;

export interface TablePlan {
  index: number;
  block: TableBlock;
}

export interface Content {
  requests: Json[];
  tables: TablePlan[];
}

interface Layout {
  text: string;
  paragraphs: { start: number; end: number; block: DocBlock }[];
  runs: { start: number; end: number; run: Run; block: DocBlock }[];
  breaks: number[];
  tables: TablePlan[];
}

const rgb = (hex: string) => ({
  color: {
    rgbColor: {
      red: parseInt(hex.slice(1, 3), 16) / 255,
      green: parseInt(hex.slice(3, 5), 16) / 255,
      blue: parseInt(hex.slice(5, 7), 16) / 255,
    },
  },
});
const pt = (magnitude: number) => ({ magnitude, unit: 'PT' });
const border = (hex: string, width: number, padding = 0) => ({
  color: rgb(hex),
  width: pt(width),
  padding: pt(padding),
  dashStyle: 'SOLID',
});

function layout(items: DocItem[], reserveLogo: boolean): Layout {
  const result: Layout = {
    text: reserveLogo ? '\n' : '',
    paragraphs: [],
    runs: [],
    breaks: [],
    tables: [],
  };
  for (const item of items) {
    if (item.type === 'pageBreak') {
      result.breaks.push(1 + result.text.length);
      continue;
    }
    if (item.type === 'table') {
      result.tables.push({ index: result.text.length, block: item });
      continue;
    }
    const start = 1 + result.text.length;
    let cursor = start;
    for (const run of item.runs) {
      const clean = run.text.replace(/\r?\n/g, ' ');
      result.runs.push({ start: cursor, end: cursor + clean.length, run, block: item });
      result.text += clean;
      cursor += clean.length;
    }
    result.text += '\n';
    result.paragraphs.push({ start, end: cursor + 1, block: item });
  }
  return result;
}

function runStyle(run: Run, style: DocumentStyle, footer: boolean): Json {
  return {
    ...(run.bold && { bold: true }),
    ...(run.italic && { italic: true }),
    ...(run.code && { weightedFontFamily: { fontFamily: style.codeFont } }),
    ...(run.muted && { foregroundColor: rgb(style.muted) }),
    ...(run.href && {
      link: { url: run.href },
      underline: true,
      foregroundColor: rgb(footer ? style.muted : style.accent),
    }),
  };
}

const strong = (style: DocumentStyle): Json => ({
  bold: true,
  weightedFontFamily: { fontFamily: style.font, weight: 700 },
});

const BAR_INDENT = 14;

function headerParagraph(block: DocBlock, style: DocumentStyle, isLast: boolean): Json {
  const centered = 'center' in block && block.center;
  return {
    alignment: centered ? 'CENTER' : 'START',
    ...(style.accentBar && {
      borderLeft: border(style.accent, 4, 8),
      indentStart: pt(BAR_INDENT),
      indentFirstLine: pt(BAR_INDENT),
    }),
    ...(style.h2Rule && isLast && { borderBottom: border(style.ink, 1.5, 10) }),
  };
}

export function contentRequests(
  items: DocItem[],
  style: DocumentStyle,
  options: { tabId?: string | undefined; logoUri?: string | undefined; logoCentered?: boolean },
): Content {
  const { tabId } = options;
  const where = tabId ? { tabId } : {};
  const location = (index: number) => ({ index, ...where });
  const range = (start: number, end: number) => ({ startIndex: start, endIndex: end, ...where });
  const logo = options.logoUri !== undefined;
  const laid = layout(items, logo);
  const { paragraphs, runs, breaks, tables } = laid;
  const text = laid.text.slice(0, -1);
  const requests: Json[] = [{ insertText: { location: location(1), text } }];
  const textStyle = (start: number, end: number, fields: Json) =>
    requests.push({
      updateTextStyle: {
        range: range(start, end),
        textStyle: fields,
        fields: Object.keys(fields).join(','),
      },
    });

  const emphasis: [number, number, Json][] = [];
  const bullets: { start: number; end: number; ordered: boolean }[] = [];
  const lastHeader = paragraphs.findLastIndex(({ block }) => 'header' in block && block.header);
  paragraphs.forEach(({ start, end, block }, position) => {
    const gap = block.type === 'item' ? style.gapPt / 2 : style.gapPt;
    const header = 'header' in block && block.header === true;
    const named =
      block.type === 'title'
        ? 'TITLE'
        : block.type === 'heading'
          ? `HEADING_${block.level}`
          : 'NORMAL_TEXT';
    const paragraphStyle: Json = {
      namedStyleType: named,
      alignment:
        block.type === 'footer' || ('center' in block && block.center) ? 'CENTER' : 'START',
      spaceBelow: pt(block.type === 'title' ? gap * 2 : gap),
      ...(block.type === 'heading' && {
        spaceAbove: pt(style.gapPt * 2),
        keepWithNext: true,
      }),
      ...(block.type === 'heading' &&
        block.level === 2 &&
        style.h2Rule && { borderBottom: border(style.rule, 0.75, 2) }),
      ...(header && headerParagraph(block, style, position === lastHeader)),
    };
    requests.push({
      updateParagraphStyle: {
        range: range(start, end),
        paragraphStyle,
        fields: Object.keys(paragraphStyle).join(','),
      },
    });
    if (block.type === 'item') {
      const last = bullets.at(-1);
      if (last && last.end === start && last.ordered === block.ordered) last.end = end;
      else bullets.push({ start, end, ordered: block.ordered });
    }
    if (block.type === 'title') {
      emphasis.push([start, end - 1, { fontSize: pt(style.titlePt), ...strong(style) }]);
    } else if (block.type === 'heading') {
      emphasis.push([
        start,
        end - 1,
        {
          fontSize: pt(block.level === 2 ? style.h2Pt : style.h3Pt),
          ...strong(style),
          foregroundColor: rgb(block.level === 2 || style.accentBar ? style.accent : style.ink),
          ...(block.level === 2 && style.h2SmallCaps && { smallCaps: true }),
        },
      ]);
    } else if (block.type === 'footer') {
      emphasis.push([start, end - 1, { fontSize: pt(8), foregroundColor: rgb(style.muted) }]);
    }
  });

  textStyle(1, 1 + text.length, {
    weightedFontFamily: { fontFamily: style.font },
    fontSize: pt(style.bodyPt),
    foregroundColor: rgb(style.ink),
    bold: false,
    italic: false,
  });

  for (const [start, end, fields] of emphasis) textStyle(start, end, fields);

  for (const { start, end, run, block } of runs) {
    if (start === end) continue;
    const fields = runStyle(run, style, block.type === 'footer');
    if (Object.keys(fields).length > 0) textStyle(start, end, fields);
  }

  for (const { start, end, ordered } of bullets) {
    requests.push({
      createParagraphBullets: {
        range: range(start, end - 1),
        bulletPreset: ordered ? 'NUMBERED_DECIMAL_ALPHA_ROMAN' : 'BULLET_DISC_CIRCLE_SQUARE',
      },
    });
  }

  for (const index of breaks.reverse()) {
    requests.push({ insertPageBreak: { location: location(index) } });
  }
  if (logo) {
    requests.push({
      updateParagraphStyle: {
        range: range(1, 2),
        paragraphStyle: { alignment: options.logoCentered ? 'CENTER' : 'START' },
        fields: 'alignment',
      },
    });
    requests.push({
      insertInlineImage: {
        location: location(1),
        uri: options.logoUri,
        objectSize: { height: pt(style.titlePt > 20 ? 48 : 36) },
      },
    });
  }
  const shift = logo ? 1 : 0;
  return { requests, tables: tables.map((plan) => ({ ...plan, index: plan.index + shift })) };
}

export function insertTableRequests(tables: TablePlan[], tabId: string | undefined): Json[] {
  return [...tables].reverse().map(({ index, block }) => ({
    insertTable: {
      rows: block.rows.length + 1,
      columns: block.header.length,
      location: { index, ...(tabId && { tabId }) },
    },
  }));
}

interface TableElement {
  startIndex?: number;
  endIndex?: number;
  table?: {
    tableRows?: { tableCells?: { content?: { startIndex?: number }[] }[] }[];
  };
}

const PAGE_WIDTH_PT = 451;

const columnWidths = (block: TableBlock) =>
  tableColumnShares(block).map((share) => Math.round(share * PAGE_WIDTH_PT));

export function fillTableRequests(
  elements: TableElement[],
  tables: TablePlan[],
  style: DocumentStyle,
  tabId: string | undefined,
): Json[] {
  const found = elements.filter((element) => element.table);
  const requests: Json[] = [];
  const where = tabId ? { tabId } : {};
  for (let position = tables.length - 1; position >= 0; position -= 1) {
    const plan = tables[position];
    const element = found[position];
    if (!plan || !element?.table || element.startIndex === undefined) continue;
    const rows = [plan.block.header, ...plan.block.rows];
    // The paragraph Docs adds after a table can go, unless it is the last one of the tab:
    // the final newline of a segment cannot be deleted (Google answers HTTP 400).
    const following = elements.indexOf(element) + 1;
    if (element.endIndex !== undefined && following > 0 && following < elements.length - 1) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: element.endIndex, endIndex: element.endIndex + 1, ...where },
        },
      });
    }
    const tableStart = { index: element.startIndex, ...where };
    const cells = element.table.tableRows ?? [];
    for (let row = rows.length - 1; row >= 0; row -= 1) {
      for (let column = (rows[row]?.length ?? 0) - 1; column >= 0; column -= 1) {
        const start = cells[row]?.tableCells?.[column]?.content?.[0]?.startIndex;
        const runs = rows[row]?.[column] ?? [];
        if (start === undefined) continue;
        const value = runs.map((run) => run.text).join('');
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: start, endIndex: start + 1, ...where },
            paragraphStyle: { spaceBelow: pt(0), spaceAbove: pt(0), namedStyleType: 'NORMAL_TEXT' },
            fields: 'spaceBelow,spaceAbove,namedStyleType',
          },
        });
        if (value !== '')
          requests.push({ insertText: { location: { index: start, ...where }, text: value } });
        let cursor = start;
        const base = {
          weightedFontFamily: { fontFamily: style.font },
          fontSize: pt(style.bodyPt - 0.5),
          foregroundColor: rgb(style.ink),
          bold: false,
          italic: false,
          ...(row === 0 && strong(style)),
        };
        requests.push({
          updateTextStyle: {
            range: { startIndex: start, endIndex: start + Math.max(1, value.length), ...where },
            textStyle: base,
            fields: Object.keys(base).join(','),
          },
        });
        for (const run of runs) {
          const fields = runStyle(run, style, false);
          if (Object.keys(fields).length > 0 && run.text !== '') {
            requests.push({
              updateTextStyle: {
                range: { startIndex: cursor, endIndex: cursor + run.text.length, ...where },
                textStyle: fields,
                fields: Object.keys(fields).join(','),
              },
            });
          }
          cursor += run.text.length;
        }
      }
    }
    const widths = columnWidths(plan.block);
    widths.forEach((width, column) =>
      requests.push({
        updateTableColumnProperties: {
          tableStartLocation: tableStart,
          columnIndices: [column],
          tableColumnProperties: { widthType: 'FIXED_WIDTH', width: pt(width) },
          fields: 'widthType,width',
        },
      }),
    );
    const edge = {
      color: rgb(style.rule),
      width: pt(0.75),
      dashStyle: 'SOLID',
    };
    const header = {
      tableRange: {
        tableCellLocation: { tableStartLocation: tableStart, rowIndex: 0, columnIndex: 0 },
        rowSpan: 1,
        columnSpan: plan.block.header.length,
      },
      tableCellStyle: { backgroundColor: rgb(style.soft) },
      fields: 'backgroundColor',
    };
    const all = {
      tableRange: {
        tableCellLocation: { tableStartLocation: tableStart, rowIndex: 0, columnIndex: 0 },
        rowSpan: rows.length,
        columnSpan: plan.block.header.length,
      },
      tableCellStyle: {
        borderTop: edge,
        borderBottom: edge,
        borderLeft: edge,
        borderRight: edge,
        paddingTop: pt(4),
        paddingBottom: pt(4),
        paddingLeft: pt(6),
        paddingRight: pt(6),
      },
      fields:
        'borderTop,borderBottom,borderLeft,borderRight,paddingTop,paddingBottom,paddingLeft,paddingRight',
    };
    requests.push({ updateTableCellStyle: all }, { updateTableCellStyle: header });
  }
  return requests;
}
