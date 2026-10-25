import type { LibraryMeetingDto } from '../../src/dto.js';
import { MinuteRow } from './MinuteRow.js';

export interface RowActions {
  selecting: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onArchive: (meeting: LibraryMeetingDto) => void;
  onDelete: (meeting: LibraryMeetingDto) => void;
  draggable: boolean;
  askCompany: boolean;
  onMove: (meeting: LibraryMeetingDto) => void;
  onCompany: (meeting: LibraryMeetingDto) => void;
}

export function MinuteList({
  meetings,
  actions,
}: {
  meetings: LibraryMeetingDto[];
  actions: RowActions;
}) {
  if (meetings.length === 0) return <p className="group-empty muted">Nothing here yet.</p>;
  return (
    <ul className="panel list minutes">
      {meetings.map((meeting) => (
        <MinuteRow
          key={meeting.id}
          meeting={meeting}
          selecting={actions.selecting}
          selected={actions.selected.has(meeting.id)}
          onToggle={() => {
            actions.onToggle(meeting.id);
          }}
          onArchive={() => {
            actions.onArchive(meeting);
          }}
          onDelete={() => {
            actions.onDelete(meeting);
          }}
          draggable={actions.draggable}
          askCompany={actions.askCompany}
          onMove={() => {
            actions.onMove(meeting);
          }}
          onCompany={() => {
            actions.onCompany(meeting);
          }}
        />
      ))}
    </ul>
  );
}
