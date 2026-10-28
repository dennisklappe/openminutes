import {
  createConfiguredSummarizer,
  createMeeting,
  DuplicateMeetingError,
  listPrompts,
  listSummaryProviders,
  loadChatLines,
  loadEditLineage,
  loadAudioStorage,
  mergedAudioPath,
  isSettled,
  rejoinMeeting,
  PromptNotFoundError,
  requestSummary,
  skipMeeting,
  skipSeries,
  SummaryNotConfiguredError,
  UnsupportedMeetingUrlError,
  waitMinutes,
  type JobSender,
  type LocalStorage,
  type SettingsStore,
} from '@openminutes/core';
import type { Deps } from '@openminutes/providers';
import {
  and,
  asc,
  audioFiles,
  calendarAccounts,
  calendars,
  desc,
  eq,
  isNull,
  meetings,
  meetingSources,
  skippedSeries,
  sql,
  summaries,
  type Database,
} from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { audioResponse } from '../audio.js';
import type {
  AudioDto,
  ChatMessageDto,
  MeetingDetailDto,
  MeetingCalendarDto,
  MeetingDto,
  MeetingSeriesDto,
  SummaryDto,
  SummaryOptionsDto,
} from '../dto.js';
import { iso, toMeetingDto } from './meeting-dto.js';
import { loadRoomNotices } from './room-voices.js';
import { dismissSpeakersNotice, speakersChangedSinceSummary } from './speakers-notice.js';
import { listRoutes } from './list-routes.js';
import { loadSegments, loadSpeakerChoices } from './segments.js';
import { loadSpeakerCheck } from './speaker-check.js';
import { downloadName, transcriptJson, transcriptMarkdown } from './export.js';
import { calendarLinkEnabled, loadCalendarLinks } from '../minutes/calendar-link.js';
import { MAX_SPEAKERS, MIN_SPEAKERS } from '../speakerCount.js';
import { markProcessing, rerunOptions } from './rerun.js';
import { listCompanies } from '../library/companies.js';
import { describeVersions } from '../minutes/summary-versions.js';

interface MeetingDeps {
  db: Database;
  queue: JobSender;
  storage: LocalStorage;
  settings: SettingsStore;
  providerDeps?: Partial<Deps> | undefined;
}

const newMeeting = z.object({
  url: z.string().min(1).max(2048),
  title: z.string().max(200).optional(),
  force: z.boolean().optional(),
});
const reprocessInput = z.object({
  language: z
    .string()
    .regex(/^[a-z]{2,3}$/)
    .optional(),
  speakers: z.int().min(MIN_SPEAKERS).max(MAX_SPEAKERS).nullable().optional(),
});

const summaryRequest = z.object({
  promptId: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  reapplyEdits: z.boolean().optional(),
});
const uuid = z.uuid();

async function seriesOf(
  db: Database,
  meeting: Pick<typeof meetings.$inferSelect, 'seriesKey'>,
): Promise<MeetingSeriesDto | null> {
  if (!meeting.seriesKey) return null;
  const [skipped] = await db
    .select({ id: skippedSeries.id })
    .from(skippedSeries)
    .where(eq(skippedSeries.seriesKey, meeting.seriesKey));
  return { skippedId: skipped?.id ?? null };
}

const RERUNNABLE: readonly MeetingDto['status'][] = ['ended', 'transcribed', 'failed'];

const isUpcoming = (meeting: typeof meetings.$inferSelect, now = new Date()) =>
  meeting.status === 'scheduled' ||
  (meeting.status === 'skipped' && (!meeting.scheduledStart || meeting.scheduledStart > now));

export function meetingRoutes(deps: MeetingDeps): Hono {
  const routes = new Hono();
  routes.route('/', listRoutes(deps.db));

  routes.post('/', async (c) => {
    const body = newMeeting.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'A meeting link is required' }, 400);
    try {
      const meeting = await createMeeting(deps, body.data);
      return c.json(toMeetingDto(meeting), 201);
    } catch (error) {
      if (error instanceof DuplicateMeetingError) {
        return c.json({ error: error.message, duplicateOf: error.existing.id }, 409);
      }
      if (error instanceof UnsupportedMeetingUrlError) {
        return c.json({ error: 'Only Google Meet and Microsoft Teams links are supported' }, 400);
      }
      throw error;
    }
  });

  async function findMeeting(rawId: string) {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const [meeting] = await deps.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id.data), isNull(meetings.deletedAt)));
    return meeting;
  }

  const loadChat = async (meetingId: string): Promise<ChatMessageDto[]> =>
    (await loadChatLines(deps.db, meetingId)).map((line) => ({
      ...line,
      sentAt: line.sentAt.toISOString(),
    }));

  async function loadSummaries(meetingId: string): Promise<SummaryDto[]> {
    const [rows, { prompts }] = await Promise.all([
      deps.db
        .select()
        .from(summaries)
        .where(eq(summaries.meetingId, meetingId))
        .orderBy(desc(summaries.createdAt)),
      listPrompts(deps.settings),
    ]);
    return describeVersions(rows).map((row) => ({
      id: row.id,
      provider: row.provider,
      model: row.model,
      promptName: prompts.find((p) => p.id === row.promptId)?.name ?? null,
      status: row.status,
      error: row.error,
      content: row.content,
      origin: row.origin,
      note: row.note,
      version: row.version,
      author: row.author,
      restoredFromVersion: row.restoredFromVersion,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async function activeModel(): Promise<string | null> {
    try {
      return (await createConfiguredSummarizer(deps.settings, undefined, deps.providerDeps))
        .provider.model;
    } catch (error) {
      if (error instanceof SummaryNotConfiguredError) return null;
      throw error;
    }
  }

  async function loadSummaryOptions(meetingId: string): Promise<SummaryOptionsDto> {
    const [{ configured }, { prompts, defaultId }, editModel, reapply] = await Promise.all([
      listSummaryProviders(deps.settings),
      listPrompts(deps.settings),
      activeModel(),
      loadEditLineage(deps.db, meetingId),
    ]);
    return {
      providers: configured,
      prompts: prompts.map(({ id, name }) => ({ id, name })),
      defaultPromptId: defaultId,
      editModel,
      reapply,
    };
  }

  const latestDone = (all: SummaryDto[]) => all.find((s) => s.active);

  const audioStorage = () => loadAudioStorage(deps.settings, deps.storage);

  async function loadAudio(meeting: typeof meetings.$inferSelect): Promise<AudioDto | null> {
    const meetingId = meeting.id;
    const size = await (await audioStorage()).size(mergedAudioPath(meetingId));
    if (size === undefined) return null;
    const [total] = await deps.db
      .select({ durationMs: sql<number>`coalesce(sum(${audioFiles.durationMs}), 0)::int` })
      .from(audioFiles)
      .where(eq(audioFiles.meetingId, meetingId));
    const trimmed =
      meeting.trimStartMs !== null && meeting.trimEndMs !== null
        ? meeting.trimEndMs - meeting.trimStartMs
        : undefined;
    return { durationMs: trimmed ?? total?.durationMs ?? 0, size };
  }

  async function canTranscribe(meeting: typeof meetings.$inferSelect): Promise<boolean> {
    if (!RERUNNABLE.includes(meeting.status)) return false;
    const [recorded] = await deps.db
      .select({ id: audioFiles.id })
      .from(audioFiles)
      .where(eq(audioFiles.meetingId, meeting.id))
      .limit(1);
    return recorded !== undefined;
  }

  const loadCalendars = (meetingId: string): Promise<MeetingCalendarDto[]> =>
    deps.db
      .selectDistinct({ name: calendars.name, accountEmail: calendarAccounts.accountEmail })
      .from(meetingSources)
      .innerJoin(calendars, eq(calendars.id, meetingSources.calendarId))
      .innerJoin(calendarAccounts, eq(calendarAccounts.id, calendars.accountId))
      .where(and(eq(meetingSources.meetingId, meetingId), eq(meetingSources.joinable, true)))
      .orderBy(asc(calendarAccounts.accountEmail), asc(calendars.name));

  routes.get('/:id', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    const summaries = await loadSummaries(meeting.id);
    const activeSummary = summaries.find((s) => s.active);
    return c.json<MeetingDetailDto>({
      meeting: toMeetingDto(meeting),
      company: {
        name: meeting.company,
        source: meeting.companySource,
        suggestions: await listCompanies(deps.db),
      },
      audio: await loadAudio(meeting),
      audioDeletedAt: iso(meeting.audioDeletedAt),
      scheduledStart: iso(meeting.scheduledStart),
      series: await seriesOf(deps.db, meeting),
      calendars: await loadCalendars(meeting.id),
      calendarLinks: await loadCalendarLinks(deps.db, meeting.id),
      calendarLinkEnabled: await calendarLinkEnabled(deps),
      canTranscribe: await canTranscribe(meeting),
      rerun: await rerunOptions(deps.db, deps.settings, meeting),
      canSkip: meeting.status === 'scheduled',
      canRejoin: meeting.status === 'skipped' && isUpcoming(meeting),
      canDelete: isSettled(meeting, new Date()),
      segments: await loadSegments(deps.db, meeting.id),
      speakerChoices: await loadSpeakerChoices(deps.db, meeting.id),
      speakerCheck: await loadSpeakerCheck(deps.settings, meeting),
      chat: await loadChat(meeting.id),
      summaries,
      speakersChangedSinceSummary: speakersChangedSinceSummary(
        meeting,
        activeSummary && new Date(activeSummary.createdAt),
      ),
      summaryOptions: await loadSummaryOptions(meeting.id),
      roomNotices: await loadRoomNotices(
        deps.db,
        meeting.id,
        waitMinutes(await deps.settings.get('summary.shared_wait_minutes')),
      ),
    });
  });

  routes.get('/:id/audio', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Audio not found' }, 404);
    const name =
      c.req.query('download') === undefined ? undefined : downloadName(meeting.title, 'opus');
    return audioResponse(
      await audioStorage(),
      mergedAudioPath(meeting.id),
      c.req.header('range'),
      name,
    );
  });

  routes.get('/:id/transcript.md', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    const body = transcriptMarkdown(
      toMeetingDto(meeting),
      await loadSegments(deps.db, meeting.id),
      await loadChat(meeting.id),
      latestDone(await loadSummaries(meeting.id)),
    );
    return c.body(body, 200, {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${downloadName(meeting.title, 'md')}"`,
    });
  });

  routes.get('/:id/transcript.json', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    c.header(
      'content-disposition',
      `attachment; filename="${downloadName(meeting.title, 'json')}"`,
    );
    const done = (await loadSummaries(meeting.id)).filter((s) => s.status === 'done');
    return c.json(
      transcriptJson(
        toMeetingDto(meeting),
        await loadSegments(deps.db, meeting.id),
        await loadChat(meeting.id),
        done,
      ),
    );
  });

  routes.on('POST', ['/:id/reprocess', '/:id/transcribe'], async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    if (!(await canTranscribe(meeting))) {
      return c.json({ error: 'This meeting cannot be transcribed right now' }, 409);
    }
    const body = reprocessInput.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'Invalid language or speaker count' }, 400);
    await markProcessing(deps.db, meeting.id, {
      speakersChangedAt: new Date(),
      ...(body.data.speakers !== undefined && { speakerCount: body.data.speakers }),
    });
    await deps.queue.send('meeting.process', {
      meetingId: meeting.id,
      ...(body.data.language && { language: body.data.language }),
    });
    return c.json({ ok: true }, 202);
  });

  routes.post('/:id/cancel', async (c) => {
    const cancelled = await deps.db
      .update(meetings)
      .set({ status: 'failed', error: 'Cancelled. Press Re-process to try again.' })
      .where(and(eq(meetings.id, c.req.param('id')), eq(meetings.status, 'processing')))
      .returning({ id: meetings.id });
    if (cancelled.length === 0)
      return c.json({ error: 'This meeting is not being processed' }, 409);
    return c.json({ ok: true });
  });

  routes.post('/:id/skip', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    if ((await skipMeeting(deps.db, meeting.id)) === 'not_skippable') {
      return c.json({ error: 'Only a meeting that has not started can be skipped' }, 409);
    }
    return c.json({ ok: true });
  });

  routes.post('/:id/skip-series', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    if ((await skipSeries(deps, meeting.id)) === 'no_series') {
      return c.json({ error: 'This meeting is not part of a recurring series' }, 409);
    }
    return c.json({ ok: true });
  });

  routes.post('/:id/rejoin', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    const result = await rejoinMeeting(deps, meeting.id);
    if (result === 'already_started') {
      return c.json({ error: 'This meeting has already started' }, 409);
    }
    if (result === 'not_skipped') return c.json({ error: 'This meeting was not skipped' }, 409);
    return c.json({ ok: true });
  });

  routes.post('/:id/speakers-notice/dismiss', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    await dismissSpeakersNotice(deps.db, meeting.id);
    return c.json({ ok: true });
  });

  routes.post('/:id/summaries', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    const body = summaryRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: 'Invalid summary request' }, 400);
    if ((await loadSegments(deps.db, meeting.id)).length === 0) {
      return c.json({ error: 'There is no transcript to summarise yet' }, 409);
    }
    try {
      await requestSummary(deps, meeting.id, body.data);
    } catch (error) {
      if (error instanceof SummaryNotConfiguredError) {
        return c.json({ error: 'That summary provider is not configured, see Settings' }, 400);
      }
      if (error instanceof PromptNotFoundError) return c.json({ error: error.message }, 400);
      throw error;
    }
    // A new summary is the answer to the notice that the speakers changed.
    await dismissSpeakersNotice(deps.db, meeting.id);
    return c.json({ ok: true }, 202);
  });

  return routes;
}
