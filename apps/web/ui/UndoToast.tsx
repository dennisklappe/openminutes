import type { Toast } from './useSpeakerEdits.js';

interface Props {
  toast: Toast | undefined;
  onUndo: () => void;
  onDismiss: () => void;
}

export function UndoToast({ toast, onUndo, onDismiss }: Props) {
  return (
    <div className="undo-toast-slot" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`undo-toast${toast.failed ? ' failed' : ''}`}>
          <span>{toast.text}</span>
          {toast.undoable && (
            <button type="button" onClick={onUndo}>
              Undo
            </button>
          )}
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
