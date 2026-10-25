CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"join_rule" text DEFAULT 'never' NOT NULL,
	"sync_state" jsonb
);
--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "calendar_id" uuid;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_account_id_calendar_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_external_idx" ON "calendars" USING btree ("account_id","external_id");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_accounts_account_idx" ON "calendar_accounts" USING btree ("provider","account_email");--> statement-breakpoint
CREATE UNIQUE INDEX "meetings_calendar_event_idx" ON "meetings" USING btree ("calendar_id","calendar_event_id");--> statement-breakpoint
ALTER TABLE "calendar_accounts" DROP COLUMN "sync_state";