export const TITLE_MAX = 200;

/** The trimmed title to save, or undefined when there is nothing to change. */
export function titleToSave(draft: string, current: string): string | undefined {
  const title = draft.trim();
  return title === '' || title === current || title.length > TITLE_MAX ? undefined : title;
}
