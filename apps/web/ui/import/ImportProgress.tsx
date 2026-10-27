import { useCallback } from 'react';
import type { ImportMeetingDto, MeetingStatus } from '../../src/dto.js';
import { api } from '../api.js';
import { progressLabel } from '../format.js';
import { usePolling } from '../usePolling.js';

const FINISHED: MeetingStatus[] = ['transcribed', 'failed', 'cancelled'];
const POLL_MS = 2000;

export const isFinished = (meeting: ImportMeetingDto) =>
  meeting.meeting !== null && FINISHED.includes(meeting.meeting.status);

function Status({ meeting }: { meeting: ImportMeetingDto }) {
  const linked = meeting.meeting;
  const status = linked?.status;
  if (status === 'transcribed')
    return (
      <span className="pill pill-transcribed">
        <i aria-hidden="true" />
        Imported
      </span>
    );
  if (status === 'failed')
    return (
      <span className="pill pill-failed">
        <i aria-hidden="true" />
        Failed
      </span>
    );
  if (status === 'processing') {
    return (
      <span className="pill pill-processing">
        <i aria-hidden="true" />
        {progressLabel(linked?.progress ?? null)}
      </span>
    );
  }
  return (
    <span className="pill pill-scheduled">
      <i aria-hidden="true" />
      Waiting
    </span>
  );
}

export function ImportProgress(props: {
  id: string;
  rows: readonly ImportMeetingDto[];
  onUpdate: (meetings: ImportMeetingDto[]) => void;
}) {
  const { id, rows, onUpdate } = props;
  const load = useCallback(
    () =>
      api.importPreview(id).then((preview) => {
        onUpdate(preview.meetings);
      }),
    [id, onUpdate],
  );
  usePolling(load, POLL_MS);
  const done = rows.filter(isFinished).length;

  return (
    <section aria-labelledby="import-progress-h">
      <div className="block-head">
        <h2 id="import-progress-h">Importing</h2>
        <span className="muted" aria-live="polite">
          {done} of {rows.length} finished
        </span>
      </div>
      <ul className="panel import-list">
        {rows.map((meeting) => (
          <li key={meeting.key}>
            <div className="import-row is-progress">
              <span className="import-main">
                <span className="import-title truncate">
                  {meeting.meeting?.status === 'transcribed' ? (
                    <a href={`#/meetings/${meeting.meeting.id}`}>{meeting.title}</a>
                  ) : (
                    meeting.title
                  )}
                </span>
                {meeting.meeting?.status === 'failed' && meeting.meeting.error && (
                  <span className="import-meta error">{meeting.meeting.error}</span>
                )}
              </span>
              <Status meeting={meeting} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
