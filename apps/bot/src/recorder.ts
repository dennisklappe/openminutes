import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

export interface Segment {
  fileName: string;
  durationMs: number;
}

export interface Recording {
  stop(): Promise<void>;
}

const STOP_TIMEOUT_MS = 10_000;

export function parseSegmentLine(line: string): Segment | undefined {
  const [fileName, start, end] = line.trim().split(',');
  const durationMs = Math.round((Number(end) - Number(start)) * 1000);
  if (!fileName || !Number.isFinite(durationMs)) return undefined;
  return { fileName, durationMs };
}

export function startRecording(options: {
  inputArgs: string[];
  outputDir: string;
  segmentSeconds: number;
  onSegment: (segment: Segment) => Promise<void>;
}): Recording {
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      ...options.inputArgs,
      '-ac',
      '1',
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-application',
      'voip',
      '-f',
      'segment',
      '-segment_format',
      'opus',
      '-segment_time',
      String(options.segmentSeconds),
      '-reset_timestamps',
      '1',
      '-segment_list',
      'pipe:1',
      '-segment_list_type',
      'csv',
      join(options.outputDir, '%03d.opus'),
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );

  let pending = Promise.resolve();
  createInterface({ input: ffmpeg.stdout }).on('line', (line) => {
    const segment = parseSegmentLine(line);
    if (segment) pending = pending.then(() => options.onSegment(segment));
  });

  const exited = new Promise<void>((resolve) =>
    ffmpeg.once('close', () => {
      resolve();
    }),
  );

  return {
    async stop() {
      ffmpeg.stdin.end('q');
      const timer = setTimeout(() => ffmpeg.kill('SIGKILL'), STOP_TIMEOUT_MS);
      await exited;
      clearTimeout(timer);
      await pending;
    },
  };
}
