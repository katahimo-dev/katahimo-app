ALTER TABLE "tenants" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");