import type { SummaryProvider } from '@openminutes/providers';
import { describe, expect, it } from 'vitest';
import { splitText, summarizeTranscript } from './summarize.js';

function fakeProvider(maxInputChars: number, reply: (input: string, prompt: string) => string) {
  const calls: { input: string; prompt: string }[] = [];
  const provider: SummaryProvider = {
    model: 'fake',
    maxInputChars,
    summarize: (input, prompt) => {
      calls.push({ input, prompt });
      return Promise.resolve(reply(input, prompt));
    },
    test: () => Promise.resolve({}),
  };
  return { provider, calls };
}

describe('splitText', () => {
  it('packs whole lines into parts within the limit', () => {
    const parts = splitText(['aaaa', 'bbbb', 'cccc', 'dd'].join('\n'), 9);
    expect(parts).toEqual(['aaaa\nbbbb', 'cccc\ndd']);
  });

  it('splits a single line longer than the limit', () => {
    expect(splitText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('never exceeds the limit and loses no text', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i} ${'x'.repeat(i % 13)}`).join('\n');
    const parts = splitText(text, 40);
    expect(parts.every((p) => p.length <= 40)).toBe(true);
    expect(parts.join('\n')).toBe(text);
  });
});

describe('summarizeTranscript', () => {
  it('sends a short transcript in a single request with the prompt', async () => {
    const { provider, calls } = fakeProvider(1000, () => 'Summary.');
    expect(await summarizeTranscript(provider, 'short', 'Be brief')).toBe('Summary.');
    expect(calls).toEqual([{ input: 'short', prompt: 'Be brief' }]);
  });

  it('summarises each part, then the combined notes with the user prompt', async () => {
    const transcript = Array.from({ length: 6 }, (_, i) => `[00:00:0${i}] line ${i}`).join('\n');
    const { provider, calls } = fakeProvider(60, (_, prompt) =>
      prompt.startsWith('You are given excerpt') ? 'n' : 'Final.',
    );
    expect(await summarizeTranscript(provider, transcript, 'Be brief')).toBe('Final.');

    const final = calls.at(-1);
    expect(final?.prompt).toContain('Be brief');
    expect(final?.prompt).toContain('set of notes');
    expect(final?.input).toContain('### Excerpt 1');
    const partCalls = calls.slice(0, -1);
    expect(partCalls.length).toBeGreaterThan(1);
    expect(partCalls.every((c) => c.input.length <= 60)).toBe(true);
    expect(partCalls.map((c) => c.input).join('\n')).toBe(transcript);
    expect(partCalls[0]?.prompt).toContain(`excerpt 1 of ${partCalls.length}`);
  });

  it('condenses notes again when they do not fit', async () => {
    const transcript = Array.from({ length: 8 }, (_, i) => `row ${i} ${'x'.repeat(20)}`).join('\n');
    const { provider, calls } = fakeProvider(100, (input, prompt) => {
      if (!prompt.startsWith('You are given excerpt')) return 'Final.';
      return input.startsWith('### Excerpt') ? 'n' : 'a note of about thirty characters';
    });
    expect(await summarizeTranscript(provider, transcript, 'p')).toBe('Final.');
    expect(calls.some((c) => c.input.startsWith('### Excerpt'))).toBe(true);
    expect(calls.every((c) => c.input.length <= 100)).toBe(true);
  });

  it('adds the chat after the transcript with the chat instructions', async () => {
    const { provider, calls } = fakeProvider(1000, () => 'Summary.');
    await summarizeTranscript(
      provider,
      '[00:00:01] hi',
      'Be brief',
      '[00:00:02] Bo: https://a.example',
    );
    expect(calls[0]?.input).toBe(
      '[00:00:01] hi\n\n## Chat messages\n[00:00:02] Bo: https://a.example',
    );
    expect(calls[0]?.prompt).toMatch(/^Be brief\n\n/);
    expect(calls[0]?.prompt).toContain('## Resources');
  });

  it('keeps the chat links through the condensing rounds', async () => {
    const transcript = Array.from({ length: 6 }, (_, i) => `[00:00:0${i}] line ${i}`).join('\n');
    const { provider, calls } = fakeProvider(80, (_, prompt) =>
      prompt.startsWith('You are given excerpt') ? 'n' : 'Final.',
    );
    await summarizeTranscript(provider, transcript, 'Be brief', '[00:00:09] Bo: https://a.example');
    const notes = calls.filter((c) => c.prompt.startsWith('You are given excerpt'));
    expect(notes.map((c) => c.input).join('\n')).toContain('https://a.example');
    expect(notes.every((c) => c.prompt.includes('keep every URL'))).toBe(true);
    expect(calls.at(-1)?.prompt).toContain('## Resources');
  });

  it('gives up honestly when the notes never shrink', async () => {
    const { provider } = fakeProvider(30, (input) => input);
    await expect(summarizeTranscript(provider, 'x'.repeat(100), 'p')).rejects.toThrow(
      /condensing rounds/,
    );
  });
});
