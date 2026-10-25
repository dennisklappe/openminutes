import { describe, expect, it, vi } from 'vitest';
import { moreItems, speakerItems } from './meetingMenus.js';

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe('speaker count menu items', () => {
  it('offers 2 to 5 speakers and no automatic item while the count is automatic', () => {
    expect(labels(speakerItems(null, vi.fn()))).toEqual([
      'Re-process with 2 speakers',
      'Re-process with 3 speakers',
      'Re-process with 4 speakers',
      'Re-process with 5 or more speakers',
    ]);
  });

  it('leaves out the current count and offers the automatic one', () => {
    const items = speakerItems(3, vi.fn());
    expect(labels(items)).toEqual([
      'Re-process with 2 speakers',
      'Re-process with 4 speakers',
      'Re-process with 5 or more speakers',
      'Re-process with automatic speaker count',
    ]);
  });

  it('re-processes with the chosen count, or null for automatic', () => {
    const reprocess = vi.fn();
    const items = speakerItems(3, reprocess);
    items[0]?.onSelect?.();
    items.at(-1)?.onSelect?.();
    expect(reprocess.mock.calls).toEqual([[{ speakers: 2 }], [{ speakers: null }]]);
  });
});

describe('more menu', () => {
  const input = {
    canTranscribe: true,
    canDelete: false,
    hasTranscript: true,
    chooseLanguage: vi.fn(),
    speakerCount: null,
    reprocess: vi.fn(),
    toggleArchive: vi.fn(),
    remove: vi.fn(),
    archived: false,
  };

  it('shows speaker counts for recordings that can be transcribed only', () => {
    expect(labels(moreItems({ ...input, isRecording: true }))).toContain(
      'Re-process with 2 speakers',
    );
    expect(labels(moreItems({ ...input, isRecording: false }))).not.toContain(
      'Re-process with 2 speakers',
    );
    expect(labels(moreItems({ ...input, isRecording: true, canTranscribe: false }))).toEqual([]);
  });
});
