CREATE TABLE "room_voices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"centroid" jsonb NOT NULL,
	"lines" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"person_id" uuid,
	"named_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "room_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "room_voice_id" uuid;--> statement-breakpoint
ALTER TABLE "room_voices" ADD CONSTRAINT "room_voices_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_voices" ADD CONSTRAINT "room_voices_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_voices" ADD CONSTRAINT "room_voices_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_voices_meeting_idx" ON "room_voices" USING btree ("meeting_id");--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_room_voice_id_room_voices_id_fk" FOREIGN KEY ("room_voice_id") REFERENCES "public"."room_voices"("id") ON DELETE set null ON UPDATE no action;