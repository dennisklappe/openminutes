import { useState } from 'react';
import type { SummaryDto } from '../src/dto.js';
import { ApiError, api, errorMessage, exportMinutes } from './api.js';
import { useConfirm } from './Confirm.js';
import { SummaryChanges } from './SummaryChanges.js';
import { useDocumentExports } from './useDocumentExports.js';

const CHIPS = [
  'Remove open questions',
  'Make it shorter',
  'Add a decisions section',
  'Translate to Dutch',
];
const LOG_LENGTH = 5;
const MAX_INSTRUCTION = 1000;

export function SummaryAiEdit(props: {
  meetingId: string;
  summaries: SummaryDto[];
  model: string | null;
  locked: boolean;
  onEdited: (change: { previousId: string; instruction: string }) => void;
}) {
  const { meetingId, summaries, model, locked, onEdited } = props;
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [useTranscript, setUseTranscript] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [latest, setLatest] = useState<string>();
  const [updating, setUpdating] = useState<string>();
  const confirm = useConfirm();
  const documents = useDocumentExports(meetingId, latest);

  if (model === null) {
    return (
      <p className="muted ai-edit-off">
        Edit with AI needs a summary provider. <a href="#/settings">Choose one in Settings.</a>
      </p>
    );
  }

  const done = summaries.filter((summary) => summary.status === 'done');
  const log = done
    .filter((summary) => summary.origin === 'ai-edit')
    .slice(0, LOG_LENGTH)
    .reverse();
  const before = (summary: SummaryDto) => done[done.indexOf(summary) + 1];

  const send = async (confirmShrink: boolean) => {
    setError(undefined);
    setBusy(true);
    try {
      const result = await api.aiEditSummary(meetingId, {
        instruction,
        useTranscript,
        confirmShrink,
      });
      onEdited({ previousId: result.previousId, instruction });
      setLatest(result.summaryId);
      setInstruction('');
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'shrunk' && !confirmShrink) {
        setBusy(false);
        const ok = await confirm({
          title: 'Remove almost everything?',
          body: (
            <p>
              The result keeps less than 15 percent of the summary. It is saved as a new version and
              you can undo it right after.
            </p>
          ),
          confirmLabel: 'Apply anyway',
          destructive: true,
        });
        if (ok) await send(true);
        return;
      }
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const update = async (id: string) => {
    setUpdating(id);
    try {
      await exportMinutes(meetingId, id, undefined, 'update');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setUpdating(undefined);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="ai-edit-bar"
        onClick={() => {
          setOpen(true);
        }}
      >
        <span>Edit with AI</span>
        <span className="muted">Tell the AI what to change...</span>
      </button>
    );
  }

  return (
    <section className="ai-edit" aria-label="Edit with AI">
      <div className="ai-edit-head">
        <h3>Edit with AI</h3>
        <button
          type="button"
          className="link"
          onClick={() => {
            setOpen(false);
          }}
        >
          Close
        </button>
      </div>
      {log.length > 0 && (
        <ol className="ai-log">
          {log.map((entry) => {
            const previous = before(entry);
            return (
              <li key={entry.id}>
                <p className="ai-you">{entry.note}</p>
                <p className="muted">
                  Version {entry.version}
                  {entry.active ? ', active' : ', replaced'}
                </p>
                {previous && (
                  <SummaryChanges
                    before={previous.content}
                    after={entry.content}
                    open={entry.id === latest}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
      {latest && documents.length > 0 && (
        <p className="hint" role="status">
          Exports and sent emails are copies and do not change by themselves.{' '}
          {documents.map((document) => (
            <button
              key={document.id}
              type="button"
              className="link"
              disabled={updating !== undefined}
              onClick={() => void update(document.id)}
            >
              {updating === document.id ? 'Updating...' : `Update the ${document.label}`}
            </button>
          ))}
        </p>
      )}
      <div className="ai-chips">
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="chip"
            disabled={busy || locked}
            onClick={() => {
              setInstruction(chip);
            }}
          >
            {chip}
          </button>
        ))}
      </div>
      <form
        className="ai-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(false);
        }}
      >
        <input
          aria-label="Instruction for the AI"
          placeholder="Tell the AI what to change..."
          maxLength={MAX_INSTRUCTION}
          value={instruction}
          disabled={busy || locked}
          onChange={(event) => {
            setInstruction(event.target.value);
          }}
        />
        <button
          type="submit"
          className="primary"
          disabled={busy || locked || instruction.trim() === ''}
        >
          {busy ? 'Working...' : 'Apply'}
        </button>
      </form>
      <label className="ai-transcript">
        <input
          type="checkbox"
          checked={useTranscript}
          onChange={(event) => {
            setUseTranscript(event.target.checked);
          }}
        />
        Use the transcript too
        <span className="muted"> (for adding or checking facts)</span>
      </label>
      {error && <p className="error">{error}</p>}
      <p className="hint">
        Saved as a new version that becomes the active one, so share links update. Uses {model}:
        each instruction is one request to your summary provider and is billed by them.
      </p>
    </section>
  );
}
