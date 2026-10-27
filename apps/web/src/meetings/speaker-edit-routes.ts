import type { JobSender, SettingsStore } from '@openminutes/core';
import { eq, meetings, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SpeakerEditResultDto } from '../dto.js';
import { rememberEnabled } from '../voices/load.js';
import { loadSegments, loadSpeakerChoices } from './segments.js';
import { markSpeakersChanged } from './speakers-notice.js';
import { applySpeakerEdit, SpeakerEditError } from './speaker-edit.js';
import { speakerEditInput } from './speaker-edit-schema.js';

interface SpeakerEditDeps {
  db: Database;
  queue: JobSender;
  settings: SettingsStore;
}

const uuid = z.uuid();

export function speakerEditRoutes(deps: SpeakerEditDeps): Hono {
  const routes = new Hono();

  const findMeeting = async (rawId: string) => {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, id.data));
    return meeting;
  };

  routes.post('/:id/speaker-edits', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    const body = speakerEditInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid speaker edit' }, 400);
    let applied;
    try {
      applied = await applySpeakerEdit(deps.db, meeting, body.data);
    } catch (error) {
      if (error instanceof SpeakerEditError) return c.json({ error: error.message }, 400);
      throw error;
    }
    await markSpeakersChanged(deps.db, meeting.id);
    if (body.data.kind === 'assign' && applied.learned && (await rememberEnabled(deps.settings))) {
      await deps.queue.send('meeting.learn-voice', { meetingId: meeting.id, ...applied.learned });
    }
    return c.json<SpeakerEditResultDto>({
      segments: await loadSegments(deps.db, meeting.id),
      speakerChoices: await loadSpeakerChoices(deps.db, meeting.id),
      undo: applied.undo,
    });
  });

  routes.post('/:id/speaker-check', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    if ((await loadSegments(deps.db, meeting.id)).length === 0) {
      return c.json({ error: 'There is no transcript to check yet' }, 409);
    }
    await deps.db
      .update(meetings)
      .set({ speakerCheckRequestedAt: new Date(), speakerCheckError: null })
      .where(eq(meetings.id, meeting.id));
    await deps.queue.send('meeting.review-speakers', { meetingId: meeting.id });
    return c.json({ ok: true }, 202);
  });

  return routes;
}
