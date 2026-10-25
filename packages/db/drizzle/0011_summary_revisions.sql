CREATE TABLE "summary_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"summary_id" uuid NOT NULL,
	"content" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "mode" text DEFAULT 'view' NOT NULL;--> statement-breakpoint
ALTER TABLE "summary_revisions" ADD CONSTRAINT "summary_revisions_summary_id_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "summary_revisions_summary_idx" ON "summary_revisions" USING btree ("summary_id","created_at");