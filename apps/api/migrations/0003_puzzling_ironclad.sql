CREATE TYPE "public"."drift_kind" AS ENUM('PRICE_HIKE', 'MERCHANT_SWAP', 'APPROVAL_EXPIRED');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"mandate_id" uuid,
	"purchase_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" char(64) NOT NULL,
	"entry_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_captured_has_capture_id";--> statement-breakpoint
ALTER TABLE "mandates" ADD COLUMN "seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_operations" ADD COLUMN "result_order_id" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "simulated_drift" "drift_kind";--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_session_seq_idx" ON "audit_events" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "audit_events_purchase_seq_idx" ON "audit_events" USING btree ("purchase_id","seq");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_captured_has_capture_id" CHECK ("purchases"."seeded" OR "purchases"."state" <> 'CAPTURED' OR "purchases"."paypal_capture_id" IS NOT NULL);--> statement-breakpoint
UPDATE purchases SET block_reasons = (
  SELECT jsonb_agg(
    CASE WHEN jsonb_typeof(reason) = 'string' THEN
      jsonb_build_object('code',
        CASE reason #>> '{}'
          WHEN 'ORDER_ID_MISMATCH' THEN 'ORDER_MISMATCH'
          WHEN 'ORDER_NOT_APPROVED' THEN 'PAYPAL_NOT_APPROVED'
          ELSE reason #>> '{}'
        END,
        'severity', 'BLOCKING', 'message', 'Capture verification failed.', 'evidence', '{}'::jsonb)
    ELSE reason END)
  FROM jsonb_array_elements(block_reasons) AS reason
) WHERE block_reasons IS NOT NULL;--> statement-breakpoint
CREATE FUNCTION forbid_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'audit_events is append-only'; END $$;--> statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();--> statement-breakpoint
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_mutation();