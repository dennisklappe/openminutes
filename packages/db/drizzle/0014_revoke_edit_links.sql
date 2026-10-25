UPDATE "share_links" SET "revoked_at" = now() WHERE "mode" = 'edit' AND "revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "share_links" DROP COLUMN "mode";
