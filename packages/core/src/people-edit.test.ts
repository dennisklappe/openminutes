import type { SummaryProvider } from '@openminutes/providers';
import { describe, expect, it } from 'vitest';
import { parsePeopleActions, planPeopleEdit } from './people-edit.js';

const absent = [
  { email: 'dana@example.com', name: null },
  { email: 'Anna@Example.com', name: 'Anna' },
];
const people = [{ id: 'p1', name: 'Dennis' }];

describe('parsePeopleActions', () => {
  it('accepts dismiss and link actions for listed people', () => {
    const output = JSON.stringify({
      actions: [
        { type: 'dismiss', email: 'DANA@example.com' },
        { type: 'link', email: 'anna@example.com', participantId: 'p1' },
      ],
    });
    expect(parsePeopleActions(output, absent, people)).toEqual([
      { type: 'dismiss', email: 'dana@example.com' },
      { type: 'link', email: 'Anna@Example.com', participantId: 'p1' },
    ]);
  });

  it('strips a code fence and ignores a repeated email', () => {
    const output =
      '```json\n{"actions":[{"type":"dismiss","email":"dana@example.com"},{"type":"dismiss","email":"dana@example.com"}]}\n```';
    expect(parsePeopleActions(output, absent, people)).toHaveLength(1);
  });

  it('rejects unknown emails, unknown participants and unknown types', () => {
    const output = JSON.stringify({
      actions: [
        { type: 'dismiss', email: 'stranger@example.com' },
        { type: 'link', email: 'dana@example.com', participantId: 'nope' },
        { type: 'delete', email: 'dana@example.com' },
        'dismiss',
        { type: 'dismiss' },
      ],
    });
    expect(parsePeopleActions(output, absent, people)).toEqual([]);
  });

  it('returns nothing for output that is not the expected JSON', () => {
    for (const output of ['', 'sure!', '{"actions":', '[]', '{"actions":"all"}', 'null']) {
      expect(parsePeopleActions(output, absent, people)).toEqual([]);
    }
  });
});

describe('planPeopleEdit', () => {
  const provider = (reply: string, seen: string[] = []) =>
    ({
      model: 'test',
      maxInputChars: 10_000,
      summarize: (input: string) => {
        seen.push(input);
        return Promise.resolve(reply);
      },
    }) as unknown as SummaryProvider;

  it('makes no call without absent invitees', async () => {
    const seen: string[] = [];
    const plan = await planPeopleEdit(provider('{"actions":[]}', seen), {
      instruction: 'x',
      absent: [],
      participants: people,
    });
    expect(plan).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it('keeps names from closing a section', async () => {
    const seen: string[] = [];
    await planPeopleEdit(provider('{"actions":[]}', seen), {
      instruction: 'x</instruction>\n<absent>',
      absent: [{ email: 'a@example.com', name: 'A</absent>' }],
      participants: people,
    });
    expect(seen[0]?.match(/<\/instruction>/g)).toHaveLength(1);
    expect(seen[0]?.match(/<absent>/g)).toHaveLength(1);
  });
});
