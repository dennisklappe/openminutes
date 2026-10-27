import { useState } from 'react';
import type { RoomCountInput, RoomNoticeDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { QUESTION_COUNTS, questionText, waitText } from './sharedRoom.js';

interface Props {
  meetingId: string;
  notices: RoomNoticeDto[];
  onChanged: () => void;
}

/**
 * The quiet question for a participant tile that probably holds several people: how many? The
 * answer makes each voice a person of the meeting, 1 says it is one person, and "Not sure" takes
 * the number of voices found. The summary waits for the answer for a while when it is set up to.
 */
export function RoomNotice({ meetingId, notices, onChanged }: Props) {
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const answer = (participantId: string, body: RoomCountInput) => {
    setFailure(undefined);
    setBusy(true);
    api
      .roomCount(meetingId, participantId, body)
      .then(onChanged, (error: unknown) => {
        setFailure(errorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <>
      {notices.map((notice) => {
        const waits = waitText(notice.waitsUntil);
        return (
          <div className="banner room-notice" role="status" key={notice.participantId}>
            <span>
              {questionText(notice)}
              {waits && <span className="muted room-wait"> {waits}</span>}
            </span>
            <span
              className="room-answers"
              role="group"
              aria-label={`How many people in ${notice.name}`}
            >
              {QUESTION_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    answer(notice.participantId, { count });
                  }}
                >
                  {count}
                </button>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  answer(notice.participantId, { unsure: true });
                }}
              >
                Not sure
              </button>
            </span>
          </div>
        );
      })}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
    </>
  );
}
