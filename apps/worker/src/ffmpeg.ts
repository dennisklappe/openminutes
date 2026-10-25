import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const FFMPEG_TIMEOUT_MS = 30 * 60_000;
const MAX_LOG_BYTES = 64 * 1024 * 1024;

export async function runFfmpeg(args: string[]): Promise<{ stderr: string }> {
  const { stderr } = await execFileAsync('ffmpeg', ['-protocol_whitelist', 'file,pipe', ...args], {
    timeout: FFMPEG_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_LOG_BYTES,
  });
  return { stderr };
}
