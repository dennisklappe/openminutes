import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectSpeechRange, dropSilentSpeech, type SilentRange } from '@openminutes/core';
import { createTranscriptionProvider } from '@openminutes/providers';
import { describe, expect, it } from 'vitest';
import { toTranscriptRows } from './transcript-store.js';

const DURATION_MS = 330_422;

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../test/fixtures/teams-five-person/${name}.json`, import.meta.url),
      'utf8',
    ),
  );

async function replay() {
  const provider = createTranscriptionProvider(
    'openai',
    { apiKey: 'k' },
    {
      fetch: () => Promise.resolve(new Response(JSON.stringify(fixture('whisper')))),
      media: {
        prepare: (path) =>
          Promise.resolve({
            chunks: [{ path, offsetMs: 0, durationMs: DURATION_MS }],
            cleanup: () => Promise.resolve(),
          }),
      },
      sleep: () => Promise.resolve(),
    },
  );
  const segments = await provider.transcribe({ path: fileURLToPath(import.meta.url) });
  const spans = (fixture('spans') as { speaker: string; startMs: number; endMs: number }[]).map(
    (s) => ({
      participantId: s.speaker,
      startMs: s.startMs,
      endMs: s.endMs,
    }),
  );
  const cleaned = dropSilentSpeech(segments, fixture('silences') as SilentRange[], spans);
  return {
    range: detectSpeechRange(cleaned, DURATION_MS),
    lines: toTranscriptRows('m', cleaned, spans).map((r) => `${r.participantId}: ${r.text}`),
  };
}

/**
 * A recorded Teams meeting with five speakers: whisper-1 output (segments with their no-speech
 * measures and word times), the active-speaker events and the silent stretches ffmpeg found.
 * The first 91 s and the last 154 s of the recording are digitally silent.
 */
describe('replay of the five person Teams meeting', () => {
  it('drops the text invented in the silent start and end and trims to the speech', async () => {
    const { range, lines } = await replay();

    expect(lines.join('\n')).not.toMatch(/Thank you|Iawn/);
    expect(range).toEqual({ startMs: 88_880, endMs: 178_260 });
  });

  it('keeps the punctuation of the segment text on the words', async () => {
    const { lines } = await replay();

    expect(lines).toContain(
      'Alice: Good morning, everyone. Today we are planning the launch of the new mobile app.',
    );
    expect(lines).toContain('Alice: The release date is the 14th of November.');
    expect(lines).toContain('Eve: Do we have a budget for the launch event?');
    expect(lines).toContain('Alice: I will confirm the budget of 5,000 euros with finance.');
  });

  it('keeps the first word of a turn and the last word of a segment', async () => {
    const { lines } = await replay();

    expect(lines).toContain(
      'Carol: I can prepare the demo videos for the event if Dave shares the staging link.',
    );
    expect(lines).toContain(
      'Bob: One risk is the app store review. Last time it took a week, so we should submit the bill by the 7th of November.',
    );
    expect(lines).toContain(
      'Bob: Understood. I will submit the build on the 7th and report back on Friday.',
    );
  });

  it('gives a quick reply to the person who said it, not to the speaker before', async () => {
    const { lines } = await replay();

    expect(lines).toContain(
      'Alice: Perfect. Eve, please send the notes to the whole team after the call.',
    );
    expect(lines).toContain('Eve: Will do. I will share the notes tomorrow morning.');
    expect(lines).toContain('Dave: Sure. I will send the staging link to Carol this afternoon.');
  });
});
