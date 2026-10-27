import { useEffect, useMemo, useState, type SubmitEvent } from 'react';
import type { PersonChoiceDto, PersonDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './Dialog.js';
import { SearchIcon } from './icons.js';
import { mergePreview } from './people.js';
import './people.css';

type Side = PersonDto | string;

/** Resolves a person given by id with one request, so a hint can open the dialog straight away. */
function useSide(side: Side): PersonDto | undefined {
  const [loaded, setLoaded] = useState<PersonDto>();
  const id = typeof side === 'string' ? side : undefined;
  useEffect(() => {
    if (!id) return;
    let current = true;
    void api.person(id).then((detail) => {
      if (current) setLoaded(detail.person);
    });
    return () => {
      current = false;
    };
  }, [id]);
  return typeof side === 'string' ? loaded : side;
}

/**
 * Asks which of two people to keep and says what the merge does before it happens. The person
 * that is not kept disappears, their emails, voice samples and meetings move to the other.
 */
export function MergeDialog({
  a,
  b,
  onClose,
  onMerged,
}: {
  a: Side;
  b: Side;
  onClose: () => void;
  /** The id of the person that was kept. */
  onMerged: (keepId: string) => void;
}) {
  const first = useSide(a);
  const second = useSide(b);
  const [choice, setChoice] = useState<'a' | 'b'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const people = first && second ? { a: first, b: second } : undefined;
  const keepKey = choice ?? (people && people.b.name.length > people.a.name.length ? 'b' : 'a');
  const keep = people?.[keepKey];
  const drop = people?.[keepKey === 'a' ? 'b' : 'a'];
  const preview = keep && drop ? mergePreview(keep, drop) : undefined;

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!keep || !drop || busy) return;
    setBusy(true);
    api.mergePerson(keep.id, drop.id).then(
      () => {
        onMerged(keep.id);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <Dialog title="Merge two people" onClose={onClose}>
      {!people || !keep || !drop || !preview ? (
        <p className="muted">Loading.</p>
      ) : (
        <form onSubmit={submit}>
          <fieldset className="merge-keep">
            <legend>Keep this name</legend>
            {(['a', 'b'] as const).map((key) => (
              <label key={key} className="merge-choice">
                <input
                  type="radio"
                  name="keep"
                  checked={keepKey === key}
                  onChange={() => {
                    setChoice(key);
                  }}
                />
                <span>
                  <strong>{people[key].name}</strong>
                  <span className="muted">
                    {' '}
                    · {people[key].emails.length === 0 ? 'No email' : people[key].emails.join(', ')}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <ul className="merge-effects">
            <li>
              The merged person is called <strong>{preview.name}</strong>.
            </li>
            <li>Emails: {preview.emails.length === 0 ? 'none' : preview.emails.join(', ')}.</li>
            <li>
              {preview.untracked
                ? 'One of them is not tracked, so the merged person stays not tracked and all voice samples are deleted.'
                : preview.samples === 0
                  ? 'No voice samples to carry over.'
                  : `Voice samples: ${String(preview.samples)} in total, the voice profile is built again.`}
            </li>
            <li>
              Meetings, saved rename rules and invitations of {drop.name} move to {keep.name}.
            </li>
            <li>
              <strong>{drop.name}</strong> is then removed. This cannot be undone.
            </li>
          </ul>
          {error && (
            <p className="feedback error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit" disabled={busy}>
              Merge into {keep.name}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** The person page entry: search for the other person, then the same merge dialog. */
export function MergeInto({
  person,
  choices,
  onClose,
  onMerged,
}: {
  person: PersonDto;
  choices: readonly PersonChoiceDto[];
  onClose: () => void;
  onMerged: (keepId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [other, setOther] = useState<string>();
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return choices.filter((choice) => choice.name.toLowerCase().includes(needle)).slice(0, 50);
  }, [choices, query]);

  if (other) return <MergeDialog a={person} b={other} onClose={onClose} onMerged={onMerged} />;
  return (
    <Dialog title={`Merge ${person.name} into another person`} onClose={onClose}>
      <label className="field">
        <span>Search people</span>
        <span className="search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            autoFocus
            autoComplete="off"
            placeholder="Name"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </span>
      </label>
      {shown.length === 0 ? (
        <p className="muted">Nobody matches.</p>
      ) : (
        <ul className="review-options scroll">
          {shown.map((choice) => (
            <li key={choice.id}>
              <button
                type="button"
                onClick={() => {
                  setOther(choice.id);
                }}
              >
                {choice.name}
                {choice.tracked === false && <span className="muted"> · not tracked</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
