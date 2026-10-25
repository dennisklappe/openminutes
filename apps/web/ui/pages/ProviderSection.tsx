import { useEffect, useState, type ReactNode } from 'react';
import type {
  ProviderDto,
  ProviderFieldDto,
  AiProviderSettingsDto,
  ProviderTestDto,
} from '../../src/dto.js';
import { errorMessage, type ProviderSettingsClient } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

type Values = Record<string, string | boolean>;

function initialValues(provider: ProviderDto): Values {
  return Object.fromEntries(
    provider.fields.map((field): [string, string | boolean] => {
      const stored = provider.values[field.name] ?? (field.advanced ? undefined : field.default);
      if (field.type === 'boolean') return [field.name, stored === true];
      const text = typeof stored === 'string' || typeof stored === 'number' ? String(stored) : '';
      return [field.name, field.secret ? '' : text];
    }),
  );
}

function toConfig(provider: ProviderDto, values: Values): Record<string, unknown> {
  return Object.fromEntries(
    provider.fields.map(({ name, type }) => {
      const value = values[name];
      return [name, type === 'number' && value !== '' ? Number(value) : value];
    }),
  );
}

function FieldInput(props: {
  field: ProviderFieldDto;
  isSet: boolean;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  const { field, isSet, value, onChange } = props;
  const help = field.help && <small>{field.help}</small>;
  if (field.type === 'boolean') {
    return (
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked);
            }}
          />
          {field.label}
        </label>
        {help}
      </div>
    );
  }
  if (field.options) {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select
          value={String(value)}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {help}
      </label>
    );
  }
  const placeholder = isSet
    ? 'Saved, leave blank to keep'
    : (field.placeholder ?? field.default?.toString());
  return (
    <label className="field">
      <span>
        {field.label}
        {field.required && ' *'}
      </span>
      <input
        type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
        autoComplete="off"
        value={String(value)}
        {...(placeholder && { placeholder })}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
      {help}
    </label>
  );
}

function ProviderForm(props: {
  selector: ReactNode;
  aside: ReactNode;
  provider: ProviderDto;
  /** Whether this provider is the one in use. Saving a different one switches to it. */
  inUse: boolean;
  client: ProviderSettingsClient;
  onSaved: (settings: AiProviderSettingsDto) => void;
}) {
  const { selector, aside, provider, inUse, client, onSaved } = props;
  const form = useSettingsForm(
    initialValues(provider),
    async (values) => {
      onSaved(await client.save({ provider: provider.id, config: toConfig(provider, values) }));
      // Secrets are never shown again once saved.
      return {
        ...values,
        ...Object.fromEntries(provider.fields.filter((f) => f.secret).map((f) => [f.name, ''])),
      };
    },
    !inUse,
  );
  const values = form.draft;
  const main = provider.fields.filter((field) => !field.advanced);
  const advanced = provider.fields.filter((field) => field.advanced);
  const renderField = (field: ProviderFieldDto) => (
    <FieldInput
      key={field.name}
      field={field}
      isSet={provider.secretsSet.includes(field.name)}
      value={values[field.name] ?? ''}
      onChange={(value) => {
        form.patch({ [field.name]: value });
      }}
    />
  );

  const test = () => {
    form.setNotice(undefined);
    client.test({ provider: provider.id, config: toConfig(provider, values) }).then(
      (result: ProviderTestDto) => {
        form.setNotice(
          result.ok
            ? { ok: true, text: `Connection works${result.detail ? `: ${result.detail}` : ''}.` }
            : { ok: false, text: result.error ?? 'The test failed' },
        );
      },
      (failure: unknown) => {
        form.setNotice({ ok: false, text: errorMessage(failure) });
      },
    );
  };

  return (
    <SettingsCard
      form={form}
      actions={
        <button type="button" onClick={test}>
          Test connection
        </button>
      }
    >
      {selector}
      {aside}
      {main.map(renderField)}
      {advanced.length > 0 && (
        <details className="advanced">
          <summary>Advanced</summary>
          <div className="advanced-fields">{advanced.map(renderField)}</div>
        </details>
      )}
    </SettingsCard>
  );
}

export function ProviderSection(props: {
  title?: string;
  client: ProviderSettingsClient;
  /** Extra content under the provider choice, for the selected provider. */
  aside?: (provider: ProviderDto) => ReactNode;
  onSaved?: () => void;
}) {
  const { title, client, aside, onSaved } = props;
  const [settings, setSettings] = useState<AiProviderSettingsDto>();
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    void client.load().then((loaded) => {
      setSettings(loaded);
      setSelected(loaded.provider);
    });
  }, [client]);

  const provider = settings?.providers.find((p) => p.id === selected);
  const selector = settings && (
    <label className="field">
      <span>Provider</span>
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
        }}
      >
        {settings.providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.id === settings.provider && ' (in use)'}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      {title && <h2>{title}</h2>}
      {settings && provider && (
        <ProviderForm
          key={provider.id}
          selector={selector}
          aside={aside?.(provider)}
          provider={provider}
          inUse={provider.id === settings.provider}
          client={client}
          onSaved={(saved) => {
            setSettings(saved);
            onSaved?.();
          }}
        />
      )}
    </>
  );
}
