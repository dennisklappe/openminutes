CREATE TABLE "minute_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "company_source" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "minute_folders" ADD CONSTRAINT "minute_folders_parent_id_minute_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."minute_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_folder_id_minute_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."minute_folders"("id") ON DELETE set null ON UPDATE no action;