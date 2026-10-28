CREATE TABLE "shared_account_voices" (
	"account_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"person_id" uuid NOT NULL,
	"centroid" jsonb,
	CONSTRAINT "shared_account_voices_account_id_number_pk" PRIMARY KEY("account_id","number")
);
--> statement-breakpoint
CREATE TABLE "shared_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_accounts_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "room_count" integer;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "room_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "unnamed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_account_voices" ADD CONSTRAINT "shared_account_voices_account_id_shared_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."shared_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_account_voices" ADD CONSTRAINT "shared_account_voices_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_account_voices_person_idx" ON "shared_account_voices" USING btree ("person_id");--> statement-breakpoint
UPDATE "participants" SET "voice_embedding" = NULL WHERE "id" IN (SELECT "participant_id" FROM "room_voices");
