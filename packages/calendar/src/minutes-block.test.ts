import { describe, expect, it } from 'vitest';
import { looksLikeHtml, withMinutesLink } from './minutes-block.js';

const url = 'https://om.test/s/abc';
const other = 'https://om.test/s/xyz';

describe('minutes block', () => {
  it('appends a delimited block to a plain description and keeps the text', () => {
    const { content } = withMinutesLink({ content: 'Agenda\n- budget', html: false }, url);
    expect(content).toBe(
      `Agenda\n- budget\n\nMinutes (OpenMinutes): ${url}\nPowered by OpenMinutes`,
    );
  });

  it('writes only the block into an empty description', () => {
    expect(withMinutesLink({ content: '', html: false }, url).content).toBe(
      `Minutes (OpenMinutes): ${url}\nPowered by OpenMinutes`,
    );
  });

  it('appends an HTML block with a clickable link and keeps the markup', () => {
    const { content, html } = withMinutesLink({ content: '<p>Agenda</p>', html: true }, url);
    expect(html).toBe(true);
    expect(content).toBe(
      `<p>Agenda</p><br><br>Minutes (OpenMinutes): <a href="${url}">${url}</a><br><small>Powered by OpenMinutes</small>`,
    );
  });

  it('inserts before the closing body tag of a full HTML document', () => {
    const { content } = withMinutesLink(
      { content: '<html><body><p>Join</p></body></html>', html: true },
      url,
    );
    expect(content).toMatch(
      /<p>Join<\/p><br><br>Minutes \(OpenMinutes\): .*<\/small><\/body><\/html>$/,
    );
  });

  it.each([false, true])('replaces the block instead of duplicating it (html: %s)', (html) => {
    const first = withMinutesLink({ content: html ? '<p>Hi</p>' : 'Hi', html }, url);
    const again = withMinutesLink(first, url);
    expect(again).toEqual(first);
    const moved = withMinutesLink(first, other);
    expect(moved.content.match(/Powered by OpenMinutes/g)).toHaveLength(1);
    expect(moved.content).toContain(other);
    expect(moved.content).not.toContain(url);
    expect(moved.content.startsWith(html ? '<p>Hi</p>' : 'Hi')).toBe(true);
  });

  it('keeps text written after the block', () => {
    const first = withMinutesLink({ content: 'Hi', html: false }, url);
    const edited = { ...first, content: `${first.content}\n\nP.S. bring snacks` };
    expect(withMinutesLink(edited, other).content).toMatch(/P\.S\. bring snacks$/);
  });

  it('escapes the link in HTML', () => {
    const { content } = withMinutesLink({ content: '', html: true }, 'https://om.test/s?a=1&b="2"');
    expect(content).toContain('href="https://om.test/s?a=1&amp;b=&quot;2&quot;"');
  });

  it('tells HTML from plain text', () => {
    expect(looksLikeHtml('line one<br>two')).toBe(true);
    expect(looksLikeHtml('1 < 2 and 3 > 2')).toBe(false);
  });
});
