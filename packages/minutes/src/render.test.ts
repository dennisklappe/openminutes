import { describe, expect, it } from 'vitest';
import { demoMinutes } from './demo.js';
import { POWERED_BY } from './footer.js';
import { renderMinutesHtml } from './render-html.js';
import { renderMinutesMarkdown } from './render-markdown.js';
import { templateIds, templates } from './templates/index.js';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

describe('renderMinutesHtml', () => {
  it.each(templateIds)(
    'lets a three column table size to its content in the %s template',
    (template) => {
      const html = renderMinutesHtml(demoMinutes, {
        template,
        includeTranscript: false,
        timeZone: 'UTC',
      });
      expect(html).toContain('.minutes th, .minutes td { overflow-wrap: normal;');
      expect(html).toContain('.minutes .col-fit { white-space: nowrap; }');
      expect(html).toContain('.minutes .col-cap { max-width: 16rem; overflow-wrap: anywhere; }');
      expect(html).toContain(
        '<th class="col-fit">Owner</th><th class="col-text">Action</th><th class="col-fit">Due</th>',
      );
      expect(html).not.toContain('width: 1%');
    },
  );

  it.each(templateIds)('renders every section with the %s template', (template) => {
    const html = renderMinutesHtml(demoMinutes, {
      template,
      includeTranscript: true,
      logo: { contentType: 'image/png', data: png },
      timeZone: 'UTC',
    });
    expect(html).toContain(`tpl-${template}`);
    expect(html.indexOf('class="logo"')).toBeLessThan(html.indexOf('<h1>'));
    for (const heading of ['Attendees', 'Unable to attend', 'Summary', 'Transcript']) {
      expect(html).toContain(`<h2>${heading}</h2>`);
    }
    expect(html).toContain('Thursday, 12 March 2026');
    expect(html).toContain(template === 'custom' ? '09:30 - 10:12 UTC' : '09:30 to 10:12 UTC');
    expect(html).toContain('Amsterdam office, room Kanaal');
    expect(html).toContain('Daan Jansen <span class="note">declined</span>');
    expect(html).toContain('00:00:10');
    expect(html).toContain(`<a href="${POWERED_BY.url}"`);
  });

  it('names the meeting name of a renamed attendee in both renderers', () => {
    const minutes = {
      ...demoMinutes,
      attendees: [{ name: 'Carla', email: null, joinedAs: 'Marketing Acme' }],
    };
    expect(renderMinutesHtml(minutes, { template: 'classic', includeTranscript: false })).toContain(
      '<li>Carla (Marketing Acme)</li>',
    );
    expect(
      renderMinutesMarkdown(minutes, {
        includeTranscript: false,
        includeChat: false,
        timeZone: 'UTC',
      }),
    ).toContain('- Carla (Marketing Acme)');
  });

  it('orders the sections as in a minutes document', () => {
    const html = renderMinutesHtml(demoMinutes, { template: 'classic', includeTranscript: true });
    const order = ['<h1>', 'Attendees', 'Unable to attend', 'Summary', '<h2>Transcript'].map(
      (needle) => html.indexOf(needle),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('leaves the transcript out unless asked and has no logo without one', () => {
    const html = renderMinutesHtml(demoMinutes, { template: 'modern', includeTranscript: false });
    expect(html).not.toContain('Transcript');
    expect(html).not.toContain('<img');
    expect(html).toContain('Powered by');
  });

  it('escapes meeting content', () => {
    const html = renderMinutesHtml(
      {
        ...demoMinutes,
        title: '<script>alert(1)</script>',
        summary: '**<img src=x onerror=alert(1)>** [x](https://e.com/"><b>)',
        transcript: [{ startMs: 0, endMs: 1, speaker: '<b>', text: '<i>hi</i>' }],
      },
      { template: 'classic', includeTranscript: true },
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<i>hi');
    expect(html).toContain('&lt;script&gt;');
  });

  it('only links http(s) addresses from the summary', () => {
    const html = renderMinutesHtml(
      { ...demoMinutes, summary: '[bad](javascript:alert(1)) [ok](https://example.com/a)' },
      { template: 'classic', includeTranscript: false },
    );
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('href="https://example.com/a"');
  });

  it('shows an empty state without a summary', () => {
    const html = renderMinutesHtml(
      { ...demoMinutes, summary: null },
      { template: 'classic', includeTranscript: false },
    );
    expect(html).toContain('No summary has been generated');
  });

  it('renders task items and ships print styles in every template', () => {
    const html = renderMinutesHtml(
      { ...demoMinutes, summary: '- [ ] Anna: finish the copy' },
      { template: 'compact', includeTranscript: false },
    );
    expect(html).toContain('<li class="task"><span class="box" aria-hidden="true">☐</span>');
    expect(html).toContain('@media print');
    expect(templates).toHaveLength(3);
  });
});

describe('chat in the HTML minutes', () => {
  const minutes = {
    ...demoMinutes,
    chat: [
      {
        sender: 'Eve <b>',
        text: 'Docs: https://example.com/a?x=1&y=2 <script>',
        links: [],
        offsetMs: 65_000,
      },
    ],
  };

  it('lists the chat as bubbles in its own tab with escaped text and a link', () => {
    const html = renderMinutesHtml(minutes, {
      template: 'classic',
      includeTranscript: true,
      includeChat: true,
    });
    expect(html.indexOf('<h2>Transcript</h2>')).toBeLessThan(html.indexOf('<h2>Chat</h2>'));
    expect(html).toContain('id="chat"');
    expect(html).toContain('<time>00:01:05</time>');
    expect(html).toContain('<span class="who">Eve &lt;b&gt;</span>');
    expect(html).toContain(
      '<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">',
    );
    expect(html).not.toContain('<script>');
  });

  it('is left out unless asked for, and when empty, whatever the transcript does', () => {
    const base = { template: 'classic', includeTranscript: true, includeChat: true } as const;
    expect(renderMinutesHtml(minutes, { ...base, includeTranscript: false })).toContain('Chat');
    expect(renderMinutesHtml(minutes, { ...base, includeChat: false })).not.toContain('Chat');
    expect(
      renderMinutesHtml(minutes, { template: 'classic', includeTranscript: true }),
    ).not.toContain('Chat');
    expect(renderMinutesHtml({ ...minutes, chat: [] }, base)).not.toContain('Chat');
  });
});

describe('renderMinutesMarkdown', () => {
  it('adds the chat as plain lines after the transcript', () => {
    const markdown = renderMinutesMarkdown(demoMinutes, {
      includeTranscript: true,
      includeChat: true,
    });
    expect(markdown.indexOf('## Transcript')).toBeLessThan(markdown.indexOf('## Chat'));
    expect(markdown).toContain(
      '**00:00:24** Chloe Martin: Research notes: https://example.com/research',
    );
    expect(
      renderMinutesMarkdown(demoMinutes, { includeTranscript: true, includeChat: false }),
    ).not.toContain('## Chat');
    expect(renderMinutesMarkdown(demoMinutes, { includeTranscript: true })).not.toContain(
      '## Chat',
    );
    expect(
      renderMinutesMarkdown(demoMinutes, { includeTranscript: false, includeChat: true }),
    ).toContain('## Chat');
  });

  it('renders the same sections and the footer', () => {
    const markdown = renderMinutesMarkdown(demoMinutes, {
      includeTranscript: true,
      timeZone: 'UTC',
    });
    expect(markdown).toContain('# Product sync');
    expect(markdown).toContain('## Unable to attend');
    expect(markdown).toContain('- Daan Jansen (declined)');
    expect(markdown).toContain('## Transcript');
    expect(markdown).toContain(`[OpenMinutes](${POWERED_BY.url})`);
    expect(renderMinutesMarkdown(demoMinutes, { includeTranscript: false })).not.toContain(
      '## Transcript',
    );
  });

  it('never prints an email address in the HTML or Markdown', () => {
    const options = { includeTranscript: false, timeZone: 'UTC' } as const;
    for (const output of [
      renderMinutesHtml(demoMinutes, { template: 'classic', ...options }),
      renderMinutesMarkdown(demoMinutes, options),
    ]) {
      expect(output).not.toMatch(/[\w.-]+@[\w-]+\.\w+/);
      expect(output).toContain('Anna de Vries');
    }
  });
});
