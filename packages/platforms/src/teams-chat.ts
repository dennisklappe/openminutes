import type { Page } from 'playwright-core';
import { toChatMessages, type RawChatMessage } from './chat.js';
import type { DomNode } from './meet-dom.js';
import { teamsLocators } from './teams-selectors.js';
import type { ChatMessage } from './types.js';

export const TEAMS_CHAT_SELECTORS_VERSION = '2026-10-22';

export const teamsChatSelectors = {
  item: '[data-tid="chat-pane-item"]',
  sender: '[data-tid="message-author-name"]',
  time: 'time',
  message: '[data-tid="chat-pane-message"]',
  link: 'a[href]',
  selfLabel: 'You',
};

type TeamsChatSelectors = typeof teamsChatSelectors;

// Serialized and run inside the page, so it must not reference anything outside its arguments.
export function parseTeamsChat(
  root: DomNode,
  selectors: TeamsChatSelectors,
  selfName: string,
): RawChatMessage[] {
  const messages: RawChatMessage[] = [];
  let sender = '';
  for (const item of Array.from(root.querySelectorAll(selectors.item))) {
    const label = item.querySelector(selectors.sender)?.textContent?.trim();
    // Consecutive messages of one author only show the name on the first.
    if (label) sender = label === selectors.selfLabel ? selfName : label;
    const message = item.querySelector(selectors.message);
    if (!message) continue;
    const stamp = item.querySelector(selectors.time);
    const time = stamp?.getAttribute('datetime') ?? stamp?.textContent?.trim() ?? null;
    const hrefs = Array.from(message.querySelectorAll(selectors.link))
      .map((anchor) => anchor.getAttribute('href') ?? '')
      .filter(Boolean);
    messages.push({ sender, text: message.textContent ?? '', time, hrefs });
  }
  return messages;
}

export async function scrapeTeamsChat(page: Page, selfName: string): Promise<ChatMessage[]> {
  const { chatClosedButton } = teamsLocators(page);
  if (await chatClosedButton.isVisible()) await chatClosedButton.click();
  const raw = await page.evaluate<RawChatMessage[]>(
    `(${parseTeamsChat.toString()})(document, ${JSON.stringify(teamsChatSelectors)}, ${JSON.stringify(selfName)})`,
  );
  return toChatMessages(raw);
}
