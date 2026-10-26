export interface DiarizedSpeaker {
  id: number;
  embedding: number[];
  durationMs: number;
}

export interface DiarizedTurn {
  startMs: number;
  endMs: number;
  speaker: number;
  similarity?: number;
  runnerUp?: { speaker: number; similarity: number };
}

export interface EmbedRange {
  startMs: number;
  endMs: number;
}

export interface DiarizationResult {
  speakers: DiarizedSpeaker[];
  turns: DiarizedTurn[];
}

export interface DiarizeOptions {
  numSpeakers?: number;
  signal?: AbortSignal;
}

/** One voice print per requested range, null where the file has no audio. */
export interface EmbeddedLines {
  embeddings: (number[] | null)[];
  /** The embedding model that made them, prints of two models cannot be compared. */
  model: string | undefined;
}

export interface Diarizer {
  diarize(
    audio: { path: string },
    options?: DiarizeOptions,
  ): Promise<DiarizationResult | undefined>;
  embed(audio: { path: string }, ranges: readonly EmbedRange[]): Promise<number[] | undefined>;
  /** A voice print of every range on its own, a range under 0.5 s read from a 1 s window. */
  embedEach(
    audio: { path: string },
    ranges: readonly EmbedRange[],
  ): Promise<EmbeddedLines | undefined>;
}
