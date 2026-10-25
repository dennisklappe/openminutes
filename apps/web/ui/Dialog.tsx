import { useEffect, useId, useRef, type ReactNode } from 'react';

/** A modal dialog with a title. Escape and a click on the backdrop close it. */
export function Dialog(props: { title: string; onClose: () => void; children: ReactNode }) {
  const { title, onClose, children } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog form-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}
