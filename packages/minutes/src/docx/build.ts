import { zipSync, strToU8 } from 'fflate';
import {
  buildDocument,
  tableColumnShares,
  type DocBlock,
  type Run,
  type TableBlock,
} from '../document.js';
import type { DocumentStyle } from '../document-style.js';
import { resolveLook } from '../look.js';
import type { MinutesLogo } from '../logo.js';
import type { RenderOptions } from '../options.js';
import type { Minutes } from '../types.js';
import { imageSize } from './image-size.js';
import { hex, stylesXml } from './styles.js';
import { escapeXml, NS_R, NS_W, REL, XML_HEAD } from './xml.js';

const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const EMU_PER_PT = 12700;
const MAX_LOGO_WIDTH_PT = 220;

const HEADING_STYLE = { 2: 'Heading1', 3: 'Heading2', 4: 'Heading3' } as const;

class Relationships {
  private readonly entries: string[] = [];
  add(type: string, target: string, external = false): string {
    const id = `rId${this.entries.length + 1}`;
    this.entries.push(
      `<Relationship Id="${id}" Type="${REL}/${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`,
    );
    return id;
  }
  xml(): string {
    return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.entries.join('')}</Relationships>`;
  }
}

function runXml(run: Run, style: DocumentStyle, relationships: Relationships): string {
  const props = [
    run.bold && '<w:b/>',
    run.italic && '<w:i/>',
    run.code && `<w:rFonts w:ascii="${style.codeFont}" w:hAnsi="${style.codeFont}"/>`,
    (run.muted || run.href) && `<w:color w:val="${hex(run.href ? style.accent : style.muted)}"/>`,
    run.href && '<w:u w:val="single"/>',
  ]
    .filter(Boolean)
    .join('');
  const body = `<w:r>${props && `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
  return run.href
    ? `<w:hyperlink r:id="${relationships.add('hyperlink', run.href, true)}">${body}</w:hyperlink>`
    : body;
}

class Numbering {
  private next = 3;
  readonly ordered: number[] = [];
  startOrdered(): number {
    const id = this.next++;
    this.ordered.push(id);
    return id;
  }
  xml(): string {
    const level = (format: string, text: string) =>
      `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
    const nums = [
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
      ...this.ordered.map(
        (id) =>
          `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`,
      ),
    ];
    return `${XML_HEAD}<w:numbering xmlns:w="${NS_W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level('bullet', '•')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level('decimal', '%1.')}</w:abstractNum>${nums.join('')}</w:numbering>`;
  }
}

interface Context {
  style: DocumentStyle;
  relationships: Relationships;
  numbering: Numbering;
}

const CONTENT_WIDTH_TWIPS = 9638;

function tableXml(block: TableBlock, context: Context): string {
  const { style, relationships } = context;
  const edge = (side: string) =>
    `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="${hex(style.rule)}"/>`;
  const widths = tableColumnShares(block).map((share) => Math.round(share * CONTENT_WIDTH_TWIPS));
  const cell = (runs: Run[], width: number, header: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(style.soft)}"/>` : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr>${runs
      .map((run) => runXml(header ? { ...run, bold: true } : run, style, relationships))
      .join('')}</w:p></w:tc>`;
  const row = (cells: Run[][], header: boolean) =>
    `<w:tr>${header ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${cells
      .map((runs, column) => cell(runs, widths[column] ?? 0, header))
      .join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH_TWIPS}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${row(block.header, true)}${block.rows.map((cells) => row(cells, false)).join('')}</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`;
}

function headerBorders(style: DocumentStyle, last: boolean): string {
  const bar = style.accentBar
    ? `<w:left w:val="single" w:sz="24" w:space="8" w:color="${hex(style.accent)}"/>`
    : '';
  const rule =
    style.h2Rule && last
      ? `<w:bottom w:val="single" w:sz="12" w:space="10" w:color="${hex(style.ink)}"/>`
      : '';
  const indent = style.accentBar ? '<w:ind w:left="280"/>' : '';
  return bar || rule ? `<w:pBdr>${bar}${rule}</w:pBdr>${indent}` : '';
}

function blocksXml(blocks: DocBlock[], context: Context): string {
  const { style, relationships, numbering } = context;
  let orderedId = 0;
  let previous: DocBlock | undefined;
  const lastHeader = blocks.findLastIndex((block) => 'header' in block && block.header);
  const out: string[] = [];
  blocks.forEach((block, position) => {
    if (block.type === 'footer') return;
    if (block.type === 'table') {
      out.push(tableXml(block, context));
      previous = block;
      return;
    }
    const runs = block.runs.map((run) => runXml(run, style, relationships)).join('');
    const center = 'center' in block && block.center ? '<w:jc w:val="center"/>' : '';
    const header =
      'header' in block && block.header ? headerBorders(style, position === lastHeader) : '';
    if (block.type === 'title') {
      out.push(`<w:p><w:pPr><w:pStyle w:val="Title"/>${header}${center}</w:pPr>${runs}</w:p>`);
    } else if (block.type === 'heading') {
      out.push(
        `<w:p><w:pPr><w:pStyle w:val="${HEADING_STYLE[block.level]}"/></w:pPr>${runs}</w:p>`,
      );
    } else if (block.type === 'item') {
      if (block.ordered && !(previous?.type === 'item' && previous.ordered)) {
        orderedId = numbering.startOrdered();
      }
      const numId = block.ordered ? orderedId : 1;
      out.push(
        `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runs}</w:p>`,
      );
    } else {
      out.push(`<w:p><w:pPr>${header}${center}</w:pPr>${runs}</w:p>`);
    }
    previous = block;
  });
  return out.join('');
}

function logoXml(
  logo: MinutesLogo,
  relationId: string,
  style: DocumentStyle,
  centered: boolean,
): string {
  const size = imageSize(logo);
  const heightPt = style.titlePt > 20 ? 48 : 36;
  const ratio = size ? size.width / size.height : 1;
  const widthPt = Math.min(MAX_LOGO_WIDTH_PT, heightPt * ratio);
  const cx = Math.round(widthPt * EMU_PER_PT);
  const cy = Math.round((widthPt / ratio) * EMU_PER_PT);
  const jc = centered ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : '';
  return `<w:p>${jc}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logo" descr="Logo"/><a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_PIC}"><pic:pic xmlns:pic="${NS_PIC}"><pic:nvPicPr><pic:cNvPr id="0" name="logo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

const part = (name: string) =>
  `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.`;

export function buildDocx(minutes: Minutes, options: RenderOptions): Uint8Array {
  const { style, logo: placement } = resolveLook(options);
  const { main, transcript, chat, links } = buildDocument(minutes, options);
  const relationships = new Relationships();
  const numbering = new Numbering();
  const context: Context = { style, relationships, numbering };
  relationships.add('styles', 'styles.xml');
  relationships.add('numbering', 'numbering.xml');
  const footerRelation = relationships.add('footer', 'footer1.xml');

  const logo =
    options.logo && placement !== 'none' && options.logo.contentType !== 'image/svg+xml'
      ? options.logo
      : undefined;
  const extension = logo?.contentType === 'image/png' ? 'png' : 'jpg';
  const logoRelation = logo ? relationships.add('image', `media/logo.${extension}`) : undefined;

  const section = `<w:footerReference w:type="default" r:id="${footerRelation}"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>`;
  const sectionBreak = `<w:p><w:pPr><w:sectPr>${section}</w:sectPr></w:pPr></w:p>`;
  const body = [
    logo && logoRelation ? logoXml(logo, logoRelation, style, placement === 'center') : '',
    blocksXml(main, context),
    transcript ? sectionBreak + blocksXml(transcript, context) : '',
    chat ? sectionBreak + blocksXml(chat, context) : '',
    links ? sectionBreak + blocksXml(links, context) : '',
  ].join('');
  const document = `${XML_HEAD}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}"><w:body>${body}<w:sectPr>${section}</w:sectPr></w:body></w:document>`;

  const footerBlock = main.find((block) => block.type === 'footer');
  const footerRelations = new Relationships();
  const footerRuns = (footerBlock?.runs ?? [])
    .map((run) => runXml(run, style, footerRelations))
    .join('');
  const footer = `${XML_HEAD}<w:ftr xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${footerRuns}</w:p></w:ftr>`;

  const media = logo ? { [`word/media/logo.${extension}`]: logo.data } : {};
  const types = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>${part('document')}document.main+xml"/>${part('styles')}styles+xml"/>${part('numbering')}numbering+xml"/>${part('footer1')}footer+xml"/></Types>`;
  const root = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;

  return zipSync({
    '[Content_Types].xml': strToU8(types),
    '_rels/.rels': strToU8(root),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(stylesXml(style)),
    'word/numbering.xml': strToU8(numbering.xml()),
    'word/footer1.xml': strToU8(footer),
    'word/_rels/document.xml.rels': strToU8(relationships.xml()),
    'word/_rels/footer1.xml.rels': strToU8(footerRelations.xml()),
    ...media,
  });
}
