import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ConfirmOptions {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

interface Pending extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

const ConfirmContext = createContext<Confirm | undefined>(undefined);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm needs a ConfirmProvider');
  return confirm;
}

function ConfirmDialog({ pending, onDone }: { pending: Pending; onDone: (ok: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        onDone(false);
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onDone(false);
      }}
    >
      <h2 id={titleId}>{pending.title}</h2>
      <div id={bodyId} className="confirm-body">
        {pending.body}
      </div>
      <div className="confirm-actions">
        <button
          type="button"
          autoFocus={pending.destructive}
          onClick={() => {
            onDone(false);
          }}
        >
          {pending.cancelLabel ?? 'Cancel'}
        </button>
        <button
          type="button"
          className={pending.destructive ? 'danger-solid' : 'primary'}
          autoFocus={!pending.destructive}
          onClick={() => {
            onDone(true);
          }}
        >
          {pending.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>();

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(undefined);
  };

  return (
    <ConfirmContext value={confirm}>
      {children}
      {pending && <ConfirmDialog pending={pending} onDone={finish} />}
    </ConfirmContext>
  );
}
