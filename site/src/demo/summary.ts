import { at, esc, fullDate } from './format';
import { changedLines, diffLines } from './diff';
import { markdown } from './markdown';
import { currentRow, doc, type Edit, type State } from './state';

const CHIPS = [
  'Remove open questions',
  'Make it shorter',
  'Add a decisions section',
  'Translate to Dutch',
];

function changes(edit: Edit, open: boolean): string {
  const lines = changedLines(diffLines(edit.before, edit.after))
    .map((line) =>
      line.kind === 'gap'
        ? '<span class="diff-gap">...</span>'
        : `<span class="diff-${line.kind}">${line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}${esc(line.text)}</span>`,
    )
    .join('');
  return `<details class="ai-changes"${open ? ' open' : ''}><summary>Show changes</summary><pre class="ai-diff" aria-label="Changes">${lines}</pre></details>`;
}

function aiEdit(state: State): string {
  const { edits } = doc(state);
  if (!state.ai.open) {
    return `<button type="button" class="ai-edit-bar" data-act="ai-open"><span>Edit with AI</span><span class="muted">Tell the AI what to change...</span></button>`;
  }
  const log = edits
    .map(
      (edit, index) =>
        `<li><p class="ai-you">${esc(edit.instruction)}</p><p class="muted">Version ${index + 2}, active</p>${changes(edit, true)}</li>`,
    )
    .join('');
  const chips = CHIPS.map(
    (chip) =>
      `<button type="button" class="chip" data-act="ai-chip" data-text="${esc(chip)}">${esc(chip)}</button>`,
  ).join('');
  return `<section class="ai-edit" aria-label="Edit with AI"><div class="ai-edit-head"><h3>Edit with AI</h3><button type="button" class="link" data-act="ai-close">Close</button></div>${log ? `<ol class="ai-log">${log}</ol>` : ''}<div class="ai-chips">${chips}</div><form class="ai-form" data-act="ai-apply"><input data-k="ai" data-bind="instruction" aria-label="Instruction for the AI" placeholder="Tell the AI what to change..." maxlength="1000" value="${esc(state.ai.instruction)}"><button type="submit" class="primary"${state.ai.instruction.trim() === '' ? ' disabled' : ''}>Apply</button></form><label class="ai-transcript"><input type="checkbox" data-act="ai-transcript"${state.ai.useTranscript ? ' checked' : ''}>Use the transcript too<span class="muted"> (for adding or checking facts)</span></label><p class="hint">Saved as a new version that becomes the active one, so share links update. In the demo only "Remove open questions" is wired up, with no AI behind it.</p></section>`;
}

function editor(state: State): string {
  return `<form class="summary-edit" data-act="summary-save"><textarea class="summary-editor" data-k="draft" aria-label="Summary (Markdown)" rows="14">${esc(state.draft)}</textarea><p class="hint">Saving adds a new version and makes it the active one.</p><div class="actions"><button type="submit" class="primary">Save</button><button type="button" data-act="edit-cancel">Cancel</button></div></form>`;
}

export function summaryPanel(state: State): string {
  const { versions, active, undo } = doc(state);
  const version = versions[active];
  const banner = undo
    ? `<p class="banner" role="status"><span>${esc(undo.text)} Version ${undo.previous + 1} is in History.</span><button type="button" class="link" data-act="undo">Undo</button></p>`
    : '';
  const meta = `<p class="muted summary-meta"><strong>Version ${active + 1}</strong><span class="pill pill-transcribed">Active</span>${esc(version.note)}, ${fullDate(at(-currentRow(state).hoursAgo + 0.1))}</p>`;
  if (state.editing === 'summary') return `${meta}${editor(state)}`;
  return `${banner}${meta}<div class="markdown">${markdown(version.markdown)}</div><div class="actions"><button type="button" data-act="copy">Copy</button><button type="button" data-act="edit" data-what="summary">Edit summary</button></div>${aiEdit(state)}`;
}
