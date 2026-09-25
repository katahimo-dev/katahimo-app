CREATE TABLE "app_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"gemini_api_key_ciphertext" text,
	"gemini_api_key_key_version" integer,
	"gemini_report_model" text,
	"gemini_ocr_model" text,
	"gchat_report_webhook_url_ciphertext" text,
	"gchat_report_webhook_url_key_version" integer,
	"gchat_receipt_webhook_url_ciphertext" text,
	"gchat_receipt_webhook_url_key_version" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);