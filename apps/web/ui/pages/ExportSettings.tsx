import { useEffect, useState } from 'react';
import type { CalendarProviderId, ExportSettingsDto } from '../../src/dto.js';
import { api } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

const PROVIDER_LABEL: Record<CalendarProviderId, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

interface ExportDraft {
  target: string | null;
  googleAccountId: string | null;
  microsoftAccountId: string | null;
  ownerEmail: string;
  /** The one switch: make the minutes by themselves after each meeting. */
  automatic: boolean;
  /** With the switch on: also export to the target. */
  exportToTarget: boolean;
  /** With the switch on: also add the minutes link to the calendar event. */
  calendarLink: boolean;
}

const canAutoExport = (state: ExportSettingsDto, target: string | null) =>
  state.targets.some((option) => option.id === target && option.automatic);

// The two stored switches (export.auto, minutes.calendar_link) stay separate so each instance
// keeps doing exactly what it did. The card shows them as one switch with two things under it.
const toForm = (state: ExportSettingsDto): ExportDraft => ({
  target: state.target,
  googleAccountId: state.googleAccountId,
  microsoftAccountId: state.microsoftAccountId,
  ownerEmail: state.ownerEmail,
  automatic: state.auto || state.calendarLink,
  exportToTarget: state.auto,
  calendarLink: state.calendarLink,
});

function AccountPicker({
  provider,
  state,
  value,
  onChange,
}: {
  provider: CalendarProviderId;
  state: ExportSettingsDto;
  value: string;
  onChange: (id: string) => void;
}) {
  const accounts = state.accounts.filter((account) => account.provider === provider);
  const chosen = accounts.find((account) => account.id === value);
  const label = PROVIDER_LABEL[provider];
  return (
    <div className="field">
      <span>{label} account</span>
      <select
        value={value}
        aria-label={`${label} account for export`}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        <option value="">None</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.email}
            {account.canExport ? '' : ' (needs export access)'}
          </option>
        ))}
      </select>
      <small>
        {chosen && !chosen.canExport
          ? `${chosen.email} has not allowed document export yet. `
          : 'Any connected account works, including the bot account. '}
        <a href={`/api/oauth/${provider}/start?export=1`}>
          Connect a {label} account with export access
        </a>
        . Existing calendar connections keep working.
      </small>
    </div>
  );
}

function ExportForm({
  state,
  onSaved,
}: {
  state: ExportSettingsDto;
  onSaved: (next: ExportSettingsDto) => void;
}) {
  const form = useSettingsForm(toForm(state), async (draft) => {
    const saved = await api.saveExportSettings({
      target: draft.target,
      googleAccountId: draft.googleAccountId,
      microsoftAccountId: draft.microsoftAccountId,
      ownerEmail: draft.ownerEmail.trim(),
      auto: draft.automatic && draft.exportToTarget && canAutoExport(state, draft.target),
      calendarLink: draft.automatic && draft.calendarLink,
    });
    onSaved(saved);
    return toForm(saved);
  });
  const draft = form.draft;
  const automaticTarget = canAutoExport(state, draft.target);
  const exportOn = automaticTarget && draft.exportToTarget;

  return (
    <SettingsCard
      form={form}
      title="Export"
      description="Where minutes go when you export them, and what is made by itself after each meeting. Documents are created by the account you pick and shared only with the owner address below."
    >
      <label className="field">
        <span>Export target</span>
        <select
          value={draft.target ?? ''}
          onChange={(e) => {
            form.patch({ target: e.target.value || null });
          }}
        >
          <option value="">No default</option>
          {state.targets.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <AccountPicker
        provider="google"
        state={state}
        value={draft.googleAccountId ?? ''}
        onChange={(id) => {
          form.patch({ googleAccountId: id || null });
        }}
      />
      <AccountPicker
        provider="microsoft"
        state={state}
        value={draft.microsoftAccountId ?? ''}
        onChange={(id) => {
          form.patch({ microsoftAccountId: id || null });
        }}
      />
      <label className="field">
        <span>Owner email</span>
        <input
          type="email"
          value={draft.ownerEmail}
          placeholder="you@example.com"
          onChange={(e) => {
            form.patch({ ownerEmail: e.target.value });
          }}
        />
        <small>
          If the connected account is not yours, the document is shared with this address (editor
          access, no notification email) and nobody else.
        </small>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.automatic}
          onChange={(e) => {
            const on = e.target.checked;
            // Switching on ticks what is available, so it is never an empty promise.
            const empty = !exportOn && !draft.calendarLink;
            form.patch({
              automatic: on,
              ...(on && empty && { exportToTarget: automaticTarget, calendarLink: true }),
            });
          }}
        />
        <span>
          Create the minutes automatically when a summary is ready{' '}
          <span className="muted">
            Off means nothing is made by itself: you open a meeting and export or share it.
          </span>
        </span>
      </label>
      <label className="check indent">
        <input
          type="checkbox"
          disabled={!draft.automatic || !automaticTarget}
          checked={draft.automatic && exportOn}
          onChange={(e) => {
            form.patch({ exportToTarget: e.target.checked });
          }}
        />
        <span>
          Send them to the export target above
          {!automaticTarget && (
            <span className="muted"> (pick Google Doc, OneDrive or Share link)</span>
          )}
        </span>
      </label>
      <label className="check indent">
        <input
          type="checkbox"
          disabled={!draft.automatic}
          checked={draft.automatic && draft.calendarLink}
          onChange={(e) => {
            form.patch({ calendarLink: e.target.checked });
          }}
        />
        <span>Add the minutes link to the calendar event</span>
      </label>
      <div className="field indent-field">
        <small>
          The link goes in the description of the original calendar event, so everyone invited can
          open the minutes later. Google guests get no change email. Outlook may notify guests of
          the changed event, the Graph API has no switch for it. Skipped when you are only a guest
          and cannot edit the event.
        </small>
        <span>Calendar accounts</span>
        <ul className="calendar-links">
          {state.accounts.map((account) => (
            <li
              key={account.id}
              className={account.canWrite ? 'calendar-link ok' : 'calendar-link'}
            >
              <span>
                {account.email}
                <small className="muted">
                  {account.canWrite ? ' can edit events' : ' cannot edit events yet'}
                </small>{' '}
                {!account.canWrite && (
                  <a href={`/api/oauth/${account.provider}/start?calendar=write`}>
                    Allow calendar links ({PROVIDER_LABEL[account.provider]})
                  </a>
                )}
              </span>
            </li>
          ))}
          {state.accounts.length === 0 && (
            <li className="calendar-link">
              <span className="muted">Connect a calendar first.</span>
            </li>
          )}
        </ul>
        <small>
          Adding a link asks for permission to edit events, on top of reading them. Existing
          connections keep working until you allow it.
        </small>
      </div>
    </SettingsCard>
  );
}

export function ExportSettings() {
  const [state, setState] = useState<ExportSettingsDto>();
  useEffect(() => {
    void api.exportSettings().then(setState);
  }, []);
  return state ? <ExportForm state={state} onSaved={setState} /> : null;
}
