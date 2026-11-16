import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import type { DomNode } from './meet-dom.js';
import { parseWherebyChat, wherebyChatSelectors } from './whereby-chat.js';
import { parseWherebyRoom } from './whereby-dom.js';
import { wherebyRoomSelectors } from './whereby-selectors.js';

function load(name: string): DomNode {
  const html = readFileSync(new URL(`../fixtures/whereby/${name}.html`, import.meta.url), 'utf8');
  return (parseHTML(html) as unknown as { document: DomNode }).document;
}

// room-live-*.html are captures of a real Whereby room taken on 2026-11-16.
describe('parseWherebyRoom on captured rooms', () => {
  it('lists the stage tile and the overflow tile, and who speaks', () => {
    const room = parseWherebyRoom(load('room-live-speaking'), wherebyRoomSelectors);
    expect(room.participants.sort()).toEqual(['OpenMinutes Notetaker', 'Probe Guest']);
    expect(room.headcount).toBe(2);
    expect(room.speaking.length).toBeLessThanOrEqual(1);
  });

  it('reads the names of both people in the room and ignores muted indicators', () => {
    const room = parseWherebyRoom(load('room-live-chat'), wherebyRoomSelectors);
    expect(room.participants.sort()).toEqual(['OpenMinutes Notetaker', 'Probe Guest']);
    expect(room.headcount).toBe(2);
  });

  it('returns an empty room when nothing matches', () => {
    const { document } = parseHTML('<html><body><p>hi</p></body></html>') as unknown as {
      document: DomNode;
    };
    expect(parseWherebyRoom(document, wherebyRoomSelectors)).toEqual({
      participants: [],
      speaking: [],
      headcount: 0,
    });
  });
});

describe('parseWherebyChat on a captured room', () => {
  it('reads sender, time and text', () => {
    expect(parseWherebyChat(load('room-live-chat'), wherebyChatSelectors, 'Bot')).toEqual([
      { sender: 'Probe Guest', text: 'Hello from the probe guest', time: '12:21', hrefs: [] },
    ]);
  });
});
