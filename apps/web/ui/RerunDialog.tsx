import { useEffect, useId, useRef, useState } from 'react';
import { filterLanguages, languageName } from './languages.js';

const AUTO = '';

interface Props {
  detected: string | null;
  onRun: (language: string | undefined) => void;
  onClose: () => void;
}

export function RerunDialog({ detected, onRun, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(AUTO);
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
      <h2 id={titleId}>Re-run in another language</h2>
      <div className="confirm-body">
        {detected && <p>Detected: {languageName(detected)}</p>}
        <p className="muted">
          Auto-detect is used by default. Use this only if the language was wrong.
        </p>
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
      </div>
      <div className="confirm-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            onRun(chosen === AUTO ? undefined : chosen);
          }}
        >
          Re-run
        </button>
      </div>
    </dialog>
  );
}
