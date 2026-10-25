import { useState, type DragEvent, type ReactNode } from 'react';
import { ChevronIcon } from '../icons.js';

export const MINUTE_DRAG_TYPE = 'application/x-openminutes-minute';

interface Props {
  title: string;
  count: number;
  icon?: ReactNode;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  note?: ReactNode;
  onDropMinute?: (meetingId: string) => void;
  children: ReactNode;
}

/** A collapsible group of minutes. With onDropMinute the header accepts a dragged minute. */
export function Group(props: Props) {
  const { title, count, icon, open, onToggle, actions, note, onDropMinute, children } = props;
  const [over, setOver] = useState(false);

  const droppable = onDropMinute
    ? {
        onDragOver: (event: DragEvent) => {
          if (!event.dataTransfer.types.includes(MINUTE_DRAG_TYPE)) return;
          event.preventDefault();
          setOver(true);
        },
        onDragLeave: () => {
          setOver(false);
        },
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setOver(false);
          const id = event.dataTransfer.getData(MINUTE_DRAG_TYPE);
          if (id) onDropMinute(id);
        },
      }
    : {};

  return (
    <section className={`group${over ? ' is-over' : ''}`}>
      <header className="group-head" {...droppable}>
        <button type="button" className="group-toggle" aria-expanded={open} onClick={onToggle}>
          <span className={`group-chevron${open ? ' is-open' : ''}`}>
            <ChevronIcon />
          </span>
          {icon}
          <span className="group-title truncate">{title}</span>
          <span className="count">{count}</span>
        </button>
        {actions && <div className="group-actions">{actions}</div>}
      </header>
      {open && (
        <>
          {note}
          {children}
        </>
      )}
    </section>
  );
}
