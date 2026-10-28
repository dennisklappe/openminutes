import { eq, meetings, type Database } from '@openminutes/db';

const BEAT_MS = 15_000;
const MIN_LIMIT_MS = 30 * 60_000;
const SLOWEST_SPEED = 4;

export type Step =
  | 'preparing'
  | 'transcribing'
  | 'repairing'
  | 'speakers'
  | 'saving'
  | 'finding-voices'
  | 'moving-lines'
  | 'checking-voices';

export class Cancelled extends Error {
  constructor() {
    super('Processing was cancelled');
  }
}

/** The longest a recording of this length may take before processing is given up. */
export const limitFor = (durationMs: number): number => MIN_LIMIT_MS + durationMs * SLOWEST_SPEED;

/**
 * What the meeting page shows while a recording is processed, and the pulse the watchdog reads.
 * A beat records that the worker is alive, notices that someone pressed Cancel, and the optional
 * limit aborts a run that takes far longer than the recording can justify.
 */
export class Run {
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout;
  private deadline: NodeJS.Timeout | undefined;
  private cancelled = false;

  constructor(
    private readonly db: Database,
    private readonly meetingId: string,
  ) {
    this.timer = setInterval(() => void this.beat(), BEAT_MS);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get wasCancelled(): boolean {
    return this.cancelled;
  }

  async begin(): Promise<void> {
    await this.db
      .update(meetings)
      .set({
        processingStep: 'preparing',
        processingCurrent: null,
        processingTotal: null,
        processingStartedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where(eq(meetings.id, this.meetingId));
  }

  limit(ms: number): void {
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => {
      this.controller.abort(
        new Error(`Processing took longer than ${String(Math.round(ms / 60_000))} minutes`),
      );
    }, ms);
  }

  async step(step: Step, current?: number, total?: number): Promise<void> {
    this.signal.throwIfAborted();
    await this.db
      .update(meetings)
      .set({
        processingStep: step,
        processingCurrent: current ?? null,
        processingTotal: total ?? null,
        heartbeatAt: new Date(),
      })
      .where(eq(meetings.id, this.meetingId));
  }

  async finish(): Promise<void> {
    clearInterval(this.timer);
    clearTimeout(this.deadline);
    await this.db
      .update(meetings)
      .set({ processingStep: null, processingCurrent: null, processingTotal: null })
      .where(eq(meetings.id, this.meetingId));
  }

  /** Ends this job but keeps the meeting on `step`, for the job that is queued next. */
  async handOver(step: Step): Promise<void> {
    this.stop();
    await this.step(step);
  }

  stop(): void {
    clearInterval(this.timer);
    clearTimeout(this.deadline);
  }

  private async beat(): Promise<void> {
    try {
      const [row] = await this.db
        .update(meetings)
        .set({ heartbeatAt: new Date() })
        .where(eq(meetings.id, this.meetingId))
        .returning({ status: meetings.status });
      if (row && row.status !== 'processing') {
        this.cancelled = true;
        this.controller.abort(new Cancelled());
      }
    } catch (error) {
      console.error(`heartbeat of meeting ${this.meetingId} failed`, error);
    }
  }
}
