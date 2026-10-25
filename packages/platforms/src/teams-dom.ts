import type { DomNode } from './meet-dom.js';
import type { TeamsRoomSelectors } from './teams-selectors.js';
import type { RoomSnapshot } from './types.js';

// Serialized and run inside the page, so it must not reference anything outside its arguments.
export function parseTeamsRoom(root: DomNode, selectors: TeamsRoomSelectors): RoomSnapshot {
  const participants: string[] = [];
  const speaking: string[] = [];
  for (const tile of Array.from(root.querySelectorAll(selectors.tile))) {
    const name = tile.getAttribute(selectors.nameAttribute)?.trim();
    if (!name) continue;
    if (!participants.includes(name)) participants.push(name);
    if (tile.querySelector(selectors.speaking) && !speaking.includes(name)) speaking.push(name);
  }
  return { participants, speaking };
}
