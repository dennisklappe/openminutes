export class TruncatedError extends Error {
  constructor() {
    super('The archive ends unexpectedly');
  }
}

/** Reads exact byte counts from a stream of buffers. */
export class ByteReader {
  private buffer: Buffer = Buffer.alloc(0);
  private ended = false;

  constructor(private readonly source: AsyncIterator<Buffer>) {}

  private async fill(count: number): Promise<void> {
    while (this.buffer.length < count && !this.ended) {
      const next = await this.source.next();
      if (next.done) this.ended = true;
      else
        this.buffer =
          this.buffer.length === 0 ? next.value : Buffer.concat([this.buffer, next.value]);
    }
  }

  /** Up to `count` bytes, fewer only at the end of the stream. */
  async take(count: number): Promise<Buffer> {
    await this.fill(count);
    const taken = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(taken.length);
    return taken;
  }

  async exact(count: number): Promise<Buffer> {
    const taken = await this.take(count);
    if (taken.length < count) throw new TruncatedError();
    return taken;
  }

  /** Pieces that add up to `count` bytes. */
  async *pieces(count: number, onPiece: (length: number) => void): AsyncGenerator<Buffer> {
    let left = count;
    while (left > 0) {
      await this.fill(1);
      if (this.buffer.length === 0) throw new TruncatedError();
      const piece = this.buffer.subarray(0, left);
      this.buffer = this.buffer.subarray(piece.length);
      left -= piece.length;
      onPiece(piece.length);
      yield piece;
    }
  }

  async skip(count: number): Promise<void> {
    const pieces = this.pieces(count, () => undefined);
    let next = await pieces.next();
    while (!next.done) next = await pieces.next();
  }
}
