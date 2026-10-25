import { parseMeetingLink } from '@openminutes/platforms';

export function joinKey(raw: string): string {
  const link = parseMeetingLink(raw);
  if (link) return link.key;
  const trimmed = raw.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, '');
    return `url:${host}/${url.pathname.split('/').filter(Boolean).join('/')}`.toLowerCase();
  } catch {
    return `url:${trimmed.toLowerCase()}`;
  }
}
