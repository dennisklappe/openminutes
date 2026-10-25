const MAX_SNIPPET = 180;

/** The first sentences of a Markdown summary as plain text, without headings or formatting. */
export function summarySnippet(markdown: string): string {
  const text = markdown
    .split('\n')
    .filter((line) => !/^\s*(#{1,6}\s|\|)/.test(line))
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[*_`>]/g, '')
        .trim(),
    )
    .filter(Boolean)
    .join(' ');
  if (text.length <= MAX_SNIPPET) return text;
  const cut = text.slice(0, MAX_SNIPPET);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX_SNIPPET / 2)).replace(/[\s.,;:]+$/, '')}…`;
}
