import type { RoomSnapshot } from '@openminutes/platforms';

export const SAMPLE_INTERVAL_MS = 250;
const MERGE_GAP_MS = 1_000;
/** The names come from the meeting page, so a guest can choose them: cap what is kept. */
export const MAX_ROOM_NAME = 200;
export const MAX_ROOM_PEOPLE = 500;

export interface TrackedParticipant {
  name: string;
  joinedMs: number;
  leftMs: number | null;
}

export interface TrackedSpeakerEvent {
  name: string;
  startMs: number;
  endMs: number;
}

interface OpenInterval {
  startMs: number;
  lastHeardMs: number;
}

export class RoomTracker {
  private readonly participants = new Map<string, TrackedParticipant>();
  private readonly open = new Map<string, OpenInterval>();
  private readonly events: TrackedSpeakerEvent[] = [];
  private present = Number.POSITIVE_INFINITY;

  /** People in the room at the last usable snapshot, or infinity before any. */
  get count(): number {
    return this.present;
  }

  /** An empty snapshot means the page could not be read (the bot is always in the room), so it is ignored. */
  observe(raw: RoomSnapshot, atMs: number): void {
    if (raw.participants.length === 0) return;
    const clip = (name: string) => name.slice(0, MAX_ROOM_NAME);
    const snapshot = {
      ...raw,
      participants: raw.participants.map(clip),
      speaking: raw.speaking.map(clip),
    };
    this.present = Math.max(snapshot.participants.length, snapshot.headcount ?? 0);

    for (const name of snapshot.participants) {
      const known = this.participants.get(name);
      if (known) known.leftMs = null;
      else if (this.participants.size < MAX_ROOM_PEOPLE) {
        this.participants.set(name, { name, joinedMs: atMs, leftMs: null });
      }
    }
    for (const participant of this.participants.values()) {
      if (participant.leftMs === null && !snapshot.participants.includes(participant.name)) {
        participant.leftMs = atMs;
      }
    }

    for (const name of snapshot.speaking) {
      const interval = this.open.get(name);
      if (interval) interval.lastHeardMs = atMs;
      else this.open.set(name, { startMs: atMs, lastHeardMs: atMs });
    }
    for (const [name, interval] of this.open) {
      if (atMs - interval.lastHeardMs > MERGE_GAP_MS) this.close(name, interval);
    }
  }

  finish(atMs: number): {
    participants: TrackedParticipant[];
    speakerEvents: TrackedSpeakerEvent[];
  } {
    for (const [name, interval] of this.open) this.close(name, interval);
    for (const participant of this.participants.values()) participant.leftMs ??= atMs;
    return {
      participants: [...this.participants.values()],
      speakerEvents: this.events.toSorted((a, b) => a.startMs - b.startMs),
    };
  }

  private close(name: string, interval: OpenInterval): void {
    this.open.delete(name);
    this.events.push({
      name,
      startMs: interval.startMs,
      endMs: interval.lastHeardMs + SAMPLE_INTERVAL_MS,
    });
  }
}
