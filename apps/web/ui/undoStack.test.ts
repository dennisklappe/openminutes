import { describe, expect, it } from 'vitest';
import { popUndo, pushUndo, UNDO_LIMIT } from './undoStack.js';

describe('undo stack', () => {
  it('pops the latest item first', () => {
    const stack = pushUndo(pushUndo([], 'one'), 'two');
    expect(popUndo(stack)).toEqual({ item: 'two', rest: ['one'] });
  });

  it('is empty-safe', () => {
    expect(popUndo([])).toEqual({ item: undefined, rest: [] });
  });

  it('forgets the oldest edits past the limit', () => {
    let stack: number[] = [];
    for (let i = 0; i < UNDO_LIMIT + 3; i += 1) stack = pushUndo(stack, i);
    expect(stack).toHaveLength(UNDO_LIMIT);
    expect(stack[0]).toBe(3);
  });
});
