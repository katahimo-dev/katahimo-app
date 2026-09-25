-- (手書きで追記) GiSTインデックス(staff_busy_blocks等)でuuid列を「=」で扱うために必須の拡張。
-- infra/initdb/01_bootstrap.sql でもスーパーユーザーが作成するが、ブートストラップを経ない環境に
-- 備えて冪等に作成する。btree_gistはPostgreSQL 13以降trusted extensionのため、DBにCREATE権限を持つ
-- 所有者ロール(MIGRATION_DATABASE_URL)で作成できる。
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TABLE "accident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"report_type" text NOT NULL,
	"content_ciphertext" text NOT NULL,
	"content_key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accident_reports_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "accident_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text DEFAULT 'prompt' NOT NULL,
	"key" text NOT NULL,
	"body" text NOT NULL,
	"updated_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_prompts_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "ai_prompts_kind_check" CHECK ("ai_prompts"."kind" in ('prompt', 'placeholder'))
);
--> statement-breakpoint
ALTER TABLE "ai_prompts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"level" text NOT NULL,
	"action" text NOT NULL,
	"actor_staff_id" uuid,
	"target_staff_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_logs_level_check" CHECK ("app_logs"."level" in ('INFO', 'WARN', 'ERROR', 'SECURITY'))
);
--> statement-breakpoint
ALTER TABLE "app_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
	"customer_csv_last_imported_version" text,
	"customer_csv_last_imported_at" timestamp with time zone,
	"data_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_day_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attendance_day_id" uuid NOT NULL,
	"changed_by_staff_id" uuid,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"previous_row_data_ciphertext" text,
	"previous_row_data_key_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_day_changes_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "attendance_day_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"row_data_ciphertext" text NOT NULL,
	"row_data_key_version" integer NOT NULL,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_changed_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_days_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"value_type" text DEFAULT 'boolean' NOT NULL,
	"max_level" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_definitions_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "attribute_definitions_category_check" CHECK ("attribute_definitions"."category" in ('skill', 'qualification', 'trait', 'language', 'other')),
	CONSTRAINT "attribute_definitions_value_type_check" CHECK ("attribute_definitions"."value_type" in ('boolean', 'level', 'text')),
	CONSTRAINT "attribute_definitions_max_level_check" CHECK ("attribute_definitions"."max_level" is null or "attribute_definitions"."max_level" >= 1)
);
--> statement-breakpoint
ALTER TABLE "attribute_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"attribute_definition_id" uuid NOT NULL,
	"level" smallint,
	"value_text" text,
	"expires_on" date,
	"note_ciphertext" text,
	"note_key_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_attributes_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_attributes_level_check" CHECK ("staff_attributes"."level" is null or "staff_attributes"."level" >= 0)
);
--> statement-breakpoint
ALTER TABLE "staff_attributes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"preferred_staff_gender" text,
	"gender_is_hard" boolean DEFAULT false NOT NULL,
	"preferred_weekdays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_time_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes_ciphertext" text,
	"notes_key_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_preferences_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "customer_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_required_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"attribute_definition_id" uuid NOT NULL,
	"min_level" smallint,
	"is_hard" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_required_attributes_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_required_attributes_min_level_check" CHECK ("customer_required_attributes"."min_level" is null or "customer_required_attributes"."min_level" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customer_required_attributes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_staff_affinities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"score" smallint DEFAULT 0 NOT NULL,
	"is_ng" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note_ciphertext" text,
	"note_key_version" integer,
	"updated_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_staff_affinities_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_staff_affinities_score_check" CHECK ("customer_staff_affinities"."score" between -2 and 2),
	CONSTRAINT "customer_staff_affinities_source_check" CHECK ("customer_staff_affinities"."source" in ('manual', 'feedback', 'history'))
);
--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_source" text,
	"external_id" text,
	"name" text NOT NULL,
	"family_name" text NOT NULL,
	"given_name" text NOT NULL,
	"family_name_kana" text,
	"given_name_kana" text,
	"email" text,
	"phone" text,
	"address_detail" text,
	"city" text,
	"parking_area" text,
	"parking_detail" text,
	"emergency_contact_ciphertext" text,
	"emergency_contact_key_version" integer,
	"emergency_contact_relation_ciphertext" text,
	"emergency_contact_relation_key_version" integer,
	"evacuation_site_ciphertext" text,
	"evacuation_site_key_version" integer,
	"memo_ciphertext" text,
	"memo_key_version" integer,
	"benefit_member_id_ciphertext" text,
	"benefit_member_id_key_version" integer,
	"address2" text,
	"address2_start_date" date,
	"address2_end_date" date,
	"lat_lng_ciphertext" text,
	"lat_lng_key_version" integer,
	"member_type" text,
	"member_status" text,
	"payment_method" text,
	"payment_status" text,
	"gender" text,
	"age_bracket" text,
	"registered_at" timestamp with time zone,
	"external_last_updated_at" timestamp with time zone,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"risk_rating" integer,
	"es_rating" integer,
	"content_ciphertext" text NOT NULL,
	"content_key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_reports_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "daily_reports_risk_rating_check" CHECK ("daily_reports"."risk_rating" is null or "daily_reports"."risk_rating" between 1 and 5),
	CONSTRAINT "daily_reports_es_rating_check" CHECK ("daily_reports"."es_rating" is null or "daily_reports"."es_rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "daily_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
	"allergy_ciphertext" text,
	"allergy_key_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "family_members_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "family_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "outbox_jobs_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "outbox_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_reset_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"sent_to_email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_codes_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "password_reset_codes_attempt_count_check" CHECK ("password_reset_codes"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "password_reset_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer_name_text" text,
	"upload_batch_id" uuid,
	"receipt_timestamp" timestamp with time zone NOT NULL,
	"dedupe_blind_index" text,
	"amount_ciphertext" text,
	"amount_key_version" integer,
	"store_name_ciphertext" text,
	"store_name_key_version" integer,
	"handoff_text_ciphertext" text,
	"handoff_text_key_version" integer,
	"file_key" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "matching_run_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"matching_run_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"is_feasible" boolean DEFAULT true NOT NULL,
	"score" numeric(8, 3),
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matching_run_candidates_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "matching_run_candidates_rank_check" CHECK ("matching_run_candidates"."rank" is null or "matching_run_candidates"."rank" >= 1)
);
--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "matching_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by_staff_id" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result_summary" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matching_runs_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "matching_runs_status_check" CHECK ("matching_runs"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "matching_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservation_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"match_score" numeric(8, 3),
	"match_reasons" jsonb,
	"matching_run_id" uuid,
	"assigned_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_assignments_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "reservation_assignments_status_check" CHECK ("reservation_assignments"."status" in ('proposed', 'confirmed', 'cancelled')),
	CONSTRAINT "reservation_assignments_period_check" CHECK (not isempty("reservation_assignments"."period") and lower_inf("reservation_assignments"."period") = false and upper_inf("reservation_assignments"."period") = false)
);
--> statement-breakpoint
ALTER TABLE "reservation_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"scheduled_period" "tstzrange" NOT NULL,
	"business_date" date NOT NULL,
	"required_staff_count" smallint DEFAULT 1 NOT NULL,
	"service_type" text,
	"address" text,
	"notes_ciphertext" text,
	"notes_key_version" integer,
	"external_source" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" in ('requested', 'tentative', 'confirmed', 'cancelled', 'done')),
	CONSTRAINT "reservations_required_staff_count_check" CHECK ("reservations"."required_staff_count" >= 1),
	CONSTRAINT "reservations_scheduled_period_check" CHECK (not isempty("reservations"."scheduled_period") and lower_inf("reservations"."scheduled_period") = false and upper_inf("reservations"."scheduled_period") = false)
);
--> statement-breakpoint
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"alt_email" text,
	"phone" text,
	"password_hash" text,
	"legacy_password_hash" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"retirement_date" date,
	"gender" text,
	"birth_year" smallint,
	"employment_type" text,
	"max_visits_per_day" smallint,
	"max_weekly_minutes" integer,
	"home_area" text,
	"home_lat_lng_ciphertext" text,
	"home_lat_lng_key_version" integer,
	"travel_mode" text,
	"calendar_id" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_travel_mode_check" CHECK ("staff"."travel_mode" is null or "staff"."travel_mode" in ('car', 'bicycle', 'transit', 'walk')),
	CONSTRAINT "staff_max_visits_per_day_check" CHECK ("staff"."max_visits_per_day" is null or "staff"."max_visits_per_day" >= 0),
	CONSTRAINT "staff_max_weekly_minutes_check" CHECK ("staff"."max_weekly_minutes" is null or "staff"."max_weekly_minutes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"kind" text NOT NULL,
	"reason_ciphertext" text,
	"reason_key_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_availability_exceptions_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_availability_exceptions_kind_check" CHECK ("staff_availability_exceptions"."kind" in ('unavailable', 'extra_available')),
	CONSTRAINT "staff_availability_exceptions_period_check" CHECK (not isempty("staff_availability_exceptions"."period") and lower_inf("staff_availability_exceptions"."period") = false and upper_inf("staff_availability_exceptions"."period") = false)
);
--> statement-breakpoint
ALTER TABLE "staff_availability_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_weekly_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_weekly_availability_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_weekly_availability_weekday_check" CHECK ("staff_weekly_availability"."weekday" between 0 and 6),
	CONSTRAINT "staff_weekly_availability_time_check" CHECK ("staff_weekly_availability"."start_time" < "staff_weekly_availability"."end_time"),
	CONSTRAINT "staff_weekly_availability_effective_check" CHECK ("staff_weekly_availability"."effective_to" is null or "staff_weekly_availability"."effective_from" <= "staff_weekly_availability"."effective_to")
);
--> statement-breakpoint
ALTER TABLE "staff_weekly_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "calendar_sync_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"sync_token" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sync_states_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "calendar_sync_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_busy_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"source" text NOT NULL,
	"external_event_id" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_busy_blocks_tenant_id_uk" UNIQUE("tenant_id","id"),
	CONSTRAINT "staff_busy_blocks_source_check" CHECK ("staff_busy_blocks"."source" in ('google_calendar', 'manual', 'assignment')),
	CONSTRAINT "staff_busy_blocks_period_check" CHECK (not isempty("staff_busy_blocks"."period") and lower_inf("staff_busy_blocks"."period") = false and upper_inf("staff_busy_blocks"."period") = false)
);
--> statement-breakpoint
ALTER TABLE "staff_busy_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_features_tenant_id_uk" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "tenant_features" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"timezone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"business_type" text DEFAULT 'babysitting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_status_check" CHECK ("tenants"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accident_reports" ADD CONSTRAINT "accident_reports_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_tenant_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_logs" ADD CONSTRAINT "app_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_logs" ADD CONSTRAINT "app_logs_tenant_actor_fk" FOREIGN KEY ("tenant_id","actor_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_logs" ADD CONSTRAINT "app_logs_tenant_target_fk" FOREIGN KEY ("tenant_id","target_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_day_changes" ADD CONSTRAINT "attendance_day_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_day_changes" ADD CONSTRAINT "attendance_day_changes_tenant_day_fk" FOREIGN KEY ("tenant_id","attendance_day_id") REFERENCES "public"."attendance_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_day_changes" ADD CONSTRAINT "attendance_day_changes_tenant_changed_by_fk" FOREIGN KEY ("tenant_id","changed_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_last_changed_by_fk" FOREIGN KEY ("tenant_id","last_changed_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attributes" ADD CONSTRAINT "staff_attributes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attributes" ADD CONSTRAINT "staff_attributes_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attributes" ADD CONSTRAINT "staff_attributes_tenant_attr_def_fk" FOREIGN KEY ("tenant_id","attribute_definition_id") REFERENCES "public"."attribute_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_required_attributes" ADD CONSTRAINT "customer_required_attributes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_required_attributes" ADD CONSTRAINT "customer_required_attributes_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_required_attributes" ADD CONSTRAINT "customer_required_attributes_tenant_attr_def_fk" FOREIGN KEY ("tenant_id","attribute_definition_id") REFERENCES "public"."attribute_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ADD CONSTRAINT "customer_staff_affinities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ADD CONSTRAINT "customer_staff_affinities_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ADD CONSTRAINT "customer_staff_affinities_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ADD CONSTRAINT "customer_staff_affinities_tenant_updated_by_fk" FOREIGN KEY ("tenant_id","updated_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ADD CONSTRAINT "matching_run_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ADD CONSTRAINT "matching_run_candidates_tenant_run_fk" FOREIGN KEY ("tenant_id","matching_run_id") REFERENCES "public"."matching_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ADD CONSTRAINT "matching_run_candidates_tenant_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ADD CONSTRAINT "matching_run_candidates_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_runs" ADD CONSTRAINT "matching_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_runs" ADD CONSTRAINT "matching_runs_tenant_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_reservation_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_matching_run_fk" FOREIGN KEY ("tenant_id","matching_run_id") REFERENCES "public"."matching_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_assigned_by_fk" FOREIGN KEY ("tenant_id","assigned_by_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability_exceptions" ADD CONSTRAINT "staff_availability_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability_exceptions" ADD CONSTRAINT "staff_availability_exceptions_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_weekly_availability" ADD CONSTRAINT "staff_weekly_availability_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_weekly_availability" ADD CONSTRAINT "staff_weekly_availability_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_states" ADD CONSTRAINT "calendar_sync_states_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_states" ADD CONSTRAINT "calendar_sync_states_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_busy_blocks" ADD CONSTRAINT "staff_busy_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_busy_blocks" ADD CONSTRAINT "staff_busy_blocks_tenant_staff_fk" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_keys" ADD CONSTRAINT "tenant_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accident_reports_tenant_customer_occurred_idx" ON "accident_reports" USING btree ("tenant_id","customer_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_prompts_tenant_key_idx" ON "ai_prompts" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "app_logs_tenant_created_idx" ON "app_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "attendance_day_changes_tenant_day_idx" ON "attendance_day_changes" USING btree ("tenant_id","attendance_day_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_tenant_staff_date_idx" ON "attendance_days" USING btree ("tenant_id","staff_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_definitions_tenant_key_idx" ON "attribute_definitions" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_attributes_tenant_staff_attr_idx" ON "staff_attributes" USING btree ("tenant_id","staff_id","attribute_definition_id");--> statement-breakpoint
CREATE INDEX "staff_attributes_tenant_attr_idx" ON "staff_attributes" USING btree ("tenant_id","attribute_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_preferences_tenant_customer_idx" ON "customer_preferences" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_required_attributes_tenant_customer_attr_idx" ON "customer_required_attributes" USING btree ("tenant_id","customer_id","attribute_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_staff_affinities_tenant_customer_staff_idx" ON "customer_staff_affinities" USING btree ("tenant_id","customer_id","staff_id");--> statement-breakpoint
CREATE INDEX "customer_staff_affinities_tenant_staff_idx" ON "customer_staff_affinities" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_external_idx" ON "customers" USING btree ("tenant_id","external_source","external_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_family_name_idx" ON "customers" USING btree ("tenant_id","family_name");--> statement-breakpoint
CREATE INDEX "daily_reports_tenant_customer_occurred_idx" ON "daily_reports" USING btree ("tenant_id","customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "family_members_tenant_customer_idx" ON "family_members" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_jobs_tenant_idempotency_key_idx" ON "outbox_jobs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_jobs_tenant_status_next_attempt_idx" ON "outbox_jobs" USING btree ("tenant_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "password_reset_codes_tenant_staff_idx" ON "password_reset_codes" USING btree ("tenant_id","staff_id","created_at");--> statement-breakpoint
CREATE INDEX "receipts_tenant_dedupe_idx" ON "receipts" USING btree ("tenant_id","dedupe_blind_index");--> statement-breakpoint
CREATE INDEX "receipts_tenant_upload_batch_idx" ON "receipts" USING btree ("tenant_id","upload_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matching_run_candidates_run_reservation_staff_idx" ON "matching_run_candidates" USING btree ("tenant_id","matching_run_id","reservation_id","staff_id");--> statement-breakpoint
CREATE INDEX "matching_runs_tenant_created_idx" ON "matching_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "reservation_assignments_tenant_reservation_idx" ON "reservation_assignments" USING btree ("tenant_id","reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_assignments_active_staff_idx" ON "reservation_assignments" USING btree ("tenant_id","reservation_id","staff_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_tenant_external_idx" ON "reservations" USING btree ("tenant_id","external_source","external_id");--> statement-breakpoint
CREATE INDEX "reservations_tenant_business_date_idx" ON "reservations" USING btree ("tenant_id","business_date");--> statement-breakpoint
CREATE INDEX "reservations_tenant_customer_idx" ON "reservations" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_tenant_staff_idx" ON "sessions" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_tenant_email_idx" ON "staff" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_tenant_alt_email_idx" ON "staff" USING btree ("tenant_id","alt_email") WHERE alt_email is not null;--> statement-breakpoint
CREATE INDEX "staff_availability_exceptions_period_gist_idx" ON "staff_availability_exceptions" USING gist ("tenant_id","staff_id","period");--> statement-breakpoint
CREATE INDEX "staff_weekly_availability_tenant_staff_idx" ON "staff_weekly_availability" USING btree ("tenant_id","staff_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_sync_states_tenant_staff_calendar_idx" ON "calendar_sync_states" USING btree ("tenant_id","staff_id","calendar_id");--> statement-breakpoint
CREATE INDEX "staff_busy_blocks_period_gist_idx" ON "staff_busy_blocks" USING gist ("tenant_id","staff_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_busy_blocks_external_event_idx" ON "staff_busy_blocks" USING btree ("tenant_id","staff_id","source","external_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_features_tenant_feature_key_idx" ON "tenant_features" USING btree ("tenant_id","feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accident_reports" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_prompts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "app_logs_select" ON "app_logs" AS PERMISSIVE FOR SELECT TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "app_logs_delete" ON "app_logs" AS PERMISSIVE FOR DELETE TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "app_logs_insert" ON "app_logs" AS PERMISSIVE FOR INSERT TO public WITH CHECK (tenant_id is null or tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "app_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attendance_day_changes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attendance_days" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attribute_definitions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_attributes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_preferences" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_required_attributes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_staff_affinities" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "daily_reports" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "family_members" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outbox_jobs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "password_reset_codes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "receipts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "matching_run_candidates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "matching_runs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reservation_assignments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reservations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_availability_exceptions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_weekly_availability" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "calendar_sync_states" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_busy_blocks" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_features" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_keys" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);