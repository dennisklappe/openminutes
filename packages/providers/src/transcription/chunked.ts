import type { Chunk, Deps, Segment } from '../types.js';

export const UPLOAD_LIMIT_BYTES = 24 * 1024 * 1024;

export async function transcribeInChunks(
  deps: Deps,
  path: string,
  maxBytes: number,
  transcribeChunk: (chunk: Chunk) => Promise<Segment[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<Segment[]> {
  const { chunks, cleanup } = await deps.media.prepare(path, maxBytes);
  try {
    const segments: Segment[] = [];
    onProgress?.(0, chunks.length);
    for (const [index, chunk] of chunks.entries()) {
      for (const segment of await transcribeChunk(chunk)) {
        segments.push({
          ...segment,
          startMs: segment.startMs + chunk.offsetMs,
          endMs: segment.endMs + chunk.offsetMs,
          ...(segment.words && {
            words: segment.words.map((word) => ({
              ...word,
              startMs: word.startMs + chunk.offsetMs,
              endMs: word.endMs + chunk.offsetMs,
            })),
          }),
        });
      }
      onProgress?.(index + 1, chunks.length);
    }
    return segments;
  } finally {
    await cleanup();
  }
}
