ALTER TABLE "known_voices" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "participant_aliases" ADD COLUMN "invitee_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "participant_aliases" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "invitee_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "participants" SET "invitee_emails" = jsonb_build_array("invitee_email") WHERE "invitee_email" IS NOT NULL;--> statement-breakpoint
UPDATE "participant_aliases" SET "invitee_emails" = jsonb_build_array("invitee_email") WHERE "invitee_email" IS NOT NULL;