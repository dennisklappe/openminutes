import { minutesFilename } from '../../../packages/minutes/src/filename';
import { at } from './format';
import { slug } from './format';
import { speakersOf, talkOf } from './fakes';
import { docOf, type State } from './state';

export type Format = 'markdown' | 'html' | 'word' | 'transcript-md' | 'transcript-json' | 'audio';

export const FORMATS: [Format, string][] = [
  ['markdown', 'Markdown'],
  ['html', 'HTML'],
  ['word', 'Word'],
  ['transcript-md', 'Transcript only (Markdown)'],
  ['transcript-json', 'Transcript only (JSON)'],
  ['audio', 'Audio'],
];

export interface Download {
  name: string;
  body: BlobPart;
  type: string;
}

const BOT = 'OpenMinutes Notetaker';
const timestamp = (seconds: number) =>
  [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), Math.floor(seconds % 60)]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');

export const shareLink = (id: string) => `https://openminutes.example/s/${id}`;

function source(state: State, id: string) {
  const row = state.rows.find((entry) => entry.id === id);
  if (!row) throw new Error(`No meeting ${id}`);
  const talk = talkOf(id);
  const { versions, active } = docOf(state, id);
  const started = at(-row.hoursAgo);
  return {
    meeting: {
      title: row.title,
      platform: row.platform === 'phone' ? ('recording' as const) : row.platform,
      joinUrl: row.link,
      scheduledStart: null,
      startedAt: started,
      endedAt: new Date(started.getTime() + row.minutes * 60_000),
      location: null,
      invitees: null,
    },
    participants: speakersOf(talk).map((speaker) => ({
      displayName: state.names[speaker] ?? '',
      email: null,
    })),
    botName: BOT,
    summary: versions[active].markdown.replace(/^## /gm, '### '),
    segments: talk.lines.map((line) => ({
      startMs: line.start * 1000,
      endMs: line.end * 1000,
      speaker: state.names[line.speaker],
      text: line.text,
    })),
    chat: talk.chat.map((message) => ({
      sender: state.names[message.who] ?? '',
      text: `${message.text} ${message.href}`,
      links: [message.href],
      offsetMs: message.at * 1000,
    })),
  };
}

function transcriptMarkdown(state: State, id: string): string {
  const { meeting, summary, segments, chat } = source(state, id);
  const entries = [
    ...segments.map((segment) => ({
      at: segment.startMs,
      text: `**${timestamp(segment.startMs / 1000)}** ${segment.speaker}: ${segment.text}`,
    })),
    ...chat.map((message) => ({
      at: message.offsetMs,
      text: `**${timestamp(message.offsetMs / 1000)}** _Chat, ${message.sender}:_ ${message.text}`,
    })),
  ].sort((a, b) => a.at - b.at);
  return [
    `# ${meeting.title}`,
    '',
    summary,
    '',
    '## Transcript',
    '',
    ...entries.flatMap((entry) => [entry.text, '']),
  ].join('\n');
}

function transcriptJson(state: State, id: string): string {
  const { meeting, summary, segments, chat } = source(state, id);
  return JSON.stringify(
    {
      title: meeting.title,
      platform: meeting.platform,
      joinUrl: meeting.joinUrl,
      startedAt: meeting.startedAt.toISOString(),
      endedAt: meeting.endedAt.toISOString(),
      summaries: [{ version: 1, active: true, author: 'ai', content: summary }],
      segments,
      chat,
    },
    null,
    2,
  );
}

async function minutesFile(
  state: State,
  id: string,
  format: 'markdown' | 'html' | 'word',
): Promise<Download> {
  const [{ buildMinutes }, { DEFAULT_TEMPLATE }] = await Promise.all([
    import('../../../packages/minutes/src/build'),
    import('../../../packages/minutes/src/templates/index'),
  ]);
  const minutes = buildMinutes(source(state, id));
  const options = {
    template: DEFAULT_TEMPLATE,
    includeTranscript: state.include.transcript,
    includeChat: state.include.chat,
    linksTab: state.include.links,
    links: state.link ? [{ label: 'Shareable link', url: shareLink(id) }] : [],
  };
  if (format === 'markdown') {
    const { renderMinutesMarkdown } = await import('../../../packages/minutes/src/render-markdown');
    return {
      name: minutesFilename(minutes.title, 'md'),
      body: renderMinutesMarkdown(minutes, options),
      type: 'text/markdown',
    };
  }
  if (format === 'html') {
    const { renderMinutesHtml } = await import('../../../packages/minutes/src/render-html');
    return {
      name: minutesFilename(minutes.title, 'html'),
      body: renderMinutesHtml(minutes, options),
      type: 'text/html',
    };
  }
  const { buildDocx } = await import('../../../packages/minutes/src/docx/build');
  return {
    name: minutesFilename(minutes.title, 'docx'),
    body: new Uint8Array(buildDocx(minutes, options)),
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

export async function exportFile(state: State, id: string, format: Format): Promise<Download> {
  const title = state.rows.find((row) => row.id === id)?.title ?? id;
  if (format === 'transcript-md')
    return {
      name: `${slug(title)}.md`,
      body: transcriptMarkdown(state, id),
      type: 'text/markdown',
    };
  if (format === 'transcript-json')
    return {
      name: `${slug(title)}.json`,
      body: transcriptJson(state, id),
      type: 'application/json',
    };
  if (format === 'audio') {
    const response = await fetch(talkOf(id).src ?? '');
    return { name: `${slug(title)}.mp3`, body: await response.blob(), type: 'audio/mpeg' };
  }
  return minutesFile(state, id, format);
}

export function saveFile({ name, body, type }: Download): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
