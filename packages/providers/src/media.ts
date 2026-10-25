import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ProviderError } from './errors.js';
import type { Chunk, Media } from './types.js';

export type Exec = (command: string, args: string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 60_000;

const defaultExec: Exec = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, {
    maxBuffer: 16 * 1024 * 1024,
    timeout: PROBE_TIMEOUT_MS,
  });
  return stdout;
};

const CHUNK_BITRATE = 48_000;
const SAFETY = 0.8;
// Whisper over an API loses its footing on long recordings: one hallucinated window is fed to the
// next, so a whole file can come back as the same credit line. Short windows confine the damage.
const WINDOW_SECONDS = 600;
// Phone microphones give loud, uneven audio with low rumble. The limiter keeps peaks from clipping
// after the gain is levelled.
const NORMALIZE =
  'aformat=sample_rates=16000:channel_layouts=mono,highpass=f=80,dynaudnorm=f=200:g=11,alimiter=limit=0.8:level=false';

export function createMedia(exec: Exec = defaultExec): Media {
  async function run(command: string, args: string[]): Promise<string> {
    try {
      return await exec(command, args);
    } catch (cause) {
      throw new ProviderError('media', 'media', `${command} failed`, undefined, { cause });
    }
  }

  async function duration(path: string): Promise<number> {
    const out = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      path,
    ]);
    const seconds = Number.parseFloat(out);
    if (!Number.isFinite(seconds)) {
      throw new ProviderError('media', 'media', `cannot read duration of ${path}`);
    }
    return Math.round(seconds * 1000);
  }

  return {
    async prepare(path, maxBytes) {
      const dir = await mkdtemp(join(tmpdir(), 'openminutes-chunks-'));
      const cleanup = () => rm(dir, { recursive: true, force: true });
      try {
        const segmentSeconds = Math.min(
          WINDOW_SECONDS,
          Math.floor((maxBytes * SAFETY * 8) / CHUNK_BITRATE),
        );
        await run('ffmpeg', [
          '-v',
          'error',
          '-i',
          path,
          '-vn',
          '-af',
          NORMALIZE,
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'libmp3lame',
          '-b:a',
          String(CHUNK_BITRATE),
          '-f',
          'segment',
          '-segment_time',
          String(segmentSeconds),
          '-reset_timestamps',
          '1',
          join(dir, 'chunk%05d.mp3'),
        ]);
        const names = (await readdir(dir)).filter((n) => n.endsWith('.mp3')).sort();
        const chunks: Chunk[] = [];
        let offsetMs = 0;
        for (const name of names) {
          const chunkPath = join(dir, name);
          const durationMs = await duration(chunkPath);
          chunks.push({ path: chunkPath, offsetMs, durationMs });
          offsetMs += durationMs;
        }
        return { chunks, cleanup };
      } catch (error) {
        await cleanup();
        throw error;
      }
    },
  };
}
