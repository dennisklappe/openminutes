ALTER TABLE "transcript_segments" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "voice_samples" ADD COLUMN "language" text DEFAULT 'und' NOT NULL;--> statement-breakpoint
UPDATE "transcript_segments" s SET "language" = lower(split_part(btrim(m."language"), '-', 1)) FROM "meetings" m WHERE m."id" = s."meeting_id" AND nullif(btrim(m."language"), '') IS NOT NULL;--> statement-breakpoint
UPDATE "voice_samples" v SET "language" = coalesce(
  (SELECT s."language" FROM "transcript_segments" s WHERE s."id" = v."segment_id"),
  (SELECT lower(split_part(btrim(m."language"), '-', 1)) FROM "meetings" m WHERE m."id" = v."meeting_id" AND nullif(btrim(m."language"), '') IS NOT NULL),
  'und'
);--> statement-breakpoint
UPDATE "people" p SET "voice_prototypes" = (
  SELECT coalesce(jsonb_agg(proto || jsonb_build_object('language', d."language")), '[]'::jsonb)
  FROM jsonb_array_elements(p."voice_prototypes") proto
)
FROM (
  SELECT DISTINCT ON ("person_id") "person_id", "language"
  FROM "voice_samples" WHERE NOT "rejected" AND "embedding" IS NOT NULL
  GROUP BY "person_id", "language"
  ORDER BY "person_id", sum("weight") DESC, "language"
) d
WHERE d."person_id" = p."id" AND jsonb_array_length(p."voice_prototypes") > 0;
