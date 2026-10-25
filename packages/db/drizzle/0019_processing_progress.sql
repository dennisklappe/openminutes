ALTER TABLE "meetings" ADD COLUMN "processing_step" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "processing_current" integer;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "processing_total" integer;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "processing_started_at" timestamp with time zone;