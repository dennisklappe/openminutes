import { talkOf } from './fakes';

export interface Player {
  readonly time: number;
  readonly playing: boolean;
  toggle: () => void;
  seek: (seconds: number) => void;
  pause: () => void;
  select: (id: string) => void;
}

interface Track extends EventTarget {
  currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  play: () => Promise<void>;
  pause: () => void;
}

/** A silent stand-in for audio: a clock that runs through a transcript and fires the same events. */
class SilentTrack extends EventTarget implements Track {
  paused = true;
  private base = 0;
  private startedAt = 0;
  private timer = 0;

  constructor(private readonly length: number) {
    super();
  }

  get currentTime(): number {
    const now = this.paused ? this.base : this.base + (performance.now() - this.startedAt) / 1000;
    return Math.min(now, this.length);
  }

  set currentTime(seconds: number) {
    this.base = seconds;
    this.startedAt = performance.now();
    if (!this.paused) this.schedule();
  }

  get ended(): boolean {
    return this.currentTime >= this.length;
  }

  play(): Promise<void> {
    this.base = this.ended ? 0 : this.currentTime;
    this.startedAt = performance.now();
    this.paused = false;
    this.schedule();
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }

  pause(): void {
    if (this.paused) return;
    this.base = this.currentTime;
    this.paused = true;
    clearTimeout(this.timer);
    this.dispatchEvent(new Event('pause'));
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(
      () => {
        this.base = this.length;
        this.paused = true;
        this.dispatchEvent(new Event('ended'));
      },
      (this.length - this.currentTime) * 1000,
    );
  }
}

/** One track per meeting, created on the first Play so the page costs nothing until then. */
export function createPlayer(onFrame: () => void, onChange: () => void): Player {
  let current = '';
  let track: Track | undefined;
  let pending = 0;
  let frame = 0;

  const tick = () => {
    onFrame();
    frame = track && !track.paused ? requestAnimationFrame(tick) : 0;
  };

  const element = (): Track => {
    if (!track) {
      const talk = talkOf(current);
      const made = talk.src
        ? Object.assign(new Audio(), { preload: 'auto', src: talk.src })
        : new SilentTrack(talk.duration);
      made.addEventListener('play', () => {
        if (!frame) frame = requestAnimationFrame(tick);
        onChange();
      });
      made.addEventListener('pause', onChange);
      made.addEventListener('ended', onChange);
      track = made;
    }
    return track;
  };

  const play = () => {
    const media = element();
    if (pending) media.currentTime = pending;
    pending = 0;
    void media.play().catch(onChange);
  };

  return {
    get time() {
      return track?.currentTime ?? pending;
    },
    get playing() {
      return track !== undefined && !track.paused;
    },
    toggle() {
      if (track && !track.paused) track.pause();
      else if (track?.ended) {
        track.currentTime = 0;
        play();
      } else play();
    },
    seek(seconds) {
      if (track) track.currentTime = seconds;
      else pending = seconds;
      play();
    },
    pause() {
      track?.pause();
    },
    select(id) {
      if (id === current) return;
      track?.pause();
      track = undefined;
      pending = 0;
      current = id;
    },
  };
}
