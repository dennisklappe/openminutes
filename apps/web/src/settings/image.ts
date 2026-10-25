const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const startsWith = (data: Uint8Array, signature: number[]) =>
  signature.every((byte, index) => data[index] === byte);

export function detectImage(data: Uint8Array): 'png' | 'jpg' | undefined {
  if (startsWith(data, PNG_SIGNATURE)) return 'png';
  if (startsWith(data, JPEG_SIGNATURE)) return 'jpg';
  return undefined;
}
