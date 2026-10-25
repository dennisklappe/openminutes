import type { ReactNode } from 'react';
import { Panel } from './Panel.js';
import type { SettingsForm } from './useSettingsForm.js';

/**
 * A settings card that edits values. Every one has the same footer: Save changes (off until
 * something changed) and the result on the right. Anything that acts at once, such as a test
 * or a connect button, goes in `actions` next to it and is never a save.
 */
export function SettingsCard<T>(props: {
  form: SettingsForm<T>;
  title?: string;
  description?: ReactNode;
  /** Buttons that act immediately, shown after Save changes. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { form, title, description, actions, children } = props;
  return (
    <Panel
      {...(title && { title })}
      description={description}
      onSubmit={form.submit}
      notice={form.notice}
      foot={
        <>
          <button className="primary" type="submit" disabled={!form.dirty || form.saving}>
            Save changes
          </button>
          {actions}
        </>
      }
    >
      {children}
    </Panel>
  );
}
