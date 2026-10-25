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

export interface Diarizer {
  diarize(
    audio: { path: string },
    options?: DiarizeOptions,
  ): Promise<DiarizationResult | undefined>;
  embed(audio: { path: string }, ranges: readonly EmbedRange[]): Promise<number[] | undefined>;
}
