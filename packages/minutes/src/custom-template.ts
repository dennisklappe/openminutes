export const customFonts = [
  'Arial',
  'Georgia',
  'Times New Roman',
  'Verdana',
  'Trebuchet MS',
] as const;
export const customSectionIds = [
  'details',
  'attendees',
  'absent',
  'summary',
  'actions',
  'transcript',
] as const;
export const customDateFormats = ['full', 'long', 'medium', 'short'] as const;
export const customTimeFormats = ['24h', '12h'] as const;
export const customLogoPlacements = ['left', 'center', 'none'] as const;

export type CustomFont = (typeof customFonts)[number];
export type CustomSectionId = (typeof customSectionIds)[number];
export type CustomDateFormat = (typeof customDateFormats)[number];
export type CustomTimeFormat = (typeof customTimeFormats)[number];
export type CustomLogoPlacement = (typeof customLogoPlacements)[number];

export interface CustomSection {
  id: CustomSectionId;
  enabled: boolean;
  title: string;
}

export interface CustomLabels {
  date: string;
  time: string;
  location: string;
  meeting: string;
}

export interface CustomTemplate {
  version: 1;
  name: string;
  accent: string;
  font: CustomFont;
  header: { logo: CustomLogoPlacement; organisation: string };
  sections: CustomSection[];
  extraBefore: string;
  extraAfter: string;
  dateFormat: CustomDateFormat;
  timeFormat: CustomTimeFormat;
  locale: string;
  labels: CustomLabels;
}

export const MAX_TITLE_LENGTH = 60;
export const MAX_EXTRA_LENGTH = 500;
export const MAX_TEMPLATE_BYTES = 8 * 1024;

export const defaultSectionTitles: Record<CustomSectionId, string> = {
  details: '',
  attendees: 'Attendees',
  absent: 'Unable to attend',
  summary: 'Summary',
  actions: 'Action items',
  transcript: 'Transcript',
};

export const defaultCustomTemplate: CustomTemplate = {
  version: 1,
  name: 'Custom',
  accent: '#2760ab',
  font: 'Arial',
  header: { logo: 'left', organisation: '' },
  sections: customSectionIds.map((id) => ({
    id,
    enabled: true,
    title: defaultSectionTitles[id],
  })),
  extraBefore: '',
  extraAfter: '',
  dateFormat: 'full',
  timeFormat: '24h',
  locale: 'en-GB',
  labels: { date: 'Date', time: 'Time', location: 'Location', meeting: 'Meeting' },
};

export type CustomTemplateResult =
  { ok: true; template: CustomTemplate } | { ok: false; errors: string[] };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  errors: string[],
): T {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
    return value as T;
  errors.push(`${field} must be one of: ${allowed.join(', ')}`);
  return fallback;
}

function text(
  value: unknown,
  fallback: string,
  field: string,
  max: number,
  errors: string[],
): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) {
    errors.push(`${field} must be text of at most ${max} characters`);
    return fallback;
  }
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}

function parseSections(value: unknown, errors: string[]): CustomSection[] {
  if (value === undefined) return defaultCustomTemplate.sections.map((section) => ({ ...section }));
  if (!Array.isArray(value)) {
    errors.push('sections must be a list');
    return [];
  }
  const seen = new Set<string>();
  const sections: CustomSection[] = [];
  value.forEach((raw, index) => {
    const field = `sections[${index}]`;
    if (!isObject(raw)) return void errors.push(`${field} must be an object`);
    const id = oneOf(raw['id'], customSectionIds, 'details', `${field}.id`, errors);
    if (raw['id'] === undefined || seen.has(id)) {
      return void errors.push(`${field}.id is missing or repeated`);
    }
    seen.add(id);
    sections.push({
      id,
      enabled: raw['enabled'] === undefined ? true : raw['enabled'] === true,
      title: text(
        raw['title'],
        defaultSectionTitles[id],
        `${field}.title`,
        MAX_TITLE_LENGTH,
        errors,
      ),
    });
  });
  for (const id of customSectionIds) {
    if (!seen.has(id)) {
      sections.push({ id, enabled: false, title: defaultSectionTitles[id] });
    }
  }
  return sections;
}

function parseLabels(value: unknown, errors: string[]): CustomLabels {
  const defaults = defaultCustomTemplate.labels;
  if (value === undefined) return { ...defaults };
  if (!isObject(value)) {
    errors.push('labels must be an object');
    return { ...defaults };
  }
  const label = (key: keyof CustomLabels) =>
    text(value[key], defaults[key], `labels.${key}`, 30, errors) || defaults[key];
  return {
    date: label('date'),
    time: label('time'),
    location: label('location'),
    meeting: label('meeting'),
  };
}

const supportedLocale = (locale: string) => {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(locale).length > 0;
  } catch {
    return false;
  }
};

export function parseCustomTemplate(input: unknown): CustomTemplateResult {
  const errors: string[] = [];
  if (!isObject(input)) return { ok: false, errors: ['The template must be a JSON object'] };
  if (input['version'] !== undefined && input['version'] !== 1) {
    errors.push('version must be 1');
  }
  const defaults = defaultCustomTemplate;
  const accent = input['accent'] ?? defaults.accent;
  if (typeof accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    errors.push('accent must be a colour like #2760ab');
  }
  const header = input['header'];
  if (header !== undefined && !isObject(header)) errors.push('header must be an object');
  const headerJson = isObject(header) ? header : {};
  const locale = input['locale'] ?? defaults.locale;
  if (typeof locale !== 'string' || !supportedLocale(locale)) {
    errors.push('locale must be a language tag such as en-GB or nl-NL');
  }
  const template: CustomTemplate = {
    version: 1,
    name: text(input['name'], defaults.name, 'name', MAX_TITLE_LENGTH, errors) || defaults.name,
    accent: typeof accent === 'string' ? accent.toLowerCase() : defaults.accent,
    font: oneOf(input['font'], customFonts, defaults.font, 'font', errors),
    header: {
      logo: oneOf(
        headerJson['logo'],
        customLogoPlacements,
        defaults.header.logo,
        'header.logo',
        errors,
      ),
      organisation: text(
        headerJson['organisation'],
        '',
        'header.organisation',
        MAX_TITLE_LENGTH,
        errors,
      ),
    },
    sections: parseSections(input['sections'], errors),
    extraBefore: text(input['extraBefore'], '', 'extraBefore', MAX_EXTRA_LENGTH, errors),
    extraAfter: text(input['extraAfter'], '', 'extraAfter', MAX_EXTRA_LENGTH, errors),
    dateFormat: oneOf(
      input['dateFormat'],
      customDateFormats,
      defaults.dateFormat,
      'dateFormat',
      errors,
    ),
    timeFormat: oneOf(
      input['timeFormat'],
      customTimeFormats,
      defaults.timeFormat,
      'timeFormat',
      errors,
    ),
    locale: typeof locale === 'string' && supportedLocale(locale) ? locale : defaults.locale,
    labels: parseLabels(input['labels'], errors),
  };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, template };
}
