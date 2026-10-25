CREATE TABLE "meeting_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"calendar_event_id" text NOT NULL,
	"joinable" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "join_key" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "allow_duplicate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_sources" ADD CONSTRAINT "meeting_sources_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_sources" ADD CONSTRAINT "meeting_sources_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "meeting_sources" ("meeting_id", "calendar_id", "calendar_event_id", "joinable")
SELECT "id", "calendar_id", "calendar_event_id", "status" = 'scheduled'
FROM "meetings"
WHERE "calendar_id" IS NOT NULL AND "calendar_event_id" IS NOT NULL;--> statement-breakpoint
UPDATE "meetings" SET "join_key" = CASE
	WHEN "join_url" ~* '^https?://(www\.)?meet\.google\.com/[^/?#]+' THEN
		'meet:' || lower(regexp_replace(substring("join_url" from '(?i)^https?://(?:www\.)?meet\.google\.com/([^?#]*)'), '^/+|/+$', '', 'g'))
	WHEN "join_url" ~* '/l/meetup-join/[^/?#]+' THEN
		'teams:' || lower(replace(replace(lower(substring("join_url" from '(?i)/l/meetup-join/([^/?#]+)')), '%3a', ':'), '%40', '@'))
	WHEN "join_url" ~* '^https?://[^/?#]+/meet/[^/?#]+' THEN
		'teams-meet:' || lower((regexp_match("join_url", '(?i)^https?://([^/?#]+)/meet/([^/?#]+)'))[1] || '/' || (regexp_match("join_url", '(?i)^https?://([^/?#]+)/meet/([^/?#]+)'))[2])
END;--> statement-breakpoint
CREATE TEMPORARY TABLE "meeting_duplicates" ON COMMIT DROP AS
SELECT "id", "keeper" FROM (
	SELECT "id", first_value("id") OVER w AS "keeper", row_number() OVER w AS "rank"
	FROM "meetings"
	WHERE "join_key" IS NOT NULL AND "scheduled_start" IS NOT NULL
	WINDOW w AS (
		PARTITION BY "join_key", "scheduled_start"
		ORDER BY ("status" IN ('scheduled', 'cancelled')), ("status" = 'cancelled'), "created_at", "id"
	)
) ranked WHERE "rank" > 1;--> statement-breakpoint
UPDATE "meeting_sources" SET "meeting_id" = "meeting_duplicates"."keeper"
FROM "meeting_duplicates" WHERE "meeting_sources"."meeting_id" = "meeting_duplicates"."id";--> statement-breakpoint
UPDATE "meetings" SET
	"status" = CASE WHEN "status" = 'scheduled' THEN 'cancelled' ELSE "status" END,
	"join_key" = NULL
FROM "meeting_duplicates" WHERE "meetings"."id" = "meeting_duplicates"."id";--> statement-breakpoint
UPDATE "calendars" SET "sync_state" = NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_sources_event_idx" ON "meeting_sources" USING btree ("calendar_id","calendar_event_id");--> statement-breakpoint
CREATE INDEX "meeting_sources_meeting_idx" ON "meeting_sources" USING btree ("meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_join_key_start_idx" ON "meetings" USING btree ("join_key","scheduled_start");--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT "meetings_calendar_id_calendars_id_fk";--> statement-breakpoint
DROP INDEX "meetings_calendar_event_idx";--> statement-breakpoint
ALTER TABLE "meetings" DROP COLUMN "calendar_id";--> statement-breakpoint
ALTER TABLE "meetings" DROP COLUMN "calendar_event_id";
