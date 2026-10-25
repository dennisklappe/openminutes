import type { DocumentStyle } from '../document-style.js';
import { POWERED_BY } from '../footer.js';

type Json = Record<string, unknown>;

const FONT_PT = 8;
const rgb = (hex: string) => ({
  color: {
    rgbColor: {
      red: parseInt(hex.slice(1, 3), 16) / 255,
      green: parseInt(hex.slice(3, 5), 16) / 255,
      blue: parseInt(hex.slice(5, 7), 16) / 255,
    },
  },
});

export const createFooterRequest = (tabId: string): Json => ({
  createFooter: {
    type: 'DEFAULT',
    sectionBreakLocation: { segmentId: '', index: 0, tabId },
  },
});

export const clearFooterRequests = (footer: Footer, tabId: string): Json[] =>
  footer.endIndex > 1
    ? [
        {
          deleteContentRange: {
            range: { segmentId: footer.id, startIndex: 0, endIndex: footer.endIndex - 1, tabId },
          },
        },
      ]
    : [];

export interface Footer {
  id: string;
  endIndex: number;
}

/** Fills an empty footer with a small centred, linked "Powered by OpenMinutes" line. */
export function fillFooterRequests(footerId: string, tabId: string, style: DocumentStyle): Json[] {
  const text = POWERED_BY.text;
  const range = (startIndex: number, endIndex: number) => ({
    segmentId: footerId,
    startIndex,
    endIndex,
    tabId,
  });
  const label = text.indexOf(POWERED_BY.label);
  const muted = {
    fontSize: { magnitude: FONT_PT, unit: 'PT' },
    foregroundColor: rgb(style.muted),
    weightedFontFamily: { fontFamily: style.font },
  };
  return [
    { insertText: { location: { segmentId: footerId, index: 0, tabId }, text } },
    {
      updateParagraphStyle: {
        range: range(0, text.length + 1),
        paragraphStyle: { alignment: 'CENTER' },
        fields: 'alignment',
      },
    },
    {
      updateTextStyle: {
        range: range(0, text.length),
        textStyle: muted,
        fields: Object.keys(muted).join(','),
      },
    },
    {
      updateTextStyle: {
        range: range(label, label + POWERED_BY.label.length),
        textStyle: { link: { url: POWERED_BY.url }, underline: true },
        fields: 'link,underline',
      },
    },
  ];
}
