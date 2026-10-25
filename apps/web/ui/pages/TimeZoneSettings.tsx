import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function TimeZoneForm({ saved }: { saved: string }) {
  const form = useSettingsForm(
    saved,
    async (zone) => (await api.saveTimeZone({ timeZone: zone })).effective,
  );
  const zone = form.draft;
  const zones = Intl.supportedValuesOf('timeZone');
  const options = zones.includes(zone) ? zones : [zone, ...zones];
  return (
    <SettingsCard
      form={form}
      title="Timezone"
      description="Shared minutes pages, exports and emails show times in this zone, with its name, for every reader. The app itself shows times in your browser's zone."
    >
      <label className="field">
        <span>Timezone</span>
        <select
          value={zone}
          onChange={(e) => {
            form.set(e.target.value);
          }}
        >
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    </SettingsCard>
  );
}

export function TimeZoneSettings() {
  const [zone, setZone] = useState<string>();

  useEffect(() => {
    // Pre-fill from this browser the first time, so a normal install needs no TZ variable.
    void api
      .timeZone()
      .then((current) =>
        current.timeZone
          ? current
          : api.saveTimeZone({ timeZone: browserZone(), onlyIfUnset: true }).catch(() => current),
      )
      .then((current) => {
        setZone(current.timeZone ?? current.effective);
      });
  }, []);

  return zone ? <TimeZoneForm saved={zone} /> : null;
}
