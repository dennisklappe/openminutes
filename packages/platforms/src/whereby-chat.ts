import type { Page } from 'playwright-core';
import { toChatMessages, type RawChatMessage } from './chat.js';
import type { DomNode } from './meet-dom.js';
import { wherebyLocators } from './whereby-selectors.js';
import type { ChatMessage } from './types.js';

export const WHEREBY_CHAT_SELECTORS_VERSION = '2026-11-16';

export const wherebyChatSelectors = {
  group: '[class*="_ChatMessageGroup_"]',
  sender: '[class*="_displayName_"]',
  time: '[class*="_timestamp_"]',
  message: '[class*="_ChatMessage_"] [class*="_content_"]',
  link: 'a[href]',
  fromSelf: '_fromSelf_',
};

type WherebyChatSelectors = typeof wherebyChatSelectors;

// Serialized and run inside the page, so it must not reference anything outside its arguments.
export function parseWherebyChat(
  root: DomNode,
  selectors: WherebyChatSelectors,
  selfName: string,
): RawChatMessage[] {
  const messages: RawChatMessage[] = [];
  for (const group of Array.from(root.querySelectorAll(selectors.group))) {
    const own = (group.getAttribute('class') ?? '').includes(selectors.fromSelf);
    const label = group.querySelector(selectors.sender)?.textContent?.trim();
    const sender = own ? selfName : (label ?? '');
    const time = group.querySelector(selectors.time)?.textContent?.trim() ?? null;
    for (const message of Array.from(group.querySelectorAll(selectors.message))) {
      const hrefs = Array.from(message.querySelectorAll(selectors.link))
        .map((anchor) => anchor.getAttribute('href') ?? '')
        .filter(Boolean);
      messages.push({ sender, text: (message.textContent ?? '').trim(), time, hrefs });
    }
  }
  return messages;
}

export async function scrapeWherebyChat(page: Page, selfName: string): Promise<ChatMessage[]> {
  const { chatButton, chatInput } = wherebyLocators(page);
  if (!(await chatInput.isVisible()) && (await chatButton.isVisible())) await chatButton.click();
  const raw = await page.evaluate<RawChatMessage[]>(
    `(${parseWherebyChat.toString()})(document, ${JSON.stringify(wherebyChatSelectors)}, ${JSON.stringify(selfName)})`,
  );
  return toChatMessages(raw);
}
