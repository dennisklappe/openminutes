CREATE TABLE "voice_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_person_id" uuid,
	"language" text DEFAULT 'und' NOT NULL,
	"mismatch" real NOT NULL,
	"sample_segment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "voice_samples" ADD COLUMN "pruned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_reviews" ADD CONSTRAINT "voice_reviews_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_reviews" ADD CONSTRAINT "voice_reviews_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_reviews" ADD CONSTRAINT "voice_reviews_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_reviews" ADD CONSTRAINT "voice_reviews_decided_person_id_people_id_fk" FOREIGN KEY ("decided_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_reviews_voice_idx" ON "voice_reviews" USING btree ("meeting_id","participant_id");--> statement-breakpoint
CREATE INDEX "voice_reviews_status_idx" ON "voice_reviews" USING btree ("status");