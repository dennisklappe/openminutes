import { useEffect, useState } from 'react';
import type { StorageBackend, StorageSettingsDto, StorageSettingsInput } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

function toForm(settings: StorageSettingsDto) {
  return {
    backend: settings.backend,
    endpoint: settings.s3.endpoint,
    bucket: settings.s3.bucket,
    region: settings.s3.region,
    accessKeyId: settings.s3.accessKeyId,
    secretAccessKey: '',
    retentionDays: settings.retentionDays === null ? '' : String(settings.retentionDays),
  };
}

const body = (form: ReturnType<typeof toForm>): StorageSettingsInput => ({
  backend: form.backend,
  s3: {
    endpoint: form.endpoint,
    bucket: form.bucket,
    region: form.region,
    accessKeyId: form.accessKeyId,
    ...(form.secretAccessKey && { secretAccessKey: form.secretAccessKey }),
  },
  retentionDays: form.retentionDays === '' ? null : Number(form.retentionDays),
});

function StorageForm({
  settings,
  onSaved,
}: {
  settings: StorageSettingsDto;
  onSaved: (next: StorageSettingsDto) => void;
}) {
  const form = useSettingsForm(toForm(settings), async (draft) => {
    const next = await api.saveStorageSettings(body(draft));
    onSaved(next);
    return toForm(next);
  });
  const state = form.draft;
  const set = form.patch;
  const s3 = state.backend === 's3';

  return (
    <SettingsCard
      form={form}
      title="Recordings"
      description="Where recordings are kept, and for how long."
      actions={
        s3 && (
          <button
            type="button"
            onClick={() => {
              form.setNotice(undefined);
              api.testStorage(body(state)).then(
                (test) => {
                  form.setNotice(
                    test.ok
                      ? { ok: true, text: `Bucket works: ${test.detail ?? 'ok'}.` }
                      : { ok: false, text: test.error ?? 'The test failed' },
                  );
                },
                (failure: unknown) => {
                  form.setNotice({ ok: false, text: errorMessage(failure) });
                },
              );
            }}
          >
            Test connection
          </button>
        )
      }
    >
      <label className="field">
        <span>Store audio on</span>
        <select
          value={state.backend}
          onChange={(e) => {
            set({ backend: e.target.value as StorageBackend });
          }}
        >
          <option value="local">Local volume</option>
          <option value="s3">S3-compatible bucket</option>
        </select>
      </label>
      {s3 ? (
        <>
          <label className="field">
            <span>Endpoint (leave empty for AWS S3)</span>
            <input
              type="url"
              placeholder="https://minio.example.com"
              value={state.endpoint}
              onChange={(e) => {
                set({ endpoint: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>Bucket *</span>
            <input
              required
              value={state.bucket}
              onChange={(e) => {
                set({ bucket: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>Region</span>
            <input
              placeholder="us-east-1"
              value={state.region}
              onChange={(e) => {
                set({ region: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>Access key ID *</span>
            <input
              required
              autoComplete="off"
              value={state.accessKeyId}
              onChange={(e) => {
                set({ accessKeyId: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>Secret access key *</span>
            <input
              type="password"
              autoComplete="off"
              required={!settings.s3.hasSecretAccessKey}
              placeholder={settings.s3.hasSecretAccessKey ? 'Saved, leave blank to keep' : ''}
              value={state.secretAccessKey}
              onChange={(e) => {
                set({ secretAccessKey: e.target.value });
              }}
            />
          </label>
          <p className="hint">
            Recordings are written to the local volume first and moved to the bucket once the
            transcript is ready. Audio already stored stays where it is when you switch.
          </p>
        </>
      ) : (
        <p className="hint">
          Audio is kept on the data volume at <code className="mono">{settings.localPath}</code>.
        </p>
      )}
      <label className="field">
        <span>Delete audio after (days)</span>
        <input
          type="number"
          min={1}
          max={3650}
          value={state.retentionDays}
          onChange={(e) => {
            set({ retentionDays: e.target.value });
          }}
        />
      </label>
      <p className="hint">
        Leave empty to keep audio forever. Retention removes the audio only. Transcripts and
        summaries stay, and the meeting shows that its audio was deleted.
      </p>
    </SettingsCard>
  );
}

export function StorageSettings() {
  const [settings, setSettings] = useState<StorageSettingsDto>();
  useEffect(() => {
    void api.storageSettings().then(setSettings);
  }, []);
  return settings ? <StorageForm settings={settings} onSaved={setSettings} /> : null;
}
