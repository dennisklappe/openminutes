import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api.js';
import { PencilIcon } from './icons.js';
import { titleToSave, TITLE_MAX } from './title.js';
import './voices.css';

interface Props {
  id: string;
  title: string;
  onSaved: () => void;
}

export function MeetingTitle({ id, title, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [shown, setShown] = useState(title);
  const [error, setError] = useState<string>();
  const cancelled = useRef(false);

  useEffect(() => {
    setShown(title);
  }, [title]);

  const start = () => {
    cancelled.current = false;
    setDraft(shown);
    setError(undefined);
    setEditing(true);
  };

  const finish = () => {
    setEditing(false);
    const next = cancelled.current ? undefined : titleToSave(draft, shown);
    if (next === undefined) return;
    const previous = shown;
    setShown(next);
    api.renameMeeting(id, next).then(onSaved, (failure: unknown) => {
      setShown(previous);
      setError(errorMessage(failure));
    });
  };

  if (editing) {
    return (
      <input
        className="title-input"
        aria-label="Meeting title"
        value={draft}
        maxLength={TITLE_MAX}
        autoFocus
        onFocus={(e) => {
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <>
      <h1 className="title-heading">
        <button className="title-edit" onClick={start} aria-label={`Edit title: ${shown}`}>
          <span>{shown}</span>
          <PencilIcon />
        </button>
      </h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
