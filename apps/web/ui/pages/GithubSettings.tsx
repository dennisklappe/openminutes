import { useEffect, useState } from 'react';
import type { GithubSettingsDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

interface GithubDraft {
  repo: string;
  branch: string;
  folder: string;
  includeTranscript: boolean;
  folderTemplate: string;
  minutesFile: string;
  transcriptFile: string;
  /** Typed, never read back. Empty keeps the saved token. */
  token: string;
}

const toForm = (state: GithubSettingsDto): GithubDraft => ({
  repo: state.repo,
  branch: state.branch,
  folder: state.folder,
  includeTranscript: state.includeTranscript,
  folderTemplate: state.folderTemplate,
  minutesFile: state.minutesFile,
  transcriptFile: state.transcriptFile,
  token: '',
});

function GithubForm({
  state,
  onSaved,
}: {
  state: GithubSettingsDto;
  onSaved: (next: GithubSettingsDto) => void;
}) {
  const form = useSettingsForm(toForm(state), async (draft) => {
    const saved = await api.saveGithubSettings({
      repo: draft.repo.trim(),
      branch: draft.branch.trim(),
      folder: draft.folder.trim(),
      includeTranscript: draft.includeTranscript,
      folderTemplate: draft.folderTemplate.trim(),
      minutesFile: draft.minutesFile.trim(),
      transcriptFile: draft.transcriptFile.trim(),
      token: draft.token.trim(),
    });
    onSaved(saved);
    return toForm(saved);
  });
  const draft = form.draft;
  return (
    <SettingsCard
      form={form}
      title="GitHub"
      description={
        <>
          Commit the minutes to a folder in a GitHub repository, for example as context for agents.
          Each meeting gets its own folder, by default <code>202603120930 Product sync</code> with{' '}
          <code>MINUTES.md</code> and <code>TRANSCRIPT.md</code>. Pick GitHub as the export target
          above to send it automatically.
        </>
      }
      actions={
        state.tokenSet && (
          <button
            type="button"
            onClick={() => {
              form.setNotice(undefined);
              api
                .removeGithubSettings()
                .then((next) => {
                  onSaved(next);
                  form.set(toForm(next));
                  form.setNotice({ ok: true, text: 'GitHub removed.' });
                })
                .catch((error: unknown) => {
                  form.setNotice({ ok: false, text: errorMessage(error) });
                });
            }}
          >
            Remove GitHub
          </button>
        )
      }
    >
      <label className="field">
        <span>Repository</span>
        <input
          value={draft.repo}
          placeholder="owner/name"
          onChange={(e) => {
            form.patch({ repo: e.target.value });
          }}
        />
      </label>
      <label className="field">
        <span>Branch</span>
        <input
          value={draft.branch}
          placeholder="Default branch"
          onChange={(e) => {
            form.patch({ branch: e.target.value });
          }}
        />
        <small>Leave empty for the default branch. It must already exist.</small>
      </label>
      <label className="field">
        <span>Folder</span>
        <input
          value={draft.folder}
          placeholder="meetings"
          onChange={(e) => {
            form.patch({ folder: e.target.value });
          }}
        />
        <small>A folder inside the repository. Leave empty for the top level.</small>
      </label>
      <label className="field">
        <span>Meeting folder name</span>
        <input
          value={draft.folderTemplate}
          onChange={(e) => {
            form.patch({ folderTemplate: e.target.value });
          }}
        />
        <small>
          Made per meeting from variables:{' '}
          {state.variables.map((name) => (
            <code key={name}>{`{${name}}`} </code>
          ))}
          (year, month as number or name, day, hour, minute, meeting title, company, short id). A
          slash makes subfolders, for example <code>{'{yyyy}/{MM}/{title}'}</code>.
        </small>
      </label>
      <label className="field">
        <span>Minutes file name</span>
        <input
          value={draft.minutesFile}
          onChange={(e) => {
            form.patch({ minutesFile: e.target.value });
          }}
        />
      </label>
      <label className="field">
        <span>Transcript file name</span>
        <input
          value={draft.transcriptFile}
          onChange={(e) => {
            form.patch({ transcriptFile: e.target.value });
          }}
        />
        <small>
          Updating a meeting writes into the same folder. After you rename files or the folder
          template, older meetings keep their old names.
        </small>
      </label>
      <label className="field">
        <span>Access token</span>
        <input
          type="password"
          autoComplete="off"
          value={draft.token}
          placeholder={state.tokenSet ? 'Saved, type to replace' : 'github_pat_...'}
          onChange={(e) => {
            form.patch({ token: e.target.value });
          }}
        />
        <small>
          A fine-grained personal access token limited to this repository with Contents: read and
          write. Stored encrypted.
        </small>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.includeTranscript}
          onChange={(e) => {
            form.patch({ includeTranscript: e.target.checked });
          }}
        />
        <span>
          Also commit the transcript{' '}
          <span className="muted">As its own file, so agents can read the minutes alone.</span>
        </span>
      </label>
    </SettingsCard>
  );
}

export function GithubSettings() {
  const [state, setState] = useState<GithubSettingsDto>();
  useEffect(() => {
    api.githubSettings().then(setState, () => undefined);
  }, []);
  return state ? <GithubForm state={state} onSaved={setState} /> : null;
}
