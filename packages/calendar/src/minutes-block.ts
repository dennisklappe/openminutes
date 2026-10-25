export interface EventBody {
  content: string;
  html: boolean;
}

const BLOCK = /Minutes \(OpenMinutes\): [\s\S]*?Powered by OpenMinutes(?:<\/small>)?/;
const HTML_TAG = /<\/?(?:br|p|div|a|b|i|u|ul|ol|li|span|strong|em|html|body|table)\b/i;

export const looksLikeHtml = (content: string) => HTML_TAG.test(content);

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function renderBlock(url: string, html: boolean): string {
  return html
    ? `Minutes (OpenMinutes): <a href="${escapeHtml(url)}">${escapeHtml(url)}</a><br><small>Powered by OpenMinutes</small>`
    : `Minutes (OpenMinutes): ${url}\nPowered by OpenMinutes`;
}

function append(content: string, block: string, html: boolean): string {
  if (content.trim() === '') return block;
  if (!html) return `${content.trimEnd()}\n\n${block}`;
  const closing = /<\/body>(?![\s\S]*<\/body>)/i.exec(content);
  const joined = `<br><br>${block}`;
  return closing
    ? `${content.slice(0, closing.index)}${joined}${content.slice(closing.index)}`
    : `${content}${joined}`;
}

/** The body with the minutes block set to this link: replaced when present, appended otherwise. */
export function withMinutesLink(body: EventBody, url: string): EventBody {
  const block = renderBlock(url, body.html);
  return {
    html: body.html,
    content: BLOCK.test(body.content)
      ? body.content.replace(BLOCK, () => block)
      : append(body.content, block, body.html),
  };
}
