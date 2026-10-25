import type { BotProfile } from '@openminutes/core';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertCameraImage } from './camera.js';
import type { BotEnv } from './env.js';
import { FINGERPRINT_ARGS } from './google-browser.js';
import { silentWav } from './wav.js';

export interface BotSession {
  displayName: string;
  joinMessage: string | null;
  cameraOn: boolean;
  chromiumArgs: string[];
  dispose(): Promise<void>;
}

interface BotSessionOptions {
  convert?: typeof convertCameraImage;
  onCameraError?: (error: unknown) => void;
}

// The fake audio device beeps unless it reads a file, so the bot always feeds it silence.
const baseArgs = [
  ...FINGERPRINT_ARGS,
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];

export async function prepareBotSession(
  profile: BotProfile,
  env: BotEnv,
  { convert = convertCameraImage, onCameraError }: BotSessionOptions = {},
): Promise<BotSession> {
  const directory = await mkdtemp(join(tmpdir(), 'openminutes-bot-'));
  const silenceFile = join(directory, 'silence.wav');
  await writeFile(silenceFile, silentWav());
  let cameraFile: string | undefined;
  if (profile.cameraImagePath) {
    cameraFile = await convert(profile.cameraImagePath, directory).catch((error: unknown) => {
      onCameraError?.(error);
      return undefined;
    });
  }
  return {
    displayName: profile.name,
    joinMessage: profile.joinMessage,
    cameraOn: cameraFile !== undefined,
    chromiumArgs: [
      ...baseArgs,
      `--use-file-for-fake-audio-capture=${silenceFile}`,
      ...(cameraFile ? [`--use-file-for-fake-video-capture=${cameraFile}`] : []),
      ...env.OPENMINUTES_CHROMIUM_ARGS,
    ],
    dispose: async () => {
      await rm(directory, { recursive: true, force: true });
    },
  };
}
