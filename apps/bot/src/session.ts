import {
  joinJobExpirySeconds,
  lobbyTimeoutMessage,
  loadBotProfile,
  loadGoogleSession,
  loadGoogleCredentials,
  markGoogleSessionExpired,
  refreshGoogleSession,
  type JoinJobPayload,
  type JobSender,
  type LocalStorage,
  type SettingsStore,
} from '@openminutes/core';
import { audioFiles, eq, meetings, type Database, type MeetingStatus } from '@openminutes/db';
import { JoinError, parseMeetingLink, platformById, type Platform } from '@openminutes/platforms';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createAudioSink, type AudioSink } from './audio-sink.js';
import { prepareBotSession, type BotSession } from './bot-session.js';
import type { BotEnv } from './env.js';
import { contextOptions, launchHeadless, type LaunchGoogleBrowser } from './google-browser.js';
import { signInWithSavedCredentials } from './google-keepalive.js';
import { loudMicSamples, installMicGuard } from './mic-guard.js';
import { startHeartbeat } from './heartbeat.js';
import { startRecording, type Recording } from './recorder.js';
import { startChatScraper, type ChatScraper } from './chat-scraper.js';
import { saveChat } from './chat-store.js';
import { saveRoom } from './room-store.js';
import { startRoomScraper, type RoomScraper } from './scraper.js';
import { claimSlot } from './slots.js';
import { watchMeeting } from './watch.js';

interface BotDeps {
  db: Database;
  queue: JobSender;
  settings: SettingsStore;
  storage: LocalStorage;
  env: BotEnv;
  launchGoogleBrowser?: LaunchGoogleBrowser;
}

const POLL_INTERVAL_MS = 2_000;
const SLOT_RETRY_MS = 30_000;
const JOIN_DEADLINE_GRACE_MS = 60_000;

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withDeadline<T>(work: Promise<T>, ms: number, error: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(error());
    }, ms);
  });
  return Promise.race([work, expired]).finally(() => {
    clearTimeout(timer);
  });
}

const isSessionExpired = (error: unknown) =>
  error instanceof JoinError && error.reason === 'session_expired';

async function signedBackIn(deps: BotDeps, error: unknown): Promise<boolean> {
  if (!isSessionExpired(error) || !(await loadGoogleCredentials(deps.settings))) return false;
  const outcome = await signInWithSavedCredentials({
    settings: deps.settings,
    launch: deps.launchGoogleBrowser ?? launchHeadless(deps.env),
  }).catch(() => ({ ok: false }));
  return outcome.ok;
}

async function keepMicMuted(platform: Platform, page: Page, meetingId: string): Promise<void> {
  const muted = await platform.muteMicrophone(page).catch(() => false);
  if (!muted) console.error(`meeting ${meetingId}: the microphone could not be confirmed muted`);
}

function guardMic(platform: Platform, page: Page, meetingId: string): () => Promise<void> {
  let seen = 0;
  return async () => {
    const loud = await loudMicSamples(page).catch(() => seen);
    if (loud <= seen) return;
    seen = loud;
    console.error(`meeting ${meetingId}: the outgoing microphone was not silent, muting again`);
    await keepMicMuted(platform, page, meetingId);
  };
}

export async function runMeeting(
  deps: BotDeps,
  { meetingId, scheduledStart }: JoinJobPayload,
): Promise<void> {
  const { db } = deps;
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  const platform = meeting && platformById(meeting.platform);
  if (meeting?.status !== 'scheduled' || !platform) return;
  if ((meeting.scheduledStart?.toISOString() ?? null) !== scheduledStart) return;

  const setStatus = (status: MeetingStatus, extra: Partial<typeof meetings.$inferInsert> = {}) =>
    db
      .update(meetings)
      .set({ status, ...extra })
      .where(eq(meetings.id, meetingId));

  const [lobbySeconds, maxMinutes, aloneSeconds, maxConcurrent] = await Promise.all([
    deps.settings.getNumber('bot.lobby_timeout_seconds'),
    deps.settings.getNumber('bot.max_duration_minutes'),
    deps.settings.getNumber('bot.alone_timeout_seconds'),
    deps.settings.getNumber('bot.max_concurrent'),
  ]);

  const claimedAt = new Date();
  const requeued: string[] = [];
  const claim = await claimSlot(db, meetingId, maxConcurrent, claimedAt, requeued);
  for (const id of requeued) await deps.queue.send('meeting.schedule', { meetingId: id });
  if (claim === 'gone' || claim === 'duplicate') return;
  if (claim === 'full') {
    await db
      .update(meetings)
      .set({ error: 'Waiting for a free slot, the concurrent meeting limit is reached' })
      .where(eq(meetings.id, meetingId));
    await deps.queue.send(
      'meeting.join',
      { meetingId, scheduledStart },
      {
        startAfter: new Date(Date.now() + SLOT_RETRY_MS),
        expireInSeconds: joinJobExpirySeconds(lobbySeconds, maxMinutes),
        retryLimit: 0,
      },
    );
    return;
  }

  let scraper: RoomScraper | undefined;
  const persistRoom = async () => {
    const finished = scraper;
    scraper = undefined;
    if (!finished) return;
    const room = await finished.stop();
    await saveRoom(db, meetingId, finished.startedAt, room, await deps.settings.get('bot.name'));
  };

  let chatScraper: ChatScraper | undefined;
  const persistChat = async () => {
    const finished = chatScraper;
    chatScraper = undefined;
    await finished?.stop();
  };

  let browser: Browser | undefined;
  const watchdog = { closed: false };
  const stopHeartbeat = startHeartbeat(db, meetingId, claimedAt, () => {
    watchdog.closed = true;
    void browser?.close().catch(() => undefined);
  });
  let session: BotSession | undefined;
  let recording: Recording | undefined;
  let sink: AudioSink | undefined;
  try {
    const profile = await loadBotProfile(deps.settings, deps.storage);
    session = await prepareBotSession(profile, deps.env, {
      onCameraError: (error) => {
        console.error('camera image could not be prepared, joining with the camera off', error);
      },
    });
    sink = await createAudioSink(meetingId);
    const launched = await chromium.launch({
      headless: false,
      args: session.chromiumArgs,
      env: { ...process.env, ...sink.env },
    });
    browser = launched;
    const { displayName, cameraOn } = session;
    const openSession = async (): Promise<{
      context: BrowserContext;
      page: Page;
      signedIn: boolean;
    }> => {
      const googleSession =
        platform.id === 'meet' ? await loadGoogleSession(deps.settings) : undefined;
      const context = await launched.newContext(contextOptions(googleSession));
      await installMicGuard(context);
      const page = await context.newPage();
      try {
        await platform.join(
          page,
          parseMeetingLink(meeting.joinUrl)?.canonicalUrl ?? meeting.joinUrl,
          {
            displayName,
            cameraOn,
            lobbyTimeoutMs: lobbySeconds * 1000,
            signedIn: googleSession !== undefined,
            onLobby: async () => {
              await setStatus('in_lobby');
            },
          },
        );
      } catch (error) {
        await context.close();
        throw error;
      }
      return { context, page, signedIn: googleSession !== undefined };
    };
    const lobbyTimeout = () => new JoinError('lobby_timeout', lobbyTimeoutMessage(lobbySeconds));
    const openWithinDeadline = () =>
      withDeadline(openSession(), lobbySeconds * 1000 + JOIN_DEADLINE_GRACE_MS, lobbyTimeout);
    let joined;
    try {
      joined = await openWithinDeadline();
    } catch (error) {
      if (!(await signedBackIn(deps, error))) throw error;
      joined = await openWithinDeadline();
    }
    const { context, page } = joined;

    if (joined.signedIn) {
      await refreshGoogleSession(deps.settings, await context.storageState()).catch(
        (error: unknown) => {
          console.error(`meeting ${meetingId}: Google session could not be refreshed`, error);
        },
      );
    }

    await keepMicMuted(platform, page, meetingId);

    if (session.joinMessage) {
      await platform.sendChatMessage(page, session.joinMessage).catch((error: unknown) => {
        console.error(`meeting ${meetingId}: join message could not be sent`, error);
      });
    }

    const directory = `meetings/${meetingId}`;
    const outputDir = await deps.storage.ensureDirectory(directory);
    recording = startRecording({
      inputArgs: ['-f', 'pulse', '-i', sink.source],
      outputDir,
      segmentSeconds: deps.env.OPENMINUTES_SEGMENT_SECONDS,
      onSegment: async ({ fileName, durationMs }) => {
        const path = `${directory}/${fileName}`;
        await db.insert(audioFiles).values({
          meetingId,
          path,
          durationMs,
          codec: 'opus',
          size: await deps.storage.size(path),
        });
      },
    });
    scraper = startRoomScraper(platform, page, displayName);
    chatScraper = startChatScraper({
      platform,
      page,
      selfName: displayName,
      startedAt: scraper.startedAt,
      save: (messages) => saveChat(db, meetingId, messages),
    });
    await setStatus('recording', { startedAt: scraper.startedAt });

    const reason = await watchMeeting(platform, page, {
      maxDurationMs: maxMinutes * 60_000,
      aloneTimeoutMs: aloneSeconds * 1000,
      pollIntervalMs: POLL_INTERVAL_MS,
      participantCount: () => scraper?.tracker.count ?? Number.POSITIVE_INFINITY,
      onPoll: guardMic(platform, page, meetingId),
    });
    console.log(`meeting ${meetingId} finished: ${reason}`);
    await persistRoom();
    await persistChat();
    await platform.leave(page);
    await recording.stop();
    await setStatus('ended', { endedAt: new Date() });
    await deps.queue.send('meeting.process', { meetingId });
  } catch (error) {
    if (isSessionExpired(error)) {
      await markGoogleSessionExpired(deps.settings).catch(() => undefined);
      await deps.queue
        .send('bot.session-alert', { reason: failureMessage(error) })
        .catch(() => undefined);
    }
    await recording?.stop().catch(() => undefined);
    await persistRoom().catch(() => undefined);
    await persistChat().catch(() => undefined);
    if (watchdog.closed) {
      console.error(`meeting ${meetingId} was closed by the worker watchdog`);
    } else {
      const message =
        error instanceof JoinError && error.reason === 'lobby_timeout'
          ? lobbyTimeoutMessage(lobbySeconds)
          : failureMessage(error);
      await setStatus('failed', { endedAt: new Date(), error: message });
      console.error(`meeting ${meetingId} failed`, error);
    }
  } finally {
    stopHeartbeat();
    await browser?.close().catch(() => undefined);
    await sink?.dispose().catch(() => undefined);
    await session?.dispose();
  }
}
