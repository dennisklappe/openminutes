import { useState } from 'react';
import type { CompanySourceDto, MeetingCompanyDto } from '../src/dto.js';
import { api } from './api.js';
import { CompanyForm } from './CompanyForm.js';
import { BuildingIcon } from './icons.js';

const SOURCES: Record<CompanySourceDto, string> = {
  calendar: 'from the calendar',
  ai: 'guessed from the conversation',
  manual: 'set by you',
};

/** Shows the company of a transcribed meeting, or asks for it when nothing could be found. */
export function MeetingCompany(props: {
  meetingId: string;
  company: MeetingCompanyDto;
  onChanged: () => void;
}) {
  const { meetingId, company, onChanged } = props;
  const [editing, setEditing] = useState(false);

  const save = async (name: string | null) => {
    await api.setCompany(meetingId, name);
    setEditing(false);
    onChanged();
  };

  if (company.name && !editing) {
    return (
      <p className="company-line">
        <BuildingIcon />
        <strong>{company.name}</strong>
        {company.source && <span className="muted">{SOURCES[company.source]}</span>}
        <button
          type="button"
          className="link"
          onClick={() => {
            setEditing(true);
          }}
        >
          Change
        </button>
      </p>
    );
  }

  return (
    <section className="company-ask" aria-labelledby="company-ask-title">
      <h3 id="company-ask-title">
        {company.name ? 'Change the company' : 'Which company is this?'}
      </h3>
      {!company.name && (
        <p className="muted">
          Used to sort your minutes by company. Pick one you used before or type a new one.
        </p>
      )}
      <CompanyForm
        label="Company"
        initial={company.name ?? ''}
        suggestions={company.suggestions}
        submitLabel="Save"
        allowClear
        onSave={save}
        {...(company.name && {
          onCancel: () => {
            setEditing(false);
          },
        })}
      />
    </section>
  );
}
