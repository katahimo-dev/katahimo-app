CREATE TABLE "tenant_keys" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"dek_version" integer DEFAULT 1 NOT NULL,
	"wrapped_dek" text NOT NULL,
	"kek_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tenant_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accident_reports" DROP CONSTRAINT "accident_reports_staff_id_staff_id_fk";
--> statement-breakpoint
ALTER TABLE "accident_reports" DROP CONSTRAINT "accident_reports_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "attendance_days" DROP CONSTRAINT "attendance_days_staff_id_staff_id_fk";
--> statement-breakpoint
ALTER TABLE "daily_reports" DROP CONSTRAINT "daily_reports_staff_id_staff_id_fk";
--> statement-breakpoint
ALTER TABLE "daily_reports" DROP CONSTRAINT "daily_reports_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "family_members" DROP CONSTRAINT "family_members_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_staff_id_staff_id_fk";
--> statement-breakpoint
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_staff_id_staff_id_fk";
--> statement-breakpoint
DROP INDEX "outbox_jobs_idempotency_key_idx";--> statement-breakpoint
ALTER TABLE "tenant_keys" ADD CONSTRAINT "tenant_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 複合FKが参照する複合UNIQUE制約は、それを参照するFKより先に作成する必要がある
-- (drizzle-kit生成時の並び順のままだと「被参照テーブルに一致する一意性制約がない」で
-- 失敗することを実機マイグレーションで確認したため、生成後に手動で並び替えた)。
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_uk" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_tenant_id_uk" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_jobs_tenant_idempotency_key_idx" ON "outbox_jobs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_keys" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);