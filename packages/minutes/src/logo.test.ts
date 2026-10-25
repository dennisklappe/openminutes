import { describe, expect, it } from 'vitest';
import { detectLogo, logoDataUri, MAX_LOGO_BYTES } from './logo.js';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('detectLogo', () => {
  it('recognises PNG, JPEG and SVG', () => {
    expect(detectLogo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(detectLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectLogo(bytes('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'))).toBe(
      'image/svg+xml',
    );
    expect(detectLogo(bytes('<?xml version="1.0"?>\n<!-- c -->\n<svg viewBox="0 0 1 1"/>'))).toBe(
      'image/svg+xml',
    );
  });

  it('rejects other files, empty and oversized data', () => {
    expect(detectLogo(bytes('<html></html>'))).toBeUndefined();
    expect(detectLogo(new Uint8Array())).toBeUndefined();
    expect(detectLogo(new Uint8Array(MAX_LOGO_BYTES + 1).fill(0xff))).toBeUndefined();
  });

  it.each([
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"/>',
    '<svg><foreignObject/></svg>',
    '<svg><a href="javascript:alert(1)"/></svg>',
  ])('rejects active SVG content: %s', (svg) => {
    expect(detectLogo(bytes(svg))).toBeUndefined();
  });

  it('builds a data URI', () => {
    expect(logoDataUri({ contentType: 'image/png', data: new Uint8Array([1, 2, 3]) })).toBe(
      'data:image/png;base64,AQID',
    );
  });
});
