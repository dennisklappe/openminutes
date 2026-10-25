export const UNDO_LIMIT = 20;

export const pushUndo = <T>(stack: readonly T[], item: T): T[] =>
  [...stack, item].slice(-UNDO_LIMIT);

export const popUndo = <T>(stack: readonly T[]): { item: T | undefined; rest: T[] } => ({
  item: stack.at(-1),
  rest: stack.slice(0, -1),
});
