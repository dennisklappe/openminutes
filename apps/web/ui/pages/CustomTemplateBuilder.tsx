import { useRef, useState } from 'react';
import type { CustomTemplate } from '@openminutes/minutes';
import type { CustomChoicesDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';

interface Props {
  value: CustomTemplate;
  choices: CustomChoicesDto;
  onChange: (next: CustomTemplate) => void;
}

const LOGO_LABEL: Record<string, string> = {
  left: 'Left, with the title beside it',
  center: 'Centred above the title',
  none: 'Hidden',
};
const DATE_LABEL: Record<string, string> = {
  full: 'Full (Tuesday 3 June 2025)',
  long: 'Long (3 June 2025)',
  medium: 'Medium (3 Jun 2025)',
  short: 'Short (03/06/2025)',
};
const TIME_LABEL: Record<string, string> = { '24h': '24 hour (14:30)', '12h': '12 hour (2:30 PM)' };
const SECTION_LABEL: Record<string, string> = {
  details: 'Details and location',
  attendees: 'Attendees',
  absent: 'Unable to attend',
  summary: 'Summary',
  actions: 'Action items table',
  transcript: 'Transcript',
};
const FIELD_LABELS = ['date', 'time', 'location', 'meeting'] as const;

function download(template: CustomTemplate): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'openminutes-template.json';
  link.click();
  URL.revokeObjectURL(url);
}

export function CustomTemplateBuilder({ value, choices, onChange }: Props) {
  const [problem, setProblem] = useState<string>();
  const picker = useRef<HTMLInputElement>(null);
  const patch = (change: Partial<CustomTemplate>) => {
    onChange({ ...value, ...change });
  };
  const patchSection = (index: number, change: Partial<CustomTemplate['sections'][number]>) => {
    patch({
      sections: value.sections.map((section, at) =>
        at === index ? { ...section, ...change } : section,
      ),
    });
  };
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    const moved = value.sections[index];
    const other = value.sections[target];
    if (!moved || !other) return;
    patch({
      sections: value.sections.map((section, at) =>
        at === index ? other : at === target ? moved : section,
      ),
    });
  };
  const importFile = async (file: File) => {
    setProblem(undefined);
    try {
      onChange(await api.checkCustomTemplate(JSON.parse(await file.text()) as unknown));
    } catch (failure) {
      setProblem(
        failure instanceof SyntaxError ? 'That file is not valid JSON' : errorMessage(failure),
      );
    }
  };

  return (
    <div className="custom-builder">
      <div className="field-row">
        <label className="field">
          <span>Accent colour</span>
          <input
            type="color"
            value={value.accent}
            onChange={(e) => {
              patch({ accent: e.target.value });
            }}
          />
        </label>
        <label className="field">
          <span>Font</span>
          <select
            value={value.font}
            onChange={(e) => {
              patch({ font: e.target.value as CustomTemplate['font'] });
            }}
          >
            {choices.fonts.map((font) => (
              <option key={font}>{font}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Logo</span>
          <select
            value={value.header.logo}
            onChange={(e) => {
              patch({
                header: {
                  ...value.header,
                  logo: e.target.value as CustomTemplate['header']['logo'],
                },
              });
            }}
          >
            {choices.logoPlacements.map((placement) => (
              <option key={placement} value={placement}>
                {LOGO_LABEL[placement] ?? placement}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Organisation line (optional)</span>
        <input
          value={value.header.organisation}
          maxLength={choices.maxTitleLength}
          placeholder="Acme BV"
          onChange={(e) => {
            patch({ header: { ...value.header, organisation: e.target.value } });
          }}
        />
      </label>

      <fieldset className="custom-sections">
        <legend>Sections, in order</legend>
        {value.sections.map((section, index) => (
          <div className="custom-section" key={section.id}>
            <label className="check">
              <input
                type="checkbox"
                checked={section.enabled}
                onChange={(e) => {
                  patchSection(index, { enabled: e.target.checked });
                }}
              />
              <span className="muted">{SECTION_LABEL[section.id] ?? section.id}</span>
            </label>
            <input
              aria-label={`Title for ${SECTION_LABEL[section.id] ?? section.id}`}
              value={section.title}
              maxLength={choices.maxTitleLength}
              onChange={(e) => {
                patchSection(index, { title: e.target.value });
              }}
            />
            <button
              type="button"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => {
                move(index, -1);
              }}
            >
              Up
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={index === value.sections.length - 1}
              onClick={() => {
                move(index, 1);
              }}
            >
              Down
            </button>
          </div>
        ))}
      </fieldset>

      <div className="field-row">
        {FIELD_LABELS.map((key) => (
          <label className="field" key={key}>
            <span>Label: {key}</span>
            <input
              value={value.labels[key]}
              maxLength={30}
              onChange={(e) => {
                patch({ labels: { ...value.labels, [key]: e.target.value } });
              }}
            />
          </label>
        ))}
      </div>
      <div className="field-row">
        <label className="field">
          <span>Date format</span>
          <select
            value={value.dateFormat}
            onChange={(e) => {
              patch({ dateFormat: e.target.value as CustomTemplate['dateFormat'] });
            }}
          >
            {choices.dateFormats.map((format) => (
              <option key={format} value={format}>
                {DATE_LABEL[format] ?? format}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Time format</span>
          <select
            value={value.timeFormat}
            onChange={(e) => {
              patch({ timeFormat: e.target.value as CustomTemplate['timeFormat'] });
            }}
          >
            {choices.timeFormats.map((format) => (
              <option key={format} value={format}>
                {TIME_LABEL[format] ?? format}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Language for dates</span>
          <input
            value={value.locale}
            placeholder="en-GB"
            onChange={(e) => {
              patch({ locale: e.target.value });
            }}
          />
        </label>
      </div>

      <label className="field">
        <span>Text above the sections (optional)</span>
        <textarea
          rows={2}
          value={value.extraBefore}
          maxLength={choices.maxExtraLength}
          placeholder="Confidential, for the attendees only."
          onChange={(e) => {
            patch({ extraBefore: e.target.value });
          }}
        />
      </label>
      <label className="field">
        <span>Text below the sections (optional)</span>
        <textarea
          rows={2}
          value={value.extraAfter}
          maxLength={choices.maxExtraLength}
          onChange={(e) => {
            patch({ extraAfter: e.target.value });
          }}
        />
        <small>
          Plain text only. The small "Powered by OpenMinutes" line always stays at the end.
        </small>
      </label>

      <div className="actions">
        <button
          type="button"
          onClick={() => {
            download(value);
          }}
        >
          Export template (JSON)
        </button>
        <button
          type="button"
          onClick={() => {
            picker.current?.click();
          }}
        >
          Import template
        </button>
        <input
          ref={picker}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {problem && (
        <p className="feedback error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
