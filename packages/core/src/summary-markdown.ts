import { cleanSummaryText } from './summary-text.js';

export const MAX_SUMMARY_CHARS = 50_000;

const TAG = /<\/?[a-zA-Z!][^>\n]*>?/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizeSummaryMarkdown(input: string): string {
  let text = input.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(TAG, '');
  }
  return cleanSummaryText(text).trim();
}
