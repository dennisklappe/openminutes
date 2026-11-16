import type { DomNode } from './meet-dom.js';
import type { WherebyRoomSelectors } from './whereby-selectors.js';
import type { RoomSnapshot } from './types.js';

// Serialized and run inside the page, so it must not reference anything outside its arguments.
export function parseWherebyRoom(root: DomNode, selectors: WherebyRoomSelectors): RoomSnapshot {
  const participants: string[] = [];
  const speaking: string[] = [];
  const seen: string[] = [];
  for (const tile of Array.from(root.querySelectorAll(selectors.participant))) {
    const id = tile.getAttribute('data-clientid');
    if (!id || seen.includes(id)) continue;
    const name = (
      tile.getAttribute('title') ??
      tile.querySelector(selectors.nameBanner)?.textContent ??
      ''
    )
      .replace(/\(you\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) continue;
    seen.push(id);
    participants.push(name);
    const indicator = tile.querySelector(selectors.audioIndicator);
    const opacity = Number(/opacity:\s*([\d.]+)/.exec(indicator?.getAttribute('style') ?? '')?.[1]);
    const muted = (indicator?.getAttribute('class') ?? '').includes(selectors.mutedClass);
    if (indicator && !muted && opacity >= selectors.speakingOpacity && !speaking.includes(name)) {
      speaking.push(name);
    }
  }
  return { participants: [...new Set(participants)], speaking, headcount: participants.length };
}
