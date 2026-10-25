import { MEETING_ID, rows, upcoming, people, type Row, type Upcoming } from './data';
import { talkOf } from './fakes';
import { defaultSettings } from './settings-data';

export type Screen = 'meetings' | 'meeting' | 'library' | 'record' | 'settings';
export type Grouping = 'company' | 'date' | 'person' | 'folders';
export type Platform = 'all' | 'meet' | 'teams';
export type PreviewTab = 'minutes' | 'transcript' | 'chat' | 'links';
export type Editing = 'title' | 'company' | 'summary';
export type Dialog = 'share' | 'sent' | 'rename' | 'speakers' | 'consent';

export interface Include {
  transcript: boolean;
  chat: boolean;
  links: boolean;
}

export interface Version {
  markdown: string;
  note: string;
}

export interface Edit {
  instruction: string;
  before: string;
  after: string;
}

export interface Doc {
  versions: Version[];
  active: number;
  undo: { text: string; previous: number } | null;
  edits: Edit[];
}

export interface Toast {
  text: string;
  restore?: () => void;
}

export interface Recorder {
  recording: boolean;
  paused: boolean;
  elapsed: number;
  speakers: string;
  saved: boolean;
}

export interface State {
  screen: Screen;
  meetingId: string;
  tab: 'transcript' | 'summary';
  showChat: boolean;
  speaker: number | null;
  include: Include;
  link: Include | null;
  docs: Record<string, Doc>;
  ai: { open: boolean; instruction: string; useTranscript: boolean };
  menu: string | null;
  dialog: Dialog | null;
  renaming: number;
  editing: Editing | null;
  draft: string;
  toast: Toast | null;
  rows: Row[];
  upcoming: Upcoming[];
  names: string[];
  recorder: Recorder;
  section: string;
  settings: Record<string, string | boolean>;
  feedback: { panel: string; text: string } | null;
  preview: PreviewTab | null;
  grouping: Grouping;
  collapsed: string[];
  query: string;
  platform: Platform;
  time: number;
  playing: boolean;
}

export const initialState = (): State => ({
  screen: 'meeting',
  meetingId: MEETING_ID,
  tab: 'transcript',
  showChat: true,
  speaker: null,
  include: { transcript: false, chat: false, links: true },
  link: null,
  docs: {},
  ai: { open: false, instruction: '', useTranscript: false },
  menu: null,
  dialog: null,
  renaming: 0,
  editing: null,
  draft: '',
  toast: null,
  rows: rows.map((row) => ({ ...row })),
  upcoming: [...upcoming],
  names: [...people],
  recorder: { recording: false, paused: false, elapsed: 0, speakers: '', saved: false },
  section: 'general',
  settings: defaultSettings(),
  feedback: null,
  preview: null,
  grouping: 'company',
  collapsed: [],
  query: '',
  platform: 'all',
  time: 0,
  playing: false,
});

export const docOf = (state: State, id: string): Doc =>
  (state.docs[id] ??= {
    versions: [{ markdown: talkOf(id).summary, note: 'AI (demo)' }],
    active: 0,
    undo: null,
    edits: [],
  });

export const doc = (state: State): Doc => docOf(state, state.meetingId);

export const currentRow = (state: State): Row =>
  state.rows.find((row) => row.id === state.meetingId) as Row;
