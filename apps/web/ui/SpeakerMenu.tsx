import { useEffect, useId, useRef, useState } from 'react';
import type { SpeakerChoiceDto, SpeakerTargetInput } from '../src/dto.js';
import { scopeLabels, type Scope } from './speakerEdits.js';

export interface LineAction {
  label: string;
  run: () => void;
}

interface Props {
  id: string;
  choices: SpeakerChoiceDto[];
  currentId: string | null;
  scopes: Scope[];
  actions: LineAction[];
  onPick: (target: SpeakerTargetInput, scope: Scope) => void;
  onClose: () => void;
}

const MAX_DIGITS = 9;
const entries = (root: HTMLElement | null) => [
  ...(root?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
];

/**
 * Popover to reassign, revert, split or merge one transcript line. Keyboard: arrows, Home and End
 * move, digits 1 to 9 pick a speaker, Escape or Tab close it.
 */
export function SpeakerMenu({ id, choices, currentId, scopes, actions, onPick, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const scopeName = useId();
  const [scope, setScope] = useState<Scope>('line');

  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const away = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close.current();
    };
    document.addEventListener('pointerdown', away);
    const current = root.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (current ?? entries(root.current)[0])?.focus();
    return () => {
      document.removeEventListener('pointerdown', away);
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const all = entries(root.current);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: all.length - 1,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      all[(next + all.length) % all.length]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      onClose();
    } else if (/^[1-9]$/.test(event.key)) {
      const choice = choices[Number(event.key) - 1];
      if (choice) onPick({ id: choice.id }, scope);
    }
  };

  return (
    <div
      ref={root}
      id={id}
      className="menu-list start speaker-menu"
      role="menu"
      aria-label="Change speaker"
      onKeyDown={onKeyDown}
    >
      {choices.map((choice, index) => (
        <button
          key={choice.id}
          type="button"
          role="menuitemradio"
          aria-checked={choice.id === currentId}
          onClick={() => {
            onPick({ id: choice.id }, scope);
          }}
        >
          <span>{choice.name}</span>
          {index < MAX_DIGITS && <kbd aria-hidden="true">{index + 1}</kbd>}
        </button>
      ))}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onPick({ create: true }, scope);
        }}
      >
        New speaker
      </button>
      {scopes.length > 1 && (
        <div role="group" aria-labelledby={scopeName} className="menu-group">
          <span id={scopeName} className="menu-heading">
            Apply to
          </span>
          {scopes.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === scope}
              onClick={() => {
                setScope(option);
              }}
            >
              {scopeLabels[option]}
            </button>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div role="group" className="menu-group">
          {actions.map((action) => (
            <button key={action.label} type="button" role="menuitem" onClick={action.run}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
