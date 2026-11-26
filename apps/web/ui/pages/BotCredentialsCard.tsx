import type { ReactNode } from 'react';
import type { GoogleCredentialsInput } from '../../src/dto.js';
import { errorMessage } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

export interface SavedCredentials {
  email: string;
  hasPassword: boolean;
  hasTotp: boolean;
}

interface CredentialsDraft {
  email: string;
  password: string;
  totpSecret: string;
}

const draftOf = (saved: SavedCredentials | null): CredentialsDraft => ({
  email: saved?.email ?? '',
  password: '',
  totpSecret: '',
});

const DEFAULT_TOTP_HINT = (
  <>
    Only needed when the account uses 2-step verification with an authenticator app. It is the setup
    key shown next to the QR code.
  </>
);

/** Email, password and authenticator secret the bot signs in with, for Google or Microsoft. */
export function BotCredentialsCard<T extends { credentials: SavedCredentials | null }>({
  credentials: saved,
  description,
  totpHint = DEFAULT_TOTP_HINT,
  save,
  remove,
  onSaved,
}: {
  credentials: SavedCredentials | null;
  description: ReactNode;
  totpHint?: ReactNode;
  save: (body: GoogleCredentialsInput) => Promise<T>;
  remove: () => Promise<T>;
  onSaved: (next: T) => void;
}) {
  const form = useSettingsForm(draftOf(saved), async ({ email, password, totpSecret }) => {
    const next = await save({
      email,
      ...(password && { password }),
      ...(totpSecret && { totpSecret }),
    });
    onSaved(next);
    return draftOf(next.credentials);
  });
  const { email, password, totpSecret } = form.draft;

  return (
    <SettingsCard
      form={form}
      title="Sign in with email and password"
      description={description}
      actions={
        saved && (
          <button
            type="button"
            onClick={() => {
              form.setNotice(undefined);
              remove().then(
                (next) => {
                  onSaved(next);
                  form.setNotice({ ok: true, text: 'Sign-in details removed.' });
                },
                (failure: unknown) => {
                  form.setNotice({ ok: false, text: errorMessage(failure) });
                },
              );
            }}
          >
            Remove
          </button>
        )
      }
    >
      <label className="field">
        <span>Bot account email</span>
        <input
          type="email"
          autoComplete="off"
          value={email}
          placeholder="notetaker@example.com"
          onChange={(e) => {
            form.patch({ email: e.target.value });
          }}
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          placeholder={saved?.hasPassword ? 'Saved, leave blank to keep' : ''}
          onChange={(e) => {
            form.patch({ password: e.target.value });
          }}
        />
      </label>
      <label className="field">
        <span>Authenticator secret (optional)</span>
        <input
          type="password"
          autoComplete="off"
          value={totpSecret}
          placeholder={saved?.hasTotp ? 'Saved, leave blank to keep' : ''}
          onChange={(e) => {
            form.patch({ totpSecret: e.target.value });
          }}
        />
        <small>{totpHint}</small>
      </label>
    </SettingsCard>
  );
}
