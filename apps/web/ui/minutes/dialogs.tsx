import { useState, type SubmitEvent } from 'react';
import type { FolderDto, LibraryMeetingDto } from '../../src/dto.js';
import { errorMessage } from '../api.js';
import { CompanyForm } from '../CompanyForm.js';
import { Dialog } from '../Dialog.js';
import { folderChoices } from '../library.js';

export function FolderNameDialog(props: {
  title: string;
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { title, initial, submitLabel, onSubmit, onClose } = props;
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    setBusy(true);
    onSubmit(name.trim()).then(onClose, (failure: unknown) => {
      setError(errorMessage(failure));
      setBusy(false);
    });
  };

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Folder name</span>
          <input
            value={name}
            maxLength={60}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || name.trim() === ''}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function MoveDialog(props: {
  meeting: LibraryMeetingDto;
  folders: FolderDto[];
  onMove: (folderId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const { meeting, folders, onMove, onClose } = props;
  const [error, setError] = useState<string>();
  const choose = (folderId: string | null) => {
    onMove(folderId).then(onClose, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  };
  const options = [{ id: null, name: 'Unfiled', depth: 0 }, ...folderChoices(folders)];

  return (
    <Dialog title="Move to folder" onClose={onClose}>
      <p className="muted truncate">{meeting.title}</p>
      <ul className="folder-options">
        {options.map((option) => (
          <li key={option.id ?? 'unfiled'}>
            <button
              type="button"
              style={{ paddingLeft: 12 + option.depth * 16 }}
              aria-current={option.id === meeting.folderId ? 'true' : undefined}
              onClick={() => {
                choose(option.id);
              }}
            >
              {option.name}
            </button>
          </li>
        ))}
      </ul>
      {folders.length === 0 && (
        <p className="muted">No folders yet. Create one with New folder in My folders.</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function CompanyDialog(props: {
  meeting: LibraryMeetingDto;
  suggestions: string[];
  onSave: (company: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const { meeting, suggestions, onSave, onClose } = props;
  return (
    <Dialog title="Which company is this?" onClose={onClose}>
      <p className="muted truncate">{meeting.title}</p>
      <CompanyForm
        label="Company"
        initial={meeting.company ?? ''}
        suggestions={suggestions}
        submitLabel="Save"
        allowClear
        autoFocus
        onSave={async (company) => {
          await onSave(company);
          onClose();
        }}
        onCancel={onClose}
      />
    </Dialog>
  );
}

export function RenameCompanyDialog(props: {
  company: string;
  companies: string[];
  onSubmit: (to: string) => Promise<void>;
  onClose: () => void;
}) {
  const { company, companies, onSubmit, onClose } = props;
  return (
    <Dialog title={`Rename ${company}`} onClose={onClose}>
      <p className="muted">
        Every minute of {company} gets the new name. Choose a company that already exists to merge
        the two.
      </p>
      <CompanyForm
        label="New name"
        initial={company}
        suggestions={companies.filter((name) => name !== company)}
        submitLabel="Rename"
        autoFocus
        onSave={async (to) => {
          if (to) await onSubmit(to);
          onClose();
        }}
        onCancel={onClose}
      />
    </Dialog>
  );
}
