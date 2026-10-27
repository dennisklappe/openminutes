ALTER TABLE "people" ADD COLUMN "auto_margin" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_samples" ADD COLUMN "source" text DEFAULT 'verified' NOT NULL;