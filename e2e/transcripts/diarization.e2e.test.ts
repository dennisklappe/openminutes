import { describe, expect, it } from 'vitest';
import { createLocalDiarizer } from '../../packages/providers/src/diarization/local.js';
import type { DiarizationResult } from '../../packages/providers/src/diarization/types.js';
import { attributedShare, shortTurnAccuracy } from './diarization-score.js';
import { phoneScenarios } from './phone-scenarios.js';
import { renderMeeting } from './render.js';

const WHISPER_URL = process.env['WHISPER_URL'] ?? 'http://127.0.0.1:8000';
const diarizer = createLocalDiarizer(
  { baseUrl: WHISPER_URL },
  { fetch: (input, init) => fetch(input, init) },
);

interface Row {
  name: string;
  truth: number;
  found: number;
  share: number;
  knownFound: number;
  knownShare: number;
  short: number | undefined;
}

const percent = (value: number) => `${(value * 100).toFixed(1).padStart(5)}%`;
const scenarios = phoneScenarios();
const byName = (name: string) => rows.find((row) => row.name === name);
const rows: Row[] = [];

async function run(path: string, numSpeakers?: number): Promise<DiarizationResult> {
  const result = await diarizer.diarize({ path }, numSpeakers ? { numSpeakers } : {});
  if (!result) throw new Error('the service reports diarization as unavailable');
  return result;
}

describe('diarization on synthetic phone conversations', () => {
  for (const scenario of scenarios) {
    it(scenario.name, async () => {
      const { wav, truth } = renderMeeting(scenario);
      const auto = await run(wav);
      const known = await run(wav, scenario.speakers);
      rows.push({
        name: scenario.name,
        truth: scenario.speakers,
        found: auto.speakers.length,
        share: attributedShare(auto.turns, truth),
        knownFound: known.speakers.length,
        knownShare: attributedShare(known.turns, truth),
        short: shortTurnAccuracy(auto.turns, truth),
      });
    });
  }

  it('reports and meets the targets', () => {
    console.log(
      [
        'scenario    true  found  attributed  short | with the count given: found  attributed',
        ...rows
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map(
            (r) =>
              `${r.name.padEnd(10)}  ${String(r.truth).padStart(4)}  ${String(r.found).padStart(5)}  ${percent(r.share)}  ${r.short === undefined ? '    -' : percent(r.short)}  |  ${String(r.knownFound).padStart(21)}  ${percent(r.knownShare)}`,
          ),
      ].join('\n'),
    );
    const talking = rows.filter((row) => row.truth > 1);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const counted = talking.filter((row) => row.found === row.truth).length;
    console.log(
      `speaker count right in ${String(counted)}/${String(talking.length)}, attributed ${percent(mean(talking.map((r) => r.share)))} (count unknown) and ${percent(mean(talking.map((r) => r.knownShare)))} (count given)`,
    );
    expect(counted / talking.length).toBeGreaterThanOrEqual(0.7);
    expect(mean(talking.map((row) => row.share))).toBeGreaterThanOrEqual(0.8);
    expect(mean(talking.map((row) => row.knownShare))).toBeGreaterThanOrEqual(0.85);
    for (const row of talking) expect(row.knownShare).toBeGreaterThanOrEqual(0.7);
    const rapid = rows.filter((row) => row.name.startsWith('rapid'));
    expect(rapid.length).toBeGreaterThan(0);
    for (const row of rapid) expect(row.short).toBeGreaterThanOrEqual(0.9);
    expect(byName('pause-1')?.found).toBe(1);
    expect(byName('pause-1')?.share).toBeGreaterThanOrEqual(0.95);
  });
});
