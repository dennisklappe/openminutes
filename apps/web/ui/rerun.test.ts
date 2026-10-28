import { describe, expect, it, vi } from 'vitest';
import { rerunCopy, rerunItems, type RerunInput } from './rerun.js';

const labels = (items: { label: string }[]) => items.map((item) => item.label);
const input: RerunInput = {
  canTranscribe: true,
  hasTranscript: true,
  rerun: { available: true, speakers: true, voiceCheckOn: true },
};

describe('rerunItems', () => {
  it('offers all three actions for a transcribed recording', () => {
    expect(labels(rerunItems(input, vi.fn()))).toEqual([
      'Re-transcribe...',
      'Re-run voice recognition...',
      'Re-run speakers with a number of people...',
    ]);
  });

  it('leaves out the speakers for a call with a speaking indicator', () => {
    const items = rerunItems({ ...input, rerun: { ...input.rerun, speakers: false } }, vi.fn());
    expect(labels(items)).toEqual(['Re-transcribe...', 'Re-run voice recognition...']);
  });

  it('offers only Transcribe before there is a transcript, and nothing while busy', () => {
    const fresh = { canTranscribe: true, hasTranscript: false };
    const none = { available: false, speakers: false, voiceCheckOn: false };
    expect(labels(rerunItems({ ...input, ...fresh, rerun: none }, vi.fn()))).toEqual([
      'Transcribe...',
    ]);
    expect(rerunItems({ ...input, canTranscribe: false, rerun: none }, vi.fn())).toEqual([]);
  });

  it('tells which action was chosen', () => {
    const choose = vi.fn();
    for (const item of rerunItems(input, choose)) item.onSelect?.();
    expect(choose.mock.calls).toEqual([['transcribe'], ['voices'], ['speakers']]);
  });
});

describe('rerunCopy', () => {
  const options = { voiceCheckOn: true };

  it('says what is kept and what changes for every action', () => {
    for (const kind of ['transcribe', 'voices', 'speakers'] as const) {
      const copy = rerunCopy(kind, options);
      expect(copy.keeps).toContain('set by hand');
      expect(copy.changes.length).toBeGreaterThan(20);
    }
  });

  it('says that voice recognition is off and blocks the action', () => {
    expect(rerunCopy('voices', options).blocked).toBeUndefined();
    const off = rerunCopy('voices', { voiceCheckOn: false });
    expect(off.blocked).toContain('Check lines against saved voices');
  });

  it('never blocks the other actions', () => {
    expect(rerunCopy('speakers', { voiceCheckOn: false }).blocked).toBeUndefined();
    expect(rerunCopy('transcribe', { voiceCheckOn: false }).blocked).toBeUndefined();
  });
});
