import {
  addDueDates,
  CALENDAR_LINK_RETRY,
  cleanSummaryText,
  describeMeetingDate,
  type DateContext,
  findPrompt,
  loadChatLines,
  loadTranscriptText,
  parseReplay,
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

export async function runSummary(deps: SummaryDeps, summaryId: string): Promise<void> {
  const [summary] = await deps.db.select().from(summaries).where(eq(summaries.id, summaryId));
  if (summary?.status !== 'pending') return;

  try {
    const lines = await loadTranscriptText(deps.db, summary.meetingId);
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
          [prompt.content, dateInstructions(context), names].filter(Boolean).join('\n\n'),
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
