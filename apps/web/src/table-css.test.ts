import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../ui/styles.css', import.meta.url), 'utf8');

describe('markdown table css', () => {
  it('sizes columns to content without percentage widths', () => {
    expect(css).toContain('.markdown .table .col-fit {\n  white-space: nowrap;');
    expect(css).toContain('.markdown .table .col-cap {\n  max-width: 16rem;');
    expect(css).toContain('.markdown .table .col-text {\n    min-width: 14rem;');
    expect(css).not.toContain('min-width: 40%');
  });
});
