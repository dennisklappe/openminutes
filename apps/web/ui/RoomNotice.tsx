import { useState } from 'react';
import type { RoomNoticeDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { roomHref } from './roomRoute.js';

interface Props {
  meetingId: string;
  notices: RoomNoticeDto[];
  onChanged: () => void;
}

/**
 * A quiet notice for a participant tile that probably holds several people. Nothing in the
 * transcript changes until the voices are named; "It is one person" hides the notice for good.
 */
export function RoomNotice({ meetingId, notices, onChanged }: Props) {
  const [failure, setFailure] = useState<string>();
  return (
    <>
      {notices.map((notice) => (
        <p className="banner room-notice" role="status" key={notice.participantId}>
          <span>
            {notice.name} appears to have {String(notice.voices)} voices.
          </span>
          <a className="button" href={roomHref(meetingId, notice.participantId)}>
            Name them
          </a>
          <button
            type="button"
            className="link"
            onClick={() => {
              setFailure(undefined);
              api.dismissRoom(meetingId, notice.participantId).then(onChanged, (error: unknown) => {
                setFailure(errorMessage(error));
              });
            }}
          >
            It is one person
          </button>
        </p>
      ))}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
    </>
  );
}
