import type { LibraryMeetingDto } from '../../src/dto.js';
import { formatLength, formatWhen } from '../format.js';
import { BuildingIcon, ClockIcon, MoreIcon, PlatformIcon } from '../icons.js';
import { initials, personSlot } from '../library.js';
import { Menu, type MenuItem } from '../Menu.js';
import { SPEAKER_COLORS } from '../speakers.js';
import { MINUTE_DRAG_TYPE } from './Group.js';

const MAX_AVATARS = 4;

function People({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, MAX_AVATARS);
  const rest = names.length - shown.length;
  return (
    <span className="avatars" title={names.join(', ')} aria-label={names.join(', ')}>
      {shown.map((name) => (
        <span
          key={name}
          className="person"
          style={{
            ['--slot' as string]: `var(--spk-${String(personSlot(name, SPEAKER_COLORS) + 1)})`,
          }}
        >
          {initials(name)}
        </span>
      ))}
      {rest > 0 && <span className="person more">+{rest}</span>}
    </span>
  );
}

interface Props {
  meeting: LibraryMeetingDto;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onArchive: () => void;
  onDelete: () => void;
  draggable: boolean;
  askCompany: boolean;
  onMove: () => void;
  onCompany: () => void;
}

export function MinuteRow(props: Props) {
  const { meeting, selecting, selected, draggable, askCompany } = props;
  const { onToggle, onArchive, onDelete, onMove, onCompany } = props;
  const items: MenuItem[] = [
    { label: 'Move to folder', onSelect: onMove },
    { label: meeting.company ? 'Change company' : 'Set company', onSelect: onCompany },
    { label: 'Open', href: `#/meetings/${meeting.id}` },
    { label: 'Archive', onSelect: onArchive },
    { label: 'Delete', danger: true, onSelect: onDelete },
  ];
  return (
    <li
      className={selecting ? 'minute selecting' : 'minute'}
      {...(draggable && {
        draggable: true,
        onDragStart: (event: React.DragEvent) => {
          event.dataTransfer.setData(MINUTE_DRAG_TYPE, meeting.id);
          event.dataTransfer.effectAllowed = 'move';
        },
      })}
    >
      {selecting && (
        <input
          type="checkbox"
          className="minute-check"
          aria-label={`Select ${meeting.title}`}
          checked={selected}
          onChange={onToggle}
        />
      )}
      <a className="minute-main" href={`#/meetings/${meeting.id}`}>
        <span className="minute-title">
          <PlatformIcon platform={meeting.platform} />
          <span className="truncate">{meeting.title}</span>
        </span>
        <span className="minute-meta">
          <span>{formatWhen(meeting.heldAt)}</span>
          {meeting.durationMs !== null && (
            <span className="mono">
              <ClockIcon />
              {formatLength(meeting.durationMs)}
            </span>
          )}
          {meeting.company && (
            <span className="company-chip">
              <BuildingIcon />
              <span className="truncate">{meeting.company}</span>
            </span>
          )}
        </span>
        {meeting.snippet && <span className="minute-snippet">{meeting.snippet}</span>}
      </a>
      <div className="minute-side">
        {askCompany && !meeting.company && (
          <button type="button" className="company-chip ask" onClick={onCompany}>
            <BuildingIcon />
            Which company?
          </button>
        )}
        <People names={meeting.people} />
      </div>
      <Menu
        trigger={<MoreIcon />}
        label={`Actions for ${meeting.title}`}
        items={items}
        align="end"
        className="minute-menu"
      />
    </li>
  );
}
