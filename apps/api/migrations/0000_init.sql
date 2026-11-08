CREATE TYPE "public"."payment_op_channel" AS ENUM('mcp', 'rest');--> statement-breakpoint
CREATE TYPE "public"."payment_op_kind" AS ENUM('CREATE_ORDER', 'CAPTURE');--> statement-breakpoint
CREATE TYPE "public"."payment_op_status" AS ENUM('STARTED', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."purchase_state" AS ENUM('PENDING_APPROVAL', 'APPROVED', 'ORDER_CREATED', 'CAPTURING', 'CAPTURED', 'CAPTURE_PENDING', 'CAPTURE_FAILED', 'BLOCKED_AT_CAPTURE', 'CANCELLED', 'EXPIRED', 'REVERSED');--> statement-breakpoint
CREATE TABLE "payment_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"kind" "payment_op_kind" NOT NULL,
	"channel" "payment_op_channel" NOT NULL,
	"mcp_tool" text,
	"paypal_request_id" uuid NOT NULL,
	"status" "payment_op_status" DEFAULT 'STARTED' NOT NULL,
	"http_status" integer,
	"paypal_debug_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_operations_capture_is_rest" CHECK ("payment_operations"."kind" <> 'CAPTURE' OR "payment_operations"."channel" = 'rest')
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"state" "purchase_state" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_at" timestamp with time zone,
	"approval_expires_at" timestamp with time zone,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"paypal_status" text,
	"block_reasons" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_total_check" CHECK ("purchases"."total_minor" = "purchases"."unit_amount_minor" * "purchases"."quantity"),
	CONSTRAINT "purchases_quantity_check" CHECK ("purchases"."quantity" BETWEEN 1 AND 100),
	CONSTRAINT "purchases_currency_check" CHECK ("purchases"."currency" = 'USD'),
	CONSTRAINT "purchases_unit_positive_check" CHECK ("purchases"."unit_amount_minor" > 0),
	CONSTRAINT "purchases_captured_has_capture_id" CHECK ("purchases"."state" <> 'CAPTURED' OR "purchases"."paypal_capture_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_operations_purchase_kind_uq" ON "payment_operations" USING btree ("purchase_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_operations_request_id_uq" ON "payment_operations" USING btree ("paypal_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_paypal_order_id_uq" ON "purchases" USING btree ("paypal_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_paypal_capture_id_uq" ON "purchases" USING btree ("paypal_capture_id");--> statement-breakpoint
CREATE INDEX "purchases_session_idx" ON "purchases" USING btree ("session_id");