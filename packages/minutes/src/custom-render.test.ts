import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildDocx } from './docx/build.js';
import { demoMinutes } from './demo.js';
import { defaultCustomTemplate, parseCustomTemplate } from './custom-template.js';
import { renderMinutesHtml } from './render-html.js';
import { renderMinutesMarkdown } from './render-markdown.js';

const parsed = parseCustomTemplate({
  accent: '#0f7b5f',
  font: 'Georgia',
  header: { logo: 'center', organisation: 'Acme <b>BV</b>' },
  sections: [
    { id: 'details', enabled: true, title: '' },
    { id: 'summary', enabled: true, title: 'Samenvatting' },
    { id: 'actions', enabled: true, title: 'Actiepunten' },
    { id: 'attendees', enabled: true, title: 'Aanwezig' },
    { id: 'absent', enabled: false, title: 'Afwezig' },
    { id: 'transcript', enabled: true, title: 'Gespreksverslag' },
  ],
  extraBefore: 'Vertrouwelijk <script>',
  extraAfter: 'Contact: secretariaat',
  dateFormat: 'long',
  locale: 'nl-NL',
  labels: { date: 'Datum', time: 'Tijd', location: 'Locatie', meeting: 'Vergadering' },
});
if (!parsed.ok) throw new Error(parsed.errors.join());
const options = {
  template: 'custom',
  custom: parsed.template,
  includeTranscript: true,
  timeZone: 'UTC',
} as const;

const at = (text: string, needle: string) => text.indexOf(needle);
const ascending = (values: number[]) =>
  values.every((value) => value >= 0) &&
  values.every((v, i) => i === 0 || v > (values[i - 1] ?? 0));

describe('custom template', () => {
  it('orders, renames and hides sections in HTML and escapes everything', () => {
    const html = renderMinutesHtml(demoMinutes, options);
    expect(
      ascending(['Datum', 'Samenvatting', 'Actiepunten', 'Aanwezig'].map((n) => at(html, n))),
    ).toBe(true);
    expect(html.lastIndexOf('Gespreksverslag')).toBeGreaterThan(at(html, 'Contact: secretariaat'));
    expect(html).not.toContain('Unable to attend');
    expect(html).toContain('12 maart 2026');
    expect(html).toContain('--accent: #0f7b5f');
    expect(html).toContain('Georgia');
    expect(html).toContain('Acme &lt;b&gt;BV&lt;/b&gt;');
    expect(html).toContain('Vertrouwelijk &lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html).toContain('<table>');
    expect(html).toContain('class="powered"');
  });

  it('moves the action items out of the summary', () => {
    const html = renderMinutesHtml(demoMinutes, options);
    const summary = html.slice(at(html, 'Samenvatting'), at(html, 'Actiepunten'));
    expect(summary).toContain('Decisions');
    expect(summary).not.toContain('Finish the pricing page copy');
    expect(html.slice(at(html, 'Actiepunten'))).toContain('Finish the pricing page copy');
  });

  it('never injects an unsafe accent or font into the style block', () => {
    const html = renderMinutesHtml(demoMinutes, {
      ...options,
      custom: { ...defaultCustomTemplate, accent: 'red;}</style><script>', font: 'x' as never },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain(`--accent: ${defaultCustomTemplate.accent}`);
  });

  it('renders the same layout as Markdown', () => {
    const markdown = renderMinutesMarkdown(demoMinutes, options);
    expect(
      ascending(
        [
          '**Datum:**',
          '## Samenvatting',
          '## Actiepunten',
          '## Aanwezig',
          '## Gespreksverslag',
        ].map((n) => at(markdown, n)),
      ),
    ).toBe(true);
    expect(markdown).not.toContain('Afwezig');
    expect(markdown).toContain('Contact: secretariaat');
    expect(markdown).toContain('| Owner | Action | Due |');
  });

  it('renders the same layout as Word with the template font and a real table', () => {
    const files = unzipSync(buildDocx(demoMinutes, options));
    const document = strFromU8(files['word/document.xml'] ?? new Uint8Array());
    const styles = strFromU8(files['word/styles.xml'] ?? new Uint8Array());
    expect(styles).toContain('w:ascii="Georgia"');
    expect(styles).toContain('0F7B5F');
    expect(document).toContain('<w:tbl>');
    expect(ascending(['Samenvatting', 'Actiepunten', 'Aanwezig'].map((n) => at(document, n)))).toBe(
      true,
    );
    expect(document).not.toContain('Afwezig');
    expect(document).toContain('Acme &lt;b&gt;BV&lt;/b&gt;');
  });

  it('leaves the built-in templates unchanged by it', () => {
    const html = renderMinutesHtml(demoMinutes, { template: 'classic', includeTranscript: false });
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).toContain('Action items');
  });
});
