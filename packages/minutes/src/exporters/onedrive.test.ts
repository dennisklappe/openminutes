import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { demoMinutes } from '../demo.js';
import { createOneDriveExporter } from './onedrive.js';
import { DOCX_TYPE } from './word.js';

const options = { template: 'classic', includeTranscript: true } as const;

function harness(accountEmail = 'bot@example.com') {
  const calls: { method: string; url: string; body: unknown; headers: Headers }[] = [];
  const exporter = createOneDriveExporter({
    graph: 'https://graph.test/v1.0',
    fetch: (input, init) => {
      const raw = init?.body;
      calls.push({
        method: init?.method ?? 'GET',
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw,
        headers: new Headers(init?.headers),
      });
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'item1', webUrl: 'https://onedrive.test/doc' }), {
          status: 200,
        }),
      );
    },
    resolve: () =>
      Promise.resolve({ accessToken: 'tok', accountEmail, ownerEmail: 'owner@example.com' }),
  });
  return { calls, exporter };
}

describe('onedrive exporter', () => {
  it('uploads a valid docx and invites only the owner without notification', async () => {
    const { calls, exporter } = harness();
    const outcome = await exporter.export({
      meetingId: '12345678-aaaa',
      minutes: demoMinutes,
      options,
    });
    expect(outcome).toMatchObject({ kind: 'link', url: 'https://onedrive.test/doc', ref: 'item1' });
    const [upload, invite] = calls;
    expect(upload?.method).toBe('PUT');
    expect(upload?.url).toBe(
      'https://graph.test/v1.0/me/drive/root:/OpenMinutes/12345678-product-sync-minutes.docx:/content?@microsoft.graph.conflictBehavior=replace',
    );
    expect(upload?.headers.get('content-type')).toBe(DOCX_TYPE);
    expect(upload?.headers.get('authorization')).toBe('Bearer tok');
    expect(Object.keys(unzipSync(upload?.body as Uint8Array))).toContain('word/document.xml');
    expect(invite).toMatchObject({
      method: 'POST',
      url: 'https://graph.test/v1.0/me/drive/items/item1/invite',
      body: {
        recipients: [{ email: 'owner@example.com' }],
        roles: ['write'],
        requireSignIn: true,
        sendInvitation: false,
      },
    });
  });

  it('replaces the content of the previous item without inviting again', async () => {
    const { calls, exporter } = harness('owner@example.com');
    await exporter.export({
      meetingId: 'm',
      minutes: demoMinutes,
      options,
      previous: { ref: 'item0', url: 'https://onedrive.test/old' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://graph.test/v1.0/me/drive/items/item0/content');
  });
});
