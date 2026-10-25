import { MAX_SPEAKERS, MIN_SPEAKERS } from '../../src/speakerCount.js';

const options = Array.from(
  { length: MAX_SPEAKERS - MIN_SPEAKERS + 1 },
  (_, index) => MIN_SPEAKERS + index,
);

export function SpeakerCountSelect(props: {
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="record-speakers">
      <span>How many people are talking?</span>
      <select
        value={props.value ?? ''}
        disabled={props.disabled}
        onChange={(event) => {
          props.onChange(event.target.value ? Number(event.target.value) : undefined);
        }}
      >
        <option value="">Auto</option>
        {options.map((count) => (
          <option key={count} value={count}>
            {count === MAX_SPEAKERS ? `${String(count)}+` : count}
          </option>
        ))}
      </select>
    </label>
  );
}
