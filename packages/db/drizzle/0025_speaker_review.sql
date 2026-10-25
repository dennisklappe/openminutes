ALTER TABLE "meetings" ADD COLUMN "speaker_check_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "speaker_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "speaker_check_error" text;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "speaker_confidence" real;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "speaker_source" text;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "speaker_candidates" jsonb;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "previous_participant_id" uuid;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_previous_participant_id_participants_id_fk" FOREIGN KEY ("previous_participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;