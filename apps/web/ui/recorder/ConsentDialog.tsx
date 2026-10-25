import { useEffect, useRef } from 'react';

export function ConsentDialog(props: {
  text: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="consent-dialog"
      aria-labelledby="consent-h"
      onClose={props.onCancel}
    >
      <h2 id="consent-h">Before you record</h2>
      <p>{props.text}</p>
      <div className="actions">
        <button className="primary" autoFocus onClick={props.onConfirm}>
          I understand, start recording
        </button>
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    </dialog>
  );
}
