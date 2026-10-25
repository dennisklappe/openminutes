import { buildDocument } from '../document.js';
import {
  ExportError,
  type Exporter,
  type ExportInput,
  type ExportOutcome,
  type GrantAccessInput,
  type GrantAccessOutcome,
} from '../exporter.js';
import type { DocumentStyle } from '../document-style.js';
import type { MinutesLogo } from '../logo.js';
import { sameEmail } from '../people.js';
import { resolveLook } from '../look.js';
import {
  clearFooterRequests,
  createFooterRequest,
  fillFooterRequests,
  type Footer,
} from './google-docs-footer.js';
import {
  contentRequests,
  fillTableRequests,
  insertTableRequests,
  type Content,
  type DocItem,
} from './google-docs-requests.js';
import { apiClient, type ApiClient, type Fetch } from './http.js';

export interface GoogleDocsEndpoints {
  docs: string;
  drive: string;
  upload: string;
}

export interface GoogleDocsContext {
  accessToken: string;
  accountEmail: string;
  ownerEmail: string | undefined;
}

export interface GoogleDocsDeps {
  fetch: Fetch;
  endpoints: GoogleDocsEndpoints;
  resolve(): Promise<GoogleDocsContext>;
}

interface Tab {
  tabId: string;
  endIndex: number;
  footer?: Footer;
}

interface Part {
  title: string;
  items: DocItem[];
}

interface TabContent {
  endIndex?: number;
  startIndex?: number;
  table?: { tableRows?: { tableCells?: { content?: { startIndex?: number }[] }[] }[] };
}

interface DocumentTabs {
  tabs?: {
    tabProperties?: { tabId?: string };
    documentTab?: {
      body?: { content?: TabContent[] };
      documentStyle?: { defaultFooterId?: string };
      footers?: Record<string, { content?: { endIndex?: number }[] }>;
    };
  }[];
}

const LOGO_URL = 'https://drive.google.com/uc?export=download&id=';
const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

function toTabs(document: DocumentTabs): Tab[] {
  return (document.tabs ?? []).flatMap((tab) => {
    const tabId = tab.tabProperties?.tabId;
    const content = tab.documentTab?.body?.content ?? [];
    const footerId = tab.documentTab?.documentStyle?.defaultFooterId;
    const footerEnd = footerId
      ? tab.documentTab?.footers?.[footerId]?.content?.at(-1)?.endIndex
      : 0;
    return tabId
      ? [
          {
            tabId,
            endIndex: content.at(-1)?.endIndex ?? 2,
            ...(footerId && { footer: { id: footerId, endIndex: footerEnd ?? 1 } }),
          },
        ]
      : [];
  });
}

async function readTableElements(
  api: ApiClient,
  docs: string,
  documentId: string,
  tabId: string,
): Promise<TabContent[]> {
  const url = `${docs}/documents/${documentId}?includeTabsContent=true&fields=${encodeURIComponent('tabs(tabProperties/tabId,documentTab/body/content)')}`;
  const document = await api.json<DocumentTabs>('GET', url);
  const tab = document.tabs?.find((candidate) => candidate.tabProperties?.tabId === tabId);
  return tab?.documentTab?.body?.content ?? [];
}

async function readTabs(api: ApiClient, docs: string, documentId: string): Promise<Tab[]> {
  const fields =
    'tabs(tabProperties/tabId,documentTab(body/content/endIndex,documentStyle/defaultFooterId,footers))';
  const url = `${docs}/documents/${documentId}?includeTabsContent=true&fields=${encodeURIComponent(fields)}`;
  return toTabs(await api.json<DocumentTabs>('GET', url));
}

async function uploadLogo(
  api: ApiClient,
  endpoints: GoogleDocsEndpoints,
  logo: MinutesLogo,
): Promise<{ id: string; uri: string }> {
  const boundary = `om${Math.random().toString(36).slice(2)}`;
  const head = `--${boundary}\r\ncontent-type: application/json\r\n\r\n${JSON.stringify({ name: 'openminutes-logo' })}\r\n--${boundary}\r\ncontent-type: ${logo.contentType}\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head), logo.data, Buffer.from(`\r\n--${boundary}--`)]);
  const response = await api.raw(
    'POST',
    `${endpoints.upload}/files?uploadType=multipart&fields=id`,
    body,
    { 'content-type': `multipart/related; boundary=${boundary}` },
  );
  const { id } = (await response.json()) as { id: string };
  await api.json('POST', `${endpoints.drive}/files/${id}/permissions`, {
    type: 'anyone',
    role: 'reader',
  });
  return { id, uri: `${LOGO_URL}${id}` };
}

const isFooter = (item: DocItem) => item.type === 'footer';

type Batch = <T>(requests: object[]) => Promise<T>;

/** Puts a real page footer in each tab. False when Google refuses, so the body gets a line instead. */
async function placeFooters(batch: Batch, tabs: Tab[], style: DocumentStyle): Promise<boolean> {
  try {
    const footers = new Map(
      tabs.flatMap((tab) => (tab.footer ? [[tab.tabId, tab.footer.id]] : [])),
    );
    const fresh = tabs.filter((tab) => !tab.footer);
    if (fresh.length > 0) {
      const { replies } = await batch<{ replies?: { createFooter?: { footerId?: string } }[] }>(
        fresh.map((tab) => createFooterRequest(tab.tabId)),
      );
      fresh.forEach((tab, index) => {
        const footerId = replies?.[index]?.createFooter?.footerId;
        if (!footerId) throw new ExportError('Google did not create the footer');
        footers.set(tab.tabId, footerId);
      });
    }
    await batch(
      tabs.flatMap((tab) => [
        ...(tab.footer ? clearFooterRequests(tab.footer, tab.tabId) : []),
        ...fillFooterRequests(footers.get(tab.tabId) ?? '', tab.tabId, style),
      ]),
    );
    return true;
  } catch (error) {
    if (error instanceof ExportError) return false;
    throw error;
  }
}

export function createGoogleDocsExporter(deps: GoogleDocsDeps): Exporter {
  const { endpoints } = deps;

  async function run({ minutes, options, previous }: ExportInput): Promise<ExportOutcome> {
    const context = await deps.resolve();
    const api = apiClient('Google', deps.fetch, context.accessToken);
    const { style, logo: logoPlacement } = resolveLook(options);
    const { main, transcript, chat, links } = buildDocument(minutes, options);
    const parts: Part[] = [
      { title: 'Minutes', items: main },
      ...(transcript ? [{ title: 'Transcript', items: transcript }] : []),
      ...(chat ? [{ title: 'Chat', items: chat }] : []),
      ...(links ? [{ title: 'Links', items: links }] : []),
    ];

    const documentId =
      previous?.ref ??
      (
        await api.json<{ documentId: string }>('POST', `${endpoints.docs}/documents`, {
          title: minutes.title,
        })
      ).documentId;
    const batch = async <T>(requests: object[]): Promise<T> =>
      api.json<T>('POST', `${endpoints.docs}/documents/${documentId}:batchUpdate`, { requests });

    let tabs = await readTabs(api, endpoints.docs, documentId);
    const clear = tabs
      .slice(0, parts.length)
      .filter((tab) => tab.endIndex > 2)
      .map((tab) => ({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: tab.endIndex - 1, tabId: tab.tabId },
        },
      }));
    const surplus = tabs.slice(parts.length).map((tab) => ({ deleteTab: { tabId: tab.tabId } }));
    const missing = parts.slice(tabs.length);
    const cleanup = [...clear, ...surplus];
    if (cleanup.length > 0) await batch(cleanup);
    for (const part of missing) {
      await batch([{ addDocumentTab: { tabProperties: { title: part.title } } }]);
    }
    if (cleanup.length > 0 || missing.length > 0) {
      tabs = await readTabs(api, endpoints.docs, documentId);
    }
    const targets = tabs.slice(0, parts.length);
    const [first] = targets;
    if (!first || targets.length < parts.length) {
      throw new ExportError('Google did not create all the tabs');
    }

    const placed = await placeFooters(batch, targets, style);

    let logoFile: { id: string; uri: string } | undefined;
    const notes: string[] = [];
    if (options.logo && logoPlacement !== 'none') {
      if (options.logo.contentType === 'image/svg+xml') {
        notes.push('The logo was skipped: Google Docs does not accept SVG images');
      } else {
        try {
          logoFile = await uploadLogo(api, endpoints, options.logo);
        } catch (error) {
          notes.push(
            `The logo was skipped: ${error instanceof Error ? error.message : 'upload failed'}`,
          );
        }
      }
    }
    if (previous) {
      await api
        .json('PATCH', `${endpoints.drive}/files/${documentId}`, { name: minutes.title })
        .catch(() => notes.push('The document title was not updated'));
    }

    const requests: object[] = [];
    let firstContent: Content | undefined;
    parts.forEach((part, index) => {
      const tab = targets[index];
      if (!tab) return;
      const content = contentRequests(
        placed ? part.items.filter((i) => !isFooter(i)) : part.items,
        style,
        {
          tabId: tab.tabId,
          logoUri: index === 0 ? logoFile?.uri : undefined,
          logoCentered: logoPlacement === 'center',
        },
      );
      if (index === 0) firstContent = content;
      requests.push(
        {
          updateDocumentTabProperties: {
            tabProperties: { tabId: tab.tabId, title: part.title },
            fields: 'title',
          },
        },
        ...content.requests,
      );
    });
    try {
      await batch(requests);
      const tables = firstContent?.tables ?? [];
      if (tables.length > 0) {
        await batch(insertTableRequests(tables, first.tabId));
        const elements = await readTableElements(api, endpoints.docs, documentId, first.tabId);
        const fill = fillTableRequests(elements, tables, style, first.tabId);
        if (fill.length > 0) await batch(fill);
      }
    } finally {
      if (logoFile) {
        await api.json('DELETE', `${endpoints.drive}/files/${logoFile.id}`).catch(() => undefined);
      }
    }

    if (!previous && context.ownerEmail && !sameEmail(context.ownerEmail, context.accountEmail)) {
      await api.json(
        'POST',
        `${endpoints.drive}/files/${documentId}/permissions?sendNotificationEmail=false`,
        { type: 'user', role: 'writer', emailAddress: context.ownerEmail },
      );
    }
    return {
      kind: 'link',
      url: docUrl(documentId),
      label: previous ? 'Open the updated Google Doc' : 'Open the Google Doc',
      ref: documentId,
      ...(notes.length > 0 && { note: notes.join('. ') }),
    };
  }

  async function grantAccess({ url, emails }: GrantAccessInput): Promise<GrantAccessOutcome> {
    const documentId = /\/document\/d\/([\w-]+)/.exec(url)?.[1];
    if (!documentId) throw new ExportError('This is not a Google Doc link');
    const context = await deps.resolve();
    const api = apiClient('Google', deps.fetch, context.accessToken);
    const outcome: GrantAccessOutcome = { granted: [], failed: [] };
    for (const email of emails) {
      try {
        await api.json(
          'POST',
          `${endpoints.drive}/files/${documentId}/permissions?sendNotificationEmail=false`,
          { type: 'user', role: 'reader', emailAddress: email },
        );
        outcome.granted.push(email);
      } catch (error) {
        outcome.failed.push({ email, reason: error instanceof Error ? error.message : 'failed' });
      }
    }
    return outcome;
  }

  return {
    id: 'google-docs',
    label: 'Google Doc',
    destination: true,
    shareLabel: 'Google Doc',
    description:
      'Creates a Google Doc with the minutes and, if you like, the transcript in a second tab.',
    export: run,
    grantAccess,
  };
}
