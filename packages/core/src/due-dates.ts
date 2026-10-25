const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  zondag: 0,
  maandag: 1,
  dinsdag: 2,
  woensdag: 3,
  donderdag: 4,
  vrijdag: 5,
  zaterdag: 6,
};

const RELATIVE: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  vandaag: 0,
  morgen: 1,
  morgenochtend: 1,
  morgenmiddag: 1,
  morgenavond: 1,
};

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  nl: ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
};

const DUTCH_WORDS = new Set([
  ...Object.keys(WEEKDAYS).filter((word) => /dag$/.test(word)),
  'vandaag',
  'morgen',
  'morgenochtend',
  'morgenmiddag',
  'morgenavond',
]);

const NEXT_WORDS = new Set(['next', 'volgende']);
const DAY_WORDS = [...Object.keys(WEEKDAYS), ...Object.keys(RELATIVE)].join('|');
const DAY_PHRASE = new RegExp(
  `(?<![\\p{L}\\d])((?:(next|this|coming|volgende|komende|aanstaande|deze)\\s+)?(${DAY_WORDS}))(?![\\p{L}\\d])`,
  'giu',
);
const SKIP = /\d|\b(?:weeks?|weken|every|each|elke|iedere|weekly|wekelijks)\b/i;
const DUE_HEADER = /^(?:due|due date|deadline|uiterlijk|termijn|vervaldatum)$/i;
const CELL_SEPARATOR = /(?<!\\)\|/;

export interface DateContext {
  date: Date;
  timeZone?: string | undefined;
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

function calendarDay({ date, timeZone }: DateContext): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone && { timeZone }),
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

const toUtc = ({ year, month, day }: CalendarDay) => new Date(Date.UTC(year, month - 1, day));

export function describeMeetingDate(context: DateContext): string {
  const day = toUtc(calendarDay(context));
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    day,
  );
  const zone = context.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${weekday} ${day.getUTCDate()} ${MONTHS.en[day.getUTCMonth()]} ${day.getUTCFullYear()} (time zone ${zone})`;
}

function resolveDay(word: string, modifier: string | undefined, meeting: Date): Date | null {
  const relative = RELATIVE[word];
  if (relative !== undefined) {
    return modifier ? null : new Date(meeting.getTime() + relative * 86_400_000);
  }
  const target = WEEKDAYS[word];
  if (target === undefined) return null;
  const current = meeting.getUTCDay();
  const ahead = (target - current + 7) % 7;
  if (modifier && NEXT_WORDS.has(modifier)) {
    const mondayOffset = (8 - current) % 7 || 7;
    const nextWeek = mondayOffset + ((target + 6) % 7);
    return new Date(meeting.getTime() + nextWeek * 86_400_000);
  }
  if (ahead === 0) return null;
  return new Date(meeting.getTime() + ahead * 86_400_000);
}

function addDate(cell: string, meeting: Date): string {
  if (SKIP.test(cell)) return cell;
  const matches = [...cell.matchAll(DAY_PHRASE)];
  const [match] = matches;
  if (matches.length !== 1 || !match?.[1] || !match[3]) return cell;
  const word = match[3].toLowerCase();
  const day = resolveDay(word, match[2]?.toLowerCase(), meeting);
  if (!day) return cell;
  const months = DUTCH_WORDS.has(word) ? MONTHS.nl : MONTHS.en;
  const end = match.index + match[1].length;
  const label = ` (${day.getUTCDate()} ${months[day.getUTCMonth()]})`;
  return cell.slice(0, end) + label + cell.slice(end);
}

export function addDueDates(markdown: string, context: DateContext): string {
  const meeting = toUtc(calendarDay(context));
  let dueColumn = -1;
  return markdown
    .split('\n')
    .map((line) => {
      if (!line.trimStart().startsWith('|')) {
        dueColumn = -1;
        return line;
      }
      const cells = line.split(CELL_SEPARATOR);
      if (dueColumn < 0) {
        dueColumn = cells.findIndex((cell) => DUE_HEADER.test(cell.trim()));
        return line;
      }
      if (dueColumn >= cells.length - 1 || /^[\s:|-]*$/.test(line)) return line;
      cells[dueColumn] = addDate(cells[dueColumn] ?? '', meeting);
      return cells.join('|');
    })
    .join('\n');
}
