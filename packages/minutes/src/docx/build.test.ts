import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { demoMinutes } from '../demo.js';
import { buildDocx } from './build.js';

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 200,
  0, 0, 0, 100, 8, 6, 0, 0, 0,
]);

function open(options: Parameters<typeof buildDocx>[1], minutes = demoMinutes) {
  const files = unzipSync(buildDocx(minutes, options));
  const read = (name: string) => strFromU8(files[name] ?? new Uint8Array());
  return { files, read, document: read('word/document.xml') };
}

describe('buildDocx', () => {
  it('writes a package with the minutes content in order', () => {
    const { files, document } = open({ template: 'classic', includeTranscript: false });
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/_rels/document.xml.rels',
      'word/_rels/footer1.xml.rels',
      'word/document.xml',
      'word/footer1.xml',
      'word/numbering.xml',
      'word/styles.xml',
    ]);
    const order = [
      'Product sync',
      'Date:',
      'Attendees',
      'Anna de Vries',
      'Unable to attend',
      'Summary',
      'Decisions',
    ];
    const positions = order.map((text) => document.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(document).toContain('Ship the new onboarding flow on ');
    expect(document).toContain('<w:tbl>');
    expect(document).toContain('Finish the pricing page copy');
    expect(document).not.toContain('Transcript');
    expect(document.match(/<w:sectPr>/g)).toHaveLength(1);
  });

  it('renders task items as boxes', () => {
    const { document } = open(
      { template: 'classic', includeTranscript: false },
      { ...demoMinutes, summary: '- [ ] Anna: finish the copy' },
    );
    expect(document).toContain('☐ ');
  });

  it('puts the transcript in a second section on a new page', () => {
    const { document } = open({
      template: 'modern',
      includeTranscript: true,
    });
    expect(document.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(document.indexOf('Transcript')).toBeGreaterThan(document.indexOf('</w:sectPr>'));
    expect(document).toContain('00:00:10');
    expect(document).toContain('Ben Carter: ');
  });

  it('adds a Links section after the transcript', () => {
    const { document, read } = open({
      template: 'modern',
      includeTranscript: true,
      linksTab: true,
      links: [{ label: 'Share link', url: 'https://om.example/s/abc' }],
    });
    expect(document.match(/<w:sectPr>/g)).toHaveLength(3);
    expect(document.indexOf('Links')).toBeGreaterThan(document.indexOf('00:00:10'));
    expect(document).toContain('Shared in the meeting chat');
    expect(read('word/_rels/document.xml.rels')).toContain('https://om.example/s/abc');
  });

  it('has a real footer with the Powered by OpenMinutes link', () => {
    const { read, document } = open({ template: 'modern', includeTranscript: false });
    expect(document).toContain('<w:footerReference w:type="default"');
    expect(read('word/footer1.xml')).toContain('Powered by </w:t>');
    expect(read('word/footer1.xml')).toContain('OpenMinutes');
    expect(read('word/_rels/footer1.xml.rels')).toContain(
      'Target="https://github.com/dennisklappe/openminutes" TargetMode="External"',
    );
  });

  it('adds the chat with clickable links as its own section, with or without the transcript', () => {
    const { document, read } = open({
      template: 'modern',
      includeTranscript: true,
      includeChat: true,
    });
    expect(document.match(/<w:sectPr>/g)).toHaveLength(3);
    expect(document.indexOf('Chat')).toBeGreaterThan(document.indexOf('Transcript'));
    expect(document).toContain('00:00:24');
    expect(document).toContain('Chloe Martin: ');
    expect(read('word/_rels/document.xml.rels')).toContain(
      'Target="https://example.com/research" TargetMode="External"',
    );
    expect(open({ template: 'modern', includeTranscript: true }).document).not.toContain('Chat');
    const chatOnly = open({ template: 'modern', includeTranscript: false, includeChat: true });
    expect(chatOnly.document.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(chatOnly.document).not.toContain('00:00:10');
  });

  it('links the footer to the project and maps templates to fonts', () => {
    const classic = open({ template: 'classic', includeTranscript: false });
    expect(classic.read('word/footer1.xml')).toContain('OpenMinutes');
    expect(classic.read('word/_rels/footer1.xml.rels')).toContain(
      'Target="https://github.com/dennisklappe/openminutes"',
    );
    expect(classic.read('word/styles.xml')).toContain('w:ascii="Georgia"');
    const compact = open({ template: 'compact', includeTranscript: false });
    expect(compact.read('word/styles.xml')).toContain('w:ascii="Arial"');
    expect(compact.read('word/styles.xml')).toContain('w:val="19"');
  });

  it('embeds a png logo first, scaled to its aspect ratio', () => {
    const { files, document } = open({
      template: 'classic',
      includeTranscript: false,
      logo: { contentType: 'image/png', data: png },
    });
    expect(files['word/media/logo.png']).toEqual(png);
    expect(document.indexOf('<w:drawing>')).toBeLessThan(document.indexOf('Product sync'));
    expect(document).toContain('<wp:extent cx="1219200" cy="609600"/>');
  });

  it('skips svg logos and escapes markup in text', () => {
    const files = unzipSync(
      buildDocx(
        { ...demoMinutes, title: 'A & <B>' },
        {
          template: 'classic',
          includeTranscript: false,
          logo: { contentType: 'image/svg+xml', data: new TextEncoder().encode('<svg/>') },
        },
      ),
    );
    expect(Object.keys(files).some((name) => name.startsWith('word/media/'))).toBe(false);
    expect(strFromU8(files['word/document.xml'] ?? new Uint8Array())).toContain(
      'A &amp; &lt;B&gt;',
    );
  });
});
