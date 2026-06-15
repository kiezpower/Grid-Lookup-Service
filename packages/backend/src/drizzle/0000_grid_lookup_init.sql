-- Grid Lookup Module — initial schema
-- Can be applied independently of KiezPower core migrations.
-- Requires: PostgreSQL 14+, pgcrypto (gen_random_uuid).

CREATE TABLE IF NOT EXISTS "grid_lookup_operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mastr_nummer" text NOT NULL,
	"name" text NOT NULL,
	"bdew_id" text,
	"street" text,
	"house_number" text,
	"zip_code" text,
	"city" text,
	"state" text,
	"country" text,
	"email" text,
	"phone" text,
	"website" text,
	"acer_code" text,
	"is_closed_grid" boolean DEFAULT false NOT NULL,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grid_lookup_operators_mastr_nummer_idx"
	ON "grid_lookup_operators" ("mastr_nummer");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zip_operator_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plz" text NOT NULL,
	"grid_operator_id" uuid NOT NULL,
	"vote_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "zip_operator_mapping"
		ADD CONSTRAINT "zip_operator_mapping_grid_operator_id_fkey"
		FOREIGN KEY ("grid_operator_id")
		REFERENCES "grid_lookup_operators"("id")
		ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zip_operator_mapping_plz_idx"
	ON "zip_operator_mapping" ("plz");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "zip_operator_mapping_plz_operator_idx"
	ON "zip_operator_mapping" ("plz", "grid_operator_id");
