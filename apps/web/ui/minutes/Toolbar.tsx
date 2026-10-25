import type { LibraryFilter } from '../api.js';
import { SearchIcon } from '../icons.js';

const PLATFORMS = [
  { value: '', label: 'All' },
  { value: 'meet', label: 'Meet' },
  { value: 'teams', label: 'Teams' },
  { value: 'recording', label: 'Phone' },
];

interface Props {
  filter: LibraryFilter;
  onFilter: (next: LibraryFilter) => void;
}

export function Toolbar({ filter, onFilter }: Props) {
  return (
    <div className="toolbar minutes-toolbar">
      <label className="search">
        <SearchIcon />
        <input
          type="search"
          aria-label="Search minutes"
          placeholder="Search titles, companies, people and transcripts"
          value={filter.q}
          onChange={(e) => {
            onFilter({ ...filter, q: e.target.value });
          }}
        />
      </label>
      <div className="segmented" role="group" aria-label="Platform">
        {PLATFORMS.map(({ value, label }) => (
          <button
            key={value}
            aria-pressed={filter.platform === value}
            onClick={() => {
              onFilter({ ...filter, platform: value });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="date-range">
        <input
          type="date"
          aria-label="From date"
          value={filter.from}
          max={filter.to || undefined}
          onChange={(e) => {
            onFilter({ ...filter, from: e.target.value });
          }}
        />
        <span className="muted" aria-hidden="true">
          to
        </span>
        <input
          type="date"
          aria-label="To date"
          value={filter.to}
          min={filter.from || undefined}
          onChange={(e) => {
            onFilter({ ...filter, to: e.target.value });
          }}
        />
      </div>
    </div>
  );
}
