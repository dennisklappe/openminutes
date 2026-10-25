export interface Timed {
  startMs: number;
  endMs: number;
}

export interface SpeakerSpan extends Timed {
  participantId: string;
  /** Voice similarity to the own speaker minus that to the runner up, when a diarizer gave it. */
  margin?: number | undefined;
}

export interface TimedWord extends Timed {
  text: string;
}

export const overlap = (a: Timed, b: Timed) =>
  Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);

export const endsSentence = (word: TimedWord) => /[.!?]["')\]]*$/.test(word.text);

/** How much a diarizing provider's label for a word counts next to a full indicator overlap. */
export const DIARIZATION_WEIGHT = 0.5;
