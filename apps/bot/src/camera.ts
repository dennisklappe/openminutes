import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 1280;
const HEIGHT = 720;
const FRAMES_PER_SECOND = 5;

export function cameraConversionArgs(image: string, output: string): string[] {
  const fit = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`;
  const pad = `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-loop',
    '1',
    '-framerate',
    String(FRAMES_PER_SECOND),
    '-i',
    image,
    '-t',
    '1',
    '-vf',
    `${fit},${pad},format=yuv420p`,
    '-f',
    'yuv4mpegpipe',
    output,
  ];
}

export async function convertCameraImage(image: string | URL, directory: string): Promise<string> {
  const source = typeof image === 'string' ? image : fileURLToPath(image);
  const output = join(directory, 'camera.y4m');
  const ffmpeg = spawn('ffmpeg', cameraConversionArgs(source, output), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  await new Promise<void>((resolve, reject) => {
    ffmpeg.once('error', reject);
    ffmpeg.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`));
    });
  });
  return output;
}
