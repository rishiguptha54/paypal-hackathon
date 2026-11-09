CREATE TYPE "public"."evaluation_decision" AS ENUM('ALLOWED', 'BLOCKED', 'NEEDS_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."mandate_status" AS ENUM('DRAFT', 'NEEDS_CLARIFICATION', 'CONFIRMED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."offer_source" AS ENUM('channel3', 'fixture');--> statement-breakpoint
CREATE TYPE "public"."recurrence_signal" AS ENUM('NONE', 'RECURRING', 'AMBIGUOUS');--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"offer_snapshot_id" uuid NOT NULL,
	"decision" "evaluation_decision" NOT NULL,
	"findings" jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evaluations_offer_snapshot_id_unique" UNIQUE("offer_snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"status" "mandate_status" NOT NULL,
	"request_text" text NOT NULL,
	"product_query" text,
	"quantity" integer,
	"max_total_minor" bigint,
	"currency" char(3),
	"allowed_merchant_domains" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"recurring_allowed" boolean DEFAULT false NOT NULL,
	"excluded_terms" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"clarification_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parser" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandates_quantity_check" CHECK ("mandates"."quantity" IS NULL OR "mandates"."quantity" BETWEEN 1 AND 100),
	CONSTRAINT "mandates_max_total_check" CHECK ("mandates"."max_total_minor" IS NULL OR "mandates"."max_total_minor" > 0),
	CONSTRAINT "mandates_confirmed_fields_check" CHECK ("mandates"."status" <> 'CONFIRMED' OR ("mandates"."quantity" IS NOT NULL AND "mandates"."max_total_minor" IS NOT NULL AND "mandates"."currency" = 'USD' AND cardinality("mandates"."allowed_merchant_domains") >= 1))
);
--> statement-breakpoint
CREATE TABLE "offer_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"source" "offer_source" NOT NULL,
	"source_product_id" text NOT NULL,
	"title" text NOT NULL,
	"brand" text,
	"merchant_name" text,
	"merchant_domain" text,
	"offer_url" text,
	"unit_amount_minor" bigint,
	"currency" char(3),
	"recurrence_signal" "recurrence_signal" NOT NULL,
	"recurrence_evidence" text,
	"raw_sha256" char(64) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "mandate_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "offer_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "mandate_hash" char(64);--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_offer_snapshot_id_offer_snapshots_id_fk" FOREIGN KEY ("offer_snapshot_id") REFERENCES "public"."offer_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_supersedes_id_mandates_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_snapshots" ADD CONSTRAINT "offer_snapshots_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mandates_session_created_idx" ON "mandates" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "offer_snapshots_mandate_idx" ON "offer_snapshots" USING btree ("mandate_id");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_offer_snapshot_id_offer_snapshots_id_fk" FOREIGN KEY ("offer_snapshot_id") REFERENCES "public"."offer_snapshots"("id") ON DELETE no action ON UPDATE no action;