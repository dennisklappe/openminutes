import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, tableColumnClasses } from './markdown.js';

describe('parseMarkdown', () => {
  it('parses headings, paragraphs and both kinds of list', () => {
    const blocks = parseMarkdown(
      '## Summary\n\nFirst line\nsecond line.\n\n## Action items\n\n- Ana: ship it\n- Bo: test\n\n1. One\n2. Two',
    );
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'list']);
    expect(blocks[0]).toMatchObject({ level: 2, inline: [{ text: 'Summary' }] });
    expect(blocks[1]).toMatchObject({ inline: [{ text: 'First line second line.' }] });
    expect(blocks[3]).toMatchObject({
      ordered: false,
      items: [[{ text: 'Ana: ship it' }], [{ text: 'Bo: test' }]],
    });
    expect(blocks[4]).toMatchObject({ ordered: true });
  });

  it('keeps "None" style one-word sections and ignores blank input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('None')).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: 'None' }] },
    ]);
  });
});

describe('parseInline', () => {
  it('parses emphasis, code and http links', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.test/p?q=1)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', text: 'b' },
      { type: 'text', text: ' ' },
      { type: 'em', text: 'c' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'e', href: 'https://x.test/p?q=1' },
    ]);
  });

  it('never produces links for other schemes and leaves HTML as plain text', () => {
    const inline = parseInline(
      '[x](javascript:alert(1)) <img src=x onerror=alert(1)> <script>y</script>',
    );
    expect(inline.some((part) => part.type === 'link')).toBe(false);
    expect(inline.map((part) => part.text).join('')).toContain('<script>y</script>');
  });
});

describe('tables', () => {
  it('parses a GFM table into header and rows', () => {
    const blocks = parseMarkdown(
      '| Owner | Action | Due |\n| --- | --- | --- |\n| Ann | Send **plan** | Friday |\n\nAfter',
    );
    expect(blocks).toHaveLength(2);
    const table = blocks[0];
    expect(table?.type).toBe('table');
    if (table?.type === 'table') {
      expect(table.header).toHaveLength(3);
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0]?.[1]).toContainEqual({ type: 'strong', text: 'plan' });
    }
  });
  it('lets the longest column take the space and short columns hug their content', () => {
    const [block] = parseMarkdown(
      '| Owner | Action | Due |\n| --- | --- | --- |\n| Maximiliaan van der Westhuizen | Send the long plan to everybody | Not specified |',
    );
    if (block?.type !== 'table') throw new Error('not a table');
    expect(tableColumnClasses(block.header, block.rows)).toEqual([
      'col-fit',
      'col-text',
      'col-fit',
    ]);
  });

  it('caps a second long column and works for any column count', () => {
    const [block] = parseMarkdown(
      '| Topic | Decision | Notes | Who |\n| --- | --- | --- | --- |\n| Pricing | A fairly long decision text about the new plan | Another long note that is quite wide indeed and then some more words | Bo |',
    );
    if (block?.type !== 'table') throw new Error('not a table');
    expect(tableColumnClasses(block.header, block.rows)).toEqual([
      'col-fit',
      'col-cap',
      'col-text',
      'col-fit',
    ]);
  });
});
