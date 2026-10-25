import { describe, expect, it } from 'vitest';
import { isUncertain, LOW_SPEAKER_CONFIDENCE, scoreSpeaker } from './speaker-confidence.js';

const span = (participantId: string, startMs: number, endMs: number, margin?: number) => ({
  participantId,
  startMs,
  endMs,
  margin,
});

describe('scoreSpeaker', () => {
  it('has no confidence for a line without a speaker', () => {
    const line = { participantId: null, startMs: 0, endMs: 4000 };
    expect(scoreSpeaker(line, [span('a', 0, 4000)], 'indicator')).toEqual({
      confidence: null,
      candidates: null,
    });
  });

  it('is sure when one speaker covers the whole line', () => {
    const line = { participantId: 'a', startMs: 0, endMs: 5000 };
    const score = scoreSpeaker(line, [span('a', 0, 5000)], 'indicator');
    expect(score.confidence).toBe(1);
    expect(score.candidates).toEqual([{ participantId: 'a', score: 1 }]);
  });

  it('loses confidence when a second speaker talks during the line', () => {
    const line = { participantId: 'a', startMs: 0, endMs: 4000 };
    const score = scoreSpeaker(line, [span('a', 0, 2500), span('b', 2000, 4000)], 'indicator');
    expect(score.confidence).toBeLessThan(LOW_SPEAKER_CONFIDENCE);
    expect(score.candidates).toEqual([
      { participantId: 'a', score: 0.56 },
      { participantId: 'b', score: 0.44 },
    ]);
  });

  it('is unsure when no span touches the line', () => {
    const line = { participantId: 'a', startMs: 0, endMs: 4000 };
    expect(scoreSpeaker(line, [], 'indicator')).toEqual({ confidence: 0.25, candidates: [] });
  });

  it('scales a diarized line by the embedding margin', () => {
    const line = { participantId: 'a', startMs: 0, endMs: 6000 };
    const clear = scoreSpeaker(line, [span('a', 0, 6000, 0.4)], 'diarization');
    const close = scoreSpeaker(line, [span('a', 0, 6000, 0.03)], 'diarization');
    expect(clear.confidence).toBe(1);
    expect(close.confidence).toBeCloseTo(0.55, 2);
    expect(isUncertain({ speakerConfidence: close.confidence, speakerSource: 'diarization' })).toBe(
      true,
    );
  });

  it('caps short diarized turns below the uncertain line, whatever the margin', () => {
    const line = { participantId: 'a', startMs: 0, endMs: 2000 };
    const short = scoreSpeaker(line, [span('a', 0, 2000, 0.5)], 'diarization');
    expect(short.confidence).toBe(0.58);
    expect(isUncertain({ speakerConfidence: short.confidence, speakerSource: 'diarization' })).toBe(
      true,
    );
    const shorter = scoreSpeaker({ ...line, endMs: 800 }, [span('a', 0, 800, 0.5)], 'diarization');
    expect(shorter.confidence).toBeLessThan(short.confidence ?? 0);
  });

  it('does not cap short lines of the speaking indicator', () => {
    const line = { participantId: 'a', startMs: 0, endMs: 1000 };
    expect(scoreSpeaker(line, [span('a', 0, 1000)], 'indicator').confidence).toBe(1);
  });
});

describe('isUncertain', () => {
  it('never flags a line a person has confirmed', () => {
    expect(isUncertain({ speakerConfidence: 0.1, speakerSource: 'user' })).toBe(false);
    expect(isUncertain({ speakerConfidence: null, speakerSource: null })).toBe(false);
  });
});
