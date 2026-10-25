import { useEffect } from 'react';
import { useConfirm } from '../Confirm.js';
import { useFinishRedirect, useRecorderSession } from './hooks.js';
import { recorderSession } from './session.js';

export function UnfinishedBanner() {
  const { unfinished, phase } = useRecorderSession();
  useFinishRedirect();
  const confirm = useConfirm();
  useEffect(() => {
    void recorderSession.refreshUnfinished();
  }, []);
  const busy = phase === 'uploading' || phase === 'starting' || phase === 'stopping';
  return (
    <>
      {unfinished.map(({ id, label }) => (
        <p className="banner unfinished" key={id} role="status">
          <span>Upload unfinished recording? ({label})</span>
          <span className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                void recorderSession.resumeUnfinished(id);
              }}
            >
              Upload
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                void confirm({
                  title: 'Discard this recording?',
                  body: `The audio from ${label} is deleted from this device and cannot be recovered.`,
                  confirmLabel: 'Discard',
                  destructive: true,
                }).then((ok) => {
                  if (ok) void recorderSession.discardUnfinished(id);
                });
              }}
            >
              Discard
            </button>
          </span>
        </p>
      ))}
    </>
  );
}
