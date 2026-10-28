import { eq, type Database, settings } from '@openminutes/db';
import { decryptSecret, encryptSecret } from './crypto.js';

const definitions = {
  'admin.password_hash': { secret: true, default: undefined },
  'google.client_id': { secret: false, default: undefined },
  'google.client_secret': { secret: true, default: undefined },
  'microsoft.client_id': { secret: false, default: undefined },
  'microsoft.client_secret': { secret: true, default: undefined },
  'microsoft.tenant': { secret: false, default: 'common' },
  'bot.lobby_timeout_seconds': { secret: false, default: '600' },
  'bot.max_duration_minutes': { secret: false, default: '240' },
  'bot.alone_timeout_seconds': { secret: false, default: '60' },
  'transcription.provider': { secret: false, default: 'local' },
  'transcription.configs': { secret: true, default: '{}' },
  'updates.enabled': { secret: false, default: 'false' },
  'updates.latest': { secret: false, default: undefined },
  'updates.dismissed': { secret: false, default: undefined },
  'summary.provider': { secret: false, default: 'none' },
  'summary.configs': { secret: true, default: '{}' },
  'summary.prompts': { secret: false, default: '[]' },
  'summary.default_prompt': { secret: false, default: 'default' },
  'summary.include_chat': { secret: false, default: 'true' },
  /** Minutes the summary waits for how many people sit in a shared account, 0: never wait. */
  'summary.shared_wait_minutes': { secret: false, default: '15' },
  'speakers.refine': { secret: false, default: 'true' },
  'phone.enabled': { secret: false, default: 'true' },
  'phone.consent_text': { secret: false, default: undefined },
  'voices.remember': { secret: false, default: 'false' },
  'voices.check': { secret: false, default: 'false' },
  /** Seconds of clean speech that fill the Length bar of a voice profile. */
  'voices.ready_seconds': { secret: false, default: '120' },
  /** Meetings and ways of sounding that fill the Variety bar of a voice profile. */
  'voices.ready_meetings': { secret: false, default: '5' },
  'voices.ready_ways': { secret: false, default: '5' },
  /** A voice agrees with a profile when its score is at least this. */
  'voices.agree_score': { secret: false, default: '0.6' },
  /** A new sample joins the closest way of sounding when it is at least this similar. */
  'voices.merge_similarity': { secret: false, default: '0.6' },
  /** Set once the first run over the existing meetings gave everyone a profile. */
  'people.backfilled': { secret: false, default: 'false' },
  /** Meeting ids whose "Check the people" card was confirmed or dismissed, a JSON list. */
  'people.checked': { secret: false, default: '[]' },
  'people.cleanup_shared': { secret: false, default: 'false' },
  'bot.name': { secret: false, default: undefined },
  'bot.join_message': { secret: false, default: undefined },
  'bot.join_message_enabled': { secret: false, default: undefined },
  'bot.camera_image': { secret: false, default: undefined },
  'bot.google_session': { secret: true, default: undefined },
  'bot.google_session_expired': { secret: false, default: undefined },
  'bot.google_credentials': { secret: true, default: undefined },
  'bot.google_keepalive': { secret: false, default: undefined },
  'bot.google_notify': { secret: false, default: 'true' },
  'bot.google_alert_sent_at': { secret: false, default: undefined },
  'bot.max_concurrent': { secret: false, default: '1' },
  'storage.backend': { secret: false, default: 'local' },
  'storage.s3': { secret: true, default: undefined },
  'retention.audio_days': { secret: false, default: undefined },
  'minutes.template': { secret: false, default: undefined },
  'minutes.logo': { secret: false, default: undefined },
  'minutes.include_transcript': { secret: false, default: 'false' },
  'minutes.include_chat': { secret: false, default: 'false' },
  'export.target': { secret: false, default: undefined },
  'export.google_account': { secret: false, default: undefined },
  'export.microsoft_account': { secret: false, default: undefined },
  'minutes.links_tab': { secret: false, default: undefined },
  'minutes.calendar_link': { secret: false, default: undefined },
  'minutes.destinations': { secret: false, default: undefined },
  'minutes.custom_template': { secret: false, default: undefined },
  'export.owner_email': { secret: false, default: undefined },
  'export.auto': { secret: false, default: undefined },
  'email.provider': { secret: false, default: 'smtp' },
  'email.configs': { secret: true, default: '{}' },
  'email.from_name': { secret: false, default: undefined },
  'email.from_address': { secret: false, default: undefined },
  'email.owner_address': { secret: false, default: undefined },
  'email.subject': { secret: false, default: undefined },
  'email.body': { secret: false, default: undefined },
  'instance.timezone': { secret: false, default: undefined },
  'wizard.completed': { secret: false, default: 'true' },
  'wizard.step': { secret: false, default: undefined },
} as const;

export type SettingKey = keyof typeof definitions;

export class SettingsStore {
  constructor(
    private readonly db: Database,
    private readonly secret: string,
  ) {}

  async get(key: SettingKey): Promise<string | undefined> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key));
    if (!row) return definitions[key].default;
    return row.secret ? decryptSecret(row.value, this.secret) : row.value;
  }

  async getNumber(key: SettingKey): Promise<number> {
    const value = await this.get(key);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Setting ${key} is not a number`);
    return parsed;
  }

  async setIfAbsent(key: SettingKey, value: string): Promise<boolean> {
    const isSecret = definitions[key].secret;
    const stored = isSecret ? encryptSecret(value, this.secret) : value;
    const inserted = await this.db
      .insert(settings)
      .values({ key, value: stored, secret: isSecret })
      .onConflictDoNothing()
      .returning({ key: settings.key });
    return inserted.length > 0;
  }

  async delete(key: SettingKey): Promise<void> {
    await this.db.delete(settings).where(eq(settings.key, key));
  }

  async set(key: SettingKey, value: string): Promise<void> {
    const isSecret = definitions[key].secret;
    const stored = isSecret ? encryptSecret(value, this.secret) : value;
    await this.db
      .insert(settings)
      .values({ key, value: stored, secret: isSecret })
      .onConflictDoUpdate({ target: settings.key, set: { value: stored, secret: isSecret } });
  }
}
