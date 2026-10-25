ALTER TABLE "summaries" ADD COLUMN "origin" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "summaries" ADD COLUMN "restored_from" uuid;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_restored_from_summaries_id_fk" FOREIGN KEY ("restored_from") REFERENCES "public"."summaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "summaries" ("meeting_id", "provider", "model", "status", "content", "origin", "restored_from", "created_at")
SELECT
	s."meeting_id",
	'manual',
	'',
	'done',
	COALESCE(r."content", s."content"),
	CASE WHEN r."content" IS NULL THEN 'restore' WHEN r."source" = 'link' THEN 'link' ELSE 'edit' END,
	CASE WHEN r."content" IS NULL THEN s."id" END,
	CASE
		WHEN s."id" = (
			SELECT l."id" FROM "summaries" l
			WHERE l."meeting_id" = s."meeting_id" AND l."status" = 'done'
			ORDER BY l."created_at" DESC, l."id" DESC LIMIT 1
		) THEN r."created_at"
		ELSE s."created_at" + make_interval(secs => r."rank" / 1000.0)
	END
FROM (
	SELECT *, row_number() OVER (PARTITION BY "summary_id" ORDER BY "created_at", "id") AS "rank"
	FROM "summary_revisions"
) r
JOIN "summaries" s ON s."id" = r."summary_id"
WHERE s."origin" = 'ai';--> statement-breakpoint
DROP TABLE "summary_revisions";
