const WORD_EDGE_BEFORE = '(?<![\\p{L}\\p{N}_])';
const WORD_EDGE_AFTER = '(?![\\p{L}\\p{N}_])';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const wordPattern = (source: string, flags: string) =>
  new RegExp(`${WORD_EDGE_BEFORE}${source}${WORD_EDGE_AFTER}`, flags);

function usableFirstName(
  text: string,
  from: string,
  others: readonly string[],
): string | undefined {
  const first = firstWord(from);
  if (first === '' || first === from.trim() || first.length < 2) return undefined;
  if (others.some((other) => firstWord(other).toLowerCase() === first.toLowerCase())) {
    return undefined;
  }
  const lower = first.toLocaleLowerCase();
  if (lower !== first && wordPattern(escape(lower), 'u').test(text)) return undefined;
  return first;
}

const shout = (matched: string, oldName: string) =>
  matched.length > 3 && matched === matched.toUpperCase() && oldName !== oldName.toUpperCase();

/**
 * Replaces a participant's old name in a summary: the full name in any case, and the first
 * name (exact case) when it is not ambiguous. Other names and longer words are left alone, so
 * renaming "Marketing Acme" never touches "Acme" or "marketing".
 */
export function renameInText(
  text: string,
  from: string,
  to: string,
  otherNames: readonly string[] = [],
): string {
  const oldName = from.trim();
  const newName = to.trim();
  if (oldName === '' || newName === '' || oldName === newName) return text;
  const first = usableFirstName(text, oldName, otherNames);
  const firstPattern = first ? wordPattern(escape(first), 'gu') : undefined;
  const replaceFirst = (chunk: string) =>
    firstPattern ? chunk.replace(firstPattern, () => firstWord(newName)) : chunk;
  const fullPattern = wordPattern(escape(oldName).replace(/\s+/g, '\\s+'), 'giu');

  const parts: string[] = [];
  let end = 0;
  for (const match of text.matchAll(fullPattern)) {
    parts.push(replaceFirst(text.slice(end, match.index)));
    parts.push(shout(match[0], oldName) ? newName.toUpperCase() : newName);
    end = match.index + match[0].length;
  }
  parts.push(replaceFirst(text.slice(end)));
  return parts.join('');
}
