import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ImportConfigDto, ImportMeetingDto, ImportPreviewDto } from '../../src/dto.js';
import { useLinkableEvents } from '../EventPicker.js';
import { api, errorMessage } from '../api.js';
import { EVENT_NEAR_MS, eventLinks, selectableKeys } from '../import/choices.js';
import { ImportList } from '../import/ImportList.js';
import { ImportProgress, isFinished } from '../import/ImportProgress.js';
import { PickFile } from '../import/PickFile.js';
import { SpeakerCountSelect } from '../recorder/SpeakerCountSelect.js';
import { useUpload } from '../import/useUpload.js';
import '../import/import.css';

export function Import() {
  const [config, setConfig] = useState<ImportConfigDto>();
  const [preview, setPreview] = useState<ImportPreviewDto>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [started, setStarted] = useState<string[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [speakers, setSpeakers] = useState<number>();

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
  // The calendar meetings around the dates of the export, to link a recording to.
  const range = useMemo(() => {
    const times = meetings.map((meeting) => new Date(meeting.startedAt).getTime());
    return times.length === 0
      ? undefined
      : {
          from: new Date(Math.min(...times) - EVENT_NEAR_MS),
          to: new Date(Math.max(...times) + EVENT_NEAR_MS),
        };
  }, [meetings]);
  const events = useLinkableEvents(range?.from, range?.to);
  const [chosen, setChosen] = useState<Record<string, string | null>>({});
  const links = useMemo(() => eventLinks(meetings, events, chosen), [meetings, events, chosen]);
  const running = started ? meetings.filter((meeting) => started.includes(meeting.key)) : [];
  const failed = running.filter((meeting) => meeting.meeting?.status === 'failed');
  const settled = started !== undefined && running.every(isFinished);

  const start = (keys: string[]) => {
    if (!preview) return;
    setBusy(true);
    const linked = Object.fromEntries(
      keys.flatMap((key) => (links[key] ? [[key, links[key]]] : [])),
    );
    api
      .importStart(preview.id, {
        keys,
        ...(speakers !== undefined && { speakers }),
        ...(Object.keys(linked).length > 0 && { events: linked }),
      })
      .then(
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
          <ImportList
            meetings={meetings}
            picked={picked}
            onChange={setPicked}
            events={events}
            links={links}
            onLink={(key, id) => {
              setChosen((current) => ({ ...current, [key]: id ?? null }));
            }}
          />
          <p className="hint">
            Only the recordings and the meeting details are imported. Each recording is transcribed
            and summarised here, like any other recording.
          </p>
          <SpeakerCountSelect
            label="How many people speak?"
            value={speakers}
            disabled={busy}
            onChange={setSpeakers}
          />
          <p className="hint">
            Choose Auto unless you know the number. A wrong number merges or invents voices. You can
            change it later on the meeting.
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
