import { useState, type SyntheticEvent } from 'react';
import { api, errorMessage } from '../api.js';
import { Panel } from '../Panel.js';
import { WizardFrame } from './WizardFrame.js';

export function PasswordStep({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    api.setup(password).then(onDone, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  };

  return (
    <WizardFrame
      current="password"
      title="Set up OpenMinutes"
      intro="Choose the admin password. It protects this web interface, and you sign in with it from now on."
    >
      <Panel
        onSubmit={submit}
        notice={error ? { ok: false, text: error } : undefined}
        foot={
          <button className="primary" type="submit">
            Create admin
          </button>
        }
      >
        <label className="field">
          <span>Admin password</span>
          <input
            type="password"
            autoFocus
            autoComplete="new-password"
            placeholder="10 or more characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
      </Panel>
    </WizardFrame>
  );
}
