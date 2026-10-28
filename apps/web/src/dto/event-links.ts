/** A calendar meeting a recording can be linked to: one the bot does not (or did not) join. */
export interface LinkableEventDto {
  id: string;
  title: string;
  scheduledStart: string;
  status: 'scheduled' | 'skipped';
  location: string | null;
  /** The people on the invitation who did not decline. */
  people: number;
  /** The first few invitee names, for the picker to show who is expected. */
  names: string[];
}

export interface LinkableEventsDto {
  items: LinkableEventDto[];
}

export interface LinkEventInput {
  /** The calendar meeting to link to. */
  eventId: string;
}
