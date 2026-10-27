import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const meetingPlatforms = ['meet', 'teams', 'recording', 'imported'] as const;
export const meetingStatuses = [
  'scheduled',
  'uploading',
  'joining',
  'in_lobby',
  'recording',
  'ended',
  'processing',
  'transcribed',
  'failed',
  'cancelled',
  'skipped',
] as const;
export const activeMeetingStatuses = ['joining', 'in_lobby', 'recording'] as const;
export const calendarProviders = ['google', 'microsoft'] as const;
export const joinRules = ['all', 'organizer', 'external', 'never'] as const;

export const summaryStatuses = ['pending', 'done', 'failed'] as const;
export const summaryOrigins = ['ai', 'ai-edit', 'edit', 'link', 'restore', 'rename'] as const;
export const calendarLinkStatuses = [
  'added',
  'failed',
  'no_permission',
  'needs_reconnect',
] as const;
export const companySources = ['calendar', 'ai', 'manual'] as const;
export const speakerSources = ['indicator', 'diarization', 'user', 'ai', 'guess'] as const;
/** marked: a person said the line has two speakers. probable: the voice guard thinks so. */
export const mixedStates = ['marked', 'probable'] as const;
export const shareEmailStatuses = ['sent', 'failed'] as const;

export type CompanySource = (typeof companySources)[number];
export type SpeakerSource = (typeof speakerSources)[number];
export type MixedState = (typeof mixedStates)[number];
export type SummaryOrigin = (typeof summaryOrigins)[number];
export type MeetingPlatform = (typeof meetingPlatforms)[number];
export type MeetingStatus = (typeof meetingStatuses)[number];
export type CalendarProviderId = (typeof calendarProviders)[number];
export type JoinRule = (typeof joinRules)[number];

export interface CalendarSyncState {
  token: string;
  windowEnd: string;
}

export interface CalendarInvitee {
  email: string;
  name: string | null;
  declined: boolean;
}
export type SummaryStatus = (typeof summaryStatuses)[number];

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid('id').primaryKey().defaultRandom();
const meetingId = () =>
  uuid('meeting_id')
    .notNull()
    .references(() => meetings.id, { onDelete: 'cascade' });

export const minuteFolders = pgTable('minute_folders', {
  id: id(),
  name: text('name').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => minuteFolders.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const meetings = pgTable(
  'meetings',
  {
    id: id(),
    title: text('title').notNull(),
    platform: text('platform', { enum: meetingPlatforms }).notNull(),
    joinUrl: text('join_url').notNull(),
    joinKey: text('join_key'),
    /** Where an imported meeting came from, such as `fireflies:<id>`. Importing it again is skipped. */
    externalId: text('external_id'),
    titleEdited: boolean('title_edited').notNull().default(false),
    seriesKey: text('series_key'),
    allowDuplicate: boolean('allow_duplicate').notNull().default(false),
    scheduledStart: timestamptz('scheduled_start'),
    location: text('location'),
    invitees: jsonb('invitees').$type<CalendarInvitee[]>(),
    dismissedInvitees: jsonb('dismissed_invitees').$type<string[]>(),
    startedAt: timestamptz('started_at'),
    endedAt: timestamptz('ended_at'),
    audioDeletedAt: timestamptz('audio_deleted_at'),
    archivedAt: timestamptz('archived_at'),
    deletedAt: timestamptz('deleted_at'),
    company: text('company'),
    companySource: text('company_source', { enum: companySources }),
    folderId: uuid('folder_id').references(() => minuteFolders.id, { onDelete: 'set null' }),
    speakersRefined: boolean('speakers_refined').notNull().default(false),
    /** The last time a person changed who said a line. Automatic and AI changes do not set it. */
    speakersChangedAt: timestamptz('speakers_changed_at'),
    /** When the owner dismissed the notice that the summary is older than the speakers. */
    speakersNoticeDismissedAt: timestamptz('speakers_notice_dismissed_at'),
    speakerCheckRequestedAt: timestamptz('speaker_check_requested_at'),
    speakerCheckedAt: timestamptz('speaker_checked_at'),
    speakerCheckError: text('speaker_check_error'),
    language: text('language'),
    speakerCount: integer('speaker_count'),
    processingStep: text('processing_step'),
    processingCurrent: integer('processing_current'),
    processingTotal: integer('processing_total'),
    processingStartedAt: timestamptz('processing_started_at'),
    trimStartMs: integer('trim_start_ms'),
    trimEndMs: integer('trim_end_ms'),
    claimedAt: timestamptz('claimed_at'),
    heartbeatAt: timestamptz('heartbeat_at'),
    status: text('status', { enum: meetingStatuses }).notNull().default('scheduled'),
    error: text('error'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('meetings_created_at_idx').on(t.createdAt),
    index('meetings_deleted_at_idx').on(t.deletedAt),
    uniqueIndex('meetings_join_key_start_idx').on(t.joinKey, t.scheduledStart),
    uniqueIndex('meetings_external_id_idx').on(t.externalId),
  ],
);

export interface SpeakerCandidate {
  participantId: string;
  score: number;
}

export interface NameSuggestion {
  name: string;
  source: 'conversation' | 'voice' | 'calendar';
}

export interface VoicePrototype {
  vector: number[];
  /** How many samples this vector stands for. */
  samples: number;
  /** The language of the samples, a person keeps up to 5 vectors per language. Missing: 'und'. */
  language?: string;
}

/** How a person came to be known: added by hand, was in a meeting, or only on an invitation. */
export const personSources = ['manual', 'joined', 'invited'] as const;
export type PersonSource = (typeof personSources)[number];
export type PersonTracking = 'on' | 'off';

export const voiceSampleKinds = ['line', 'meeting', 'imported'] as const;
export type VoiceSampleKind = (typeof voiceSampleKinds)[number];

/** verified: a person confirmed the line. auto: added by itself from a near-certain line. */
export const voiceSampleSources = ['verified', 'auto'] as const;
export type VoiceSampleSource = (typeof voiceSampleSources)[number];

/** Someone the owner knows: a name, any number of emails and, when allowed, a voice profile. */
export const people = pgTable(
  'people',
  {
    id: id(),
    name: text('name').notNull(),
    notes: text('notes'),
    source: text('source').$type<PersonSource>().notNull().default('manual'),
    /** 'off' means do not track: no voice is learned or suggested, the name stays in transcripts. */
    tracking: text('tracking').$type<PersonTracking>().notNull().default('on'),
    /** Added to the margin a line needs to be learned by itself, raised when an auto sample is rejected. */
    autoMargin: real('auto_margin').notNull().default(0),
    /** A voice of a shared account that nobody gave a name yet, named "Voice 1 (Ann and Sam)". */
    unnamed: boolean('unnamed').notNull().default(false),
    /** Lower case. A person may have none, one or several. */
    emails: jsonb('emails').$type<string[]>().notNull().default([]),
    /** Up to 5 vectors built from the voice samples, matched by the highest cosine. */
    voicePrototypes: jsonb('voice_prototypes').$type<VoicePrototype[]>().notNull().default([]),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('people_name_idx').on(sql`lower(${t.name})`)],
);

export const participants = pgTable(
  'participants',
  {
    id: id(),
    meetingId: meetingId(),
    displayName: text('display_name').notNull(),
    originalName: text('original_name'),
    isBot: boolean('is_bot').notNull().default(false),
    email: text('email'),
    /** Replaced by inviteeEmails, kept so a rollback still finds the data. */
    inviteeEmail: text('invitee_email'),
    /** Every calendar invitee this person is, set by the owner. One person may use several emails. */
    inviteeEmails: jsonb('invitee_emails').$type<string[]>().notNull().default([]),
    joinedAt: timestamptz('joined_at'),
    leftAt: timestamptz('left_at'),
    voiceEmbedding: jsonb('voice_embedding').$type<number[]>(),
    nameConfirmed: boolean('name_confirmed').notNull().default(false),
    nameSuggestions: jsonb('name_suggestions').$type<NameSuggestion[]>(),
    personId: uuid('person_id').references((): AnyPgColumn => people.id, { onDelete: 'set null' }),
    /** The owner said this tile is one person, so it is not offered as a shared room again. */
    roomDismissedAt: timestamptz('room_dismissed_at'),
    /** How many people the owner (or a remembered account) says are in this tile. Null: not known. */
    roomCount: integer('room_count'),
    /** When the question how many people was raised, the summary waits for the answer from then. */
    roomAskedAt: timestamptz('room_asked_at'),
  },
  (t) => [index('participants_person_idx').on(t.personId)],
);

/**
 * One voice found in a participant tile that probably holds several people (a meeting room). The
 * centroid is a voice print of someone who may not be known yet, so it is deleted with the
 * meeting, when voices are forgotten, and when the owner says the tile is one person. Nothing in
 * the transcript changes until the owner gives the voice a person.
 */
export const roomVoices = pgTable(
  'room_voices',
  {
    id: id(),
    meetingId: meetingId(),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id, { onDelete: 'cascade' }),
    /** 1, 2, ... within the tile, the voice with the most speech first. */
    number: integer('number').notNull(),
    centroid: jsonb('centroid').$type<number[]>().notNull(),
    /** Lines that formed the voice and the speech in them. */
    lines: integer('lines').notNull(),
    durationMs: integer('duration_ms').notNull(),
    /** Who the owner said it is. Null: not named yet. */
    personId: uuid('person_id').references((): AnyPgColumn => people.id, { onDelete: 'set null' }),
    namedAt: timestamptz('named_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('room_voices_meeting_idx').on(t.meetingId)],
);

/**
 * A participant tile that holds several people, known by its email or else its normalised name,
 * so the next meeting from it skips the question. `count` is what the owner answered and stays
 * null while the row only anchors the people made for its voices.
 */
export const sharedAccounts = pgTable('shared_accounts', {
  id: id(),
  /** `email:<address>` or `name:<lower case name>`. */
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  count: integer('count'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

/** The person that stands for voice `number` of a shared account, the same in every meeting. */
export const sharedAccountVoices = pgTable(
  'shared_account_voices',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => sharedAccounts.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references((): AnyPgColumn => people.id, { onDelete: 'cascade' }),
    /** How this voice sounded last time, so the next meeting finds the same person by ear. */
    centroid: jsonb('centroid').$type<number[]>(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.number] }),
    index('shared_account_voices_person_idx').on(t.personId),
  ],
);

/** A person who was invited to a meeting, whether or not they joined. One row per person and meeting. */
export const meetingInvitees = pgTable(
  'meeting_invitees',
  {
    meetingId: meetingId(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.meetingId, t.personId] }),
    index('meeting_invitees_person_idx').on(t.personId),
  ],
);

export const participantAliases = pgTable(
  'participant_aliases',
  {
    id: id(),
    originalName: text('original_name').notNull(),
    displayName: text('display_name').notNull(),
    /** Replaced by inviteeEmails, kept so a rollback still finds the data. */
    inviteeEmail: text('invitee_email'),
    inviteeEmails: jsonb('invitee_emails').$type<string[]>().notNull().default([]),
    /** An address for a person who is not on the invitation. */
    email: text('email'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('participant_aliases_original_idx').on(sql`lower(${t.originalName})`)],
);

export const knownVoices = pgTable(
  'known_voices',
  {
    id: id(),
    name: text('name').notNull(),
    embedding: jsonb('embedding').$type<number[]>().notNull(),
    email: text('email'),
    samples: integer('samples').notNull().default(1),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('known_voices_name_idx').on(t.name)],
);

/** One verified stretch of someone's voice, the unit a voice profile is built from. */
export const voiceSamples = pgTable(
  'voice_samples',
  {
    id: id(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: voiceSampleKinds }).notNull(),
    meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
    segmentId: uuid('segment_id').references((): AnyPgColumn => transcriptSegments.id, {
      onDelete: 'set null',
    }),
    /** Null while the worker has not embedded the line yet. */
    embedding: jsonb('embedding').$type<number[]>(),
    /** Which embedding model made the vector, so a model change can be told apart. */
    embedder: text('embedder'),
    durationMs: integer('duration_ms').notNull().default(0),
    /** How many earlier samples an imported vector stands for. */
    weight: integer('weight').notNull().default(1),
    /** The language of the speech, so a person gets one voice profile per language. 'und': unknown. */
    language: text('language').notNull().default('und'),
    source: text('source', { enum: voiceSampleSources }).notNull().default('verified'),
    /** A line the owner said is not this person, kept so it is not offered again. */
    rejected: boolean('rejected').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('voice_samples_person_idx').on(t.personId),
    uniqueIndex('voice_samples_line_idx').on(t.personId, t.segmentId),
    uniqueIndex('voice_samples_meeting_idx')
      .on(t.personId, t.meetingId)
      .where(sql`${t.kind} = 'meeting'`),
  ],
);

export const audioFiles = pgTable('audio_files', {
  id: id(),
  meetingId: meetingId(),
  path: text('path').notNull(),
  durationMs: integer('duration_ms').notNull(),
  codec: text('codec').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
});

const participantRef = () => uuid('participant_id').references(() => participants.id);

export const speakerEvents = pgTable('speaker_events', {
  id: id(),
  meetingId: meetingId(),
  participantId: participantRef().notNull(),
  startMs: integer('start_ms').notNull(),
  endMs: integer('end_ms').notNull(),
});

export const transcriptSegments = pgTable('transcript_segments', {
  id: id(),
  meetingId: meetingId(),
  participantId: participantRef(),
  startMs: integer('start_ms').notNull(),
  endMs: integer('end_ms').notNull(),
  text: text('text').notNull(),
  confidence: real('confidence'),
  speakerConfidence: real('speaker_confidence'),
  speakerSource: text('speaker_source', { enum: speakerSources }),
  speakerCandidates: jsonb('speaker_candidates').$type<SpeakerCandidate[]>(),
  previousParticipantId: uuid('previous_participant_id').references(
    (): AnyPgColumn => participants.id,
    { onDelete: 'set null' },
  ),
  /** The speaker the review thinks is right when it disagrees with the label, never applied by itself. */
  suggestedParticipantId: uuid('suggested_participant_id').references(
    (): AnyPgColumn => participants.id,
    { onDelete: 'set null' },
  ),
  /** The voice check found the line closer to another saved voice than to the label. */
  voiceDoubt: boolean('voice_doubt').notNull().default(false),
  /**
   * The label or the suggestion comes from elimination: the voice matches none of the people with
   * a saved voice and one participant is left. Only reviewed, never learned from by itself.
   */
  byElimination: boolean('by_elimination').notNull().default(false),
  /** How well each meeting participant's saved voice fits the line, best first. */
  voiceScores: jsonb('voice_scores').$type<SpeakerCandidate[]>(),
  /**
   * The language spoken in this line, a two letter code. The transcription gives one language per
   * meeting, so this is that language unless a provider names one per line. Null: not known.
   */
  language: text('language'),
  /** The voice of a shared tile this line sounds like. Null: not assigned, overlap or too short. */
  roomVoiceId: uuid('room_voice_id').references((): AnyPgColumn => roomVoices.id, {
    onDelete: 'set null',
  }),
  /** Speakers a person turned down for this line, so the review does not suggest them again. */
  rejectedSuggestions: jsonb('rejected_suggestions').$type<string[]>().notNull().default([]),
  /**
   * The line holds two speakers. Either way it never trains a voice. `marked` also keeps it out of
   * the review queues, `probable` is asked about with a split offered.
   */
  mixed: text('mixed', { enum: mixedStates }),
});

export const reviewDecisionKinds = ['skip', 'approve', 'reject', 'move', 'mixed', 'split'] as const;
export type ReviewDecisionKind = (typeof reviewDecisionKinds)[number];

/** What a line looked like before a review decision, so Undo can put it back. */
export interface SegmentSnapshot {
  participantId: string | null;
  speakerSource: SpeakerSource | null;
  suggestedParticipantId: string | null;
  voiceDoubt: boolean;
  /** Missing in snapshots taken before elimination existed. */
  byElimination?: boolean;
  previousParticipantId: string | null;
  rejectedSuggestions: string[];
  /** Missing in snapshots taken before mixed lines existed. */
  mixed?: MixedState | null;
  /** A split changed the line itself: the text and end it had. */
  text?: string;
  endMs?: number;
  /** The lines a split added next to it, removed again by Undo. */
  parts?: string[];
}

/**
 * The last review decision per line. A skip hides the line from the review queue for the person
 * it was proposed for, until the user asks for the skipped lines or the proposal changes to
 * someone else. The other kinds keep the earlier state of the line for Undo.
 */
export const reviewDecisions = pgTable('review_decisions', {
  segmentId: uuid('segment_id')
    .primaryKey()
    .references(() => transcriptSegments.id, { onDelete: 'cascade' }),
  /** The person the line was proposed for (skip) or the person it was verified or rejected for. */
  personId: uuid('person_id')
    .notNull()
    .references(() => people.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: reviewDecisionKinds }).notNull(),
  before: jsonb('before').$type<SegmentSnapshot>(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const summaries = pgTable('summaries', {
  id: id(),
  meetingId: meetingId(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptId: text('prompt_id'),
  status: text('status', { enum: summaryStatuses }).notNull().default('pending'),
  error: text('error'),
  content: text('content').notNull().default(''),
  origin: text('origin', { enum: summaryOrigins }).notNull().default('ai'),
  note: text('note'),
  replay: text('replay'),
  restoredFrom: uuid('restored_from').references((): AnyPgColumn => summaries.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const calendarAccounts = pgTable(
  'calendar_accounts',
  {
    id: id(),
    provider: text('provider', { enum: calendarProviders }).notNull(),
    accountEmail: text('account_email').notNull(),
    encryptedTokens: text('encrypted_tokens').notNull(),
    lastError: text('last_error'),
    lastSyncedAt: timestamptz('last_synced_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('calendar_accounts_account_idx').on(t.provider, t.accountEmail)],
);

export const calendars = pgTable(
  'calendars',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    joinRule: text('join_rule', { enum: joinRules }).notNull().default('never'),
    syncState: jsonb('sync_state').$type<CalendarSyncState>(),
  },
  (t) => [uniqueIndex('calendars_external_idx').on(t.accountId, t.externalId)],
);

export const meetingSources = pgTable(
  'meeting_sources',
  {
    id: id(),
    meetingId: meetingId(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    calendarEventId: text('calendar_event_id').notNull(),
    joinable: boolean('joinable').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meeting_sources_event_idx').on(t.calendarId, t.calendarEventId),
    index('meeting_sources_meeting_idx').on(t.meetingId),
  ],
);

export const meetingCalendarLinks = pgTable(
  'meeting_calendar_links',
  {
    id: id(),
    meetingId: meetingId(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => meetingSources.id, { onDelete: 'cascade' }),
    status: text('status', { enum: calendarLinkStatuses }).notNull(),
    url: text('url'),
    error: text('error'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('meeting_calendar_links_source_idx').on(t.sourceId),
    index('meeting_calendar_links_meeting_idx').on(t.meetingId),
  ],
);

export const skippedSeries = pgTable(
  'skipped_series',
  {
    id: id(),
    seriesKey: text('series_key').notNull(),
    title: text('title').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('skipped_series_key_idx').on(t.seriesKey)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  secret: boolean('secret').notNull().default(false),
});

export const shareLinks = pgTable(
  'share_links',
  {
    id: id(),
    meetingId: meetingId(),
    token: text('token').notNull(),
    includeTranscript: boolean('include_transcript').notNull().default(false),
    includeChat: boolean('include_chat').notNull().default(false),
    includeLinks: boolean('include_links').notNull().default(false),
    expiresAt: timestamptz('expires_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('share_links_token_idx').on(t.token),
    index('share_links_meeting_idx').on(t.meetingId),
  ],
);

export const meetingExports = pgTable(
  'meeting_exports',
  {
    id: id(),
    meetingId: meetingId(),
    exporterId: text('exporter_id').notNull(),
    ref: text('ref').notNull(),
    url: text('url').notNull(),
    /** What went into the output: the minutes always, these parts when ticked. */
    includeTranscript: boolean('include_transcript').notNull().default(false),
    includeChat: boolean('include_chat').notNull().default(false),
    includeLinks: boolean('include_links').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('meeting_exports_meeting_exporter_idx').on(t.meetingId, t.exporterId)],
);

export const shareEmails = pgTable(
  'share_emails',
  {
    id: id(),
    meetingId: meetingId(),
    recipient: text('recipient').notNull(),
    items: jsonb('items').$type<string[]>().notNull(),
    shareLinkId: uuid('share_link_id').references(() => shareLinks.id, { onDelete: 'set null' }),
    subject: text('subject').notNull(),
    status: text('status', { enum: shareEmailStatuses }).notNull(),
    error: text('error'),
    sentAt: timestamptz('sent_at').notNull().defaultNow(),
  },
  (t) => [index('share_emails_meeting_idx').on(t.meetingId, t.recipient)],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: id(),
    meetingId: meetingId(),
    dedupeKey: text('dedupe_key').notNull(),
    sender: text('sender').notNull(),
    text: text('text').notNull(),
    links: jsonb('links').$type<string[]>().notNull().default([]),
    sentAt: timestamptz('sent_at').notNull(),
    offsetMs: integer('offset_ms').notNull(),
  },
  (t) => [
    uniqueIndex('chat_messages_dedupe_idx').on(t.meetingId, t.dedupeKey),
    index('chat_messages_meeting_offset_idx').on(t.meetingId, t.offsetMs),
  ],
);
