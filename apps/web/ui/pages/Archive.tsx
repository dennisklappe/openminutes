import { useCallback, useState } from 'react';
import { api, type BulkAction } from '../api.js';
import { formatWhen } from '../format.js';
import { SearchIcon } from '../icons.js';
import { useSelection } from '../selection.js';
import { SelectionBar } from '../SelectionBar.js';
import { StoredTable } from '../StoredTable.js';
import { StoredLinks } from '../StoredLinks.js';
import { BulkMessages, useBulk } from '../useBulk.js';
import { usePolling } from '../usePolling.js';

export function Archive() {
  const [q, setQ] = useState('');
  const load = useCallback(() => api.meetings({ scope: 'archived', q }), [q]);
  const { data, refresh } = usePolling(load);
  const selection = useSelection();
  const bulk = useBulk(() => {
    selection.stop();
    refresh();
  });
  const meetings = data ?? [];
  const chosen = meetings.filter((m) => selection.ids.has(m.id));
  const act = (action: BulkAction, items: typeof meetings) => {
    void bulk.run(action, items);
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Archive</h1>
          <p className="lede">
            Minutes you want to keep without them cluttering your lists. Nothing here is ever
            deleted.
          </p>
        </div>
      </header>
      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <input
            type="search"
            aria-label="Search the archive"
            placeholder="Search titles and transcripts"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
        </label>
      </div>
      <BulkMessages bulk={bulk} />
      {chosen.length > 0 && (
        <SelectionBar
          count={chosen.length}
          actions={[
            {
              label: 'Unarchive',
              onClick: () => {
                act('unarchive', chosen);
              },
            },
            {
              label: 'Delete',
              danger: true,
              onClick: () => {
                act('delete', chosen);
              },
            },
          ]}
          onCancel={selection.stop}
        />
      )}
      {data && meetings.length === 0 ? (
        <div className="panel empty-state">
          <h3>{q ? 'Nothing archived matches' : 'The archive is empty'}</h3>
          <p>Archive a meeting from its three dots menu and it is kept here for good.</p>
        </div>
      ) : (
        <StoredTable
          meetings={meetings}
          selection={selection}
          extraHead="Archived"
          extra={(m) => (m.archivedAt ? formatWhen(m.archivedAt) : '')}
          linked
          menu={(m) => [
            { label: 'Open', href: `#/meetings/${m.id}` },
            {
              label: 'Unarchive',
              onSelect: () => {
                act('unarchive', [m]);
              },
            },
            {
              label: 'Delete',
              danger: true,
              onSelect: () => {
                act('delete', [m]);
              },
            },
          ]}
        />
      )}
      <StoredLinks route="/archive" where="page" />
    </>
  );
}
