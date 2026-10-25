import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { SettingsCard } from './SettingsCard.js';
import { useSettingsForm } from './useSettingsForm.js';
import { usePolling } from './usePolling.js';

const HOUR_MS = 60 * 60 * 1000;

export function UpdateBanner() {
  const load = useCallback(() => api.updates(), []);
  const { data, refresh } = usePolling(load, HOUR_MS);
  if (!data?.available || !data.latest) return null;
  const { latest, url } = data;
  const dismiss = () => {
    void api.dismissUpdate(latest).then(refresh);
  };
  return (
    <p className="banner">
      <span>
        OpenMinutes {latest} is available (you run {data.current}).{' '}
        {url && (
          <a href={url} target="_blank" rel="noreferrer">
            Release notes
          </a>
        )}
      </span>
      <button className="link" onClick={dismiss}>
        Dismiss
      </button>
    </p>
  );
}

export function UpdateSettings() {
  const load = useCallback(() => api.updates(), []);
  const { data, refresh } = usePolling(load, HOUR_MS);
  const form = useSettingsForm({ enabled: data?.enabled ?? false }, async (draft) => {
    const next = await api.setUpdateNotices(draft.enabled);
    refresh();
    return { enabled: next.enabled };
  });
  if (!data) return null;
  return (
    <SettingsCard
      form={form}
      title="Update notices"
      description={`Running OpenMinutes ${data.current}. When this is on, the server asks the public GitHub releases API for the latest version at most once a day and shows a banner. It sends no identifiers. It is off by default.`}
    >
      <label className="check">
        <input
          type="checkbox"
          checked={form.draft.enabled}
          onChange={(e) => {
            form.patch({ enabled: e.target.checked });
          }}
        />
        Tell me when a new version is released
      </label>
    </SettingsCard>
  );
}

export function VersionLabel() {
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    void api.version().then((body) => {
      setVersion(body.version);
    });
  }, []);
  return version ? <span className="version mono">v{version}</span> : null;
}
