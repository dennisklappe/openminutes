import { randomUUID } from 'node:crypto';

interface FakeTab {
  id: string;
  title: string;
  text: string;
}

export interface FakePermission {
  type: string;
  role: string;
  emailAddress?: string;
  query: string;
}

export interface FakeDocument {
  id: string;
  title: string;
  tabs: FakeTab[];
  permissions: FakePermission[];
  requests: Record<string, unknown>[];
}

interface Request {
  tabId?: string;
  [key: string]: unknown;
}

export class FakeDocuments {
  readonly documents = new Map<string, FakeDocument>();
  readonly files = new Set<string>();
  private tabCounter = 0;

  private newTab(title = 'Tab'): FakeTab {
    return { id: `t.${this.tabCounter++}`, title, text: '' };
  }

  create(title: string): FakeDocument {
    const doc: FakeDocument = {
      id: `doc-${randomUUID().slice(0, 8)}`,
      title,
      tabs: [this.newTab('Tab 1')],
      permissions: [],
      requests: [],
    };
    this.documents.set(doc.id, doc);
    this.files.add(doc.id);
    return doc;
  }

  view(doc: FakeDocument) {
    return {
      documentId: doc.id,
      title: doc.title,
      tabs: doc.tabs.map((tab) => ({
        tabProperties: { tabId: tab.id, title: tab.title },
        documentTab: { body: { content: [{ endIndex: tab.text.length + 2 }] } },
      })),
    };
  }

  batchUpdate(doc: FakeDocument, requests: Record<string, Request>[]): void {
    for (const request of requests) {
      doc.requests.push(request);
      const tabOf = (id?: string) => doc.tabs.find((tab) => tab.id === id) ?? doc.tabs[0];
      const insert = request['insertText'] as
        { text: string; location: { tabId?: string } } | undefined;
      const clear = request['deleteContentRange'] as { range: { tabId?: string } } | undefined;
      const add = request['addDocumentTab'] as { tabProperties?: { title?: string } } | undefined;
      const remove = request['deleteTab'] as { tabId: string } | undefined;
      const rename = request['updateDocumentTabProperties'] as
        { tabProperties: { tabId: string; title: string } } | undefined;
      if (insert) {
        const tab = tabOf(insert.location.tabId);
        if (tab) tab.text += insert.text;
      } else if (clear) {
        const tab = tabOf(clear.range.tabId);
        if (tab) tab.text = '';
      } else if (add) {
        doc.tabs.push(this.newTab(add.tabProperties?.title));
      } else if (remove) {
        doc.tabs = doc.tabs.filter((tab) => tab.id !== remove.tabId);
      } else if (rename) {
        const tab = tabOf(rename.tabProperties.tabId);
        if (tab) tab.title = rename.tabProperties.title;
      }
    }
  }
}
