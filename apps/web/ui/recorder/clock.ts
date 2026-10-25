export class RecordingClock {
  private startedAt: number | undefined;
  private accumulated = 0;

  get running(): boolean {
    return this.startedAt !== undefined;
  }

  start(now: number): void {
    this.startedAt ??= now;
  }

  pause(now: number): void {
    if (this.startedAt === undefined) return;
    this.accumulated += now - this.startedAt;
    this.startedAt = undefined;
  }

  elapsed(now: number): number {
    return this.accumulated + (this.startedAt === undefined ? 0 : now - this.startedAt);
  }
}

export const CHUNK_MS = 5000;
const GRACE_CHUNKS = 3;

export function missingChunks(elapsedMs: number, savedChunks: number): boolean {
  return Math.floor(elapsedMs / CHUNK_MS) - savedChunks > GRACE_CHUNKS;
}
