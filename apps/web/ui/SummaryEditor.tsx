import { useEffect, useState, type ReactNode } from 'react';
import type { SummaryDto } from '../src/dto.js';
import { ActionTableEditor } from './ActionTableEditor.js';
import { joinActionTable, splitActionTable, type SplitSummary } from './actionTable.js';
import { api, errorMessage } from './api.js';
import { useDocumentExports } from './useDocumentExports.js';

type Draft = { kind: 'text'; text: string } | { kind: 'table'; split: SplitSummary };

const startDraft = (content: string): Draft => {
  const split = splitActionTable(content);
  return split ? { kind: 'table', split } : { kind: 'text', text: content };
};

const draftText = (draft: Draft) =>
  draft.kind === 'text' ? draft.text : joinActionTable(draft.split);

function Fields({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  if (draft.kind === 'text') {
    return (
      <textarea
        className="summary-editor"
        aria-label="Summary in Markdown"
        rows={18}
        value={draft.text}
        onChange={(e) => {
          onChange({ kind: 'text', text: e.target.value });
        }}
      />
    );
  }
  const { split } = draft;
  const field = (name: 'before' | 'after', label: string) => (
    <textarea
      className="summary-editor"
      aria-label={label}
      rows={Math.min(14, Math.max(3, split[name].split('\n').length + 1))}
      value={split[name]}
      onChange={(e) => {
        onChange({ kind: 'table', split: { ...split, [name]: e.target.value } });
      }}
    />
  );
  return (
    <>
      {field('before', 'Summary in Markdown')}
      <ActionTableEditor
        table={split.table}
        onChange={(table) => {
          onChange({ kind: 'table', split: { ...split, table } });
        }}
      />
      {split.after !== '' && field('after', 'Text after the action items')}
    </>
  );
}

export function SummaryEditor(props: {
  summary: SummaryDto;
  meetingId: string;
  locked: boolean;
  onChanged: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { summary, meetingId, locked, onChanged, children, actions } = props;
  const [draft, setDraft] = useState<Draft>();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(undefined);
    setError(undefined);
  }, [summary.id]);

  const hasDocuments = useDocumentExports(meetingId, saved).length > 0;

  const text = draft && draftText(draft);

  const save = () => {
    if (!text) return;
    setError(undefined);
    setBusy(true);
    api
      .editSummary(meetingId, text)
      .then(() => {
        setDraft(undefined);
        setSaved(true);
        onChanged();
      })
      .catch((failure: unknown) => {
        setError(errorMessage(failure));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      {draft === undefined ? (
        <>
          {children}
          {saved && summary.origin === 'edit' && summary.active && (
            <p className="muted" role="status">
              Saved as a new version. Share links and shared documents show it.
              {hasDocuments && ' Press Update on a document in the Minutes card to refresh it.'}
            </p>
          )}
          <div className="actions">
            {actions}
            {summary.active && (
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  setSaved(false);
                  setDraft(startDraft(summary.content));
                }}
              >
                Edit summary
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <Fields draft={draft} onChange={setDraft} />
          <p className="hint">Saving adds a new version and makes it the active one.</p>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy || text?.trim() === ''}
              onClick={save}
            >
              Save as new version
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(undefined);
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </>
  );
}
