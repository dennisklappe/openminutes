import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import type { DomNode } from './meet-dom.js';
import { parseTeamsRoom } from './teams-dom.js';
import { teamsRoomSelectors } from './teams-selectors.js';

function parseFixture(name: string) {
  const html = readFileSync(new URL(`../fixtures/teams/${name}.html`, import.meta.url), 'utf8');
  const { document } = parseHTML(html) as unknown as { document: DomNode };
  return parseTeamsRoom(document, teamsRoomSelectors);
}

describe('parseTeamsRoom', () => {
  it('lists the tiles and who is speaking', () => {
    expect(parseFixture('room-alice-speaking')).toEqual({
      participants: ['Alice', 'Bob', 'OpenMinutes Notetaker'],
      speaking: ['Alice'],
    });
  });

  it('reports nobody when the room is silent', () => {
    expect(parseFixture('room-silent').speaking).toEqual([]);
  });

  it('reports simultaneous speakers and keeps unusual names intact', () => {
    const room = parseFixture('room-overlap');
    expect(room.speaking).toEqual(['Alice', 'Bob']);
    expect(room.participants).toContain("Chloé O'Neil");
  });

  it('returns an empty room when the DOM no longer matches, so callers can tell it from "everyone left"', () => {
    expect(parseFixture('room-changed-dom')).toEqual({ participants: [], speaking: [] });
  });

  it('reads the participant count from the People control', () => {
    const { document } = parseHTML(
      '<html><body><div>Chat</div><div>4</div><div>People</div><div>Raise</div></body></html>',
    ) as unknown as { document: DomNode };
    expect(parseTeamsRoom(document, teamsRoomSelectors)).toEqual({
      participants: [],
      speaking: [],
      headcount: 4,
    });
  });

  it('reports no headcount when Teams hides the count for a single participant', () => {
    const { document } = parseHTML(
      '<html><body><div>Chat</div><div>People</div><div>Raise</div></body></html>',
    ) as unknown as { document: DomNode };
    expect(parseTeamsRoom(document, teamsRoomSelectors).headcount).toBeUndefined();
  });
});
