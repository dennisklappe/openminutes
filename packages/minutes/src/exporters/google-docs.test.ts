import { describe, expect, it } from 'vitest';
import { demoMinutes } from '../demo.js';
import { createGoogleDocsExporter, type GoogleDocsContext } from './google-docs.js';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

const endpoints = {
  docs: 'https://docs.test/v1',
  drive: 'https://drive.test/v3',
  upload: 'https://upload.test/v3',
};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

interface Behaviour {
  existingTabs?: number;
  refuseFooter?: boolean;
  existingFooters?: boolean;
  /** Real Google shape: nothing follows a table but the tab's final paragraph. */
  textAfterTable?: boolean;
}

function harness(context: Partial<GoogleDocsContext> = {}, behaviour: Behaviour = {}) {
  const {
    existingTabs = 1,
    refuseFooter = false,
    existingFooters = false,
    textAfterTable = false,
  } = behaviour;
  const calls: Call[] = [];
  let tabs = existingTabs;
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const raw = init?.body;
    const body = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
    calls.push({ method: init?.method ?? 'GET', url, body });
    if (url === `${endpoints.docs}/documents`)
      return Promise.resolve(reply({ documentId: 'doc1' }));
    if (url.includes('/documents/doc1?') && url.includes('body%2Fcontent)')) {
      return Promise.resolve(
        reply({
          tabs: [
            {
              tabProperties: { tabId: 't0' },
              documentTab: {
                body: {
                  content: [
                    {
                      startIndex: 100,
                      endIndex: 140,
                      table: {
                        tableRows: [0, 1, 2, 3].map((row) => ({
                          tableCells: [0, 1, 2].map((cell) => ({
                            content: [{ startIndex: 102 + row * 10 + cell * 3 }],
                          })),
                        })),
                      },
                    },
                    ...(textAfterTable ? [{ startIndex: 140, endIndex: 141 }] : []),
                    {
                      startIndex: textAfterTable ? 141 : 140,
                      endIndex: textAfterTable ? 142 : 141,
                    },
                  ],
                },
              },
            },
          ],
        }),
      );
    }
    if (url.includes('/documents/doc1?')) {
      return Promise.resolve(
        reply({
          tabs: Array.from({ length: tabs }, (_, i) => ({
            tabProperties: { tabId: `t${i}` },
            documentTab: {
              body: { content: [{ endIndex: i === 0 && existingTabs > 1 ? 30 : 1 }] },
              ...(existingFooters && {
                documentStyle: { defaultFooterId: `old${i}` },
                footers: { [`old${i}`]: { content: [{ endIndex: 24 }] } },
              }),
            },
          })),
        }),
      );
    }
    if (url.endsWith(':batchUpdate')) {
      const requests = (body as { requests: object[] }).requests;
      if (requests.some((r) => 'addDocumentTab' in r)) tabs += 1;
      if (refuseFooter && requests.some((r) => 'createFooter' in r)) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'No footers' } }), { status: 400 }),
        );
      }
      return Promise.resolve(
        reply({
          replies: requests.map((r, i) =>
            'createFooter' in r ? { createFooter: { footerId: `foot${i}` } } : {},
          ),
        }),
      );
    }
    if (url.startsWith(endpoints.upload)) return Promise.resolve(reply({ id: 'logo1' }));
    return Promise.resolve(reply({}));
  };
  const exporter = createGoogleDocsExporter({
    fetch: fetchImpl,
    endpoints,
    resolve: () =>
      Promise.resolve({
        accessToken: 'tok',
        accountEmail: 'bot@example.com',
        ownerEmail: 'owner@example.com',
        ...context,
      }),
  });
  return { calls, exporter };
}

const options = {
  template: 'modern',
  includeTranscript: true,
} as const;
const plain = { ...demoMinutes, summary: '- one point' };
const batches = (calls: Call[]) =>
  calls
    .filter((c) => c.url.endsWith(':batchUpdate'))
    .map((c) => (c.body as { requests: Record<string, unknown>[] }).requests);

describe('google docs exporter', () => {
  it('creates a doc with a transcript tab and shares it only with the owner', async () => {
    const { calls, exporter } = harness();
    const outcome = await exporter.export({ meetingId: 'm', minutes: plain, options });
    expect(outcome).toMatchObject({
      kind: 'link',
      url: 'https://docs.google.com/document/d/doc1/edit',
      ref: 'doc1',
    });
    expect(calls[0]).toMatchObject({ method: 'POST', body: { title: 'Product sync' } });
    const [addTab, , , content] = batches(calls);
    expect(addTab).toEqual([{ addDocumentTab: { tabProperties: { title: 'Transcript' } } }]);
    const insert = content?.find((r) => 'insertText' in r) as {
      insertText: { text: string; location: object };
    };
    expect(insert.insertText.text).toContain('Product sync\nDate: Thursday, 12 March 2026');
    expect(insert.insertText.text).not.toContain('Powered by OpenMinutes');
    expect(insert.insertText.text).not.toContain('00:00:10');
    const inserts = content?.filter((r) => 'insertText' in r) as {
      insertText: { text: string; location: { tabId: string } };
    }[];
    expect(inserts.map((i) => i.insertText.location.tabId)).toEqual(['t0', 't1']);
    expect(inserts[1]?.insertText.text).toContain('00:00:10  Ben Carter: Testing went well');
    expect(JSON.stringify(content)).toContain('BULLET_DISC_CIRCLE_SQUARE');
    const share = calls.at(-1);
    expect(share).toMatchObject({
      method: 'POST',
      url: `${endpoints.drive}/files/doc1/permissions?sendNotificationEmail=false`,
      body: { type: 'user', role: 'writer', emailAddress: 'owner@example.com' },
    });
    expect(calls.filter((c) => c.url.includes('/permissions'))).toHaveLength(1);
  });

  it('puts the chat with its links in a Chat tab only when asked for', async () => {
    const { calls, exporter } = harness();
    await exporter.export({
      meetingId: 'm',
      minutes: demoMinutes,
      options: { ...options, includeChat: true },
    });
    const tabsAdded = JSON.stringify(batches(calls)).match(/"addDocumentTab"/g);
    expect(tabsAdded).toHaveLength(2);
    const texts = batches(calls)
      .flat()
      .flatMap((r) => ('insertText' in r ? [(r.insertText as { text: string }).text] : []));
    expect(
      texts.some(
        (t) =>
          t.startsWith('Chat\n') &&
          t.includes('00:00:24  Chloe Martin: Research notes: https://example.com/research'),
      ),
    ).toBe(true);
    expect(JSON.stringify(batches(calls))).toContain(
      '"link":{"url":"https://example.com/research"}',
    );

    const off = harness();
    await off.exporter.export({
      meetingId: 'm',
      minutes: demoMinutes,
      options,
    });
    expect(JSON.stringify(batches(off.calls))).not.toContain('example.com/research');
  });

  it('inserts real tables back to front and fills the cells from the document', async () => {
    const { calls, exporter } = harness();
    await exporter.export({ meetingId: 'm', minutes: demoMinutes, options });
    const [, , , content, tables, fill] = batches(calls);
    expect(JSON.stringify(content)).not.toContain('Owner');
    expect(tables).toHaveLength(1);
    expect(tables?.[0]).toMatchObject({
      insertTable: { rows: 4, columns: 3, location: { tabId: 't0' } },
    });
    const text = (fill ?? []).filter((r) => 'insertText' in r) as {
      insertText: { text: string; location: { index: number } };
    }[];
    expect(text.map((r) => r.insertText.text)).toEqual([
      'Done',
      'Share the research notes',
      'Chloe',
      'Not specified',
      'Confirm the launch date with support',
      'Ben',
      'Friday',
      'Finish the pricing page copy',
      'Anna',
      'Due',
      'Action',
      'Owner',
    ]);
    expect(JSON.stringify(fill)).toContain('updateTableCellStyle');
  });

  it('keeps the final paragraph after a table that ends the tab (Google refuses to delete it)', async () => {
    const { calls, exporter } = harness();
    await exporter.export({ meetingId: 'm', minutes: demoMinutes, options });
    const fill = batches(calls).at(-1) ?? [];
    expect(fill.some((r) => 'deleteContentRange' in r)).toBe(false);
  });

  it('removes the extra paragraph Docs adds after a table that has text after it', async () => {
    const { calls, exporter } = harness({}, { textAfterTable: true });
    await exporter.export({ meetingId: 'm', minutes: demoMinutes, options });
    const fill = batches(calls).at(-1) ?? [];
    expect(fill[0]).toEqual({
      deleteContentRange: { range: { startIndex: 140, endIndex: 141, tabId: 't0' } },
    });
  });

  it('renames the document when updating an existing one', async () => {
    const { calls, exporter } = harness();
    await exporter.export({
      meetingId: 'm',
      minutes: plain,
      options,
      previous: { ref: 'doc1', url: 'https://docs.google.com/document/d/doc1/edit' },
    });
    expect(calls).toContainEqual({
      method: 'PATCH',
      url: `${endpoints.drive}/files/doc1`,
      body: { name: 'Product sync' },
    });
  });

  it('does not share when the connected account is the owner', async () => {
    const { calls, exporter } = harness({ accountEmail: 'Owner@Example.com' });
    await exporter.export({ meetingId: 'm', minutes: plain, options });
    expect(calls.some((c) => c.url.includes('/permissions'))).toBe(false);
  });

  it('uploads the logo, inserts it first and removes the temporary file', async () => {
    const { calls, exporter } = harness();
    await exporter.export({
      meetingId: 'm',
      minutes: plain,
      options: { ...options, logo: { contentType: 'image/png', data: png } },
    });
    expect(calls.some((c) => c.url.startsWith(endpoints.upload))).toBe(true);
    expect(calls).toContainEqual({
      method: 'POST',
      url: `${endpoints.drive}/files/logo1/permissions`,
      body: { type: 'anyone', role: 'reader' },
    });
    expect(JSON.stringify(batches(calls))).toContain(
      '"insertInlineImage":{"location":{"index":1,"tabId":"t0"},"uri":"https://drive.google.com/uc?export=download&id=logo1"',
    );
    expect(
      calls.at(-1) && calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/files/logo1')),
    ).toBe(true);
  });

  it('updates the same doc: clears the tabs and does not share again', async () => {
    const { calls, exporter } = harness({}, { existingTabs: 2 });
    const outcome = await exporter.export({
      meetingId: 'm',
      minutes: plain,
      options,
      previous: { ref: 'doc1', url: 'https://docs.google.com/document/d/doc1/edit' },
    });
    expect(outcome).toMatchObject({ label: 'Open the updated Google Doc', ref: 'doc1' });
    expect(calls.some((c) => c.url === `${endpoints.docs}/documents`)).toBe(false);
    const [clear] = batches(calls);
    expect(clear).toEqual([
      { deleteContentRange: { range: { startIndex: 1, endIndex: 29, tabId: 't0' } } },
    ]);
    const footerText = (JSON.stringify(batches(calls)).match(/insertText/g) ?? []).length;
    expect(footerText).toBeGreaterThan(0);
    expect(calls.some((c) => c.url.includes('/permissions'))).toBe(false);
  });

  it('turns an API failure into a readable error', async () => {
    const exporter = createGoogleDocsExporter({
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'Docs API has not been used' } }), {
            status: 403,
          }),
        ),
      endpoints,
      resolve: () =>
        Promise.resolve({
          accessToken: 't',
          accountEmail: 'a@b.c',
          ownerEmail: undefined,
        }),
    });
    await expect(
      exporter.export({ meetingId: 'm', minutes: demoMinutes, options }),
    ).rejects.toThrow('Google refused the request: Docs API has not been used');
  });
});

describe('google docs footer', () => {
  const footerBatches = (calls: Call[]) =>
    batches(calls).filter((requests) =>
      requests.some((r) => 'createFooter' in r || /"segmentId":"[^"]/.test(JSON.stringify(r))),
    );

  it('creates a real footer in every tab, links the label and leaves the body without it', async () => {
    const { calls, exporter } = harness();
    await exporter.export({ meetingId: 'm', minutes: plain, options });
    const [create, fill] = footerBatches(calls);
    expect(create).toEqual([
      {
        createFooter: {
          type: 'DEFAULT',
          sectionBreakLocation: { segmentId: '', index: 0, tabId: 't0' },
        },
      },
      {
        createFooter: {
          type: 'DEFAULT',
          sectionBreakLocation: { segmentId: '', index: 0, tabId: 't1' },
        },
      },
    ]);
    expect(fill).toContainEqual({
      insertText: {
        location: { segmentId: 'foot0', index: 0, tabId: 't0' },
        text: 'Powered by OpenMinutes',
      },
    });
    expect(JSON.stringify(fill)).toContain(
      '{"range":{"segmentId":"foot1","startIndex":11,"endIndex":22,"tabId":"t1"},"textStyle":{"link":{"url":"https://github.com/dennisklappe/openminutes"}',
    );
    const body = JSON.stringify(batches(calls).at(-1));
    expect(body).not.toContain('Powered by OpenMinutes');
  });

  it('reuses and clears the existing footer when updating', async () => {
    const { calls, exporter } = harness({}, { existingTabs: 2, existingFooters: true });
    await exporter.export({
      meetingId: 'm',
      minutes: plain,
      options,
      previous: { ref: 'doc1', url: 'https://docs.google.com/document/d/doc1/edit' },
    });
    expect(JSON.stringify(batches(calls))).not.toContain('createFooter');
    const [fill] = footerBatches(calls);
    expect(fill).toContainEqual({
      deleteContentRange: {
        range: { segmentId: 'old0', startIndex: 0, endIndex: 23, tabId: 't0' },
      },
    });
    expect(JSON.stringify(fill)).toContain('"segmentId":"old1"');
  });

  it('falls back to a last small line in each tab when footers are refused', async () => {
    const { calls, exporter } = harness({}, { refuseFooter: true });
    await exporter.export({ meetingId: 'm', minutes: plain, options });
    const inserts = batches(calls)
      .flat()
      .filter((r) => 'insertText' in r) as { insertText: { text: string } }[];
    expect(
      inserts.filter((i) => i.insertText.text.includes('Powered by OpenMinutes')),
    ).toHaveLength(2);
  });

  it('adds a Links tab and puts the transcript in a tab only when asked', async () => {
    const { calls, exporter } = harness();
    await exporter.export({
      meetingId: 'm',
      minutes: plain,
      options: {
        ...options,
        includeTranscript: false,
        linksTab: true,
        links: [{ label: 'Share link', url: 'https://om.example/s/abc' }],
      },
    });
    const adds = batches(calls)
      .flat()
      .filter((r) => 'addDocumentTab' in r);
    expect(adds).toEqual([{ addDocumentTab: { tabProperties: { title: 'Links' } } }]);
    expect(JSON.stringify(batches(calls))).toContain('Share link: https://om.example/s/abc');
  });
});

describe('google docs sharing with attendees', () => {
  it('adds readers without notification mail and reports failures', async () => {
    const { calls, exporter } = harness();
    const outcome = await exporter.grantAccess?.({
      meetingId: 'm',
      url: 'https://docs.google.com/document/d/doc1/edit',
      emails: ['a@example.com'],
    });
    expect(outcome).toEqual({ granted: ['a@example.com'], failed: [] });
    expect(calls).toEqual([
      {
        method: 'POST',
        url: `${endpoints.drive}/files/doc1/permissions?sendNotificationEmail=false`,
        body: { type: 'user', role: 'reader', emailAddress: 'a@example.com' },
      },
    ]);
  });
});
