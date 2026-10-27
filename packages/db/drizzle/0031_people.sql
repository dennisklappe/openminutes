CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"voice_prototypes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"meeting_id" uuid,
	"segment_id" uuid,
	"embedding" jsonb,
	"embedder" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"rejected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "voice_doubt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "voice_scores" jsonb;--> statement-breakpoint
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_samples" ADD CONSTRAINT "voice_samples_segment_id_transcript_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."transcript_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_name_idx" ON "people" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "voice_samples_person_idx" ON "voice_samples" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_samples_line_idx" ON "voice_samples" USING btree ("person_id","segment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_samples_meeting_idx" ON "voice_samples" USING btree ("person_id","meeting_id") WHERE "voice_samples"."kind" = 'meeting';--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "people" ("name", "emails", "voice_prototypes")
SELECT DISTINCT ON (lower("name")) "name", '[]'::jsonb, '[]'::jsonb FROM (
	SELECT "name", 1 AS "rank" FROM "known_voices"
	UNION ALL SELECT "display_name", 2 FROM "participant_aliases"
	UNION ALL SELECT "display_name", 3 FROM "participants"
		WHERE "is_bot" = false AND ("name_confirmed" OR "email" IS NOT NULL OR "invitee_emails" <> '[]'::jsonb)
) AS "names"
WHERE btrim("name") <> '' AND "name" !~ '^Speaker [0-9]+$'
ORDER BY lower("name"), "rank", "name";--> statement-breakpoint
UPDATE "people" SET "emails" = "found"."emails" FROM (
	SELECT "key", jsonb_agg(DISTINCT "address") AS "emails" FROM (
		SELECT lower("name") AS "key", lower(btrim("email")) AS "address" FROM "known_voices" WHERE "email" IS NOT NULL
		UNION ALL SELECT lower("display_name"), lower(btrim("email")) FROM "participant_aliases" WHERE "email" IS NOT NULL
		UNION ALL SELECT lower("display_name"), lower(btrim("address")) FROM "participant_aliases", jsonb_array_elements_text("invitee_emails") AS "address"
		UNION ALL SELECT lower("display_name"), lower(btrim("email")) FROM "participants" WHERE "email" IS NOT NULL
		UNION ALL SELECT lower("display_name"), lower(btrim("address")) FROM "participants", jsonb_array_elements_text("invitee_emails") AS "address"
	) AS "all_addresses" WHERE "address" <> '' GROUP BY "key"
) AS "found" WHERE lower("people"."name") = "found"."key";--> statement-breakpoint
INSERT INTO "voice_samples" ("person_id", "kind", "embedding", "weight")
SELECT "people"."id", 'imported', "known_voices"."embedding", "known_voices"."samples"
FROM "known_voices" INNER JOIN "people" ON lower("people"."name") = lower("known_voices"."name");--> statement-breakpoint
UPDATE "people" SET "voice_prototypes" = jsonb_build_array(jsonb_build_object('vector', "known_voices"."embedding", 'samples', "known_voices"."samples"))
FROM "known_voices" WHERE lower("people"."name") = lower("known_voices"."name");--> statement-breakpoint
UPDATE "participants" SET "person_id" = "people"."id" FROM "people"
WHERE "participants"."is_bot" = false AND lower("participants"."display_name") = lower("people"."name");
