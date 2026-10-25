import { describe, expect, it } from 'vitest';
import { joinActionTable, splitActionTable } from './actionTable.js';

const summary = `## Decisions

- Ship on Friday

## Action items

| Owner | Action | Due |
| --- | --- | --- |
| Ann | Write the docs | 1 Nov |
| Bob | Fix a \\| pipe | |

Thanks all.`;

describe('action table', () => {
  it('splits the text around the table', () => {
    const split = splitActionTable(summary);
    expect(split?.before).toBe('## Decisions\n\n- Ship on Friday\n\n## Action items');
    expect(split?.table.header).toEqual(['Owner', 'Action', 'Due']);
    expect(split?.table.rows).toEqual([
      ['Ann', 'Write the docs', '1 Nov'],
      ['Bob', 'Fix a | pipe', ''],
    ]);
    expect(split?.after).toBe('Thanks all.');
  });

  it('returns null without a table', () => {
    expect(splitActionTable('- one\n- two')).toBeNull();
  });

  it('round trips and drops empty rows', () => {
    const split = splitActionTable(summary);
    if (!split) throw new Error('no table');
    split.table.rows.push(['', '', '']);
    const text = joinActionTable(split);
    expect(splitActionTable(text)).toEqual(splitActionTable(summary));
  });
});
