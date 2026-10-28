import { describe, expect, it } from 'vitest';
import { ClipBusyError, createClipService } from './clip-service.js';

const clip = (size: number) => ({ body: Buffer.alloc(size), offsetMs: 0 });
const options = { concurrent: 2, waiting: 1, cacheBytes: 100 };

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

describe('createClipService', () => {
  it('cuts once for the same clip, also when asked at the same time', async () => {
    const service = createClipService(options);
    let cuts = 0;
    const cut = () => {
      cuts++;
      return Promise.resolve(clip(10));
    };
    await Promise.all([service.get('a', cut), service.get('a', cut)]);
    await service.get('a', cut);
    expect(cuts).toBe(1);
  });

  it('never runs more cuts than allowed and turns away what cannot wait', async () => {
    const service = createClipService(options);
    const g = gate();
    let running = 0;
    let peak = 0;
    const slow = async () => {
      peak = Math.max(peak, ++running);
      await g.opened;
      running--;
      return clip(1);
    };
    const jobs = ['a', 'b', 'c'].map((key) => service.get(key, slow));
    await expect(service.get('d', slow)).rejects.toBeInstanceOf(ClipBusyError);
    g.open();
    await Promise.all(jobs);
    expect(peak).toBe(2);
    await service.get('e', () => Promise.resolve(clip(1)));
  });

  it('frees its turn when a cut fails', async () => {
    const service = createClipService({ ...options, concurrent: 1 });
    await expect(service.get('a', () => Promise.reject(new Error('broken')))).rejects.toThrow(
      'broken',
    );
    await expect(service.get('b', () => Promise.resolve(clip(1)))).resolves.toBeDefined();
  });

  it('forgets the oldest clips beyond its memory', async () => {
    const service = createClipService(options);
    let cuts = 0;
    const cut = (size: number) => () => {
      cuts++;
      return Promise.resolve(clip(size));
    };
    await service.get('a', cut(60));
    await service.get('b', cut(60));
    await service.get('b', cut(60));
    expect(cuts).toBe(2);
    await service.get('a', cut(60));
    expect(cuts).toBe(3);
  });
});
