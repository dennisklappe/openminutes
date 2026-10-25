export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;
export const MAX_LOGO_BYTES = 512 * 1024;

export type LogoType = (typeof LOGO_TYPES)[number];

export interface MinutesLogo {
  contentType: LogoType;
  data: Uint8Array;
}

export const logoExtensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
} as const;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const SVG_ROOT =
  /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>[]*>\s*)?<svg[\s>]/i;
const SVG_ACTIVE =
  /<script|<foreignObject|<iframe|<!ENTITY|\son[a-z]+\s*=|javascript:|data:text\/html/i;

const startsWith = (data: Uint8Array, signature: number[]) =>
  signature.every((byte, index) => data[index] === byte);

export function detectLogo(data: Uint8Array): LogoType | undefined {
  if (data.length === 0 || data.length > MAX_LOGO_BYTES) return undefined;
  if (startsWith(data, PNG)) return 'image/png';
  if (startsWith(data, JPEG)) return 'image/jpeg';
  const text = new TextDecoder().decode(data);
  return SVG_ROOT.test(text) && !SVG_ACTIVE.test(text) ? 'image/svg+xml' : undefined;
}

export const logoDataUri = (logo: MinutesLogo) =>
  `data:${logo.contentType};base64,${Buffer.from(logo.data).toString('base64')}`;
