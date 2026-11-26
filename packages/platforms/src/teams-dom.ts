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
  // The People control shows the participant count only while more than one
  // person is in the call, and tiles only render for cameras that are on.
  // The count lets the room tracker tell "alone" apart from "cameras off".
  const page = root as DomNode & { body?: { innerText?: string } };
  const peopleMatch = /\b(\d+)\s*\n\s*People\b/.exec(page.body?.innerText ?? '');
  const headcount = peopleMatch ? Number(peopleMatch[1]) : undefined;
  return headcount === undefined
    ? { participants, speaking }
    : { participants, speaking, headcount };
}
