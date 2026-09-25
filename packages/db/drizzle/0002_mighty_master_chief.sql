CREATE TABLE "family_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name_ciphertext" text NOT NULL,
	"name_key_version" integer NOT NULL,
	"dob_ciphertext" text,
	"dob_key_version" integer,
	"info_ciphertext" text,
	"info_key_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "family_name_kana_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "family_name_kana_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "given_name_kana_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "given_name_kana_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_blind_index" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "parking_area_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "parking_area_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "parking_detail_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "parking_detail_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "emergency_contact_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "emergency_contact_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "emergency_contact_relation_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "emergency_contact_relation_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "evacuation_site_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "evacuation_site_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "memo_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "memo_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "benefit_member_id_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "benefit_member_id_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address2_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address2_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address2_start_date" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address2_end_date" date;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lat_lng_ciphertext" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lat_lng_key_version" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "member_type" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "member_status" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_status" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "age_bracket" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "registered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "external_last_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_external_idx" ON "customers" USING btree ("tenant_id","external_source","external_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "family_members" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);