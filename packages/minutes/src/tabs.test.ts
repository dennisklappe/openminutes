import { describe, expect, it } from 'vitest';
import { demoMinutes } from './demo.js';
import { linkGroups } from './links.js';
import { renderMinutesHtml } from './render-html.js';
import type { RenderOptions } from './options.js';
import { renderMinutesMarkdown } from './render-markdown.js';

const all: RenderOptions = {
  template: 'classic',
  includeTranscript: true,
  includeChat: true,
  linksTab: true,
  links: [{ label: 'Share link', url: 'https://om.example/s/abc' }],
};
const withSummaryLink = {
  ...demoMinutes,
  summary: `${demoMinutes.summary ?? ''}\n\n## Resources\n\n- [Spec](https://example.com/spec)\n- https://example.com/research`,
};

describe('tabbed html', () => {
  it('renders Minutes, Transcript, Chat and Links as script-free tabs', () => {
    const html = renderMinutesHtml(demoMinutes, all);
    expect(html).not.toContain('<script');
    for (const id of ['minutes', 'transcript', 'chat', 'links']) {
      expect(html).toContain(`id="tab-${id}"`);
      expect(html).toContain(`for="tab-${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('id="tab-minutes" checked');
    const panel = (id: string) =>
      html.slice(html.indexOf(`id="${id}"`)).split('class="tab-panel"')[0] ?? '';
    expect(panel('minutes')).toContain('Decisions');
    expect(panel('minutes')).not.toContain('00:00:10');
    expect(panel('transcript')).toContain('00:00:10');
    expect(panel('transcript')).not.toContain('Research notes');
    expect(panel('chat')).toContain('Research notes');
    expect(panel('links')).toContain('https://om.example/s/abc');
    expect(panel('links')).toContain('https://example.com/research');
    expect(html).toContain('@media print');
    expect(html).toContain('.tab-panel:target');
  });

  it('adds only the tabs asked for', () => {
    const tabs = (options: Partial<RenderOptions>) =>
      [
        ...renderMinutesHtml(demoMinutes, { ...all, ...options }).matchAll(
          /<label for="tab-(\w+)"/g,
        ),
      ].map((m) => m[1]);
    expect(tabs({})).toEqual(['minutes', 'transcript', 'chat', 'links']);
    expect(tabs({ includeChat: false, linksTab: false })).toEqual(['minutes', 'transcript']);
    expect(tabs({ includeTranscript: false, linksTab: false })).toEqual(['minutes', 'chat']);
    expect(tabs({ includeTranscript: false, includeChat: false, linksTab: false })).toEqual([]);
  });

  it('omits the chat tab without messages and the Links tab without anything to list', () => {
    const html = renderMinutesHtml({ ...demoMinutes, chat: [] }, { ...all, links: [] });
    expect(html).not.toContain('id="tab-chat"');
    expect(html).not.toContain('id="tab-links"');
    expect(html).toContain('id="tab-transcript"');
  });

  it('titles the transcript tab', () => {
    const html = renderMinutesHtml(demoMinutes, { ...all, links: [], linksTab: false });
    expect(html).toContain('<label for="tab-transcript">Transcript</label>');
  });
});

describe('links tab content', () => {
  it('lists documents, summary links and chat links once, and needs the Links switch', () => {
    const groups = linkGroups(withSummaryLink, all);
    expect(groups?.documents).toEqual([{ label: 'Share link', url: 'https://om.example/s/abc' }]);
    expect(groups?.summary).toEqual(['https://example.com/spec', 'https://example.com/research']);
    expect(groups?.chat).toEqual([]);
    expect(linkGroups(demoMinutes, all)?.chat).toEqual([
      { sender: 'Chloe Martin', url: 'https://example.com/research' },
    ]);
    expect(linkGroups(demoMinutes, { ...all, linksTab: false })).toBeUndefined();
  });

  it('lists chat links even when the chat itself is not included', () => {
    expect(linkGroups(demoMinutes, { ...all, includeChat: false })?.chat).toHaveLength(1);
  });
});

describe('markdown parts', () => {
  it('puts transcript, chat and links after separators', () => {
    const markdown = renderMinutesMarkdown(demoMinutes, all);
    const rule = markdown.indexOf('\n---\n');
    expect(rule).toBeGreaterThan(markdown.indexOf('## Summary'));
    expect(markdown.indexOf('## Transcript')).toBeGreaterThan(rule);
    expect(markdown.indexOf('## Chat')).toBeGreaterThan(markdown.indexOf('## Transcript'));
    expect(markdown.indexOf('## Links')).toBeGreaterThan(markdown.indexOf('## Chat'));
    expect(markdown).toContain('- Share link: https://om.example/s/abc');
    expect(markdown).toContain('- Chloe Martin: https://example.com/research');
  });

  it('has no extra part when none is asked for', () => {
    const markdown = renderMinutesMarkdown(demoMinutes, {
      ...all,
      includeTranscript: false,
      includeChat: false,
      linksTab: false,
    });
    expect(markdown).not.toContain('## Transcript');
    expect(markdown).not.toContain('## Chat');
    expect(markdown).not.toContain('## Links');
    expect(markdown.match(/\n---\n/g)).toHaveLength(1);
  });
});
