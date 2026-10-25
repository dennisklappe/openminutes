ALTER TABLE "meetings" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "meetings_deleted_at_idx" ON "meetings" USING btree ("deleted_at");