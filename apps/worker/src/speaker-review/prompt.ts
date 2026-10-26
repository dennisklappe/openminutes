import type { ReviewLine } from './lines.js';

export const INSTRUCTIONS = `You correct speaker labels in a meeting transcript. Each line is "[index] start-end in seconds, label: text". Lines marked with a question mark after the index, like "[12]?", have a label that may be wrong, with how sure the audio analysis was and which speakers it considered. The other lines are context and are not to be changed.

Keep the label unless the conversation clearly shows it is wrong. The audio analysis is evidence too: a label it was sure about stays. A sentence is almost never said by two people. Use who answered whom (an answer comes from someone other than the one who asked), names used to address someone ("Thanks, Alice" is said by someone other than Alice), and who owns a topic. Short replies are the most often wrong. Use only the indexes of lines marked with a question mark, and for such a line only a speaker named after "considered" with at least 20%, never anyone else.

Reply with JSON only, in exactly this shape: {"changes":[{"index":<number>,"speaker":"<name>"}]}. Use {"changes":[]} when nothing is clearly wrong. Include only lines whose label you change.`;

export interface Batch {
  uncertain: number[];
  from: number;
  to: number;
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);
const percent = (score: number) => `${String(Math.round(score * 100))}%`;

function describeLine(
  line: ReviewLine,
  index: number,
  uncertain: boolean,
  names: ReadonlyMap<string, string>,
): string {
  const speaker = (line.participantId && names.get(line.participantId)) || 'unknown';
  const head = `[${String(index)}]${uncertain ? '?' : ''} ${seconds(line.startMs)}-${seconds(line.endMs)}, ${speaker}`;
  if (!uncertain) return `${head}: ${line.text}`;
  const sure = line.speakerConfidence === null ? '' : `${percent(line.speakerConfidence)} sure`;
  const considered = (line.speakerCandidates ?? [])
    .map((c) => `${names.get(c.participantId) ?? 'unknown'} ${percent(c.score)}`)
    .join(', ');
  const notes = [sure, considered && `considered ${considered}`].filter(Boolean).join('; ');
  return `${head}${notes ? ` (${notes})` : ''}: ${line.text}`;
}

/** Names and text of one batch with its context lines, nothing else: no audio and no emails. */
export function renderBatch(
  lines: readonly ReviewLine[],
  batch: Batch,
  names: ReadonlyMap<string, string>,
): string {
  const marked = new Set(batch.uncertain);
  const body = lines
    .slice(batch.from, batch.to)
    .map((line, i) => describeLine(line, batch.from + i, marked.has(batch.from + i), names));
  return [`Speakers: ${[...new Set(names.values())].join(', ')}`, '', 'Transcript:', ...body].join(
    '\n',
  );
}
