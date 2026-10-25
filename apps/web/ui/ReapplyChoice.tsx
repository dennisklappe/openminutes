import { useState } from 'react';

export function ReapplyChoice(props: {
  instructions: string[];
  manualEdits: boolean;
  onChange: (reapply: boolean) => void;
}) {
  const { instructions, manualEdits, onChange } = props;
  const [reapply, setReapply] = useState(false);
  const choose = (value: boolean) => () => {
    setReapply(value);
    onChange(value);
  };
  return (
    <>
      <p>
        Your edited version stays in History and you can restore it. Shared links will show the new
        version.
      </p>
      {instructions.length > 0 && (
        <fieldset className="reapply">
          <legend className="sr-only">What to do with your AI edits</legend>
          <label>
            <input type="radio" name="reapply" checked={!reapply} onChange={choose(false)} />
            Regenerate fresh
          </label>
          <label>
            <input type="radio" name="reapply" checked={reapply} onChange={choose(true)} />
            Regenerate and re-apply my edits
          </label>
          {reapply && (
            <ol className="hint">
              {instructions.map((instruction, index) => (
                <li key={index}>{instruction}</li>
              ))}
            </ol>
          )}
        </fieldset>
      )}
      {manualEdits && (
        <p className="hint">
          Manual edits are kept in History, only AI instructions can be re-applied.
        </p>
      )}
    </>
  );
}
