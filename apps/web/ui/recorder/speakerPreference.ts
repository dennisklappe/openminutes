import { MAX_SPEAKERS, MIN_SPEAKERS } from '../../src/speakerCount.js';

const KEY = 'openminutes.speakers';

export function loadSpeakerPreference(): number | undefined {
  try {
    const value = Number(localStorage.getItem(KEY));
    return Number.isInteger(value) && value >= MIN_SPEAKERS && value <= MAX_SPEAKERS
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function saveSpeakerPreference(speakers: number | undefined): void {
  try {
    if (speakers) localStorage.setItem(KEY, String(speakers));
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the choice is only remembered for this visit
  }
}
