import type { CalendarProviderId } from '@openminutes/db';
import { z } from 'zod';
import { endpointsFor } from './endpoints.js';
import { createGoogleProvider } from './google.js';
import type { Fetch } from './http.js';
import { createMicrosoftProvider } from './microsoft.js';
import type { CalendarProvider } from './types.js';

export const calendarEnvSchema = z.object({
  OPENMINUTES_FAKE_CALENDAR_URL: z.url().optional(),
});

export type CalendarProviders = Record<CalendarProviderId, CalendarProvider>;

export function createProviders(
  options: { fakeBaseUrl?: string | undefined; fetch?: Fetch } = {},
): CalendarProviders {
  const endpoints = endpointsFor(options.fakeBaseUrl);
  const fetchImpl = options.fetch ?? fetch;
  return {
    google: createGoogleProvider(endpoints.google, fetchImpl),
    microsoft: createMicrosoftProvider(endpoints.microsoft, fetchImpl),
  };
}
