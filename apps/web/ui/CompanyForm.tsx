import { useId, useState, type SubmitEvent } from 'react';
import { errorMessage } from './api.js';

const MAX_SUGGESTIONS = 6;

interface Props {
  label: string;
  initial?: string;
  suggestions: string[];
  submitLabel: string;
  allowClear?: boolean;
  autoFocus?: boolean;
  onSave: (company: string | null) => Promise<void>;
  onCancel?: () => void;
}

/** Type a company or pick one used before. Suggestions work like the name suggestions on voices. */
export function CompanyForm(props: Props) {
  const {
    label,
    initial = '',
    suggestions,
    submitLabel,
    allowClear,
    autoFocus,
    onSave,
    onCancel,
  } = props;
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const listId = useId();

  const save = (company: string | null) => {
    setBusy(true);
    setError(undefined);
    onSave(company)
      .catch((failure: unknown) => {
        setError(errorMessage(failure));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (value.trim() !== '') save(value.trim());
  };
  const picks = suggestions.filter((name) => name !== initial).slice(0, MAX_SUGGESTIONS);

  return (
    <form className="company-form" onSubmit={submit}>
      <label className="field">
        <span>{label}</span>
        <input
          value={value}
          list={listId}
          maxLength={80}
          autoFocus={autoFocus}
          placeholder="Company name"
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
        <datalist id={listId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      {picks.length > 0 && (
        <div className="suggestions" role="group" aria-label="Earlier companies">
          {picks.map((name) => (
            <button
              key={name}
              type="button"
              className="chip-button"
              disabled={busy}
              onClick={() => {
                save(name);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions">
        {allowClear && initial !== '' && (
          <button
            type="button"
            className="link clear"
            disabled={busy}
            onClick={() => {
              save(null);
            }}
          >
            Remove company
          </button>
        )}
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="primary" disabled={busy || value.trim() === ''}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
