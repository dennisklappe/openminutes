export interface BarAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

export function SelectionBar(props: { count: number; actions: BarAction[]; onCancel: () => void }) {
  const { count, actions, onCancel } = props;
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected meetings">
      <span className="selection-count">
        {count === 0 ? 'Select meetings' : `${count} selected`}
      </span>
      {actions.map(({ label, onClick, danger }) => (
        <button
          key={label}
          type="button"
          className={danger ? 'danger' : ''}
          disabled={count === 0}
          onClick={onClick}
        >
          {label}
        </button>
      ))}
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
