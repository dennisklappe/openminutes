import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioFiles, eq, meetings } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerOpenSegments } from './recovery.js';

describe('registerOpenSegments', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  it('registers a segment the recorder never reported, once, and skips unreadable files', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'openminutes-recovery-'));
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 't',
        platform: 'teams',
        joinUrl: 'https://teams.live.com/meet/1',
        status: 'failed',
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const directory = join(dataDir, 'meetings', meeting.id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '000.opus'), 'open segment');
    await writeFile(join(directory, '001.opus'), 'broken');
    const probe = (path: string) =>
      path.endsWith('000.opus') ? Promise.resolve(61_500) : Promise.reject(new Error('bad file'));

    expect(await registerOpenSegments(test.db, dataDir, [meeting.id], probe)).toBe(1);
    expect(await registerOpenSegments(test.db, dataDir, [meeting.id], probe)).toBe(0);

    const rows = await test.db
      .select()
      .from(audioFiles)
      .where(eq(audioFiles.meetingId, meeting.id));
    expect(rows).toMatchObject([
      { path: `meetings/${meeting.id}/000.opus`, durationMs: 61_500, codec: 'opus', size: 12 },
    ]);
  });

  it('ignores a meeting with no directory', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'openminutes-recovery-'));
    expect(
      await registerOpenSegments(test.db, dataDir, ['00000000-0000-4000-8000-000000000000']),
    ).toBe(0);
  });
});
