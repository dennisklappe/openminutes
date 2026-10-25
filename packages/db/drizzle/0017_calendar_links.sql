CREATE TABLE "meeting_calendar_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text NOT NULL,
	"url" text,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_calendar_links" ADD CONSTRAINT "meeting_calendar_links_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_calendar_links" ADD CONSTRAINT "meeting_calendar_links_source_id_meeting_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."meeting_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_calendar_links_source_idx" ON "meeting_calendar_links" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "meeting_calendar_links_meeting_idx" ON "meeting_calendar_links" USING btree ("meeting_id");