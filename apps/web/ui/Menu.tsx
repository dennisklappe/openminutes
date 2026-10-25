import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  /** Give either onSelect or href. An href item is a link, set download for files. */
  onSelect?: () => void;
  href?: string;
  download?: boolean;
  danger?: boolean;
}

/**
 * A button that opens a short list of actions. Keyboard: arrows move, Escape closes and returns
 * focus to the button. Reuse it for any card with more than two secondary actions.
 */
export function Menu(props: {
  trigger: ReactNode;
  label: string;
  items: MenuItem[];
  className?: string;
  align?: 'start' | 'end';
}) {
  const { trigger, label, items, className = '', align = 'start' } = props;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const move = (event: React.KeyboardEvent) => {
    const buttons = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const target: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: buttons.length - 1,
    };
    const next = target[event.key];
    if (next === undefined || buttons.length === 0) return;
    event.preventDefault();
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div className={`menu ${className}`} ref={root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu-list ${align}`} id={id} role="menu" onKeyDown={move}>
          {items.map((item) =>
            item.href ? (
              <a
                key={item.label}
                role="menuitem"
                className="button"
                href={item.href}
                {...(item.download && { download: true })}
                onClick={() => {
                  setOpen(false);
                }}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.danger ? 'danger' : ''}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
