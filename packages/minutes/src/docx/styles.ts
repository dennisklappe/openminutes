import type { DocumentStyle } from '../document-style.js';
import { NS_W, XML_HEAD } from './xml.js';

const hex = (color: string) => color.slice(1).toUpperCase();
const half = (pt: number) => Math.round(pt * 2);
const twips = (pt: number) => Math.round(pt * 20);

function paragraphStyle(
  id: string,
  name: string,
  style: DocumentStyle,
  size: number,
  extra: {
    color: string;
    before?: number;
    rule?: boolean;
    bold?: boolean;
    caps?: boolean;
    italic?: boolean;
  },
): string {
  const rule = extra.rule
    ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${hex(style.rule)}"/></w:pBdr>`
    : '';
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/>${rule}<w:spacing w:before="${twips(extra.before ?? 0)}" w:after="${twips(style.gapPt)}"/></w:pPr><w:rPr>${extra.bold === false ? '' : '<w:b/>'}${extra.caps ? '<w:smallCaps/>' : ''}${extra.italic ? '<w:i/>' : ''}<w:color w:val="${hex(extra.color)}"/><w:sz w:val="${half(size)}"/><w:szCs w:val="${half(size)}"/></w:rPr></w:style>`;
}

export function stylesXml(style: DocumentStyle): string {
  const font = `<w:rFonts w:ascii="${style.font}" w:hAnsi="${style.font}" w:cs="${style.font}"/>`;
  return `${XML_HEAD}<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr>${font}<w:color w:val="${hex(style.ink)}"/><w:sz w:val="${half(style.bodyPt)}"/><w:szCs w:val="${half(style.bodyPt)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${twips(style.gapPt)}" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${paragraphStyle('Title', 'Title', style, style.titlePt, { color: style.ink, before: 0 })}${paragraphStyle('Heading1', 'heading 1', style, style.h2Pt, { color: style.accent, before: style.gapPt * 2, rule: style.h2Rule, caps: style.h2SmallCaps })}${paragraphStyle('Heading2', 'heading 2', style, style.h3Pt, { color: style.accent, before: style.gapPt * 1.5, italic: !style.accentBar })}${paragraphStyle('Heading3', 'heading 3', style, style.bodyPt + 1, { color: style.ink, before: style.gapPt })}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="${twips(style.gapPt / 2)}"/><w:ind w:left="720"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="${hex(style.muted)}"/><w:sz w:val="16"/></w:rPr></w:style></w:styles>`;
}

export { hex };
