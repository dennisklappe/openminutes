export const languages: [code: string, name: string][] = [
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

export const languageName = (code: string): string =>
  languages.find(([value]) => value === code)?.[1] ?? code;

export function filterLanguages(query: string): [code: string, name: string][] {
  const needle = query.trim().toLowerCase();
  return languages.filter(
    ([code, name]) => needle === '' || code === needle || name.toLowerCase().includes(needle),
  );
}
