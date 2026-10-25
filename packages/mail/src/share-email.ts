export const POWERED_BY = {
  text: 'Powered by OpenMinutes',
  label: 'OpenMinutes',
  url: 'https://github.com/dennisklappe/openminutes',
} as const;

export const DEFAULT_SUBJECT = 'Minutes: {{title}} ({{date}})';
export const DEFAULT_BODY = [
  'Hi,',
  'Here are the minutes of {{title}} on {{date}}.',
  '{{link}}',
].join('\n\n');

export const PLACEHOLDERS = ['title', 'date', 'link'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export interface ShareItem {
  label: string;
  url: string;
}

export interface ShareEmailInput {
  subject: string;
  body: string;
  title: string;
  date: string;
  item?: ShareItem;
}

export interface ShareEmail {
  subject: string;
  text: string;
  html: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

const TOKEN = /\{\{\s*(\w+)\s*\}\}/g;

/** Splits a body template into paragraphs of text and the link. */
function paragraphs(body: string, input: ShareEmailInput): string[] {
  const line = input.item && `${input.item.label}: ${input.item.url}`;
  const placed = /\{\{\s*link\s*\}\}/.test(body);
  const filled = body.replace(TOKEN, (whole, name: string) => {
    if (name === 'title') return input.title;
    if (name === 'date') return input.date;
    if (name === 'link') return line ?? '';
    return name === 'document' ? '' : whole;
  });
  const blocks = filled
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return placed || !line ? blocks : [...blocks, line];
}

const URL_IN_LINE = /^(.*?): (https?:\/\/\S+)$/s;

function htmlBlock(block: string): string {
  const match = URL_IN_LINE.exec(block);
  if (match && !block.includes('\n')) {
    const [, label = '', url = ''] = match;
    return `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>`;
  }
  const linked = escapeHtml(block).replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" style="color:#2760ab">${url}</a>`,
  );
  return `<p style="margin:0 0 16px">${linked.replace(/\n/g, '<br>')}</p>`;
}

export function renderShareEmail(input: ShareEmailInput): ShareEmail {
  const subject = oneLine(
    input.subject.replace(TOKEN, (whole, name: string) =>
      name === 'title' ? input.title : name === 'date' ? input.date : whole,
    ),
  );
  const blocks = paragraphs(input.body, input);
  const text = [...blocks, `--\n${POWERED_BY.text}: ${POWERED_BY.url}`].join('\n\n');
  const html = [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9">',
    '<div style="max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border-radius:12px;font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827">',
    ...blocks.map(htmlBlock),
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">Powered by <a href="${POWERED_BY.url}" target="_blank" rel="noopener noreferrer" style="color:#6b7280">${POWERED_BY.label}</a></p>`,
    '</div></body></html>',
  ].join('');
  return { subject, text, html };
}
