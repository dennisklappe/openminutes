import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { meetSelectors, parseMeetRoom, type DomNode } from './meet-dom.js';

function parseFixture(name: string, selfName = 'OpenMinutes Notetaker') {
  const html = readFileSync(new URL(`../fixtures/meet/${name}.html`, import.meta.url), 'utf8');
  const { document } = parseHTML(html) as unknown as { document: DomNode };
  return parseMeetRoom(document, meetSelectors, selfName);
}

describe('parseMeetRoom', () => {
  it('lists the participants of a recorded call', () => {
    const room = parseFixture('room-live-speaking');
    expect(room.participants).toEqual(['Alice Example', 'Bob Example', 'OpenMinutes Notetaker']);
    expect(room.speaking).toEqual(['Bob Example']);
  });

  it('sees nobody speaking in the recorded silent moment', () => {
    expect(parseFixture('room-live-silent').speaking).toEqual([]);
  });

  it('lists participants and keeps the bot name', () => {
    expect(parseFixture('room-alice-speaking').participants).toEqual([
      'OpenMinutes Notetaker',
      'Alice',
      'Bob',
    ]);
  });

  it('swaps a tile labelled "You" for the bot name', () => {
    const html = '<div data-participant-id="x"><span class="notranslate">You</span></div>';
    const { document } = parseHTML(`<body>${html}</body>`) as unknown as { document: DomNode };
    expect(parseMeetRoom(document, meetSelectors, 'Bot').participants).toEqual(['Bot']);
  });

  it('reports who is speaking', () => {
    expect(parseFixture('room-alice-speaking').speaking).toEqual(['Alice']);
  });

  it('reports nobody when the room is silent', () => {
    expect(parseFixture('room-silent').speaking).toEqual([]);
  });

  it('reports several simultaneous speakers and keeps unusual names intact', () => {
    const room = parseFixture('room-overlap');
    expect(room.speaking).toEqual(['Alice', 'Bob']);
    expect(room.participants).toContain("Chloé O'Neil");
  });

  it('sees only the bot when it is alone', () => {
    expect(parseFixture('room-alone').participants).toEqual(['OpenMinutes Notetaker']);
  });

  it('returns an empty room when the DOM no longer matches, so callers can tell it from "everyone left"', () => {
    expect(parseFixture('room-changed-dom')).toEqual({
      participants: [],
      speaking: [],
      headcount: 0,
    });
  });

  it('counts two people who share a name as two', () => {
    const tile = (id: string) =>
      `<div data-participant-id="${id}"><span class="notranslate">Acme Notetaker</span></div>`;
    const { document } = parseHTML(
      `<body>${tile('spaces/a/devices/1')}${tile('spaces/a/devices/2')}</body>`,
    ) as unknown as { document: DomNode };
    const room = parseMeetRoom(document, meetSelectors, 'Bot');
    expect(room.participants).toEqual(['Acme Notetaker']);
    expect(room.headcount).toBe(2);
  });

  it('counts the two tiles of one account in two sessions, recorded from a real call', () => {
    const room = parseFixture('room-live-same-name');
    expect(room.participants).toEqual(['Alice Example']);
    expect(room.headcount).toBe(2);
  });

  it.each(['room-live-speaking', 'room-live-silent', 'room-alice-speaking', 'room-overlap'])(
    'counts one person per tile in %s',
    (name) => {
      const room = parseFixture(name);
      expect(room.headcount).toBe(room.participants.length);
    },
  );
});
