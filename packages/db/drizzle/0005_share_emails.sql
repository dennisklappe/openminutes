CREATE TABLE "share_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"items" jsonb NOT NULL,
	"share_link_id" uuid,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_emails" ADD CONSTRAINT "share_emails_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_emails" ADD CONSTRAINT "share_emails_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_emails_meeting_idx" ON "share_emails" USING btree ("meeting_id","recipient");