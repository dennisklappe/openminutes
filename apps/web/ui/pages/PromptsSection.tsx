import { useEffect, useState } from 'react';
import type { PromptsDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

const NEW = 'new';

interface PromptDraft {
  name: string;
  content: string;
}

function PromptEditor({
  data,
  selected,
  seed,
  onSelect,
  onCopy,
  onData,
}: {
  data: PromptsDto;
  selected: string;
  /** Text to start a new prompt from, when copying a built in one. */
  seed: PromptDraft | undefined;
  onSelect: (id: string) => void;
  onCopy: (seed: PromptDraft) => void;
  onData: (next: PromptsDto, id: string) => void;
}) {
  const current = data.prompts.find((p) => p.id === selected);
  const form = useSettingsForm<PromptDraft>(
    { name: current?.name ?? '', content: current?.content ?? '' },
    async (draft) => {
      if (current && !current.builtin) {
        onData(await api.updatePrompt(current.id, draft), current.id);
      } else {
        const next = await api.createPrompt(draft);
        onData(next, next.prompts[next.prompts.length - 1]?.id ?? NEW);
      }
      return draft;
    },
  );
  const { set } = form;
  useEffect(() => {
    if (seed) set(seed);
    // Only the first render of an editor starts from the seed.
  }, []);
  const { name, content } = form.draft;
  const run = (action: () => Promise<void>) => {
    form.setNotice(undefined);
    action().catch((failure: unknown) => {
      form.setNotice({ ok: false, text: errorMessage(failure) });
    });
  };

  return (
    <SettingsCard
      form={form}
      title="Summary prompts"
      description="The instructions the language model gets with each transcript."
      actions={
        <>
          {current?.builtin && (
            <button
              type="button"
              onClick={() => {
                onCopy({ name: `${name} copy`, content });
              }}
            >
              Copy to edit
            </button>
          )}
          {current && current.id !== data.defaultId && (
            <button
              type="button"
              onClick={() => {
                run(async () => {
                  onData(await api.makeDefaultPrompt(current.id), current.id);
                });
              }}
            >
              Use for automatic summaries
            </button>
          )}
          {current && !current.builtin && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                run(async () => {
                  const next = await api.deletePrompt(current.id);
                  onData(next, next.defaultId);
                });
              }}
            >
              Delete
            </button>
          )}
        </>
      }
    >
      <label className="field">
        <span>Prompt</span>
        <select
          value={selected}
          onChange={(e) => {
            onSelect(e.target.value);
          }}
        >
          {data.prompts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === data.defaultId && ' (used for automatic summaries)'}
            </option>
          ))}
          <option value={NEW}>New prompt</option>
        </select>
      </label>
      <label className="field">
        <span>Name</span>
        <input
          value={name}
          required
          disabled={current?.builtin}
          onChange={(e) => {
            form.patch({ name: e.target.value });
          }}
        />
      </label>
      <label className="field">
        <span>Prompt text</span>
        <textarea
          rows={12}
          value={content}
          required
          disabled={current?.builtin}
          onChange={(e) => {
            form.patch({ content: e.target.value });
          }}
        />
        {current?.builtin && <small>Built in prompts are read only. Copy one to edit it.</small>}
      </label>
    </SettingsCard>
  );
}

export function PromptsSection() {
  const [data, setData] = useState<PromptsDto>();
  const [selected, setSelected] = useState(NEW);
  const [seed, setSeed] = useState<PromptDraft>();

  useEffect(() => {
    void api.prompts().then((loaded) => {
      setData(loaded);
      setSelected(loaded.defaultId);
    });
  }, []);

  return (
    data && (
      <PromptEditor
        key={selected}
        data={data}
        selected={data.prompts.some((p) => p.id === selected) ? selected : NEW}
        seed={seed}
        onSelect={(id) => {
          setSeed(undefined);
          setSelected(id);
        }}
        onCopy={(copy) => {
          setSeed(copy);
          setSelected(NEW);
        }}
        onData={(next, id) => {
          setData(next);
          setSeed(undefined);
          setSelected(id);
        }}
      />
    )
  );
}
