import type { ReactNode } from 'react';
import type { MeetingListItemDto } from '../src/dto.js';
import { formatWhen } from './format.js';
import { MoreIcon, PlatformIcon } from './icons.js';
import { Menu, type MenuItem } from './Menu.js';
import type { Selection } from './selection.js';

/** A selectable table of archived or binned meetings. */
export function StoredTable(props: {
  meetings: MeetingListItemDto[];
  selection: Selection;
  extraHead: string;
  extra: (meeting: MeetingListItemDto) => ReactNode;
  linked: boolean;
  menu: (meeting: MeetingListItemDto) => MenuItem[];
}) {
  const { meetings, selection, extraHead, extra, linked, menu } = props;
  const allSelected = meetings.length > 0 && meetings.every((m) => selection.ids.has(m.id));
  return (
    <div className="panel table-wrap">
      <table className="table stored-table">
        <thead>
          <tr>
            <th>
              <label className="cell-select">
                <input
                  type="checkbox"
                  aria-label="Select all meetings"
                  checked={allSelected}
                  onChange={() => {
                    selection.setAll(allSelected ? [] : meetings.map((m) => m.id));
                  }}
                />
                Meeting
              </label>
            </th>
            <th>Date</th>
            <th>{extraHead}</th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {meetings.map((m) => {
            const title = (
              <>
                <PlatformIcon platform={m.platform} />
                <span className="truncate">{m.title}</span>
              </>
            );
            return (
              <tr key={m.id}>
                <td>
                  <div className="cell-select">
                    <input
                      type="checkbox"
                      aria-label={`Select ${m.title}`}
                      checked={selection.ids.has(m.id)}
                      onChange={() => {
                        selection.toggle(m.id);
                      }}
                    />
                    {linked ? (
                      <a className="row-link" href={`#/meetings/${m.id}`}>
                        {title}
                      </a>
                    ) : (
                      <span className="row-link static">{title}</span>
                    )}
                  </div>
                </td>
                <td className="muted nowrap" data-label="Held">
                  {formatWhen(m.startedAt ?? m.createdAt)}
                </td>
                <td className="muted nowrap" data-label={extraHead}>
                  {extra(m)}
                </td>
                <td className="row-menu">
                  <Menu
                    trigger={<MoreIcon />}
                    label={`Actions for ${m.title}`}
                    align="end"
                    items={menu(m)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
