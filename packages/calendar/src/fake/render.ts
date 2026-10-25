import type { FakeEvent, FakeStore } from './store.js';

const graphTime = (iso: string) => ({
  dateTime: new Date(iso).toISOString().replace('Z', '0000'),
  timeZone: 'UTC',
});

export function googleEvent(store: FakeStore, event: FakeEvent) {
  return {
    id: event.id,
    status: 'confirmed',
    ...(event.seriesId && { recurringEventId: event.seriesId }),
    summary: event.title,
    description: event.description,
    location: event.location,
    start: { dateTime: event.start },
    end: { dateTime: event.end },
    ...(event.conferenceUrl && {
      conferenceData: { entryPoints: [{ entryPointType: 'video', uri: event.conferenceUrl }] },
    }),
    organizer: { self: event.organizerSelf ?? true },
    attendees: [
      { email: store.email, self: true, responseStatus: 'accepted' },
      ...(event.guests ?? []).map((email) => ({ email, responseStatus: 'needsAction' })),
    ],
  };
}

export const googleCancelled = (id: string) => ({ id, status: 'cancelled' });

export function graphEvent(event: FakeEvent) {
  return {
    id: event.id,
    subject: event.title,
    isCancelled: false,
    ...(event.seriesId && { seriesMasterId: event.seriesId }),
    isOrganizer: event.organizerSelf ?? true,
    start: graphTime(event.start),
    end: graphTime(event.end),
    body: { contentType: 'html', content: event.description ?? '' },
    location: { displayName: event.location ?? '' },
    onlineMeeting: event.conferenceUrl ? { joinUrl: event.conferenceUrl } : null,
    responseStatus: { response: 'organizer' },
    attendees: (event.guests ?? []).map((address) => ({
      type: 'required',
      emailAddress: { address },
    })),
  };
}

export const graphRemoved = (id: string) => ({ id, '@removed': { reason: 'deleted' } });
