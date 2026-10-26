import { PgBoss } from 'pg-boss';
import { jobNames, type JobName, type JobPayloads } from './jobs.js';

export interface SendOptions {
  startAfter?: Date;
  expireInSeconds?: number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
}

// pg-boss gives a handler 15 minutes by default and then fails the job, which is far too short
// for transcribing and identifying the speakers of a long recording on a small server.
const QUEUE_OPTIONS: Partial<Record<JobName, { expireInSeconds: number; retryLimit: number }>> = {
  'meeting.process': { expireInSeconds: 6 * 3600, retryLimit: 1 },
  'meeting.import': { expireInSeconds: 3600, retryLimit: 1 },
};

export interface JobSender {
  send<N extends JobName>(name: N, payload: JobPayloads[N], options?: SendOptions): Promise<void>;
}

export class JobQueue implements JobSender {
  private constructor(private readonly boss: PgBoss) {}

  static async start(connectionString: string): Promise<JobQueue> {
    const boss = new PgBoss(connectionString);
    boss.on('error', (error) => {
      console.error('queue error', error);
    });
    await boss.start();
    for (const name of jobNames) {
      await boss.createQueue(name);
      const options = QUEUE_OPTIONS[name];
      if (options) await boss.updateQueue(name, options);
    }
    return new JobQueue(boss);
  }

  async send<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
    options: SendOptions = {},
  ): Promise<void> {
    await this.boss.send(name, payload, options);
  }

  async work<N extends JobName>(
    name: N,
    handler: (payload: JobPayloads[N]) => Promise<void>,
    { concurrency = 1 }: { concurrency?: number } = {},
  ): Promise<void> {
    await this.boss.work<JobPayloads[N]>(name, { localConcurrency: concurrency }, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }

  async schedule<N extends JobName>(name: N, cron: string, payload: JobPayloads[N]): Promise<void> {
    await this.boss.schedule(name, cron, payload);
  }

  stop(): Promise<void> {
    return this.boss.stop({ graceful: false });
  }
}
