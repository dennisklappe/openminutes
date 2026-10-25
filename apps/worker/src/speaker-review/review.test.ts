import type { SpeakerSpan } from '@openminutes/core';
import type { Segment, SummaryProvider } from '@openminutes/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toTranscriptRows } from '../transcript-store.js';
import type { Person, ReviewLine } from './lines.js';
import { reviewLines } from './review.js';

const ids = { one: 'p1', two: 'p2' };
const people: Person[] = [
  { id: ids.one, name: 'Speaker 1' },
  { id: ids.two, name: 'Speaker 2' },
];

function modelAnswering(
  answer: (input: string, call: number) => string | Error,
  maxInputChars = 100_000,
): SummaryProvider & { inputs: string[] } {
  const inputs: string[] = [];
  return {
    model: 'fake',
    maxInputChars,
    inputs,
    summarize: (input) => {
      const reply = answer(input, inputs.length);
      inputs.push(input);
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
    test: () => Promise.resolve({}),
  };
}

const changes = (...pairs: [number, string][]) =>
  JSON.stringify({ changes: pairs.map(([index, speaker]) => ({ index, speaker })) });

const markedIndexes = (input: string) =>
  [...input.matchAll(/^\[(\d+)\]\?/gm)].map((match) => Number(match[1]));

afterEach(() => vi.restoreAllMocks());

describe('replay of a dialog where the diarizer merged two speakers', () => {
  const segments: Segment[] = [
    {
      startMs: 0,
      endMs: 8000,
      text: 'De nieuwe laptop is klaar en het ging prima. Heb je hem al getest?',
    },
    { startMs: 8000, endMs: 10_000, text: 'Ja, hij doet het.' },
    { startMs: 10_000, endMs: 12_000, text: 'Dat was fijn.' },
    {
      startMs: 12_000,
      endMs: 40_000,
      text: 'Ja, vertel. Nou, ik heb vandaag de pitch gemaakt en die is klaar voor morgen.',
    },
  ];
  const spans: SpeakerSpan[] = [
    { participantId: ids.one, startMs: 0, endMs: 12_000, margin: 0.05 },
    { participantId: ids.two, startMs: 12_000, endMs: 40_000, margin: 0.4 },
  ];
  const rows = () =>
    toTranscriptRows('m', segments, spans, null, 'diarization').map((row) => ({
      startMs: row.startMs,
      endMs: row.endMs,
      text: row.text,
      participantId: row.participantId ?? null,
      speakerConfidence: row.speakerConfidence ?? null,
      speakerSource: row.speakerSource ?? null,
      speakerCandidates: row.speakerCandidates ?? null,
      previousParticipantId: null,
    }));

  it('scores the short lines low and the long monologue high', () => {
    const [, ja, fijn, monologue] = rows();
    expect(ja?.speakerConfidence).toBeLessThan(0.7);
    expect(fijn?.speakerConfidence).toBeLessThan(0.7);
    expect(monologue?.speakerConfidence).toBe(1);
    expect(ja?.participantId).toBe(ids.one);
    expect(fijn?.participantId).toBe(ids.one);
  });

  it('lets the model move the answer to the other speaker', async () => {
    const model = modelAnswering(() => changes([1, 'Speaker 2']));
    const review = await reviewLines(model, rows(), people);

    expect(review.lines.map((line) => line.participantId)).toEqual([
      ids.one,
      ids.two,
      ids.one,
      ids.two,
    ]);
    expect(review.lines[1]).toMatchObject({
      speakerSource: 'ai',
      previousParticipantId: ids.one,
      text: 'Ja, hij doet het.',
    });
    expect(review.lines[2]?.speakerSource).toBe('diarization');
    expect(review).toMatchObject({ refined: true, error: null });
    expect(markedIndexes(model.inputs[0] ?? '')).toEqual([0, 1, 2]);
    expect(model.inputs[0]).toContain('[3] 12.0-40.0, Speaker 2: Ja, vertel.');
  });

  it('guesses only the obvious answer when there is no model', async () => {
    const review = await reviewLines(undefined, rows(), people);

    expect(review.lines.map((line) => line.participantId)).toEqual([
      ids.one,
      ids.two,
      ids.one,
      ids.two,
    ]);
    expect(review.lines.map((line) => line.speakerSource)).toEqual([
      'diarization',
      'guess',
      'diarization',
      'diarization',
    ]);
    expect(review.lines[1]?.previousParticipantId).toBe(ids.one);
    expect(review.refined).toBe(false);
  });
});

describe('model batches', () => {
  const lines = (count: number, uncertainEvery = 1): ReviewLine[] =>
    Array.from({ length: count }, (_, i) => ({
      startMs: i * 5500,
      endMs: i * 5500 + 4000,
      text: `Statement number ${String(i)} about the plan.`,
      participantId: i % 2 === 0 ? ids.one : ids.two,
      speakerConfidence: i % uncertainEvery === 0 ? 0.4 : 0.95,
      speakerSource: 'diarization',
      speakerCandidates: null,
      previousParticipantId: null,
    }));

  it('rejects only the batch that changes far too many lines and applies the rest', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const model = modelAnswering((input, call) => {
      const marked = markedIndexes(input);
      if (call === 1)
        return changes(
          ...marked.map((i): [number, string] => [i, i % 2 ? 'Speaker 1' : 'Speaker 2']),
        );
      const first = marked[0] ?? 0;
      return changes([first, first % 2 ? 'Speaker 1' : 'Speaker 2']);
    });
    const input = lines(44);

    const review = await reviewLines(model, input, people);

    expect(model.inputs).toHaveLength(5);
    const changed = review.lines.flatMap((line, i) => (line === input[i] ? [] : [i]));
    expect(changed).toEqual([0, 20, 30, 40]);
    expect(review.lines[10]).toBe(input[10]);
    expect(review).toMatchObject({ refined: true, error: null });
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).toContain('too many lines');
  });

  it('skips a batch whose request fails and reports when every batch fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const flaky = modelAnswering((input, call) =>
      call === 0 ? new Error('rate limited') : changes([markedIndexes(input)[0] ?? 0, 'Speaker 2']),
    );
    const some = await reviewLines(flaky, lines(25), people);
    expect(some).toMatchObject({ refined: true, error: null });
    expect(some.lines.filter((line) => line.speakerSource === 'ai').length).toBeGreaterThan(0);

    const broken = modelAnswering(() => new Error('down'));
    expect(await reviewLines(broken, lines(25), people)).toMatchObject({
      refined: false,
      error: 'The model gave no usable answer',
    });
  });

  it('keeps every request within the input limit of the model', async () => {
    const model = modelAnswering(() => changes(), 3000);
    await reviewLines(model, lines(60), people);
    expect(model.inputs.length).toBeGreaterThan(6);
    for (const input of model.inputs) expect(input.length).toBeLessThan(3000);
  });

  it('never sends or changes lines a person confirmed', async () => {
    const model = modelAnswering(() => changes([0, 'Speaker 2']));
    const input = lines(3).map((line, i) =>
      i === 0 ? { ...line, speakerSource: 'user' as const, speakerConfidence: 0.1 } : line,
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const review = await reviewLines(model, input, people);

    expect(markedIndexes(model.inputs[0] ?? '')).toEqual([1, 2]);
    expect(review.lines[0]).toBe(input[0]);
  });

  it('sends nothing when no line is uncertain', async () => {
    const model = modelAnswering(() => changes());
    const review = await reviewLines(
      model,
      lines(8, 100).map((l) => ({ ...l, speakerConfidence: 0.95 })),
      people,
    );
    expect(model.inputs).toHaveLength(0);
    expect(review.refined).toBe(true);
  });
});
