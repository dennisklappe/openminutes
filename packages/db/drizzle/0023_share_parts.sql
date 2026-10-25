ALTER TABLE "meeting_exports" ADD COLUMN "include_transcript" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_exports" ADD COLUMN "include_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_exports" ADD COLUMN "include_links" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "include_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "include_links" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "share_links" SET
  "include_chat" = "include_transcript" AND NOT EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'minutes.include_chat' AND "value" = 'false'),
  "include_links" = "include_transcript" AND EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'minutes.links_tab' AND "value" = 'true') AND NOT EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'minutes.transcript_placement' AND "value" = 'inline');--> statement-breakpoint
UPDATE "meeting_exports" SET
  "include_transcript" = s."include_transcript",
  "include_chat" = s."include_chat",
  "include_links" = s."include_links"
FROM "share_links" s WHERE "meeting_exports"."exporter_id" = 'share-link' AND "meeting_exports"."ref" = s."id"::text;
