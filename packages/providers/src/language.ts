import { z } from 'zod';

const LANGUAGES: [code: string, name: string][] = [
  ['en', 'English'],
  ['nl', 'Dutch'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['pl', 'Polish'],
  ['sv', 'Swedish'],
  ['da', 'Danish'],
  ['no', 'Norwegian'],
  ['fi', 'Finnish'],
  ['cs', 'Czech'],
  ['tr', 'Turkish'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
];

/** The empty value (and the legacy "auto") means the provider detects the language itself. */
const isAuto = (value: string | undefined): value is undefined => !value || value === 'auto';

export const languageField = z
  .string()
  .trim()
  .optional()
  .transform((value) => (isAuto(value) ? undefined : value))
  .meta({
    label: 'Language',
    help: 'Auto-detect works for most meetings. Pick a language only when detection gets it wrong.',
    options: [
      { value: '', label: 'Auto-detect (recommended)' },
      ...LANGUAGES.map(([value, label]) => ({ value, label: `${label} (${value})` })),
    ],
  });
