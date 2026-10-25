import { listSummaryProviders, type SettingsStore } from '@openminutes/core';
import type { meetings } from '@openminutes/db';
import type { SpeakerCheckDto } from '../dto.js';

export async function loadSpeakerCheck(
  settings: SettingsStore,
  meeting: Pick<
    typeof meetings.$inferSelect,
    'speakerCheckRequestedAt' | 'speakerCheckedAt' | 'speakerCheckError'
  >,
): Promise<SpeakerCheckDto> {
  const [{ configured }, refine] = await Promise.all([
    listSummaryProviders(settings),
    settings.get('speakers.refine'),
  ]);
  const { speakerCheckRequestedAt: requested, speakerCheckedAt: checked } = meeting;
  return {
    ai: configured.length > 0 && refine !== 'false',
    running: requested !== null && (checked === null || checked < requested),
    checkedAt: checked?.toISOString() ?? null,
    error: meeting.speakerCheckError,
  };
}
