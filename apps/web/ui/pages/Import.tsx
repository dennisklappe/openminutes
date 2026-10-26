import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ImportConfigDto, ImportMeetingDto, ImportPreviewDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { selectableKeys } from '../import/choices.js';
import { ImportList } from '../import/ImportList.js';
import { ImportProgress, isFinished } from '../import/ImportProgress.js';
import { PickFile } from '../import/PickFile.js';
import { useUpload } from '../import/useUpload.js';
import '../import/import.css';

export function Import() {
  const [config, setConfig] = useState<ImportConfigDto>();
  const [preview, setPreview] = useState<ImportPreviewDto>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [started, setStarted] = useState<string[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.importConfig().then(setConfig, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  }, []);

  const ready = useCallback((next: ImportPreviewDto) => {
    setPreview(next);
    setPicked(new Set(selectableKeys(next.meetings)));
  }, []);
  const upload = useUpload(config, ready);

  const update = useCallback((meetings: ImportMeetingDto[]) => {
    setPreview((current) => current && { ...current, meetings });
  }, []);

  const meetings = useMemo(() => preview?.meetings ?? [], [preview]);
  const running = started ? meetings.filter((meeting) => started.includes(meeting.key)) : [];
  const failed = running.filter((meeting) => meeting.meeting?.status === 'failed');
  const settled = started !== undefined && running.every(isFinished);

  const start = (keys: string[]) => {
    if (!preview) return;
    setBusy(true);
    api.importStart(preview.id, { keys }).then(
      (next) => {
        setPreview(next);
        setStarted(keys);
        setError(undefined);
        setBusy(false);
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
        setBusy(false);
      },
    );
  };

  const leave = (discard: boolean) => {
    const go = () => {
      window.location.hash = '#/';
    };
    if (discard && preview) void api.importDiscard(preview.id).then(go, go);
    else go();
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Import</h1>
          <p className="lede">
            Bring the recordings of a Fireflies account export into your library.
          </p>
        </div>
      </header>
      {error && (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      )}
      {!preview && (
        <PickFile
          config={config}
          state={upload.state}
          error={upload.error}
          onFile={(file) => void upload.upload(file)}
        />
      )}
      {preview && !started && (
        <div className="import-stack">
          {preview.unreadable > 0 && (
            <p className="banner" role="status">
              {preview.unreadable} meeting{preview.unreadable === 1 ? '' : 's'} in the export could
              not be read and {preview.unreadable === 1 ? 'was' : 'were'} left out.
            </p>
          )}
          <ImportList meetings={meetings} picked={picked} onChange={setPicked} />
          <p className="hint">
            Only the recordings and the meeting details are imported. Each recording is transcribed
            and summarised here, like any other recording.
          </p>
          <div className="actions import-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || picked.size === 0}
              onClick={() => {
                start([...picked]);
              }}
            >
              Import {picked.size} meeting{picked.size === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              onClick={() => {
                leave(true);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {preview && started && (
        <div className="import-stack">
          <ImportProgress id={preview.id} rows={running} onUpdate={update} />
          <div className="actions import-actions">
            {failed.length > 0 && settled && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  start(failed.map((meeting) => meeting.key));
                }}
              >
                Retry failed
              </button>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => {
                leave(settled);
              }}
            >
              {settled ? 'Done' : 'Continue in the background'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
