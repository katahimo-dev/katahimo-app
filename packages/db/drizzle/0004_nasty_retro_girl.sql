ALTER TABLE "staff" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "legacy_password_hash" text;