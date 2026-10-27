ALTER TABLE "meetings" ADD COLUMN "speakers_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "speakers_notice_dismissed_at" timestamp with time zone;