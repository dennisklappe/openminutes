import { describe, expect, it } from 'vitest';
import { defaultCustomTemplate, MAX_EXTRA_LENGTH, parseCustomTemplate } from './custom-template.js';

const ok = (input: unknown) => {
  const result = parseCustomTemplate(input);
  if (!result.ok) throw new Error(result.errors.join());
  return result.template;
};

describe('parseCustomTemplate', () => {
  it('accepts its own default and fills missing fields', () => {
    expect(ok(defaultCustomTemplate)).toEqual(defaultCustomTemplate);
    expect(ok({})).toEqual(defaultCustomTemplate);
  });

  it('keeps the section order, fills in missing sections as hidden and trims text', () => {
    const template = ok({
      sections: [
        { id: 'summary', enabled: true, title: '  Samenvatting  ' },
        { id: 'attendees', enabled: false, title: 'Aanwezig' },
      ],
    });
    expect(template.sections.map((s) => s.id)).toEqual([
      'summary',
      'attendees',
      'details',
      'absent',
      'actions',
      'transcript',
    ]);
    expect(template.sections[0]?.title).toBe('Samenvatting');
    expect(template.sections.slice(2).every((s) => !s.enabled)).toBe(true);
  });

  it.each([
    [{ accent: 'red' }, 'accent'],
    [{ font: 'Comic Sans' }, 'font'],
    [{ header: { logo: 'right' } }, 'header.logo'],
    [{ sections: [{ id: 'summary' }, { id: 'summary' }] }, 'sections[1].id'],
    [{ sections: [{ id: 'nope' }] }, 'sections[0].id'],
    [{ extraBefore: 'x'.repeat(MAX_EXTRA_LENGTH + 1) }, 'extraBefore'],
    [{ locale: 'not a locale!' }, 'locale'],
    [{ version: 2 }, 'version'],
    ['text', 'JSON object'],
  ])('rejects %j', (input, field) => {
    const result = parseCustomTemplate(input);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join()).toContain(field);
  });
});
