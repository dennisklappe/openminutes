import type { ExporterDto, MeetingExportDto } from '../src/dto.js';
import { formatDate } from './format.js';
import { DocumentIcon, ExternalIcon, LinkIcon, MoreIcon } from './icons.js';
import { Menu, type MenuItem } from './Menu.js';
import { partsLabel } from './parts.js';

export interface DestinationActions {
  create: () => void;
  update: () => void;
  createCopy: () => void;
  copyLink: () => void;
  revoke: () => void;
}

export function DestinationRow(props: {
  exporter: ExporterDto;
  record: MeetingExportDto | undefined;
  /** What the card is set to include differs from what this output holds. */
  outdated: boolean;
  busy: boolean;
  copied: boolean;
  actions: DestinationActions;
}) {
  const { exporter, record, outdated, busy, copied, actions } = props;
  const isLink = exporter.id === 'share-link';
  const icon = isLink ? <LinkIcon /> : <DocumentIcon />;

  if (!record) {
    return (
      <li className="destination">
        <span className="destination-icon">{icon}</span>
        <button type="button" disabled={busy} title={exporter.description} onClick={actions.create}>
          {busy ? 'Creating...' : `Create ${isLink ? 'shareable link' : exporter.label}`}
        </button>
      </li>
    );
  }

  const items: MenuItem[] = [
    ...(isLink
      ? [
          { label: copied ? 'Copied' : 'Copy link', onSelect: actions.copyLink },
          { label: 'Revoke link', onSelect: actions.revoke, danger: true },
        ]
      : [{ label: 'Create new copy', onSelect: actions.createCopy }]),
  ];

  return (
    <li className="destination exists">
      <span className="destination-icon">{icon}</span>
      <div className="destination-main">
        <a href={record.url} target="_blank" rel="noreferrer">
          {exporter.label}
          <ExternalIcon />
        </a>
        <span className="muted">
          {partsLabel(record)}. Updated {formatDate(record.updatedAt)}
        </span>
      </div>
      <div className="destination-actions">
        {(!isLink || outdated) && (
          <button type="button" disabled={busy} onClick={actions.update}>
            {busy ? 'Updating...' : isLink ? 'Apply include' : 'Update'}
          </button>
        )}
        <Menu
          label={`More for ${exporter.label}`}
          trigger={<MoreIcon />}
          items={items}
          align="end"
        />
      </div>
    </li>
  );
}
