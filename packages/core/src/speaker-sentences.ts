import type { OwnedWord } from './speaker-segments.js';
import { coverage } from './speaker-words.js';
import {
  DIARIZATION_WEIGHT,
  endsSentence,
  overlap,
  type SpeakerSpan,
  type Timed,
} from './speaker-types.js';

const LONG_PAUSE_MS = 800;
const EDGE_MS = 400;
const EDGE_WEIGHT = 0.5;
const FRAGMENT_WORDS = 4;
const ALONE_COVERAGE = 0.5;
const INTERJECTION_WORDS = 3;
const INTERJECTION_GAP_MS = 200;
const INTERJECTION_COVERAGE = 0.9;
const TURN_PAUSE_MS = 300;

type Unit = OwnedWord[];

function sentences(words: readonly OwnedWord[]): Unit[] {
  const units: Unit[] = [];
  words.forEach((word, i) => {
    const before = words[i - 1];
    const unit = units.at(-1);
    const split = !before || endsSentence(before) || word.startMs - before.endMs >= LONG_PAUSE_MS;
    if (unit && !split) unit.push(word);
    else units.push([word]);
  });
  return units;
}

function weightedOverlap(word: Timed, span: SpeakerSpan): number {
  const shared = overlap(word, span);
  if (shared <= 0) return 0;
  const edge = Math.min(EDGE_MS, (span.endMs - span.startMs) / 2);
  const interior = overlap(word, {
    startMs: span.startMs + edge,
    endMs: span.endMs - edge,
  });
  const inside = Math.max(0, interior);
  return inside + (shared - inside) * EDGE_WEIGHT;
}

function dominant(unit: Unit, spans: readonly SpeakerSpan[]): string | null {
  const weights = new Map<string, number>();
  for (const word of unit) {
    const length = Math.max(1, word.endMs - word.startMs);
    for (const [participantId, covered] of coverage(word, spans, weightedOverlap)) {
      weights.set(participantId, (weights.get(participantId) ?? 0) + covered * length);
    }
    if (word.hint) {
      weights.set(word.hint, (weights.get(word.hint) ?? 0) + DIARIZATION_WEIGHT * length);
    }
  }
  let best: string | null = null;
  let most = 0;
  for (const [participantId, weight] of weights) {
    if (weight > most) [best, most] = [participantId, weight];
  }
  return best;
}

const covers = (spans: readonly SpeakerSpan[], participantId: string, run: Unit) => {
  const window = { startMs: run[0]?.startMs ?? 0, endMs: run.at(-1)?.endMs ?? 0 };
  const shared = spans
    .filter((span) => span.participantId === participantId)
    .reduce((sum, span) => sum + Math.max(0, overlap(window, span)), 0);
  return shared / Math.max(1, window.endMs - window.startMs);
};

function isTurn(run: Unit, unit: Unit, owner: string, spans: readonly SpeakerSpan[]): boolean {
  const first = run[0];
  const last = run.at(-1);
  const speaker = first?.participantId;
  if (!first || !last || !speaker) return false;
  const shown = covers(spans, speaker, run);
  const before = unit[unit.indexOf(first) - 1];
  const midPhrase =
    !!before && !endsSentence(before) && first.startMs - before.endMs < TURN_PAUSE_MS;
  if (shown >= ALONE_COVERAGE && covers(spans, owner, run) === 0 && !midPhrase) return true;
  const after = unit[unit.indexOf(last) + 1];
  const apart =
    (!before || first.startMs - before.endMs >= INTERJECTION_GAP_MS) &&
    (!after || after.startMs - last.endMs >= INTERJECTION_GAP_MS);
  return run.length <= INTERJECTION_WORDS && apart && shown >= INTERJECTION_COVERAGE;
}

function turnRuns(unit: Unit, owner: string | null, spans: readonly SpeakerSpan[]): Set<OwnedWord> {
  const kept = new Set<OwnedWord>();
  let run: Unit = [];
  const close = () => {
    if (owner && run.length > 0 && isTurn(run, unit, owner, spans)) {
      run.forEach((word) => kept.add(word));
    }
    run = [];
  };
  for (const word of unit) {
    if (word.participantId === owner) close();
    else {
      if (run[0] && run[0].participantId !== word.participantId) close();
      run.push(word);
    }
  }
  close();
  return kept;
}

const continuesAfter = (unit: Unit) => {
  const last = unit.at(-1);
  return !!last && !endsSentence(last);
};
const continuesFrom = (unit: Unit) => /^[a-z]/.test(unit[0]?.text ?? '');

/**
 * A sentence is almost never spoken by two people, so the per-word choice is only a
 * suggestion for where a turn starts. Each sentence (cut at sentence ends and long pauses) goes
 * to the speaker with the most indicator coverage, edges of the indicator counting less, unless
 * someone else's indicator alone covers a run of words that starts after a pause or sentence end, or a short run said apart from
 * the rest is covered by another speaker's indicator. A short fragment next to a
 * different speaker joins the neighbour when the sentence runs on across it.
 */
export function cohereSentences(
  words: readonly OwnedWord[],
  spans: readonly SpeakerSpan[],
): OwnedWord[] {
  const units = sentences(words).map((unit) => {
    const owner = dominant(unit, spans) ?? unit[0]?.participantId ?? null;
    const kept = turnRuns(unit, owner, spans);
    return unit.map((word) => (kept.has(word) ? word : { ...word, participantId: owner }));
  });
  units.forEach((unit, i) => {
    const before = units[i - 1];
    const after = units[i + 1];
    const speaker = unit[0]?.participantId;
    if (unit.length >= FRAGMENT_WORDS) return;
    const join =
      before &&
      before.at(-1)?.participantId !== speaker &&
      continuesAfter(before) &&
      continuesFrom(unit)
        ? before
        : after &&
            after[0]?.participantId !== speaker &&
            continuesAfter(unit) &&
            continuesFrom(after)
          ? after
          : undefined;
    const target = join === before ? before?.at(-1)?.participantId : join?.[0]?.participantId;
    if (join && target !== undefined) unit.forEach((word) => (word.participantId = target));
  });
  return units.flat();
}
