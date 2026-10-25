import { useCallback } from 'react';
import { api, type BulkAction } from '../api.js';
import { daysLeft, leftLabel } from '../format.js';
import { useSelection } from '../selection.js';
import { SelectionBar } from '../SelectionBar.js';
import { StoredTable } from '../StoredTable.js';
import { StoredLinks } from '../StoredLinks.js';
import { BulkMessages, useBulk } from '../useBulk.js';
import { usePolling } from '../usePolling.js';

export function Bin() {
  const load = useCallback(() => api.meetings({ scope: 'bin' }), []);
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
          <h1>Bin</h1>
          <p className="lede">
            Deleted meetings stay here for 30 days, then they are removed for good, with their
            audio, transcript and summaries.
          </p>
        </div>
      </header>
      <BulkMessages bulk={bulk} />
      {chosen.length > 0 && (
        <SelectionBar
          count={chosen.length}
          actions={[
            {
              label: 'Restore',
              onClick: () => {
                act('restore', chosen);
              },
            },
            {
              label: 'Delete forever',
              danger: true,
              onClick: () => {
                act('purge', chosen);
              },
            },
          ]}
          onCancel={selection.stop}
        />
      )}
      {data && meetings.length === 0 ? (
        <div className="panel empty-state">
          <h3>The bin is empty</h3>
          <p>A deleted meeting waits here for 30 days before it is removed for good.</p>
        </div>
      ) : (
        <StoredTable
          meetings={meetings}
          selection={selection}
          extraHead="Time left"
          extra={(m) => leftLabel(daysLeft(m.purgeAt))}
          linked={false}
          menu={(m) => [
            {
              label: 'Restore',
              onSelect: () => {
                act('restore', [m]);
              },
            },
            {
              label: 'Delete forever',
              danger: true,
              onSelect: () => {
                act('purge', [m]);
              },
            },
          ]}
        />
      )}
      <StoredLinks route="/bin" where="page" />
    </>
  );
}
