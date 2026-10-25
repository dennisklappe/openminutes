ALTER TABLE "participants" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "participants" SET "is_bot" = true WHERE lower(trim(regexp_replace("display_name", '\s*\(guest\)\s*$', '', 'i'))) IN ('openminutes notetaker', 'klappe notetaker');
