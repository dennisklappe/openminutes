// Applies the worker's silence filtering (packages/core dropSilentSpeech) to a transcript.
// stdin: {"segments": [...], "silences": [{startMs, endMs}]}  stdout: the kept segments.
// Needs `pnpm --filter @openminutes/core build` first. Speaker indicators are empty, as for uploads.
import { dropSilentSpeech } from '../../packages/core/dist/index.js';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { segments, silences } = JSON.parse(raw);
process.stdout.write(JSON.stringify(dropSilentSpeech(segments, silences, [])));
