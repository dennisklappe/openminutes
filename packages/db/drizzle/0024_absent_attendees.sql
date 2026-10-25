ALTER TABLE "meetings" ADD COLUMN "dismissed_invitees" jsonb;--> statement-breakpoint
ALTER TABLE "participant_aliases" ADD COLUMN "invitee_email" text;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "invitee_email" text;