CREATE TABLE "meeting_invitees" (
	"meeting_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "meeting_invitees_meeting_id_person_id_pk" PRIMARY KEY("meeting_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_invitees" ADD CONSTRAINT "meeting_invitees_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_invitees" ADD CONSTRAINT "meeting_invitees_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_invitees_person_idx" ON "meeting_invitees" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "participants_person_idx" ON "participants" USING btree ("person_id");--> statement-breakpoint
UPDATE "people" SET "source" = 'joined' WHERE EXISTS (SELECT 1 FROM "participants" WHERE "participants"."person_id" = "people"."id");
