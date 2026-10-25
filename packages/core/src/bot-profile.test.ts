import { createTestDatabase } from '@openminutes/db/testing';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOT_DEFAULTS, isBotName, loadBotProfile, loadJoinMessage } from './bot-profile.js';
import { SettingsStore } from './settings.js';
import { LocalStorage } from './storage.js';

describe('loadBotProfile', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  let storage: LocalStorage;

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-profile-')));
  });
  afterAll(() => test.close());

  it('defaults to the OpenMinutes name and message with no camera image', async () => {
    expect(await loadBotProfile(settings, storage)).toEqual({
      name: 'OpenMinutes Notetaker',
      joinMessage: BOT_DEFAULTS.joinMessage,
      cameraImagePath: null,
    });
    expect(BOT_DEFAULTS.joinMessage).toBe(
      'OpenMinutes notetaker is recording notes for this meeting. For more info see https://openminut.es/',
    );
  });

  it('uses the stored name, message and image', async () => {
    await settings.set('bot.name', ' Acme Notes ');
    await settings.set('bot.join_message', 'Recording for Acme');
    await settings.set('bot.camera_image', 'bot/camera.png');
    await storage.write('bot/camera.png', new Uint8Array([1]));
    expect(await loadBotProfile(settings, storage)).toEqual({
      name: 'Acme Notes',
      joinMessage: 'Recording for Acme',
      cameraImagePath: storage.absolutePath('bot/camera.png'),
    });
  });

  it('keeps a legacy cleared message as no message and a blank name as the default', async () => {
    await settings.set('bot.name', '  ');
    await settings.set('bot.join_message', '');
    const profile = await loadBotProfile(settings, storage);
    expect(profile.name).toBe('OpenMinutes Notetaker');
    expect(profile.joinMessage).toBeNull();
    expect(await loadJoinMessage(settings)).toEqual({
      enabled: false,
      message: BOT_DEFAULTS.joinMessage,
    });
  });

  it('sends nothing when switched off and the default text when switched on without text', async () => {
    await settings.set('bot.join_message', 'Recording for Acme');
    await settings.set('bot.join_message_enabled', 'false');
    expect((await loadBotProfile(settings, storage)).joinMessage).toBeNull();
    await settings.set('bot.join_message', '');
    await settings.set('bot.join_message_enabled', 'true');
    expect((await loadBotProfile(settings, storage)).joinMessage).toBe(BOT_DEFAULTS.joinMessage);
  });

  it('moves a saved copy of the old default to the new default and keeps custom text', async () => {
    await settings.set(
      'bot.join_message',
      'This meeting is being minuted by OpenMinutes. For more info please see https://github.com/dennisklappe/openminutes',
    );
    await settings.set('bot.join_message_enabled', 'true');
    expect((await loadJoinMessage(settings)).message).toBe(BOT_DEFAULTS.joinMessage);
    await settings.set(
      'bot.join_message',
      'OpenMinutes notetaker is recording notes for this meeting. For more info see github.com/dennisklappe/openminutes',
    );
    expect((await loadJoinMessage(settings)).message).toBe(BOT_DEFAULTS.joinMessage);
    await settings.set('bot.join_message', 'This meeting is being minuted by us.');
    expect((await loadJoinMessage(settings)).message).toBe('This meeting is being minuted by us.');
  });

  it('fills in the bot name for {{name}}', async () => {
    await settings.set('bot.name', 'Acme Notes');
    await settings.set('bot.join_message', '{{name}} is taking notes. {{name}} is polite.');
    await settings.set('bot.join_message_enabled', 'true');
    expect((await loadBotProfile(settings, storage)).joinMessage).toBe(
      'Acme Notes is taking notes. Acme Notes is polite.',
    );
  });

  it('ignores an image whose file is gone', async () => {
    await storage.remove('bot/camera.png');
    expect((await loadBotProfile(settings, storage)).cameraImagePath).toBeNull();
  });
});

describe('isBotName', () => {
  it('matches the defaults, the configured name and a Teams guest suffix, ignoring case', () => {
    expect(isBotName('OpenMinutes Notetaker')).toBe(true);
    expect(isBotName('klappe notetaker (Guest)')).toBe(true);
    expect(isBotName('Scribe Bot (guest)', 'scribe bot')).toBe(true);
  });

  it('does not match people', () => {
    expect(isBotName('Carla')).toBe(false);
    expect(isBotName('Notetaker Nick', 'Scribe Bot')).toBe(false);
    expect(isBotName('Anyone', '')).toBe(false);
  });
});
