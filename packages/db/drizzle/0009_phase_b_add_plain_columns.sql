ALTER TABLE "customers" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "family_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "given_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "family_name_kana" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "given_name_kana" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address_detail" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "parking_area" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "parking_detail" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address2" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "phone" text;--> statement-breakpoint
CREATE INDEX "customers_tenant_family_name_idx" ON "customers" USING btree ("tenant_id","family_name");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_tenant_email_idx" ON "staff" USING btree ("tenant_id","email");