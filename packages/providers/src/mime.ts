import { extname } from 'node:path';

const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

export function mimeFor(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}
