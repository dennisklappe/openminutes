CREATE TABLE "participant_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_name" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "original_name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "participant_aliases_original_idx" ON "participant_aliases" USING btree (lower("original_name"));