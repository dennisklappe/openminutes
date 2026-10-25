import { BOT_DEFAULTS, type BotProfile } from '@openminutes/core';
import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { prepareBotSession } from './bot-session.js';
import type { BotEnv } from './env.js';

const env = { OPENMINUTES_CHROMIUM_ARGS: ['--extra'] } as BotEnv;
const defaults: BotProfile = {
  name: BOT_DEFAULTS.name,
  joinMessage: BOT_DEFAULTS.joinMessage,
  cameraImagePath: null,
};

describe('prepareBotSession', () => {
  it('joins with the default name and message and the camera off when there is no image', async () => {
    const session = await prepareBotSession(defaults, env);
    expect(session.displayName).toBe('OpenMinutes Notetaker');
    expect(session.joinMessage).toBe(BOT_DEFAULTS.joinMessage);
    expect(session.cameraOn).toBe(false);
    expect(session.chromiumArgs).toContain('--extra');
    expect(session.chromiumArgs.some((arg) => arg.includes('fake-video-capture'))).toBe(false);
    await session.dispose();
  });

  it('feeds the fake microphone a silent file so it never beeps', async () => {
    const session = await prepareBotSession(defaults, env);
    const arg = session.chromiumArgs.find((a) =>
      a.startsWith('--use-file-for-fake-audio-capture='),
    );
    const wav = await readFile(arg?.split('=')[1] ?? '');
    expect(wav.subarray(44).every((byte) => byte === 0)).toBe(true);
    await session.dispose();
  });

  it('uses the custom name and message and turns the camera on for an image', async () => {
    const seen: (string | URL)[] = [];
    const session = await prepareBotSession(
      { name: 'Acme Notes', joinMessage: null, cameraImagePath: '/data/bot/camera.png' },
      env,
      {
        convert: (image, directory) => {
          seen.push(image);
          return Promise.resolve(`${directory}/camera.y4m`);
        },
      },
    );
    expect(session.displayName).toBe('Acme Notes');
    expect(session.joinMessage).toBeNull();
    expect(session.cameraOn).toBe(true);
    expect(seen).toEqual(['/data/bot/camera.png']);
    expect(session.chromiumArgs).toContain('--use-fake-device-for-media-stream');
    expect(session.chromiumArgs).toContainEqual(
      expect.stringMatching(/^--use-file-for-fake-video-capture=.*camera\.y4m$/),
    );
    await session.dispose();
  });

  it('falls back to the camera off when the image cannot be converted, and cleans up', async () => {
    const errors: unknown[] = [];
    let directory = '';
    const session = await prepareBotSession({ ...defaults, cameraImagePath: '/bad.png' }, env, {
      convert: (_image, dir) => {
        directory = dir;
        return Promise.reject(new Error('bad image'));
      },
      onCameraError: (error) => errors.push(error),
    });
    expect(session.cameraOn).toBe(false);
    expect(errors).toHaveLength(1);
    await session.dispose();
    await expect(access(directory)).rejects.toThrow();
  });
});
