import { describe, expect, it } from 'vitest';
import { markdownToHtml, parseMarkdown, tableColumnClasses } from './markdown.js';
import { splitActions } from './summary-split.js';

const table =
  '| Owner | Action | Due |\n| --- | :---: | ---: |\n| Anna | **Ship** it | Friday |\n| Ben | a \\| b | |';

describe('markdown tables', () => {
  it('parses header, rows and inline formatting', () => {
    const [block] = parseMarkdown(table);
    expect(block).toMatchObject({ type: 'table' });
    if (block?.type !== 'table') return;
    expect(block.header.map((cell) => cell[0])).toEqual([
      { type: 'text', text: 'Owner' },
      { type: 'text', text: 'Action' },
      { type: 'text', text: 'Due' },
    ]);
    expect(block.rows).toHaveLength(2);
    expect(block.rows[0]?.[1]?.[0]).toEqual({ type: 'strong', text: 'Ship' });
    expect(block.rows[1]?.[1]).toEqual([{ type: 'text', text: 'a | b' }]);
    expect(block.rows[1]?.[2]).toEqual([]);
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

  it('renders an escaped HTML table between other blocks', () => {
    const html = markdownToHtml(`Intro\n\n${table.replace('Anna', '<b>Anna')}\n\n- after`);
    expect(html).toContain('<p>Intro</p>');
    expect(html).toContain(
      '<div class="table-wrap"><table><thead><tr><th class="col-text">Owner</th>',
    );
    expect(html).toContain('<td class="col-text">&lt;b&gt;Anna</td>');
    expect(html).toContain('<ul><li>after</li></ul>');
  });

  it('does not treat a lone pipe line as a table', () => {
    expect(parseMarkdown('a | b\nplain text')).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: 'a | b plain text' }] },
    ]);
  });
});

describe('splitActions', () => {
  const summary =
    '### Decisions\n\n- one\n\n### Action items\n\n| A | B |\n| - | - |\n| x | y |\n\n### Open questions\n\n- q';

  it('takes the action items section out of the summary', () => {
    const { summary: rest, actions } = splitActions(summary);
    expect(actions).toBe('| A | B |\n| - | - |\n| x | y |');
    expect(rest).toBe('### Decisions\n\n- one\n\n### Open questions\n\n- q');
  });

  it('returns the summary untouched when there are no action items', () => {
    expect(splitActions('### Decisions\n\n- one')).toEqual({
      summary: '### Decisions\n\n- one',
      actions: '',
    });
  });
});

describe('bare URLs', () => {
  it('turns a plain URL into a link and keeps trailing punctuation outside it', () => {
    const [block] = parseMarkdown('See https://example.com/a?b=1&c=2, then stop.');
    expect(block).toMatchObject({
      type: 'paragraph',
      inline: [
        { type: 'text', text: 'See ' },
        { type: 'link', href: 'https://example.com/a?b=1&c=2' },
        { type: 'text', text: ', then stop.' },
      ],
    });
  });

  it('does not double-link an explicit markdown link', () => {
    const [block] = parseMarkdown('[docs](https://example.com/docs)');
    expect(block).toMatchObject({
      inline: [{ type: 'link', text: 'docs', href: 'https://example.com/docs' }],
    });
  });
});
