CREATE TABLE "skipped_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_key" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "series_key" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "skipped_series_key_idx" ON "skipped_series" USING btree ("series_key");