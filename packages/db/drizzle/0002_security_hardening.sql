CREATE TABLE "rate_limit_buckets" (
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_buckets_pk" PRIMARY KEY("bucket","key_hash"),
	CONSTRAINT "rate_limit_buckets_count_check" CHECK ("rate_limit_buckets"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD COLUMN "mail_code_ciphertext" text;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD COLUMN "mail_code_key_version" integer;--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_updated_at_idx" ON "rate_limit_buckets" USING btree ("updated_at");