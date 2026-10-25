import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { audioFiles, eq, type Database } from '@openminutes/db';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 60_000;

type ProbeDuration = (path: string) => Promise<number>;

const probeDurationMs: ProbeDuration = async (path) => {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
    { timeout: PROBE_TIMEOUT_MS },
  );
  return Math.round(Number.parseFloat(stdout) * 1000);
};

/** The recorder only reports a segment once it is closed, so a crash leaves the open one on disk without a row. */
export async function registerOpenSegments(
  db: Database,
  dataDir: string,
  meetingIds: string[],
  probe: ProbeDuration = probeDurationMs,
): Promise<number> {
  let registered = 0;
  for (const meetingId of meetingIds) {
    const directory = join(dataDir, 'meetings', meetingId);
    const files = (await readdir(directory).catch(() => [] as string[])).filter((name) =>
      name.endsWith('.opus'),
    );
    const known = new Set(
      (await db.select().from(audioFiles).where(eq(audioFiles.meetingId, meetingId))).map(
        (row) => row.path,
      ),
    );
    for (const name of files.toSorted()) {
      const path = `meetings/${meetingId}/${name}`;
      if (known.has(path)) continue;
      const durationMs = await probe(join(directory, name)).catch(() => 0);
      if (!(durationMs > 0)) continue;
      await db.insert(audioFiles).values({
        meetingId,
        path,
        durationMs,
        codec: 'opus',
        size: (await stat(join(directory, name))).size,
      });
      registered += 1;
    }
  }
  return registered;
}
