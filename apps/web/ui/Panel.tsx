import type { ReactNode, SyntheticEvent } from 'react';
import { AlertIcon, CheckIcon } from './icons.js';

export type Notice = { ok: boolean; text: string };

/** The live region stays in the page so a result that appears later is announced. */
function Feedback({ notice }: { notice: Notice | undefined }) {
  return (
    <div className="feedback-slot" role="status" aria-live="polite">
      {notice && (
        <p className={`feedback ${notice.ok ? 'ok' : 'error'}`}>
          {notice.ok ? <CheckIcon /> : <AlertIcon />}
          {notice.text}
        </p>
      )}
    </div>
  );
}

/** A titled settings card. With onSubmit it renders a form with a footer for the actions. */
export function Panel(props: {
  title?: string;
  /** Sits at the end of the header, for a menu. */
  actions?: ReactNode;
  description?: ReactNode;
  onSubmit?: (event: SyntheticEvent) => void;
  foot?: ReactNode;
  notice?: Notice | undefined;
  children: ReactNode;
}) {
  const { title, actions, description, onSubmit, foot, notice, children } = props;
  const inner = (
    <>
      {(title ?? description) && (
        <header className="card-head">
          {(title ?? actions) && (
            <div className="card-title">
              {title && <h3>{title}</h3>}
              {actions}
            </div>
          )}
          {description && <p>{description}</p>}
        </header>
      )}
      <div className="card-body">{children}</div>
      {(foot ?? notice) && (
        <footer className="card-foot">
          <div className="actions">{foot}</div>
          <Feedback notice={notice} />
        </footer>
      )}
    </>
  );
  return onSubmit ? (
    <form className="panel card" onSubmit={onSubmit}>
      {inner}
    </form>
  ) : (
    <section className="panel card">{inner}</section>
  );
}

export function SectionHead({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="section-head">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </header>
  );
}
