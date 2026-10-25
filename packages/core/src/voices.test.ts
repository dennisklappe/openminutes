import { describe, expect, it } from 'vitest';
import { cosineSimilarity, matchVoices, mergeEmbeddings } from './voices.js';

describe('voices', () => {
  it('compares embeddings by direction', () => {
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it('averages a new sample into a centroid', () => {
    expect(mergeEmbeddings([1, 1], 1, [3, 5])).toEqual([2, 3]);
  });

  it('returns only matches above the threshold, best first', () => {
    const known = [
      { name: 'Anna', embedding: [1, 0.1] },
      { name: 'Ben', embedding: [0, 1] },
      { name: 'Cleo', embedding: [1, 0.5] },
    ];
    expect(matchVoices([1, 0], known).map((m) => m.name)).toEqual(['Anna', 'Cleo']);
  });
});
