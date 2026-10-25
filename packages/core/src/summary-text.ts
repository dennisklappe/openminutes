const DASH = /[ \t]*[\u2013\u2014][ \t]*/g;
const RANGE = /(\d)[\u2013\u2014](\d)/g;

export function cleanSummaryText(text: string): string {
  return text.replace(RANGE, '$1-$2').replace(DASH, (match, offset: number, whole: string) => {
    const before = whole[offset - 1];
    const after = whole[offset + match.length];
    if (before === undefined || before === '\n' || before === '|') return after === '|' ? ' ' : '';
    if (after === undefined || after === '\n' || after === '|') return '';
    return ', ';
  });
}
