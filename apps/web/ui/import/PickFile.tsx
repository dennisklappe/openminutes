import { useRef, useState, type DragEvent } from 'react';
import type { ImportConfigDto } from '../../src/dto.js';
import { ImportIcon } from '../icons.js';
import { Panel } from '../Panel.js';
import { formatSize } from './upload.js';
import type { UploadState } from './useUpload.js';

export const REQUEST_FORM = 'https://9rnxnmmf.paperform.co/';
export const FIREFLIES_GUIDE =
  'https://guide.fireflies.ai/articles/8915664468-how-to-export-your-fireflies-account-data';
export const DOCS =
  'https://github.com/dennisklappe/openminutes/blob/main/docs/import-fireflies.md';

function Progress({ state }: { state: Exclude<UploadState, { kind: 'idle' }> }) {
  if (state.kind === 'reading') {
    return (
      <p className="import-status" role="status">
        <progress aria-label="Reading the export" />
        Reading the export. Bigger files take a minute.
      </p>
    );
  }
  const percent = Math.round((state.sent / state.total) * 100);
  return (
    <p className="import-status" role="status">
      <progress aria-label={`Uploading ${state.name}`} max={state.total} value={state.sent} />
      Uploading {state.name}: {percent}% of {formatSize(state.total)}
    </p>
  );
}

export function PickFile(props: {
  config: ImportConfigDto | undefined;
  state: UploadState;
  error: string | undefined;
  onFile: (file: File) => void;
}) {
  const { config, state, error, onFile } = props;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const busy = state.kind !== 'idle';

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) onFile(file);
  };

  return (
    <Panel
      title="Import from Fireflies"
      description={
        <>
          Bring your meeting history over. Fireflies sends you the export by email after you ask for
          it on its <a href={REQUEST_FORM}>request form</a>, see its{' '}
          <a href={FIREFLIES_GUIDE}>export guide</a> and our <a href={DOCS}>import guide</a>.
        </>
      }
    >
      <div
        className={`import-drop${over ? ' is-over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={drop}
      >
        <ImportIcon />
        <p>Drop the .tar.gz or .zip file here, or choose it.</p>
        <input
          ref={input}
          id="import-file"
          aria-label="Choose the export file to import"
          type="file"
          accept=".tar.gz,.tgz,.zip,application/gzip,application/zip"
          className="sr-only"
          disabled={busy || !config}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="primary"
          disabled={busy || !config}
          onClick={() => input.current?.click()}
        >
          Choose file
        </button>
        {config && (
          <p className="hint">
            Up to {formatSize(config.maxBytes)}. Everything stays on your server.
          </p>
        )}
      </div>
      {state.kind !== 'idle' && <Progress state={state} />}
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
