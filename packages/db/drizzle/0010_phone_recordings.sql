CREATE TABLE "known_voices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"samples" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "title_edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "voice_embedding" jsonb;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "name_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "name_suggestions" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "known_voices_name_idx" ON "known_voices" USING btree ("name");