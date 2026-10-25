import type { FolderDto, LibraryMeetingDto } from '../../src/dto.js';
import { FolderIcon, MoreIcon } from '../icons.js';
import { buildFolderTree, type FolderNode } from '../library.js';
import { Menu } from '../Menu.js';
import { Group } from './Group.js';
import { MinuteList, type RowActions } from './MinuteList.js';

export interface FolderActions {
  onCreate: (parent: FolderDto | null) => void;
  onRename: (folder: FolderDto) => void;
  onDelete: (folder: FolderDto) => void;
  onDrop: (meetingId: string, folderId: string | null) => void;
}

interface Props {
  folders: FolderDto[];
  meetings: LibraryMeetingDto[];
  rows: RowActions;
  folderActions: FolderActions;
  isOpen: (id: string, fallback: boolean) => boolean;
  toggle: (id: string, fallback: boolean) => void;
}

function Node({
  node,
  rows,
  folderActions,
  isOpen,
  toggle,
}: { node: FolderNode } & Omit<Props, 'folders' | 'meetings'>) {
  const { folder } = node;
  const id = `folder:${folder.id}`;
  return (
    <Group
      title={folder.name}
      count={node.total}
      icon={<FolderIcon />}
      open={isOpen(id, true)}
      onToggle={() => {
        toggle(id, true);
      }}
      onDropMinute={(meetingId) => {
        folderActions.onDrop(meetingId, folder.id);
      }}
      actions={
        <Menu
          trigger={<MoreIcon />}
          label={`Actions for folder ${folder.name}`}
          align="end"
          items={[
            {
              label: 'New subfolder',
              onSelect: () => {
                folderActions.onCreate(folder);
              },
            },
            {
              label: 'Rename',
              onSelect: () => {
                folderActions.onRename(folder);
              },
            },
            {
              label: 'Delete folder',
              danger: true,
              onSelect: () => {
                folderActions.onDelete(folder);
              },
            },
          ]}
        />
      }
    >
      <div className="group-body">
        {node.meetings.length > 0 && <MinuteList meetings={node.meetings} actions={rows} />}
        {node.children.map((child) => (
          <Node
            key={child.folder.id}
            node={child}
            rows={rows}
            folderActions={folderActions}
            isOpen={isOpen}
            toggle={toggle}
          />
        ))}
        {node.total === 0 && (
          <p className="group-empty muted">Empty. Drag a minute here or use Move to folder.</p>
        )}
      </div>
    </Group>
  );
}

export function FolderView({ folders, meetings, rows, folderActions, isOpen, toggle }: Props) {
  const { roots, unfiled } = buildFolderTree(folders, meetings);
  return (
    <>
      {folders.length === 0 && (
        <div className="panel empty-state">
          <h3>Organise your minutes in folders</h3>
          <p>Create a folder, then drag minutes onto it or use Move to folder in the row menu.</p>
        </div>
      )}
      {roots.map((node) => (
        <Node
          key={node.folder.id}
          node={node}
          rows={rows}
          folderActions={folderActions}
          isOpen={isOpen}
          toggle={toggle}
        />
      ))}
      <Group
        title="Unfiled"
        count={unfiled.length}
        open={isOpen('unfiled', true)}
        onToggle={() => {
          toggle('unfiled', true);
        }}
        onDropMinute={(meetingId) => {
          folderActions.onDrop(meetingId, null);
        }}
      >
        <MinuteList meetings={unfiled} actions={rows} />
      </Group>
    </>
  );
}
