import { describe, expect, it } from 'vitest';
import { parseRoomRoute, roomHref } from './roomRoute.js';

describe('room route', () => {
  it('reads the meeting and the tile', () => {
    expect(parseRoomRoute('/meetings/m-1/room/p-2')).toEqual({
      meetingId: 'm-1',
      participantId: 'p-2',
    });
    expect(parseRoomRoute(roomHref('m-1', 'p-2').slice(1))).toEqual({
      meetingId: 'm-1',
      participantId: 'p-2',
    });
  });

  it('ignores other routes', () => {
    expect(parseRoomRoute('/meetings/m-1')).toBeUndefined();
    expect(parseRoomRoute('/meetings/m-1/review')).toBeUndefined();
    expect(parseRoomRoute('/meetings/m-1/room')).toBeUndefined();
  });
});
