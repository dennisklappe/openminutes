import { useState } from 'react';
import type { SummaryDto, SummaryOptionsDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { useConfirm } from './Confirm.js';
import { formatDate } from './format.js';
import { Markdown } from './Markdown.js';
import { ReapplyChoice } from './ReapplyChoice.js';
import { SummaryAiEdit } from './SummaryAiEdit.js';
import { SummaryEditor } from './SummaryEditor.js';
import { SummaryHistory } from './SummaryHistory.js';

export function SummaryPanel(props: {
  meetingId: string;
  summaries: SummaryDto[];
  options: SummaryOptionsDto;
  hasTranscript: boolean;
  onRequested: () => void;
  onPeopleChanged: () => void;
  /** A person changed who said a line after this summary was written. */
  speakersChanged?: boolean;
}) {
  const {
    meetingId,
    summaries,
    options,
    hasTranscript,
    onRequested,
    onPeopleChanged,
    speakersChanged = false,
  } = props;
  const [chosen, setChosen] = useState<string>();
  const [promptId, setPromptId] = useState(options.defaultPromptId);
  const [provider, setProvider] = useState('');
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [undo, setUndo] = useState<{ previousId: string; text: string }>();
  const confirm = useConfirm();

  const active = summaries.find((s) => s.active);
  const shown = summaries.find((s) => s.id === chosen && s.status === 'done') ?? active;
  const pending = summaries.some((s) => s.status === 'pending');
  const failed = summaries.find(
    (s) => s.status === 'failed' && s.createdAt > (active?.createdAt ?? ''),
  );
  const undoTarget =
    undo && undo.previousId !== active?.id
      ? summaries.find((s) => s.id === undo.previousId)
      : undefined;
  const ready = hasTranscript && options.providers.length > 0;

  const report = (failure: unknown) => {
    setError(errorMessage(failure));
  };

  const generate = async (afterSpeakerChange = false) => {
    const choice = { reapplyEdits: false };
    if (
      active &&
      !(await confirm({
        title: 'Regenerate the summary?',
        body: (
          <>
            {afterSpeakerChange && (
              <p>
                The transcript is sent to your summary provider again, using your own API key. The
                current version stays in History and can be restored.
              </p>
            )}
            <ReapplyChoice
              {...options.reapply}
              onChange={(value) => {
                choice.reapplyEdits = value;
              }}
            />
          </>
        ),
        confirmLabel: 'Regenerate as new version',
      }))
    ) {
      return;
    }
    setError(undefined);
    setChosen(undefined);
    if (active) {
      setUndo({
        previousId: active.id,
        text: `Regenerated${choice.reapplyEdits ? ' with your AI edits re-applied' : ''}.`,
      });
    }
    api
      .summarize(meetingId, {
        promptId,
        ...(provider && { provider }),
        ...(choice.reapplyEdits && { reapplyEdits: true }),
      })
      .then(onRequested, report);
  };

  const restore = async (version: SummaryDto) => {
    const confirmed = await confirm({
      title: `Restore version ${String(version.version)}?`,
      body: (
        <p>
          It is added as a new version and becomes the active one. Every other version stays in
          History. Shared links will show it.
        </p>
      ),
      confirmLabel: 'Restore as new version',
    });
    if (!confirmed) return;
    setError(undefined);
    setChosen(undefined);
    api.restoreSummary(meetingId, version.id).then(onRequested, report);
  };

  const undoNow = (previous: SummaryDto) => {
    setUndo(undefined);
    setError(undefined);
    api.restoreSummary(meetingId, previous.id).then(onRequested, report);
  };

  const copy = () => {
    if (!shown) return;
    void navigator.clipboard.writeText(shown.content).then(() => {
      setCopied(true);
    });
  };

  return (
    <>
      {options.providers.length === 0 && (
        <p className="muted">
          No summary provider is set up. <a href="#/settings">Choose one in Settings.</a>
        </p>
      )}
      {!hasTranscript && <p className="muted">Summaries need a transcript.</p>}
      {ready && (
        <div className="summary-controls">
          <label className="field">
            <span>Prompt</span>
            <select
              value={promptId}
              onChange={(e) => {
                setPromptId(e.target.value);
              }}
            >
              {options.prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Provider</span>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
              }}
            >
              <option value="">Default</option>
              {options.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button disabled={pending} onClick={() => void generate()}>
            {summaries.length > 0 ? 'Regenerate' : 'Summarise'}
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {speakersChanged && active && !pending && (
        <p className="banner" role="status">
          <span>Speakers changed in the transcript since this summary was written.</span>
          <button
            type="button"
            className="link"
            onClick={() => {
              void generate(true);
            }}
          >
            Regenerate summary
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              api.dismissSpeakersNotice(meetingId).then(onRequested, report);
            }}
          >
            Dismiss
          </button>
        </p>
      )}
      {pending && <p className="muted">Summarising, this can take a minute.</p>}
      {failed && !pending && <p className="error">{failed.error}</p>}
      {undoTarget && active && !pending && (
        <p className="banner" role="status">
          <span>
            {undo?.text} Version {undoTarget.version} is in History.
          </span>
          <button
            type="button"
            className="link"
            onClick={() => {
              undoNow(undoTarget);
            }}
          >
            Undo
          </button>
        </p>
      )}
      {shown?.status === 'done' && shown.error && <p className="error">{shown.error}</p>}
      {shown && (
        <>
          <p className="muted summary-meta">
            <strong>Version {shown.version}</strong>
            {shown.active ? (
              <span className="pill pill-transcribed">Active</span>
            ) : (
              <span className="pill">Not active</span>
            )}
            {shown.author}, {formatDate(shown.createdAt)}
          </p>
          {!shown.active && active && (
            <p className="banner">
              You are looking at an older version. Shared links and exports show version{' '}
              {active.version}.{' '}
              <button
                type="button"
                className="link"
                disabled={pending}
                onClick={() => void restore(shown)}
              >
                Restore this version
              </button>
            </p>
          )}
          <SummaryEditor
            summary={shown}
            meetingId={meetingId}
            locked={pending}
            onChanged={onRequested}
            actions={<button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>}
          >
            <Markdown source={shown.content} />
          </SummaryEditor>
          {shown.active && (
            <SummaryAiEdit
              meetingId={meetingId}
              summaries={summaries}
              model={options.editModel}
              locked={pending}
              onPeopleChanged={onPeopleChanged}
              onEdited={({ previousId, instruction }) => {
                setUndo({ previousId, text: `Changed: ${instruction}.` });
                setChosen(undefined);
                onRequested();
              }}
            />
          )}
        </>
      )}
      {summaries.length > 1 && (
        <SummaryHistory
          summaries={summaries}
          viewed={shown?.id}
          locked={pending}
          onView={(id) => {
            setChosen(id);
            setCopied(false);
          }}
          onRestore={(version) => void restore(version)}
        />
      )}
    </>
  );
}
