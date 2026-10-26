export interface ChunkRange {
  index: number;
  start: number;
  end: number;
}

export interface UploadDeps {
  /** Sends one chunk, rejecting with an error that has a `status` for HTTP failures. */
  send: (index: number, body: Blob) => Promise<void>;
  onProgress: (sentBytes: number) => void;
  attempts?: number;
  wait?: (ms: number) => Promise<void>;
}

const RETRY_DELAY_MS = 1000;
const ARCHIVE_NAME = /\.(tar\.gz|tgz|zip)$/i;

export function chunkRanges(size: number, chunkBytes: number): ChunkRange[] {
  const count = Math.max(1, Math.ceil(size / chunkBytes));
  return Array.from({ length: count }, (_, index) => ({
    index,
    start: index * chunkBytes,
    end: Math.min(size, (index + 1) * chunkBytes),
  }));
}

/** Why this file cannot be imported, undefined when it can. */
export function archiveProblem(
  file: { name: string; size: number },
  maxBytes: number,
): string | undefined {
  if (!ARCHIVE_NAME.test(file.name)) return 'Choose the .tar.gz or .zip file from Fireflies.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > maxBytes) {
    return `That file is larger than the ${formatSize(maxBytes)} this server accepts.`;
  }
  return undefined;
}

export function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

const retryable = (error: unknown) => {
  const status = (error as { status?: unknown }).status;
  return typeof status !== 'number' || status >= 500 || status === 408 || status === 429;
};

export async function uploadChunks(
  file: Blob,
  chunkBytes: number,
  deps: UploadDeps,
): Promise<number> {
  const attempts = deps.attempts ?? 3;
  const wait = deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const ranges = chunkRanges(file.size, chunkBytes);
  for (const { index, start, end } of ranges) {
    for (let attempt = 1; ; attempt++) {
      try {
        await deps.send(index, file.slice(start, end, 'application/octet-stream'));
        break;
      } catch (error) {
        if (attempt >= attempts || !retryable(error)) throw error;
        await wait(RETRY_DELAY_MS * attempt);
      }
    }
    deps.onProgress(end);
  }
  return ranges.length;
}
