import type { SpeakerSpan } from '../../packages/core/src/speakers.js';
import { RoomTracker, SAMPLE_INTERVAL_MS } from '../../apps/bot/src/room-tracker.js';
import { seeded } from './random.js';

export interface TruthUtterance {
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
  interjection: boolean;
}

/**
 * How a platform's speaking indicator behaves. The defaults come from a recorded Teams meeting
 * with two guests (21 October 2026): the indicator refreshes once a second, lights up 0 to 1 s
 * after the speaker starts and stays lit 1 to 2.4 s after they stop, so the bot's events begin
 * 0.1 to 1 s late (median 0.5 s) and end 1.4 to 2.4 s late (median 1.9 s).
 */
export interface IndicatorModel {
  refreshMs: number;
  onsetLagMs: readonly [number, number];
  lingerMs: readonly [number, number];
  flickersPerMinute: number;
  ghostsPerMinute: number;
}

export const TEAMS_LIKE: IndicatorModel = {
  refreshMs: 1000,
  onsetLagMs: [0, 150],
  lingerMs: [1000, 1300],
  flickersPerMinute: 2,
  ghostsPerMinute: 1,
};

/**
 * A recorded Teams meeting with five guests, a host and the bot (22 October 2026): the indicator
 * lit 0.7 to 1.5 s after the speaker started and stayed lit 1.6 to 2.5 s after they stopped, so
 * a one-word reply is entirely over before its tile lights up.
 */
export const TEAMS_FIVE: IndicatorModel = {
  refreshMs: 1000,
  onsetLagMs: [350, 650],
  lingerMs: [1300, 1700],
  flickersPerMinute: 3,
  ghostsPerMinute: 2,
};

/**
 * The failure seen in the second five guest Teams meeting (22 October 2026): the indicator
 * trailed the speaker by anything between 0.7 and 2.5 s, differently at every turn, and stayed lit
 * 1.7 to 2.5 s after they stopped, so the start of a sentence often showed up under the previous
 * speaker.
 */
export const TEAMS_LATE: IndicatorModel = {
  refreshMs: 1000,
  onsetLagMs: [700, 2500],
  lingerMs: [1700, 2500],
  flickersPerMinute: 3,
  ghostsPerMinute: 2,
};

type Window = readonly [number, number];

function litWindows(
  utterances: readonly TruthUtterance[],
  model: IndicatorModel,
  seed: number,
): Map<string, Window[]> {
  const random = seeded(seed);
  const windows = new Map<string, Window[]>();
  for (const { speaker, startMs, endMs } of utterances) {
    const list = windows.get(speaker) ?? [];
    list.push([
      startMs + random.between(...model.onsetLagMs),
      endMs + random.between(...model.lingerMs),
    ]);
    windows.set(speaker, list);
  }
  return windows;
}

function holes(
  speakers: readonly string[],
  durationMs: number,
  model: IndicatorModel,
  seed: number,
): { flickers: Map<string, Window[]>; ghosts: Map<string, Window[]> } {
  const random = seeded(seed);
  const minutes = durationMs / 60_000;
  const scatter = (perMinute: number, lengthMs: Window) => {
    const result = new Map<string, Window[]>();
    for (const speaker of speakers) {
      const count = Math.round(perMinute * minutes);
      const list = Array.from({ length: count }, (): Window => {
        const at = random.between(0, durationMs);
        return [at, at + random.between(...lengthMs)];
      });
      result.set(speaker, list);
    }
    return result;
  };
  return {
    flickers: scatter(model.flickersPerMinute, [300, 900]),
    ghosts: scatter(model.ghostsPerMinute / Math.max(1, speakers.length), [300, 800]),
  };
}

const inside = (windows: readonly Window[] | undefined, at: number) =>
  windows?.some(([from, to]) => at >= from && at < to) ?? false;

/**
 * Plays the meeting through the bot's own room tracker: every 250 ms it sees which tiles show
 * the indicator, where the indicator only changes on the platform's refresh tick.
 */
export function speakerEvents(
  utterances: readonly TruthUtterance[],
  model: IndicatorModel,
  seed: number,
): Map<string, SpeakerSpan[]> {
  const speakers = [...new Set(utterances.map((u) => u.speaker))];
  const durationMs = Math.max(...utterances.map((u) => u.endMs)) + 5000;
  const lit = litWindows(utterances, model, seed);
  const { flickers, ghosts } = holes(speakers, durationMs, model, seed + 1);
  const tracker = new RoomTracker();
  for (let at = 0; at < durationMs; at += SAMPLE_INTERVAL_MS) {
    const tick = Math.floor(at / model.refreshMs) * model.refreshMs;
    const speaking = speakers.filter(
      (speaker) =>
        (inside(lit.get(speaker), tick) && !inside(flickers.get(speaker), tick)) ||
        inside(ghosts.get(speaker), tick),
    );
    tracker.observe({ participants: speakers, speaking }, at);
  }
  const spans = new Map<string, SpeakerSpan[]>();
  for (const event of tracker.finish(durationMs).speakerEvents) {
    const list = spans.get(event.name) ?? [];
    list.push({ participantId: event.name, startMs: event.startMs, endMs: event.endMs });
    spans.set(event.name, list);
  }
  return spans;
}

/** A guess at an indicator that reacts quickly, as the Meet one seems to. */
export const FAST: IndicatorModel = {
  refreshMs: 250,
  onsetLagMs: [0, 100],
  lingerMs: [300, 600],
  flickersPerMinute: 2,
  ghostsPerMinute: 1,
};

/** The Teams behaviour with a lot more flicker, false positives and a longer tail. */
export const NOISY: IndicatorModel = {
  refreshMs: 1000,
  onsetLagMs: [0, 300],
  lingerMs: [1500, 2500],
  flickersPerMinute: 8,
  ghostsPerMinute: 4,
};
