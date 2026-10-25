import { useCallback, useEffect, useState } from 'react';
import type { FolderDto, LibraryDto, LibraryMeetingDto } from '../../src/dto.js';
import { api, errorMessage, type LibraryFilter } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { BuildingIcon, MoreIcon, PlusIcon } from '../icons.js';
import {
  groupByCompany,
  groupByDate,
  groupByPerson,
  type GroupBy,
  type Section,
} from '../library.js';
import { Menu } from '../Menu.js';
import { useSelection } from '../selection.js';
import { SelectionBar } from '../SelectionBar.js';
import { StoredLinks } from '../StoredLinks.js';
import { BulkMessages, useBulk } from '../useBulk.js';
import {
  CompanyDialog,
  FolderNameDialog,
  MoveDialog,
  RenameCompanyDialog,
} from '../minutes/dialogs.js';
import { FolderView, type FolderActions } from '../minutes/FolderView.js';
import { Group } from '../minutes/Group.js';
import { MinuteList, type RowActions } from '../minutes/MinuteList.js';
import { Toolbar } from '../minutes/Toolbar.js';
import { MINUTES_VIEWS, minutesHref, type MinutesView } from '../minutes/views.js';

const EMPTY_FILTER: LibraryFilter = { q: '', platform: '', from: '', to: '' };
const SEARCH_DELAY_MS = 250;
const OPEN_SECTIONS = 3;
const FEW_SECTIONS = 8;

type Dialog =
  | { kind: 'move'; meeting: LibraryMeetingDto }
  | { kind: 'company'; meeting: LibraryMeetingDto }
  | { kind: 'folder-create'; parent: FolderDto | null }
  | { kind: 'folder-rename'; folder: FolderDto }
  | { kind: 'company-rename'; company: string };

function useLibrary(filter: LibraryFilter) {
  const [data, setData] = useState<LibraryDto>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    api.library(filter).then(
      (next) => {
        if (!current) return;
        setData(next);
        setError(undefined);
      },
      (failure: unknown) => {
        if (current) setError(errorMessage(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [filter, version]);

  const reload = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);
  return { data, error, reload };
}

const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'auto', label: 'Group: automatic' },
  { value: 'day', label: 'Group: per day' },
  { value: 'week', label: 'Group: per week' },
  { value: 'month', label: 'Group: per month' },
];

function GroupSelect({ value, onChange }: { value: GroupBy; onChange: (next: GroupBy) => void }) {
  return (
    <select
      aria-label="Group by"
      value={value}
      onChange={(e) => {
        onChange(e.target.value as GroupBy);
      }}
    >
      {GROUPS.map((group) => (
        <option key={group.value} value={group.value}>
          {group.label}
        </option>
      ))}
    </select>
  );
}

function ViewSwitch({ view }: { view: MinutesView }) {
  return (
    <nav className="segmented view-switch" aria-label="Sort minutes">
      {MINUTES_VIEWS.map(({ id, label }) => (
        <a key={id} href={minutesHref(id)} aria-current={id === view ? 'page' : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}

export function Minutes({ view }: { view: MinutesView }) {
  const [draft, setDraft] = useState(EMPTY_FILTER);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [groupBy, setGroupBy] = useState<GroupBy>('auto');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<Dialog>();
  const [failure, setFailure] = useState<string>();
  const { data, error, reload } = useLibrary(filter);
  const confirm = useConfirm();
  const selection = useSelection();
  const bulk = useBulk(() => {
    selection.stop();
    reload();
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter(draft);
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft]);

  const run = (action: () => Promise<unknown>) =>
    action().then(
      () => {
        setFailure(undefined);
        reload();
      },
      (problem: unknown) => {
        setFailure(errorMessage(problem));
        throw problem;
      },
    );
  const attempt = (action: () => Promise<unknown>) => {
    run(action).catch(() => undefined);
  };

  const isOpen = (id: string, fallback: boolean) => overrides[id] ?? fallback;
  const toggle = (id: string, fallback: boolean) => {
    setOverrides((current) => ({ ...current, [id]: !isOpen(id, fallback) }));
  };

  const rows: RowActions = {
    selecting: selection.active,
    selected: selection.ids,
    onToggle: selection.toggle,
    onArchive: (meeting) => {
      void bulk.run('archive', [meeting]);
    },
    onDelete: (meeting) => {
      void bulk.run('delete', [meeting]);
    },
    draggable: view === 'folders',
    askCompany: view === 'company',
    onMove: (meeting) => {
      setDialog({ kind: 'move', meeting });
    },
    onCompany: (meeting) => {
      setDialog({ kind: 'company', meeting });
    },
  };

  const folderActions: FolderActions = {
    onCreate: (parent) => {
      setDialog({ kind: 'folder-create', parent });
    },
    onRename: (folder) => {
      setDialog({ kind: 'folder-rename', folder });
    },
    onDrop: (meetingId, folderId) => {
      attempt(() => api.moveToFolder(meetingId, folderId));
    },
    onDelete: (folder) => {
      void confirm({
        title: `Delete ${folder.name}?`,
        body: (
          <p>
            The folder is removed. Its minutes are not deleted, they move up one level
            {folder.parentId ? '' : ' to Unfiled'}.
          </p>
        ),
        confirmLabel: 'Delete folder',
        destructive: true,
      }).then((confirmed) => {
        if (confirmed) attempt(() => api.deleteFolder(folder.id));
      });
    },
  };

  const filtered = Object.values(filter).some(Boolean);
  const meetings = data?.meetings ?? [];
  const chosen = meetings.filter((meeting) => selection.ids.has(meeting.id));

  const sections = (): Section[] =>
    view === 'date'
      ? groupByDate(meetings, groupBy)
      : view === 'company'
        ? groupByCompany(meetings)
        : groupByPerson(meetings);

  const renderSection = (section: Section, index: number, list: Section[]) => {
    const id = `${view}:${section.key}`;
    const fallback = index < OPEN_SECTIONS || list.length <= FEW_SECTIONS;
    const unknown = view === 'company' && section.key === '';
    return (
      <Group
        key={id}
        title={section.label}
        count={section.meetings.length}
        icon={view === 'company' ? <BuildingIcon /> : undefined}
        open={isOpen(id, fallback)}
        onToggle={() => {
          toggle(id, fallback);
        }}
        {...(unknown && {
          note: (
            <p className="group-note muted">
              We could not tell which company these minutes belong to. Answer Which company? on a
              minute and it moves to that company.
            </p>
          ),
        })}
        {...(view === 'company' &&
          !unknown && {
            actions: (
              <Menu
                trigger={<MoreIcon />}
                label={`Actions for ${section.label}`}
                align="end"
                items={[
                  {
                    label: 'Rename or merge',
                    onSelect: () => {
                      setDialog({ kind: 'company-rename', company: section.label });
                    },
                  },
                ]}
              />
            ),
          })}
      >
        <MinuteList meetings={section.meetings} actions={rows} />
      </Group>
    );
  };

  const close = () => {
    setDialog(undefined);
  };

  const body = () => {
    if (!data) return error ? null : <p className="muted">Loading</p>;
    if (data.meetings.length === 0 && view !== 'folders') {
      return filtered ? (
        <div className="panel empty-state">
          <h3>No minutes match</h3>
          <p>Try a different search, or clear the filters.</p>
          <button
            onClick={() => {
              setDraft(EMPTY_FILTER);
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="panel empty-state">
          <h3>No minutes yet</h3>
          <p>A meeting shows up here as soon as it has a transcript.</p>
          <a className="button" href="#/">
            Go to meetings
          </a>
        </div>
      );
    }
    if (view === 'folders') {
      return (
        <FolderView
          folders={data.folders}
          meetings={data.meetings}
          rows={rows}
          folderActions={folderActions}
          isOpen={isOpen}
          toggle={toggle}
        />
      );
    }
    return sections().map(renderSection);
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Minutes</h1>
          <p className="lede">Every meeting with a transcript, sorted the way you look for it.</p>
        </div>
        {view === 'folders' && (
          <button
            className="primary"
            onClick={() => {
              folderActions.onCreate(null);
            }}
          >
            <PlusIcon />
            New folder
          </button>
        )}
      </header>
      <div className="minutes-controls">
        <ViewSwitch view={view} />
        {view === 'date' && <GroupSelect value={groupBy} onChange={setGroupBy} />}
        {meetings.length > 0 && !selection.active && (
          <button className="link" onClick={selection.start}>
            Select
          </button>
        )}
      </div>
      <Toolbar filter={draft} onFilter={setDraft} />
      {(failure ?? error) && <p className="banner banner-error">{failure ?? error}</p>}
      <BulkMessages bulk={bulk} />
      {selection.active && (
        <SelectionBar
          count={chosen.length}
          actions={[
            {
              label: 'Archive',
              onClick: () => {
                void bulk.run('archive', chosen);
              },
            },
            {
              label: 'Delete',
              danger: true,
              onClick: () => {
                void bulk.run('delete', chosen);
              },
            },
          ]}
          onCancel={selection.stop}
        />
      )}
      {data && (
        <p className="minutes-count muted">
          {data.meetings.length} {data.meetings.length === 1 ? 'minute' : 'minutes'}
        </p>
      )}
      <div className="groups">{body()}</div>

      {dialog?.kind === 'move' && (
        <MoveDialog
          meeting={dialog.meeting}
          folders={data?.folders ?? []}
          onMove={(folderId) => run(() => api.moveToFolder(dialog.meeting.id, folderId))}
          onClose={close}
        />
      )}
      {dialog?.kind === 'company' && (
        <CompanyDialog
          meeting={dialog.meeting}
          suggestions={data?.companies ?? []}
          onSave={(company) => run(() => api.setCompany(dialog.meeting.id, company))}
          onClose={close}
        />
      )}
      {dialog?.kind === 'folder-create' && (
        <FolderNameDialog
          title={dialog.parent ? `New folder in ${dialog.parent.name}` : 'New folder'}
          initial=""
          submitLabel="Create"
          onSubmit={(name) =>
            run(() => api.createFolder({ name, parentId: dialog.parent?.id ?? null }))
          }
          onClose={close}
        />
      )}
      {dialog?.kind === 'folder-rename' && (
        <FolderNameDialog
          title="Rename folder"
          initial={dialog.folder.name}
          submitLabel="Rename"
          onSubmit={(name) => run(() => api.renameFolder(dialog.folder.id, name))}
          onClose={close}
        />
      )}
      {dialog?.kind === 'company-rename' && (
        <RenameCompanyDialog
          company={dialog.company}
          companies={data?.companies ?? []}
          onSubmit={(to) => run(() => api.renameCompany({ from: dialog.company, to }))}
          onClose={close}
        />
      )}
      <StoredLinks route="/minutes" where="page" />
    </>
  );
}
