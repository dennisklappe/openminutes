import { eq, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { SummaryProvider } from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanTitle, titleRecording } from './auto-title.js';

describe('cleanTitle', () => {
  it.each([
    ['Budget review', 'Budget review'],
    ['"Budget review."', 'Budget review'],
    ['Plan \u2014 launch\u2013date', 'Plan, launch, date'],
    ['# **Budget review**\nmore text', 'Budget review'],
    ['“Voorjaarsplanning”', 'Voorjaarsplanning'],
    ['', undefined],
    ['   \n  ', undefined],
    ['one two three four five six seven eight nine ten eleven', undefined],
    ['x'.repeat(81), undefined],
  ])('%j gives %j', (reply, expected) => {
    expect(cleanTitle(reply)).toBe(expected);
  });
});

describe('titleRecording', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  const provider = (reply: string | Error, before?: () => Promise<void>): SummaryProvider => ({
    model: 'm',
    maxInputChars: 100,
    summarize: async () => {
      await before?.();
      if (reply instanceof Error) throw reply;
      return reply;
    },
    test: () => Promise.resolve({}),
  });

  async function insert(platform: 'recording' | 'meet', titleEdited = false) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Recording 1 May', platform, joinUrl: 'x', titleEdited })
      .returning();
    if (!meeting) throw new Error('insert failed');
    return meeting.id;
  }
  const titleOf = async (id: string) =>
    (await test.db.select().from(meetings).where(eq(meetings.id, id)))[0]?.title;

  it('sets a sanitised title on a recording', async () => {
    const id = await insert('recording');
    await titleRecording(test.db, provider('"Budget \u2014 review."'), id, 'summary');
    expect(await titleOf(id)).toBe('Budget, review');
  });

  it('truncates the summary to the model input limit', async () => {
    const id = await insert('recording');
    const seen: string[] = [];
    await titleRecording(
      test.db,
      { ...provider('T'), summarize: (input) => (seen.push(input), Promise.resolve('T')) },
      id,
      'x'.repeat(500),
    );
    expect(seen[0]).toHaveLength(100);
  });

  it('keeps a title the user edited', async () => {
    const id = await insert('recording', true);
    await titleRecording(test.db, provider('New title'), id, 'summary');
    expect(await titleOf(id)).toBe('Recording 1 May');
  });

  it('does not overwrite an edit made while the model was answering', async () => {
    const id = await insert('recording');
    const edit = () =>
      test.db
        .update(meetings)
        .set({ title: 'Mine', titleEdited: true })
        .where(eq(meetings.id, id))
        .then(() => undefined);
    await titleRecording(test.db, provider('Model title', edit), id, 'summary');
    expect(await titleOf(id)).toBe('Mine');
  });

  it('leaves other meetings alone', async () => {
    const id = await insert('meet');
    await titleRecording(test.db, provider('New title'), id, 'summary');
    expect(await titleOf(id)).toBe('Recording 1 May');
  });

  it.each([
    ['an error', new Error('down')],
    ['an empty answer', ''],
    ['an overlong answer', 'word '.repeat(30)],
  ])('keeps the title on %s', async (_name, reply) => {
    const id = await insert('recording');
    await titleRecording(test.db, provider(reply), id, 'summary');
    expect(await titleOf(id)).toBe('Recording 1 May');
  });
});
