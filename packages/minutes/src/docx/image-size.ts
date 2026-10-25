import type { MinutesLogo } from '../logo.js';

interface Size {
  width: number;
  height: number;
}

function jpegSize(data: Uint8Array): Size | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) return undefined;
    const marker = data[offset + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
}

export function imageSize(logo: MinutesLogo): Size | undefined {
  const { data } = logo;
  if (logo.contentType === 'image/png') {
    if (data.length < 24) return undefined;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  return logo.contentType === 'image/jpeg' ? jpegSize(data) : undefined;
}
