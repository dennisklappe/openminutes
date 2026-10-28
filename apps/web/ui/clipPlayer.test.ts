import { describe, expect, it } from 'vitest';
import {
  BLOCKED,
  createClipPlayer,
  FAILED,
  SLOW,
  START_TIMEOUT_MS,
  type AudioLike,
  type ClipData,
  type ClipEnv,
} from './clipPlayer.js';

class FakeAudio implements AudioLike {
  src = '';
  currentTime = 0;
  readyState = 0;
  paused = true;
  playResult: () => Promise<void> = () => Promise.resolve();
  private handlers = new Map<string, Set<() => void>>();
  play = () => {
    this.paused = false;
    return this.playResult();
  };
  pause = () => {
    this.paused = true;
  };
  load = () => undefined;
  removeAttribute = (name: string) => {
    if (name === 'src') this.src = '';
  };
  addEventListener = (type: string, listener: () => void) => {
    const set = this.handlers.get(type) ?? new Set();
    set.add(listener);
    this.handlers.set(type, set);
  };
  removeEventListener = (type: string, listener: () => void) => {
    this.handlers.get(type)?.delete(listener);
  };
  emit = (type: string) => {
    for (const listener of [...(this.handlers.get(type) ?? [])]) listener();
  };
  count = () => [...this.handlers.values()].reduce((sum, set) => sum + set.size, 0);
}

interface Pending {
  url: string;
  signal: AbortSignal;
  resolve: (data: ClipData) => void;
  reject: (error: Error) => void;
}

function setup() {
  const audio = new FakeAudio();
  const pending: Pending[] = [];
  const timers = new Map<number, { run: () => void; ms: number }>();
  const revoked: string[] = [];
  let timerId = 0;
  const env: ClipEnv = {
    audio: () => audio,
    fetchClip: (url, signal) =>
      new Promise<ClipData>((resolve, reject) => {
        pending.push({ url, signal, resolve, reject });
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      }),
    objectUrl: () => `blob:${String(++timerId)}`,
    revokeUrl: (url) => revoked.push(url),
    setTimer: (run, ms) => {
      timers.set(++timerId, { run, ms });
      return timerId;
    },
    clearTimer: (id) => timers.delete(id as number),
  };
  const player = createClipPlayer(env);
  const data = (offsetMs = 1000): ClipData => ({ blob: new Blob(['x']), offsetMs });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { audio, pending, timers, revoked, player, data, settle };
}

const clip = (n: number) => ({ url: `/clip/${String(n)}`, durationMs: 3000 });

describe('clip player', () => {
  it('loads, seeks to the offset, plays and stops at the end of the clip', async () => {
    const { audio, pending, player, data, settle } = setup();
    player.play(clip(1));
    expect(player.getState()).toEqual({ status: 'loading', url: '/clip/1' });
    pending[0]?.resolve(data(1000));
    await settle();
    audio.emit('loadedmetadata');
    expect(audio.currentTime).toBe(1);
    audio.emit('playing');
    expect(player.getState().status).toBe('playing');
    audio.currentTime = 3.9;
    audio.emit('timeupdate');
    expect(player.getState().status).toBe('playing');
    audio.currentTime = 4.01;
    audio.emit('timeupdate');
    expect(player.getState()).toEqual({ status: 'idle' });
    expect(audio.src).toBe('');
    expect(audio.count()).toBe(0);
  });

  it('cancels the request of the previous clip when another one starts', async () => {
    const { pending, player } = setup();
    player.play(clip(1));
    player.play(clip(2));
    expect(pending[0]?.signal.aborted).toBe(true);
    expect(pending[1]?.signal.aborted).toBe(false);
    player.stop();
    expect(pending[1]?.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(player.getState()).toEqual({ status: 'idle' });
  });

  it('shows an error with the reason when the clip does not start in time', () => {
    const { pending, timers, player } = setup();
    player.play(clip(1));
    const [timer] = [...timers.values()];
    expect(timer?.ms).toBe(START_TIMEOUT_MS);
    timer?.run();
    expect(player.getState()).toEqual({ status: 'error', url: '/clip/1', message: SLOW });
    expect(pending[0]?.signal.aborted).toBe(true);
  });

  it('reports a failed request and a browser that refuses to play', async () => {
    const { audio, pending, player, data, settle } = setup();
    player.play(clip(1));
    pending[0]?.reject(new Error('503'));
    await settle();
    expect(player.getState()).toMatchObject({ status: 'error', message: FAILED });
    audio.playResult = () =>
      Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    player.play(clip(2));
    pending[1]?.resolve(data());
    await settle();
    expect(player.getState()).toMatchObject({ status: 'error', message: BLOCKED });
  });

  it('plays a clip that was fetched ahead at once, without a second request', async () => {
    const { audio, pending, player, data, settle } = setup();
    player.prefetch(clip(2));
    expect(pending).toHaveLength(1);
    pending[0]?.resolve(data());
    await settle();
    player.play(clip(2));
    expect(pending).toHaveLength(1);
    expect(audio.src).toMatch(/^blob:/);
  });

  it('joins a clip that is still being fetched ahead', async () => {
    const { pending, player, data, audio, settle } = setup();
    player.prefetch(clip(2));
    player.play(clip(2));
    expect(pending).toHaveLength(1);
    pending[0]?.resolve(data());
    await settle();
    expect(audio.src).toMatch(/^blob:/);
  });

  it('never has more than one clip fetched ahead and none while one is loading', () => {
    const { pending, player } = setup();
    player.prefetch(clip(2));
    player.prefetch(clip(3));
    expect(pending[0]?.signal.aborted).toBe(true);
    expect(pending.filter((p) => !p.signal.aborted)).toHaveLength(1);
    player.play(clip(1));
    expect(pending.filter((p) => !p.signal.aborted)).toHaveLength(1);
    player.prefetch(clip(4));
    expect(pending.filter((p) => !p.signal.aborted)).toHaveLength(1);
  });

  it('frees the object url and the listeners of every clip it leaves', async () => {
    const { audio, pending, revoked, player, data, settle } = setup();
    for (let n = 1; n <= 5; n++) {
      player.play(clip(n));
      pending[n - 1]?.resolve(data());
      await settle();
    }
    expect(revoked).toHaveLength(4);
    expect(audio.count()).toBe(5);
    player.dispose();
    expect(audio.count()).toBe(0);
    expect(revoked).toHaveLength(5);
  });
});
