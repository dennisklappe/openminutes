import type { RoomSnapshot } from './types.js';

export const MEET_DOM_VERSION = '2026-10-22';

export const meetSelectors = {
  tile: '[data-participant-id]',
  name: 'span.notranslate',
  speaking: '[jsname="QgSmzd"]:not(.gjg47c)',
  selfLabel: 'You',
};

type MeetSelectors = typeof meetSelectors;

export interface DomNode {
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): DomNode | null;
  querySelectorAll(selector: string): ArrayLike<DomNode>;
}

// Serialized and run inside the page, so it must not reference anything outside its arguments.
export function parseMeetRoom(
  root: DomNode,
  selectors: MeetSelectors,
  selfName: string,
): RoomSnapshot {
  const participants: string[] = [];
  const speaking: string[] = [];
  const people = new Set<string>();
  for (const tile of Array.from(root.querySelectorAll(selectors.tile))) {
    // Meet marks icons with the same notranslate class, so take the first match that has text.
    const label = Array.from(tile.querySelectorAll(selectors.name))
      .map((node) => node.textContent?.trim())
      .find(Boolean);
    if (!label) continue;
    const name = label === selectors.selfLabel ? selfName : label;
    people.add(tile.getAttribute('data-participant-id') ?? name);
    if (!participants.includes(name)) participants.push(name);
    if (tile.querySelector(selectors.speaking) && !speaking.includes(name)) speaking.push(name);
  }
  return { participants, speaking, headcount: people.size };
}
