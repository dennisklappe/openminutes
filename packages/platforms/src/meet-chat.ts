import type { Page } from 'playwright-core';
import { toChatMessages, type RawChatMessage } from './chat.js';
import type { DomNode } from './meet-dom.js';
import { meetLocators } from './meet-selectors.js';
import type { ChatMessage } from './types.js';

export const MEET_CHAT_SELECTORS_VERSION = '2026-10-22.2';

// Recorded from a real call on 2026-10-22 (fixtures/meet/chat-live.html): a group has a sender
// header only for other people, the groups of the viewer carry the own class and have no name, and
// the pin button inside such a group repeats the message id, so messages are matched on div only.
export const meetChatSelectors = {
  group: '.Ss4fHf',
  ownClass: 'ydIQ1d',
  sender: '.YTbUzc',
  senderName: '.poVWob',
  time: '.MuzmKe',
  message: 'div[data-message-id]',
  body: '.ptNLrf > div, .oIy2qc',
  link: 'a[href]',
  selfLabel: 'You',
};

type MeetChatSelectors = typeof meetChatSelectors;

// Serialized and run inside the page, so it must not reference anything outside its arguments.
export function parseMeetChat(
  root: DomNode,
  selectors: MeetChatSelectors,
  selfName: string,
): RawChatMessage[] {
  const messages: RawChatMessage[] = [];
  for (const group of Array.from(root.querySelectorAll(selectors.group))) {
    const labelNode =
      group.querySelector(selectors.sender) ?? group.querySelector(selectors.senderName);
    const label = labelNode?.textContent?.trim() ?? '';
    const own = (group.getAttribute('class') ?? '').split(/\s+/).includes(selectors.ownClass);
    const sender = own || label === selectors.selfLabel ? selfName : label;
    // Meet puts a narrow no-break space before AM and PM.
    const time =
      group.querySelector(selectors.time)?.textContent?.replace(/\s+/g, ' ').trim() || null;
    for (const message of Array.from(group.querySelectorAll(selectors.message))) {
      const body = message.querySelector(selectors.body) ?? message;
      const hrefs = Array.from(body.querySelectorAll(selectors.link))
        .map((anchor) => anchor.getAttribute('href') ?? '')
        .filter(Boolean);
      messages.push({ sender, text: body.textContent ?? '', time, hrefs });
    }
  }
  return messages;
}

export async function scrapeMeetChat(page: Page, selfName: string): Promise<ChatMessage[]> {
  const { chatClosedButton } = meetLocators(page);
  if (await chatClosedButton.isVisible()) await chatClosedButton.click();
  const raw = await page.evaluate<RawChatMessage[]>(
    `(${parseMeetChat.toString()})(document, ${JSON.stringify(meetChatSelectors)}, ${JSON.stringify(selfName)})`,
  );
  return toChatMessages(raw);
}
