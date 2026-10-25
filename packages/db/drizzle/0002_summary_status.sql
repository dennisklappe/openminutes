ALTER TABLE "summaries" ALTER COLUMN "content" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "error" text;