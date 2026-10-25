import { useState, type SyntheticEvent } from 'react';
import { Brand } from '../Brand.js';
import { api, errorMessage } from '../api.js';

export function AuthForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    api.login(password).then(onDone, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  };

  return (
    <form className="auth" onSubmit={submit}>
      <Brand href="#/" />
      <h1>Sign in</h1>
      <p className="muted">Enter the admin password to see your meetings.</p>
      <input
        type="password"
        aria-label="Password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
        }}
      />
      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit">
        Sign in
      </button>
    </form>
  );
}
