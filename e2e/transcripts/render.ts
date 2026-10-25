import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TruthUtterance } from './indicator.js';
import type { Scenario } from './scenarios.js';

const PYTHON = process.env['E2E_PYTHON'] ?? 'python3';
const CACHE = process.env['E2E_CACHE'] ?? join(homedir(), '.cache', 'openminutes-e2e');
const here = new URL('.', import.meta.url).pathname;

export function renderMeeting(scenario: Scenario): { wav: string; truth: TruthUtterance[] } {
  const script = JSON.stringify({
    voices: scenario.voices,
    utterances: scenario.utterances,
    gains: scenario.gains,
  });
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
