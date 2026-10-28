import { describe, expect, it, vi } from 'vitest';
import { moreItems } from './meetingMenus.js';

const labels = (items: { label: string }[]) => items.map((item) => item.label);

describe('more menu', () => {
  const input = {
    canDelete: true,
    hasTranscript: true,
    toggleArchive: vi.fn(),
    remove: vi.fn(),
    archived: false,
    reviewHref: '#/meetings/m/review',
  };

  it('keeps the re-run actions out: they have their own menu', () => {
    expect(labels(moreItems(input))).toEqual(['Review speakers', 'Archive', 'Delete meeting']);
  });

  it('offers nothing to delete or review without a transcript or when not settled', () => {
    expect(labels(moreItems({ ...input, canDelete: false, hasTranscript: false }))).toEqual([]);
  });
});
