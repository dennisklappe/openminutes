import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { withShareTheme } from './share-theme.js';

describe('share page theme script', () => {
  it('is syntactically valid JavaScript', () => {
    const html = withShareTheme('<html><head></head><body></body></html>');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script as string)).not.toThrow();
  });
});
