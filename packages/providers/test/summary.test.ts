import { describe, expect, it } from 'vitest';
import {
  defaultMeetingSummaryPrompt,
  formatChat,
  formatTranscript,
  resolvePrompt,
} from '../src/prompts.js';
import {
  createSummaryProvider,
  summaryProviders,
  transcriptionProviders,
} from '../src/registry.js';
import { deps, json, jsonBody, scriptedFetch } from './helpers.js';

describe('none', () => {
  it('returns an empty summary and passes its test', async () => {
    const provider = createSummaryProvider('none', {});
    expect(await provider.summarize('t', 'p')).toBe('');
    await expect(provider.test()).resolves.toBeDefined();
  });
});

describe('openai-compatible', () => {
  const config = { baseUrl: 'http://ollama:11434/v1/', model: 'llama3.1' };

  it('sends a chat completion and returns the content', async () => {
    const { fetch, calls } = scriptedFetch(
      json({ choices: [{ message: { content: ' Summary. ' } }] }),
    );
    const provider = createSummaryProvider(
      'openai-compatible',
      { ...config, apiKey: 'sk', temperature: 0.2 },
      deps({ fetch }),
    );

    expect(await provider.summarize('[00:00:01] hi', 'Be brief')).toBe('Summary.');
    expect(calls[0]?.url).toBe('http://ollama:11434/v1/chat/completions');
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer sk' });
    expect(jsonBody(calls[0])).toEqual({
      model: 'llama3.1',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: '[00:00:01] hi' },
      ],
    });
  });

  it('sends no auth header without a key', async () => {
    const { fetch, calls } = scriptedFetch(json({ choices: [{ message: { content: 'ok' } }] }));
    await createSummaryProvider('openai-compatible', config, deps({ fetch })).summarize('t', 'p');
    expect(calls[0]?.init.headers).not.toHaveProperty('Authorization');
  });

  it('rejects an empty completion', async () => {
    const { fetch } = scriptedFetch(json({ choices: [{ message: { content: null } }] }));
    await expect(
      createSummaryProvider('openai-compatible', config, deps({ fetch })).summarize('t', 'p'),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('requires a base URL and model', () => {
    expect(() => createSummaryProvider('openai-compatible', {})).toThrow(/baseUrl/);
  });

  it('checks /models', async () => {
    const { fetch, calls } = scriptedFetch(json({ data: [] }));
    await createSummaryProvider('openai-compatible', config, deps({ fetch })).test();
    expect(calls[0]?.url).toBe('http://ollama:11434/v1/models');
  });
});

describe('model and input limit', () => {
  it('exposes the model and a configurable input limit', () => {
    const openai = createSummaryProvider('openai-compatible', {
      baseUrl: 'http://llm/v1',
      model: 'llama3.1',
      maxInputChars: 5000,
    });
    expect([openai.model, openai.maxInputChars]).toEqual(['llama3.1', 5000]);
    const defaults = createSummaryProvider('openai-compatible', {
      baseUrl: 'http://llm/v1',
      model: 'llama3.1',
    });
    expect(defaults.maxInputChars).toBe(24_000);
    const claude = createSummaryProvider('anthropic', { apiKey: 'k' });
    expect([claude.model, claude.maxInputChars]).toEqual(['claude-sonnet-5-5', 300_000]);
    expect(createSummaryProvider('none', {}).maxInputChars).toBeGreaterThan(1e9);
  });
});

describe('anthropic', () => {
  it('calls the Messages API and joins text blocks', async () => {
    const { fetch, calls } = scriptedFetch(
      json({
        content: [
          { type: 'text', text: 'Part one. ' },
          { type: 'thinking' },
          { type: 'text', text: 'Part two.' },
        ],
      }),
    );
    const provider = createSummaryProvider(
      'anthropic',
      { apiKey: 'ak', model: 'claude-x' },
      deps({ fetch }),
    );

    expect(await provider.summarize('transcript', 'prompt')).toBe('Part one. Part two.');
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.init.headers).toMatchObject({
      'x-api-key': 'ak',
      'anthropic-version': '2023-06-01',
    });
    expect(jsonBody(calls[0])).toEqual({
      model: 'claude-x',
      max_tokens: 4096,
      system: 'prompt',
      messages: [{ role: 'user', content: 'transcript' }],
    });
  });

  it('rejects a response without text', async () => {
    const { fetch } = scriptedFetch(json({ content: [] }));
    await expect(
      createSummaryProvider('anthropic', { apiKey: 'k' }, deps({ fetch })).summarize('t', 'p'),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('prompts', () => {
  it('ships a default that covers the summary, decisions and action items', () => {
    expect(defaultMeetingSummaryPrompt).toMatch(/## Summary/);
    expect(defaultMeetingSummaryPrompt).toMatch(/## Decisions/);
    expect(defaultMeetingSummaryPrompt).toMatch(/## Action items/);
  });

  it('prefers a non-empty override', () => {
    expect(resolvePrompt(' Custom ')).toBe('Custom');
    expect(resolvePrompt('   ')).toBe(defaultMeetingSummaryPrompt);
    expect(resolvePrompt()).toBe(defaultMeetingSummaryPrompt);
  });

  it('formats a transcript with timestamps and speakers', () => {
    expect(
      formatTranscript([
        { startMs: 3_723_000, endMs: 3_730_000, text: 'Late.', speaker: 'Speaker 1' },
        { startMs: 5000, endMs: 6000, text: 'Early.' },
      ]),
    ).toBe('[01:02:03] Speaker 1: Late.\n[00:00:05] Early.');
  });
});

describe('registry', () => {
  it('lists every provider with a config schema', () => {
    expect(Object.keys(transcriptionProviders).sort()).toEqual([
      'assemblyai',
      'deepgram',
      'groq',
      'local',
      'openai',
    ]);
    expect(Object.keys(summaryProviders).sort()).toEqual([
      'anthropic',
      'none',
      'openai-compatible',
    ]);
    for (const definition of [
      ...Object.values(transcriptionProviders),
      ...Object.values(summaryProviders),
    ]) {
      expect(definition.label).not.toBe('');
      expect(definition.configSchema.safeParse({}).success).toBeTypeOf('boolean');
    }
  });
});

describe('formatChat', () => {
  it('renders one timestamped line per message on a single line', () => {
    expect(
      formatChat([
        { offsetMs: 65_000, sender: 'Bo', text: 'see\nhttps://a.example' },
        { offsetMs: 3_600_000, sender: 'Al', text: 'ok' },
      ]),
    ).toBe('[00:01:05] Bo: see https://a.example\n[01:00:00] Al: ok');
    expect(formatChat([])).toBe('');
  });
});

describe('default meeting summary prompt', () => {
  it('asks for an Owner, Action, Due table and forbids dashes', () => {
    expect(defaultMeetingSummaryPrompt).toMatch(/\| Owner +\| Action +\| Due +\|/);
    expect(defaultMeetingSummaryPrompt).toContain('Not specified');
    expect(defaultMeetingSummaryPrompt).toContain('Never use em dashes');
  });
});
