import { describe, expect, it } from 'vitest';
import { demoMinutes } from './demo.js';
import { ExporterRegistry, type Exporter } from './exporter.js';
import { createBuiltinExporters } from './exporters/index.js';
import { minutesFilename } from './filename.js';

const options = { template: 'classic', includeTranscript: false } as const;

describe('ExporterRegistry', () => {
  it('registers, finds and lists exporters and refuses duplicates', () => {
    const registry = new ExporterRegistry();
    const exporter: Exporter = {
      id: 'x',
      label: 'X',
      description: '',
      export: () => Promise.resolve({ kind: 'message', text: 'done' }),
    };
    registry.register(exporter);
    expect(registry.get('x')).toBe(exporter);
    expect(registry.get('y')).toBeUndefined();
    expect(registry.list()).toEqual([exporter]);
    expect(() => registry.register(exporter)).toThrow('already registered');
  });

  it('delegates grantAccess only to exporters that support it', async () => {
    const base = {
      label: '',
      description: '',
      export: () => Promise.resolve({ kind: 'message', text: '' } as const),
    };
    const registry = new ExporterRegistry().register({ ...base, id: 'plain' }).register({
      ...base,
      id: 'doc',
      grantAccess: ({ emails }) => Promise.resolve({ granted: emails, failed: [] }),
    });
    const input = { meetingId: 'm', url: 'https://docs.example/1', emails: ['a@example.com'] };
    expect(registry.grantAccess('plain', input)).toBeUndefined();
    expect(registry.grantAccess('missing', input)).toBeUndefined();
    await expect(registry.grantAccess('doc', input)).resolves.toEqual({
      granted: ['a@example.com'],
      failed: [],
    });
  });

  it('ships html, markdown and word file exporters', async () => {
    const registry = createBuiltinExporters();
    expect(registry.list().map((e) => e.id)).toEqual(['html', 'markdown', 'word']);
    const html = await registry
      .get('html')
      ?.export({ meetingId: 'm', minutes: demoMinutes, options });
    expect(html).toMatchObject({
      kind: 'file',
      filename: 'product-sync-minutes.html',
      contentType: 'text/html; charset=utf-8',
    });
    const md = await registry
      .get('markdown')
      ?.export({ meetingId: 'm', minutes: demoMinutes, options });
    expect(md).toMatchObject({ kind: 'file', filename: 'product-sync-minutes.md' });
  });

  it('names files from the title', () => {
    expect(minutesFilename('  Q1 / Plan!! ', 'md')).toBe('q1-plan-minutes.md');
    expect(minutesFilename('???', 'md')).toBe('meeting-minutes.md');
  });
});
