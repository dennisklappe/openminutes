import type { SettingsStore } from './settings.js';
import type { LocalStorage } from './storage.js';

export const BOT_DEFAULTS = {
  name: 'OpenMinutes Notetaker',
  joinMessage:
    'OpenMinutes notetaker is recording notes for this meeting. For more info see https://openminut.es/',
} as const;

// 'Klappe Notetaker' is the name the bot had before the rename; old minutes still carry it.
const KNOWN_BOT_NAMES = [BOT_DEFAULTS.name, 'Klappe Notetaker'];
const GUEST_SUFFIX = /\s*\(guest\)\s*$/i;

const botKey = (name: string) => name.replace(GUEST_SUFFIX, '').trim().toLowerCase();

/** Whether a participant tile belongs to the notetaker, ignoring case and a Teams "(Guest)" suffix. */
export function isBotName(name: string, configured?: string | null): boolean {
  const key = botKey(name);
  return [...KNOWN_BOT_NAMES, configured ?? ''].some(
    (known) => known !== '' && botKey(known) === key,
  );
}

// Earlier defaults; a saved copy of one of these means the message was never customised.
const LEGACY_JOIN_MESSAGES = [
  'This meeting is being minuted by OpenMinutes. For more info please see https://github.com/dennisklappe/openminutes',
  'OpenMinutes notetaker is recording notes for this meeting. For more info see github.com/dennisklappe/openminutes',
];

export interface BotProfile {
  name: string;
  joinMessage: string | null;
  cameraImagePath: string | null;
}

export interface JoinMessageSettings {
  enabled: boolean;
  message: string;
}

export async function loadJoinMessage(settings: SettingsStore): Promise<JoinMessageSettings> {
  const [stored, flag] = await Promise.all([
    settings.get('bot.join_message'),
    settings.get('bot.join_message_enabled'),
  ]);
  const trimmed = stored?.trim() ?? '';
  const message = LEGACY_JOIN_MESSAGES.includes(trimmed) ? BOT_DEFAULTS.joinMessage : trimmed;
  return {
    enabled: flag === undefined ? stored === undefined || message !== '' : flag === 'true',
    message: message || BOT_DEFAULTS.joinMessage,
  };
}

export const renderJoinMessage = (message: string, botName: string) =>
  message.replaceAll('{{name}}', botName);

export async function loadBotProfile(
  settings: SettingsStore,
  storage: LocalStorage,
): Promise<BotProfile> {
  const [name, joinMessage, cameraImage] = await Promise.all([
    settings.get('bot.name'),
    loadJoinMessage(settings),
    settings.get('bot.camera_image'),
  ]);
  const botName = name?.trim() || BOT_DEFAULTS.name;
  return {
    name: botName,
    joinMessage: joinMessage.enabled ? renderJoinMessage(joinMessage.message, botName) : null,
    cameraImagePath:
      cameraImage && (await storage.exists(cameraImage)) ? storage.absolutePath(cameraImage) : null,
  };
}
