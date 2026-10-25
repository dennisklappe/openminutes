import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assignSpeakers } from '../../packages/core/src/speakers.js';
import type { Segment } from '../../packages/providers/src/types.js';
import { local } from '../../packages/providers/src/transcription/local.js';
import {
  FAST,
  NOISY,
  TEAMS_FIVE,
  TEAMS_LATE,
  TEAMS_LIKE,
  speakerEvents,
  type TruthUtterance,
} from './indicator.js';
import { score, tokens, type HypWord, type RefWord, type Score } from './score.js';
import { scenarios, type Scenario } from './scenarios.js';

const WHISPER_URL = process.env['WHISPER_URL'] ?? 'http://127.0.0.1:8000';
const PYTHON = process.env['E2E_PYTHON'] ?? 'python3';
const CACHE = process.env['E2E_CACHE'] ?? join(homedir(), '.cache', 'openminutes-e2e');
const SEEDS = [1, 2, 3];
const MODELS = {
  teams: TEAMS_LIKE,
  teams5: TEAMS_FIVE,
  late: TEAMS_LATE,
  fast: FAST,
  noisy: NOISY,
};

const here = new URL('.', import.meta.url).pathname;

function renderMeeting(scenario: Scenario): { wav: string; truth: TruthUtterance[] } {
  const script = JSON.stringify({ voices: scenario.voices, utterances: scenario.utterances });
  const key = createHash('sha256')
    .update(script)
    .update(readFileSync(join(here, 'synth.py')))
    .digest('hex')
    .slice(0, 16);
  const out = join(CACHE, 'meetings', `${scenario.name}-${key}`);
  if (!existsSync(join(out, 'truth.json'))) {
    mkdirSync(out, { recursive: true });
    const scriptPath = join(out, 'script.json');
    writeFileSync(scriptPath, script);
    execFileSync(PYTHON, [join(here, 'synth.py'), scriptPath, join(CACHE, 'voices'), out], {
      stdio: 'inherit',
    });
  }
  return {
    wav: join(out, 'meeting.wav'),
    truth: JSON.parse(readFileSync(join(out, 'truth.json'), 'utf8')) as TruthUtterance[],
  };
}

const provider = local.create(
  { baseUrl: WHISPER_URL },
  {
    fetch: (input, init) => fetch(input, init),
    media: { prepare: () => Promise.reject(new Error('not used')) },
    sleep: () => Promise.resolve(),
  },
);

async function transcribe(wav: string): Promise<Segment[]> {
  const key = createHash('sha256')
    .update(readFileSync(wav))
    .update(readFileSync(join(here, '../../services/whisper/app.py')))
    .digest('hex')
    .slice(0, 16);
  const cached = join(CACHE, 'transcripts', `${key}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8')) as Segment[];
  const segments = await provider.transcribe({ path: wav });
  mkdirSync(join(CACHE, 'transcripts'), { recursive: true });
  writeFileSync(cached, JSON.stringify(segments));
  return segments;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const percent = (value: number | undefined) =>
  value === undefined ? '    -' : `${(value * 100).toFixed(1).padStart(5)}%`;

describe('speaker attribution on synthetic meetings', () => {
  const rows: string[] = [];
  const results = new Map<string, { attribution: number; late: number }>();

  for (const scenario of scenarios()) {
    it(scenario.name, async () => {
      const { wav, truth } = renderMeeting(scenario);
      const segments = await transcribe(wav);
      const ref: RefWord[] = truth
        .toSorted((a, b) => a.startMs - b.startMs)
        .flatMap((u, utterance) =>
          tokens(u.text).map((word) => ({
            word,
            speaker: u.speaker,
            interjection: u.interjection,
            utterance,
          })),
        );
      const sentenceEnds =
        segments
          .map((s) => s.text)
          .join(' ')
          .match(/[.?!]/g)?.length ?? 0;

      const attributions = Object.entries(MODELS).map(([model, indicator]) => {
        const scores: Score[] = SEEDS.map((seed) => {
          const events = [...speakerEvents(truth, indicator, seed).values()].flat();
          const hyp: HypWord[] = assignSpeakers(segments, events).flatMap((segment) =>
            tokens(segment.text).map((word) => ({ word, speaker: segment.participantId })),
          );
          return score(ref, hyp);
        });
        return {
          model,
          scores,
          attribution: mean(scores.map((s) => s.attribution)),
          sentences: mean(scores.map((s) => s.sentences)),
        };
      });
      const teams = attributions.find((a) => a.model === 'teams');
      const interjections = (teams?.scores ?? []).flatMap((s) => s.interjections ?? []);
      results.set(scenario.name, {
        attribution: teams?.attribution ?? 0,
        late: attributions.find((a) => a.model === 'late')?.attribution ?? 0,
      });
      rows.push(
        [
          scenario.name.padEnd(16),
          String(scenario.speakers).padStart(2),
          ...attributions.map((a) => `${percent(a.attribution)}/${percent(a.sentences)}`),
          percent(interjections.length ? mean(interjections) : undefined),
          percent(teams?.scores[0]?.wer),
          `${sentenceEnds}/${truth.length} sentence ends, ${segments.length} segments`,
        ].join('  '),
      );
    });
  }

  it('reports and meets the targets', () => {
    console.log(
      [
        'scenario          n  words/sentences per indicator model: teams, teams5, late, fast, noisy | interj  WER',
        ...rows.toSorted(),
      ].join('\n'),
    );
    for (const name of ['two-speakers', 'three-speakers']) {
      expect(results.get(name)?.attribution).toBeGreaterThanOrEqual(0.9);
    }
    expect(results.get('late-turns-4')?.late).toBeGreaterThanOrEqual(0.97);
  });
});
