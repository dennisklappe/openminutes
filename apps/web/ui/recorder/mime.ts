const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return PREFERRED_MIME_TYPES.find((type) => isSupported(type));
}
