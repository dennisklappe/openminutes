const HEADING = /^(#{1,6})\s+(.*)$/;
const ACTIONS = /^(action items?|actions?|follow[- ]?ups?|next steps|to-?dos?)\b/i;

interface SplitSummary {
  summary: string;
  actions: string;
}

/** Moves the action items section out of a summary so a template can place it on its own. */
export function splitActions(markdown: string): SplitSummary {
  const lines = markdown.split('\n');
  const headingAt = lines.findIndex((line) => {
    const match = HEADING.exec(line);
    return match?.[2] !== undefined && ACTIONS.test(match[2].replace(/[*_`]/g, '').trim());
  });
  if (headingAt < 0) return { summary: markdown.trim(), actions: '' };
  const level = HEADING.exec(lines[headingAt] ?? '')?.[1]?.length ?? 6;
  let end = headingAt + 1;
  while (end < lines.length) {
    const next = HEADING.exec(lines[end] ?? '')?.[1];
    if (next && next.length <= level) break;
    end += 1;
  }
  return {
    summary: [...lines.slice(0, headingAt), ...lines.slice(end)].join('\n').trim(),
    actions: lines
      .slice(headingAt + 1, end)
      .join('\n')
      .trim(),
  };
}
