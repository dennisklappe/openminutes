/** `#/meetings/<id>/room/<participantId>`: naming the voices of one shared participant tile. */
export interface RoomRoute {
  meetingId: string;
  participantId: string;
}

export function parseRoomRoute(route: string): RoomRoute | undefined {
  const found = /^\/meetings\/([\w-]+)\/room\/([\w-]+)$/.exec(route.split('?', 1)[0] ?? '');
  return found?.[1] && found[2] ? { meetingId: found[1], participantId: found[2] } : undefined;
}

export const roomHref = (meetingId: string, participantId: string) =>
  `#/meetings/${meetingId}/room/${participantId}`;
