import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { errorMessage } from './api.js';
import type { Notice } from './Panel.js';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface SettingsForm<T> {
  draft: T;
  /** Replaces the draft, or derives the next one from the current draft. */
  set: (next: T | ((current: T) => T)) => void;
  /** Merges changed fields into an object draft. */
  patch: (change: Partial<T>) => void;
  /** Whether the draft differs from the last saved value. */
  dirty: boolean;
  saving: boolean;
  notice: Notice | undefined;
  setNotice: (notice: Notice | undefined) => void;
  submit: (event?: SyntheticEvent) => void;
  /** Throws away the edits. */
  discard: () => void;
}

/**
 * The one way a settings card edits values: keep a draft next to the saved value, save it only on
 * request and report the result. Pass the card to SettingsCard for the footer.
 *
 * `saved` is what the server has. When it changes from outside (a reload, a poll) and nothing is
 * being edited, the draft follows it. `save` returns the new saved value.
 */
export function useSettingsForm<T>(
  saved: T,
  save: (draft: T) => Promise<T>,
  /** Set when saving is needed even though the draft equals the saved value. */
  pending = false,
): SettingsForm<T> {
  const [draft, setDraft] = useState(saved);
  const [base, setBase] = useState(saved);
  const [notice, setNotice] = useState<Notice>();
  const [saving, setSaving] = useState(false);

  const savedKey = JSON.stringify(saved);
  const seen = useRef(savedKey);
  useEffect(() => {
    if (seen.current === savedKey) return;
    seen.current = savedKey;
    setDraft((current) => (same(current, base) ? saved : current));
    setBase(saved);
    // `saved` and `base` are read once per change of the saved value on purpose.
  }, [savedKey]);

  const set: SettingsForm<T>['set'] = (next) => {
    setDraft(next);
    setNotice((current) => (current?.ok ? undefined : current));
  };
  const dirty = pending || !same(draft, base);

  return {
    draft,
    set,
    patch: (change) => {
      set((current) => ({ ...current, ...change }));
    },
    dirty,
    saving,
    notice,
    setNotice,
    submit: (event) => {
      event?.preventDefault();
      if (!dirty || saving) return;
      setNotice(undefined);
      setSaving(true);
      save(draft).then(
        (next) => {
          seen.current = JSON.stringify(next);
          setBase(next);
          setDraft(next);
          setSaving(false);
          setNotice({ ok: true, text: 'Saved.' });
        },
        (failure: unknown) => {
          setSaving(false);
          setNotice({ ok: false, text: errorMessage(failure) });
        },
      );
    },
    discard: () => {
      setDraft(base);
      setNotice(undefined);
    },
  };
}
