export interface SegmentWord {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  speaker?: string;
  words?: SegmentWord[];
}

export interface AudioInput {
  path: string;
}

export interface TranscribeOptions {
  language?: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface SummarizeOptions {
  signal?: AbortSignal;
}

export interface TestResult {
  detail?: string;
}

export interface TranscriptionProvider {
  transcribe(audio: AudioInput, options?: TranscribeOptions): Promise<Segment[]>;
  test(): Promise<TestResult>;
}

export interface SummaryProvider {
  readonly model: string;
  readonly maxInputChars: number;
  summarize(transcript: string, prompt: string, options?: SummarizeOptions): Promise<string>;
  test(): Promise<TestResult>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Chunk {
  path: string;
  offsetMs: number;
  durationMs: number;
}

export interface Media {
  prepare(
    path: string,
    maxBytes: number,
  ): Promise<{ chunks: Chunk[]; cleanup: () => Promise<void> }>;
}

export interface Deps {
  fetch: FetchLike;
  media: Media;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}
