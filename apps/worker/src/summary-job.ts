import {
  addDueDates,
  CALENDAR_LINK_RETRY,
  cleanSummaryText,
  describeMeetingDate,
  type DateContext,
  findPrompt,
  GUESSED_SPEAKER_RULE,
  loadChatLines,
  loadSummaryTranscript,
  openRoomQuestions,
  parseReplay,
  settleRoomQuestions,
  SHARED_WAIT_POLL_SECONDS,
  summaryWait,
  waitMinutes,
  type JobSender,
  type SettingsStore,
} from '@openminutes/core';
import { eq, meetings, summaries, type Database } from '@openminutes/db';
import { formatChat, type SummaryProvider } from '@openminutes/providers';
import { detectCompany } from './company.js';
import { replayEdits } from './replay-edits.js';
import { participantInstructions } from './participant-names.js';
import { titleRecording } from './auto-title.js';
import { summarizeTranscript } from './summarize.js';

interface SummaryDeps {
  db: Database;
  settings: SettingsStore;
  queue?: JobSender;
  createSummarizer: (providerId: string) => Promise<SummaryProvider>;
}

const dateInstructions = (context: DateContext) =>
  `The meeting took place on ${describeMeetingDate(context)}. Write every relative day (a weekday, tomorrow, next Monday) with its date resolved from the meeting date, for example "Wednesday (12 Nov)", in the language of the summary. Keep "Not specified" when no day is named.`;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Holds the summary back while someone can still say how many people sit in a shared account.
 * The job is sent again with a delay (pg-boss), so nothing waits in a loop and the worker is free
 * meanwhile. Once the time is up, or the wait is switched off (0), the detected counts are used
 * so the summary already names the split speakers. Returns true when the job was put off.
 */
async function waitForSharedAccounts(
  deps: SummaryDeps,
  summaryId: string,
  meetingId: string,
): Promise<boolean> {
  const questions = await openRoomQuestions(deps.db, meetingId);
  if (questions.length === 0) return false;
  const minutes = waitMinutes(await deps.settings.get('summary.shared_wait_minutes'));
  const now = new Date();
  const wait = deps.queue ? summaryWait(questions, minutes, now) : undefined;
  if (wait && deps.queue) {
    const poll = new Date(now.getTime() + SHARED_WAIT_POLL_SECONDS * 1000);
    await deps.queue.send(
      'meeting.summarize',
      { summaryId },
      { startAfter: wait.until < poll ? wait.until : poll },
    );
    return true;
  }
  await settleRoomQuestions(deps.db, meetingId);
  return false;
}

export async function runSummary(deps: SummaryDeps, summaryId: string): Promise<void> {
  const [summary] = await deps.db.select().from(summaries).where(eq(summaries.id, summaryId));
  if (summary?.status !== 'pending') return;

  try {
    if (await waitForSharedAccounts(deps, summaryId, summary.meetingId)) return;
    const { text: lines, hasGuessedSpeakers } = await loadSummaryTranscript(
      deps.db,
      summary.meetingId,
    );
    if (!lines) throw new Error('The transcript is empty');

    const prompt = await findPrompt(deps.settings, summary.promptId ?? undefined);
    const provider = await deps.createSummarizer(summary.provider);
    const chat =
      (await deps.settings.get('summary.include_chat')) === 'false'
        ? []
        : await loadChatLines(deps.db, summary.meetingId);
    const [meeting] = await deps.db
      .select({
        startedAt: meetings.startedAt,
        scheduledStart: meetings.scheduledStart,
        createdAt: meetings.createdAt,
      })
      .from(meetings)
      .where(eq(meetings.id, summary.meetingId));
    const context = {
      date: meeting?.startedAt ?? meeting?.scheduledStart ?? meeting?.createdAt ?? new Date(),
    };
    const names = await participantInstructions(deps.db, deps.settings, summary.meetingId);
    const fresh = addDueDates(
      cleanSummaryText(
        await summarizeTranscript(
          provider,
          lines,
          [
            prompt.content,
            dateInstructions(context),
            names,
            hasGuessedSpeakers && GUESSED_SPEAKER_RULE,
          ]
            .filter(Boolean)
            .join('\n\n'),
          formatChat(chat),
        ),
      ),
      context,
    );
    const replayed = await replayEdits(provider, fresh, parseReplay(summary.replay));
    const content = replayed.steps.at(-1)?.content ?? fresh;
    const failure = replayed.failure ?? null;
    const lastStep = replayed.steps.length - 1;
    await deps.db.transaction(async (tx) => {
      await tx
        .update(summaries)
        .set({
          status: 'done',
          content: fresh,
          error: lastStep < 0 ? failure : null,
        })
        .where(eq(summaries.id, summaryId));
      const now = Date.now();
      for (const [index, step] of replayed.steps.entries()) {
        await tx.insert(summaries).values({
          meetingId: summary.meetingId,
          provider: summary.provider,
          model: provider.model,
          status: 'done',
          origin: 'ai-edit',
          content: step.content,
          note: step.instruction,
          error: index === lastStep ? failure : null,
          createdAt: new Date(now + index + 1),
        });
      }
    });
    await titleRecording(deps.db, provider, summary.meetingId, content);
    await detectCompany(deps, provider, summary.meetingId, content);
    if (deps.queue && (await deps.settings.get('export.auto')) === 'true') {
      await deps.queue.send('meeting.export', { meetingId: summary.meetingId });
    }
    if (deps.queue && (await deps.settings.get('minutes.calendar_link')) === 'true') {
      await deps.queue.send(
        'meeting.calendar-link',
        { meetingId: summary.meetingId },
        CALENDAR_LINK_RETRY,
      );
    }
  } catch (error) {
    console.error(`summary ${summaryId} failed`, error);
    await deps.db
      .update(summaries)
      .set({ status: 'failed', error: errorMessage(error) })
      .where(eq(summaries.id, summaryId));
  }
}
