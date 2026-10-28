import { useEffect, useId, useRef, useState } from 'react';
import { MAX_SPEAKERS } from '../src/speakerCount.js';
import { filterLanguages, languageName } from './languages.js';
import { SpeakerCountSelect } from './recorder/SpeakerCountSelect.js';
import { rerunCopy, type RerunKind } from './rerun.js';

const AUTO = '';

export interface RerunChoice {
  language: string | undefined;
  /** The number of people, undefined is Auto. Only meaningful when the dialog asks for it. */
  speakers: number | undefined;
}

interface Props {
  kind: RerunKind;
  detected: string | null;
  /** The number of people stored on the meeting, null for Auto. */
  speakerCount: number | null;
  /** Ask for the number of people. */
  askSpeakers: boolean;
  voiceCheckOn: boolean;
  onRun: (choice: RerunChoice) => void;
  onClose: () => void;
}

export function RerunDialog(props: Props) {
  const { kind, detected, speakerCount, askSpeakers, voiceCheckOn, onRun, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const searchId = useId();
  const copy = rerunCopy(kind, { voiceCheckOn });
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(AUTO);
  const [speakers, setSpeakers] = useState<number | undefined>(
    kind === 'speakers' ? Math.min(speakerCount ?? 2, MAX_SPEAKERS) : (speakerCount ?? undefined),
  );
  const matches = filterLanguages(query);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog rerun-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <h2 id={titleId}>{copy.title}</h2>
      <div className="confirm-body">
        <p>
          <strong>Kept:</strong> {copy.keeps}
        </p>
        <p>
          <strong>Changes:</strong> {copy.changes}
        </p>
        {copy.blocked && <p className="banner banner-error">{copy.blocked}</p>}
        {askSpeakers && (
          <SpeakerCountSelect
            label="How many people speak?"
            auto={kind !== 'speakers'}
            value={speakers}
            disabled={false}
            onChange={setSpeakers}
          />
        )}
        {kind === 'transcribe' && (
          <>
            {detected && <p>Detected language: {languageName(detected)}</p>}
            <p className="muted">Auto-detect is used by default. Pick one only if it was wrong.</p>
            <label htmlFor={searchId}>Language</label>
            <input
              id={searchId}
              type="search"
              value={query}
              placeholder="Search"
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            <select
              size={6}
              aria-label="Language"
              value={chosen}
              onChange={(event) => {
                setChosen(event.target.value);
              }}
            >
              <option value={AUTO}>Auto-detect</option>
              {matches.map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div className="confirm-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={copy.blocked !== undefined}
          onClick={() => {
            onRun({ language: chosen === AUTO ? undefined : chosen, speakers });
          }}
        >
          {copy.confirm}
        </button>
      </div>
    </dialog>
  );
}
