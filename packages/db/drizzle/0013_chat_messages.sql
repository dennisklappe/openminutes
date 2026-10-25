CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"sender" text NOT NULL,
	"text" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"offset_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_dedupe_idx" ON "chat_messages" USING btree ("meeting_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "chat_messages_meeting_offset_idx" ON "chat_messages" USING btree ("meeting_id","offset_ms");