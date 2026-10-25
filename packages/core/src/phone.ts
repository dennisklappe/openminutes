import type { SettingsStore } from './settings.js';

export const DEFAULT_PHONE_CONSENT_TEXT =
  'Only record people who know and agree to it. Tell everyone before you start, and follow the laws where you are.';

export const MAX_PHONE_CONSENT_LENGTH = 1000;

export interface PhoneConfig {
  enabled: boolean;
  consentText: string;
}

export async function loadPhoneConfig(settings: SettingsStore): Promise<PhoneConfig> {
  const [enabled, consentText] = await Promise.all([
    settings.get('phone.enabled'),
    settings.get('phone.consent_text'),
  ]);
  return {
    enabled: enabled !== 'false',
    consentText: consentText?.trim() || DEFAULT_PHONE_CONSENT_TEXT,
  };
}

export async function savePhoneConfig(settings: SettingsStore, config: PhoneConfig): Promise<void> {
  await settings.set('phone.enabled', String(config.enabled));
  const text = config.consentText.trim();
  if (text === '' || text === DEFAULT_PHONE_CONSENT_TEXT) {
    await settings.delete('phone.consent_text');
  } else {
    await settings.set('phone.consent_text', text);
  }
}
