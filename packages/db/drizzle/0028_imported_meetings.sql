ALTER TABLE "meetings" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_external_id_idx" ON "meetings" USING btree ("external_id");