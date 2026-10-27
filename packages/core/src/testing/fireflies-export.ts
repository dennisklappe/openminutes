import { gzipSync, deflateRawSync } from 'node:zlib';

export interface ArchiveFile {
  name: string;
  data?: Buffer | string;
  /** Tar type flag, a regular file by default. */
  type?: string;
  /** Unix mode in the zip central directory, a regular file by default. */
  mode?: number;
}

const BLOCK = 512;
const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, '0') + '\0';

function tarHeader(name: string, size: number, type: string): Buffer {
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(0o644, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(size, 12), 124);
  header.write(octal(0, 12), 136);
  header.write('        ', 148);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return header;
}

const padded = (data: Buffer) =>
  Buffer.concat([data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK)]);

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body);
  for (let round = 0; round < 3; round++) length = Buffer.byteLength(body) + String(length).length;
  return Buffer.from(`${String(length)}${body}`);
}

/** A .tar.gz with the given entries, names longer than 100 bytes go in a pax header. */
export function tarGz(files: ArchiveFile[]): Buffer {
  const parts = files.flatMap(({ name, data = '', type = '0' }) => {
    const body = Buffer.from(data);
    const long = Buffer.byteLength(name) > 100;
    const record = paxRecord('path', name);
    const pax = long ? [tarHeader('pax', record.length, 'x'), padded(record)] : [];
    return [...pax, tarHeader(long ? 'long' : name, body.length, type), padded(body)];
  });
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(BLOCK * 2)]));
}

/** A zip with the given entries, deflated. */
export function zipArchive(files: ArchiveFile[]): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const { name, data = '', mode = 0o100644 } of files) {
    const raw = Buffer.from(data);
    const packed = deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(0x031e, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE((mode << 16) >>> 0, 38);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

export const SYNTHETIC_AUDIO = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(61)]);

interface SyntheticMeeting {
  id: string;
  folder: string;
  title: string;
  start: string;
  minutes: number;
  attendees: string[];
  speakerMeta?: Record<string, string>;
  rows: { id: number; name: string; time: number; end: number; text: string; confidence: number }[];
  summary: string;
  audio: boolean;
}

export const SYNTHETIC_MEETINGS: SyntheticMeeting[] = [
  {
    id: '01FAKEWEEKLYPLANNING0001',
    folder: 'weekly-planning-october-1-2026-at-900-am-utc',
    title: 'Weekly planning',
    start: '2026-10-01T09:00:00.000Z',
    minutes: 12,
    attendees: [
      'alice@example.com',
      'bob@example.com',
      'ALICE@example.com',
      'notetaker@fireflies.ai',
    ],
    speakerMeta: { '1': 'Alice Example', '2': 'Bob Voorbeeld' },
    rows: [
      {
        id: 0,
        name: 'Speaker 1',
        time: 1.2,
        end: 5.4,
        text: 'Shall we start with the roadmap?',
        confidence: 0.91,
      },
      {
        id: 1,
        name: 'Speaker 2',
        time: 6,
        end: 9.5,
        text: 'Yes, the launch moves to November.',
        confidence: 0.84,
      },
      {
        id: 0,
        name: 'Speaker 1',
        time: 10,
        end: 14,
        text: 'I will update the plan.',
        confidence: 0.88,
      },
    ],
    summary:
      'Alice invited Fireflies.ai here to record & take notes.\n \nType:\n"/ff pause" - pause recording\n \nAI meeting summary:\n- **Roadmap:** The launch moves to November.\n- **Plan:** Alice updates the plan.\n\nNotes:\n📋 **Roadmap** (00:01 - 00:09)\nThe launch moves to November.\n\nAction items:\n**Alice Example**\n- Update the plan (00:10)\n',
    audio: true,
  },
  {
    id: '01FAKEKLANTGESPREK00002',
    folder: 'klantgesprek-october-2-2026-at-1000-am-utc',
    title: 'Klantgesprek',
    start: '2026-10-02T10:00:00.000Z',
    minutes: 5,
    attendees: ['carla@example.com'],
    rows: [
      {
        id: 0,
        name: 'Carla Voorbeeld',
        time: 0.5,
        end: 4,
        text: 'Goedemorgen, hoe kan ik helpen?',
        confidence: 0.77,
      },
      {
        id: 1,
        name: '',
        time: 5,
        end: 8,
        text: 'Ik heb een vraag over de factuur.',
        confidence: 0.66,
      },
    ],
    summary: 'No summary found',
    audio: false,
  },
];

const jsonOf = (value: unknown) => JSON.stringify(value);

/** The files of a small made-up Fireflies export, laid out like a real one. */
export function syntheticExport(meetings = SYNTHETIC_MEETINGS): ArchiveFile[] {
  return meetings.flatMap((m) => {
    const dir = `${m.folder}/`;
    const end = new Date(Date.parse(m.start) + 30 * 60_000).toISOString();
    return [
      ...(m.audio ? [{ name: `${dir}audio.mp3`, data: SYNTHETIC_AUDIO }] : []),
      {
        name: `${dir}transcript.json`,
        data: jsonOf({
          data: m.rows.map((row, index) => ({
            sentence: row.text,
            speaker_id: row.id,
            speaker: row.id,
            speaker_name: row.name,
            time: row.time,
            endTime: row.end,
            averageConfidence: row.confidence,
            index,
            match: 'none',
            incoming: 'false',
          })),
        }),
      },
      ...(m.speakerMeta
        ? [{ name: `${dir}speaker-meta.json`, data: jsonOf({ speakerMeta: m.speakerMeta }) }]
        : []),
      { name: `${dir}transcript-${m.id}.md`, data: '**[1s] Someone:** text\n' },
      { name: `${dir}meeting-summary-${m.id}.txt`, data: m.summary },
      {
        name: `${dir}meeting-metadata-${m.id}.txt`,
        data: jsonOf({
          attendees: m.attendees,
          meetingTitle: m.title,
          meetingStartTime: m.start,
          meetingEndTime: end,
          meetingDuration: m.minutes,
        }),
      },
      { name: `${dir}meeting-url-${m.id}.txt`, data: `https://app.fireflies.ai/view/${m.id}` },
    ];
  });
}
