import type { JobSender, SettingsStore } from '@openminutes/core';
import type { Database } from '@openminutes/db';
import type { CalendarProviders } from './providers.js';

export interface CalendarContext {
  db: Database;
  queue: JobSender;
  settings: SettingsStore;
  providers: CalendarProviders;
  secret: string;
  now?: () => Date;
}

export const currentTime = (context: CalendarContext) => (context.now ?? (() => new Date()))();
