-- 0000_baseline: drizzle-kit がスキーマ定義(packages/db/src/schema)から生成したベースライン。
-- 先頭のこのブロックだけは手書き: 生成された CREATE POLICY が参照する関数と、EXCLUDE 制約(0001)に要る拡張を
-- 先に作る(drizzle-kit は関数・拡張を扱えないため)。
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
-- セッションのテナント(withTenant が set_config('app.tenant_id', …, true) で入れる値)。未設定・空文字は NULL
-- (tenant_id = NULL は常に偽 → 何も見えない)。SQL の単一 SELECT・STABLE なので、ポリシーの中で展開(インライン化)
-- され、索引の条件として使える。
CREATE FUNCTION public.app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;--> statement-breakpoint
CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"shopping_errand_count" smallint,
	"remarks_enc" "bytea",
	"status" text DEFAULT 'open' NOT NULL,
	"overridden_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_days_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "attendance_days_tenant_id_staff_id_business_date_key" UNIQUE("tenant_id","staff_id","business_date"),
	CONSTRAINT "attendance_days_status_check" CHECK ("attendance_days"."status" in ('open', 'submitted', 'locked')),
	CONSTRAINT "attendance_days_shopping_errand_count_check" CHECK ("attendance_days"."shopping_errand_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_periods" (
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_periods_pkey" PRIMARY KEY("tenant_id","staff_id","year_month"),
	CONSTRAINT "attendance_periods_status_check" CHECK ("attendance_periods"."status" in ('open', 'locked')),
	CONSTRAINT "attendance_periods_year_month_check" CHECK ("attendance_periods"."year_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "attendance_periods_locked_check" CHECK (("attendance_periods"."status" = 'locked') = ("attendance_periods"."locked_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "attendance_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "travel_legs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"kind" text NOT NULL,
	"seq" smallint DEFAULT 1 NOT NULL,
	"from_visit_id" uuid,
	"to_visit_id" uuid,
	"planned_minutes" integer,
	"distance_km" numeric(6, 2),
	"weather" text,
	"overridden_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_legs_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "travel_legs_tenant_id_staff_id_business_date_kind_seq_key" UNIQUE("tenant_id","staff_id","business_date","kind","seq"),
	CONSTRAINT "travel_legs_kind_check" CHECK ("travel_legs"."kind" in ('commute', 'between', 'return')),
	CONSTRAINT "travel_legs_weather_check" CHECK ("travel_legs"."weather" in ('sunny', 'cloudy', 'rain', 'snow')),
	CONSTRAINT "travel_legs_planned_minutes_check" CHECK ("travel_legs"."planned_minutes" >= 0),
	CONSTRAINT "travel_legs_distance_km_check" CHECK ("travel_legs"."distance_km" >= 0),
	CONSTRAINT "travel_legs_seq_check" CHECK ("travel_legs"."seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE "travel_legs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visits" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid,
	"assignment_id" uuid,
	"business_date" date NOT NULL,
	"seq" smallint NOT NULL,
	"planned_period" "tstzrange",
	"actual_period" "tstzrange",
	"status" text DEFAULT 'scheduled' NOT NULL,
	"source" text NOT NULL,
	"external_event_id" text,
	"label_enc" "bytea",
	"overridden_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "visits_tenant_id_staff_id_business_date_seq_key" UNIQUE("tenant_id","staff_id","business_date","seq"),
	CONSTRAINT "visits_tenant_id_staff_id_external_event_id_key" UNIQUE("tenant_id","staff_id","external_event_id"),
	CONSTRAINT "visits_status_check" CHECK ("visits"."status" in ('scheduled', 'completed', 'cancelled')),
	CONSTRAINT "visits_source_check" CHECK ("visits"."source" in ('google_calendar', 'manual', 'reservation')),
	CONSTRAINT "visits_seq_check" CHECK ("visits"."seq" >= 1),
	CONSTRAINT "visits_actual_period_check" CHECK (not isempty("visits"."actual_period")),
	CONSTRAINT "visits_planned_period_check" CHECK (not isempty("visits"."planned_period"))
);
--> statement-breakpoint
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_segments" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"seq" smallint NOT NULL,
	"kind" text DEFAULT 'office' NOT NULL,
	"period" "tstzrange",
	"description_enc" "bytea",
	"overridden_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_segments_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "work_segments_tenant_id_staff_id_business_date_seq_key" UNIQUE("tenant_id","staff_id","business_date","seq"),
	CONSTRAINT "work_segments_kind_check" CHECK ("work_segments"."kind" in ('office', 'training', 'other')),
	CONSTRAINT "work_segments_seq_check" CHECK ("work_segments"."seq" >= 1),
	CONSTRAINT "work_segments_period_check" CHECK (not isempty("work_segments"."period"))
);
--> statement-breakpoint
ALTER TABLE "work_segments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "care_recipients" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_kana" text,
	"birth_date" date,
	"sex" text,
	"allergy_enc" "bytea",
	"needs_enc" "bytea",
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_recipients_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "care_recipients_sex_check" CHECK ("care_recipients"."sex" in ('female', 'male', 'other', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "care_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"postal_code" text,
	"prefecture" text,
	"city" text,
	"address_line" text NOT NULL,
	"building" text,
	"parking_area" text,
	"parking_detail" text,
	"geo_enc" "bytea",
	"geo_cell" text,
	"valid" daterange DEFAULT '(,)'::daterange NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "customer_addresses_kind_check" CHECK ("customer_addresses"."kind" in ('home', 'secondary', 'visit')),
	CONSTRAINT "customer_addresses_valid_check" CHECK (not isempty("customer_addresses"."valid")),
	CONSTRAINT "customer_addresses_geo_cell_check" CHECK ("customer_addresses"."geo_cell" ~ '^[0-9b-hjkmnp-z]{6}$')
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"relation" text,
	"name_enc" "bytea",
	"phone_enc" "bytea",
	"notes_enc" "bytea",
	"is_emergency" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_contacts_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "customer_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_preferences" (
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"preferred_staff_gender" text,
	"gender_is_hard" boolean DEFAULT false NOT NULL,
	"notes_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_preferences_pkey" PRIMARY KEY("tenant_id","customer_id"),
	CONSTRAINT "customer_preferences_preferred_staff_gender_check" CHECK ("customer_preferences"."preferred_staff_gender" in ('female', 'male', 'other', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "customer_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_recurring_slots" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"valid" daterange DEFAULT '(,)'::daterange NOT NULL,
	"service_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_recurring_slots_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "customer_recurring_slots_weekday_check" CHECK ("customer_recurring_slots"."weekday" between 0 and 6),
	CONSTRAINT "customer_recurring_slots_time_check" CHECK ("customer_recurring_slots"."start_time" < "customer_recurring_slots"."end_time")
);
--> statement-breakpoint
ALTER TABLE "customer_recurring_slots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_source_records" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_registered_at" timestamp with time zone,
	"external_updated_at" timestamp with time zone,
	"last_import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_source_records_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "customer_source_records_tenant_id_source_external_id_key" UNIQUE("tenant_id","source","external_id"),
	CONSTRAINT "customer_source_records_source_check" CHECK ("customer_source_records"."source" in ('reserva'))
);
--> statement-breakpoint
ALTER TABLE "customer_source_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"family_name" text NOT NULL,
	"given_name" text DEFAULT '' NOT NULL,
	"family_name_kana" text,
	"given_name_kana" text,
	"email" text,
	"phone" text,
	"memo_enc" "bytea",
	"benefit_member_id_enc" "bytea",
	"evacuation_site_enc" "bytea",
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"archive_reason" text,
	"purged_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "customers_archive_reason_check" CHECK ("customers"."archive_reason" in ('import_missing', 'manual')),
	CONSTRAINT "customers_archived_check" CHECK (("customers"."archived_at" is null) = ("customers"."archive_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "data_export_requests" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid,
	"scope" text NOT NULL,
	"subject_id" uuid,
	"status" text DEFAULT 'requested' NOT NULL,
	"file_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_export_requests_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "data_export_requests_scope_check" CHECK ("data_export_requests"."scope" in ('tenant', 'customer', 'staff')),
	CONSTRAINT "data_export_requests_status_check" CHECK ("data_export_requests"."status" in ('requested', 'processing', 'ready', 'expired', 'failed')),
	CONSTRAINT "data_export_requests_subject_check" CHECK (("data_export_requests"."scope" = 'tenant') = ("data_export_requests"."subject_id" is null))
);
--> statement-breakpoint
ALTER TABLE "data_export_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date,
	"completed_at" timestamp with time zone,
	"notes_enc" "bytea",
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "data_subject_requests_kind_check" CHECK ("data_subject_requests"."kind" in ('access', 'rectification', 'erasure', 'restriction')),
	CONSTRAINT "data_subject_requests_subject_type_check" CHECK ("data_subject_requests"."subject_type" in ('customer', 'care_recipient', 'staff')),
	CONSTRAINT "data_subject_requests_status_check" CHECK ("data_subject_requests"."status" in ('received', 'in_progress', 'completed', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "data_subject_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"tenant_id" uuid NOT NULL,
	"target" text NOT NULL,
	"retain_days" integer NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policies_pkey" PRIMARY KEY("tenant_id","target"),
	CONSTRAINT "retention_policies_target_check" CHECK ("retention_policies"."target" in ('care_records', 'receipts', 'stored_files', 'sessions', 'outbox', 'matching_run_candidates')),
	CONSTRAINT "retention_policies_retain_days_check" CHECK ("retention_policies"."retain_days" >= 1)
);
--> statement-breakpoint
ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attribute_definitions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"value_type" text DEFAULT 'boolean' NOT NULL,
	"max_level" smallint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribute_definitions_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "attribute_definitions_tenant_id_key_key" UNIQUE("tenant_id","key"),
	CONSTRAINT "attribute_definitions_category_check" CHECK ("attribute_definitions"."category" in ('skill', 'qualification', 'trait', 'language', 'other')),
	CONSTRAINT "attribute_definitions_value_type_check" CHECK ("attribute_definitions"."value_type" in ('boolean', 'level', 'text')),
	CONSTRAINT "attribute_definitions_max_level_check" CHECK ("attribute_definitions"."max_level" >= 1)
);
--> statement-breakpoint
ALTER TABLE "attribute_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_required_attributes" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"min_level" smallint,
	"is_hard" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_required_attributes_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "customer_required_attributes_customer_id_attribute_id_key" UNIQUE("tenant_id","customer_id","attribute_id"),
	CONSTRAINT "customer_required_attributes_min_level_check" CHECK ("customer_required_attributes"."min_level" >= 0)
);
--> statement-breakpoint
ALTER TABLE "customer_required_attributes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_staff_affinities" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"score" smallint DEFAULT 0 NOT NULL,
	"is_ng" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note_enc" "bytea",
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_staff_affinities_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "customer_staff_affinities_tenant_id_customer_id_staff_id_key" UNIQUE("tenant_id","customer_id","staff_id"),
	CONSTRAINT "customer_staff_affinities_score_check" CHECK ("customer_staff_affinities"."score" between -2 and 2),
	CONSTRAINT "customer_staff_affinities_source_check" CHECK ("customer_staff_affinities"."source" in ('manual', 'feedback'))
);
--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "matching_run_candidates" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"is_feasible" boolean DEFAULT true NOT NULL,
	"score" numeric(8, 3),
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matching_run_candidates_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "matching_run_candidates_run_id_reservation_id_staff_id_key" UNIQUE("tenant_id","run_id","reservation_id","staff_id"),
	CONSTRAINT "matching_run_candidates_rank_check" CHECK ("matching_run_candidates"."rank" >= 1)
);
--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "matching_runs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" uuid,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result_summary" jsonb,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matching_runs_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "matching_runs_status_check" CHECK ("matching_runs"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "matching_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_areas" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"geo_cells" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_areas_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "service_areas_tenant_id_name_key" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "service_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_attributes" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"level" smallint,
	"value_text" text,
	"valid" daterange DEFAULT '(,)'::daterange NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"evidence_file_id" uuid,
	"note_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_attributes_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "staff_attributes_level_check" CHECK ("staff_attributes"."level" >= 0),
	CONSTRAINT "staff_attributes_valid_check" CHECK (not isempty("staff_attributes"."valid"))
);
--> statement-breakpoint
ALTER TABLE "staff_attributes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_availability_exceptions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"kind" text NOT NULL,
	"reason_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_availability_exceptions_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "staff_availability_exceptions_kind_check" CHECK ("staff_availability_exceptions"."kind" in ('unavailable', 'extra_available')),
	CONSTRAINT "staff_availability_exceptions_period_check" CHECK (not isempty("staff_availability_exceptions"."period") and not lower_inf("staff_availability_exceptions"."period") and not upper_inf("staff_availability_exceptions"."period"))
);
--> statement-breakpoint
ALTER TABLE "staff_availability_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_busy_blocks" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"source" text NOT NULL,
	"external_event_id" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_busy_blocks_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "staff_busy_blocks_staff_id_source_external_event_id_key" UNIQUE("tenant_id","staff_id","source","external_event_id"),
	CONSTRAINT "staff_busy_blocks_source_check" CHECK ("staff_busy_blocks"."source" in ('google_calendar', 'manual')),
	CONSTRAINT "staff_busy_blocks_period_check" CHECK (not isempty("staff_busy_blocks"."period") and not lower_inf("staff_busy_blocks"."period") and not upper_inf("staff_busy_blocks"."period"))
);
--> statement-breakpoint
ALTER TABLE "staff_busy_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_calendars" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"purpose" text NOT NULL,
	"sync_token" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_calendars_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "staff_calendars_tenant_id_staff_id_calendar_id_purpose_key" UNIQUE("tenant_id","staff_id","calendar_id","purpose"),
	CONSTRAINT "staff_calendars_purpose_check" CHECK ("staff_calendars"."purpose" in ('schedule', 'busy'))
);
--> statement-breakpoint
ALTER TABLE "staff_calendars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_service_areas" (
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"service_area_id" uuid NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_service_areas_pkey" PRIMARY KEY("tenant_id","staff_id","service_area_id")
);
--> statement-breakpoint
ALTER TABLE "staff_service_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_weekly_availability" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_weekly_availability_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "staff_weekly_availability_weekday_check" CHECK ("staff_weekly_availability"."weekday" between 0 and 6),
	CONSTRAINT "staff_weekly_availability_time_check" CHECK ("staff_weekly_availability"."start_time" < "staff_weekly_availability"."end_time"),
	CONSTRAINT "staff_weekly_availability_effective_check" CHECK ("staff_weekly_availability"."effective_to" is null or "staff_weekly_availability"."effective_from" <= "staff_weekly_availability"."effective_to")
);
--> statement-breakpoint
ALTER TABLE "staff_weekly_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "travel_time_cache" (
	"tenant_id" uuid NOT NULL,
	"origin_cell" text NOT NULL,
	"dest_cell" text NOT NULL,
	"mode" text NOT NULL,
	"depart_bucket" smallint NOT NULL,
	"minutes" integer NOT NULL,
	"meters" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_time_cache_pkey" PRIMARY KEY("tenant_id","origin_cell","dest_cell","mode","depart_bucket"),
	CONSTRAINT "travel_time_cache_mode_check" CHECK ("travel_time_cache"."mode" in ('car', 'bicycle', 'transit', 'walk')),
	CONSTRAINT "travel_time_cache_depart_bucket_check" CHECK ("travel_time_cache"."depart_bucket" between 0 and 167)
);
--> statement-breakpoint
ALTER TABLE "travel_time_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entity_changes" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"changed_by" uuid,
	"change_source" text NOT NULL,
	"changed_fields" text[] NOT NULL,
	"before_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_changes_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "entity_changes_entity_type_check" CHECK ("entity_changes"."entity_type" in ('attendance_day', 'visit', 'work_segment', 'travel_leg', 'customer', 'care_recipient', 'staff')),
	CONSTRAINT "entity_changes_change_source_check" CHECK ("entity_changes"."change_source" in ('user', 'calendar_sync', 'import', 'system'))
);
--> statement-breakpoint
ALTER TABLE "entity_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "outbox_messages_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "outbox_messages_tenant_id_dedupe_key_key" UNIQUE("tenant_id","dedupe_key"),
	CONSTRAINT "outbox_messages_topic_check" CHECK ("outbox_messages"."topic" in ('mirror.attendance_day', 'mirror.attendance_aggregate', 'mirror.care_record', 'mirror.receipt', 'mail.password_reset')),
	CONSTRAINT "outbox_messages_status_check" CHECK ("outbox_messages"."status" in ('pending', 'processing', 'done', 'failed', 'dead')),
	CONSTRAINT "outbox_messages_attempts_check" CHECK ("outbox_messages"."attempts" >= 0 and "outbox_messages"."max_attempts" >= 1),
	CONSTRAINT "outbox_messages_lock_check" CHECK (("outbox_messages"."status" = 'processing') = ("outbox_messages"."locked_until" is not null))
);
--> statement-breakpoint
ALTER TABLE "outbox_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform"."plan_features" (
	"plan_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_features_pkey" PRIMARY KEY("plan_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "platform"."plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "platform"."platform_operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_operators_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "platform"."rate_limit_buckets" (
	"rule" text NOT NULL,
	"subject_hash" "bytea" NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY("rule","subject_hash"),
	CONSTRAINT "rate_limit_buckets_hits_check" CHECK ("platform"."rate_limit_buckets"."hits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform"."tenant_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event" text NOT NULL,
	"actor" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_lifecycle_events_event_check" CHECK ("platform"."tenant_lifecycle_events"."event" in ('provisioned', 'activated', 'suspended', 'resumed', 'termination_requested', 'terminated', 'purged'))
);
--> statement-breakpoint
CREATE TABLE "platform"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"timezone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"business_type" text DEFAULT 'babysitting' NOT NULL,
	"plan_id" uuid,
	"terminated_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_key" UNIQUE("slug"),
	CONSTRAINT "tenants_status_check" CHECK ("platform"."tenants"."status" in ('provisioning', 'active', 'suspended', 'terminating', 'terminated')),
	CONSTRAINT "tenants_business_type_check" CHECK ("platform"."tenants"."business_type" in ('babysitting', 'home_nursing')),
	CONSTRAINT "tenants_slug_check" CHECK ("platform"."tenants"."slug" ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
	CONSTRAINT "tenants_terminated_at_check" CHECK ("platform"."tenants"."status" <> 'terminated' or "platform"."tenants"."terminated_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "ai_prompt_revisions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"revision" integer NOT NULL,
	"body" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_prompt_revisions_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ai_prompt_revisions_tenant_id_key_revision_key" UNIQUE("tenant_id","key","revision")
);
--> statement-breakpoint
ALTER TABLE "ai_prompt_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_prompts" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_prompts_pkey" PRIMARY KEY("tenant_id","key"),
	CONSTRAINT "ai_prompts_kind_check" CHECK ("ai_prompts"."kind" in ('prompt', 'placeholder')),
	CONSTRAINT "ai_prompts_revision_check" CHECK ("ai_prompts"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ai_prompts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "care_record_revisions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"care_record_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"body_enc" "bytea" NOT NULL,
	"body_schema_ver" smallint NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_record_revisions_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "care_record_revisions_tenant_id_care_record_id_revision_no_key" UNIQUE("tenant_id","care_record_id","revision_no")
);
--> statement-breakpoint
ALTER TABLE "care_record_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "care_records" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"record_type" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"visit_id" uuid,
	"customer_id" uuid NOT NULL,
	"care_recipient_id" uuid,
	"author_staff_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"service_period" "tstzrange",
	"risk_rating" smallint,
	"es_rating" smallint,
	"body_enc" "bytea" NOT NULL,
	"body_schema_ver" smallint DEFAULT 1 NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"ai_model" text,
	"ai_prompt_key" text,
	"ai_prompt_revision" integer,
	"reviewed_at" timestamp with time zone,
	"retain_until" date,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "care_records_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "care_records_record_type_check" CHECK ("care_records"."record_type" in ('daily_report', 'accident', 'near_miss')),
	CONSTRAINT "care_records_status_check" CHECK ("care_records"."status" in ('draft', 'submitted', 'locked')),
	CONSTRAINT "care_records_risk_rating_check" CHECK ("care_records"."risk_rating" between 1 and 5),
	CONSTRAINT "care_records_es_rating_check" CHECK ("care_records"."es_rating" between 1 and 5),
	CONSTRAINT "care_records_ratings_check" CHECK ("care_records"."record_type" = 'daily_report' or ("care_records"."risk_rating" is null and "care_records"."es_rating" is null)),
	CONSTRAINT "care_records_service_period_check" CHECK (not isempty("care_records"."service_period"))
);
--> statement-breakpoint
ALTER TABLE "care_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receipt_uploads" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer_name_text" text,
	"handoff_text_enc" "bytea",
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_uploads_pkey" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "receipt_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receipts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer_name_text" text,
	"receipted_at" timestamp with time zone NOT NULL,
	"amount_yen" integer,
	"store_name_enc" "bytea",
	"dedupe_bidx" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "receipts_amount_yen_check" CHECK ("receipts"."amount_yen" >= 0)
);
--> statement-breakpoint
ALTER TABLE "receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stored_files" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" "bytea" NOT NULL,
	"purpose" text NOT NULL,
	"created_by" uuid,
	"retain_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "stored_files_tenant_id_storage_key_key" UNIQUE("tenant_id","storage_key"),
	CONSTRAINT "stored_files_purpose_check" CHECK ("stored_files"."purpose" in ('receipt_image', 'evidence', 'export')),
	CONSTRAINT "stored_files_byte_size_check" CHECK ("stored_files"."byte_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservation_assignments" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"period" "tstzrange" NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"match_score" numeric(8, 3),
	"match_reasons" jsonb,
	"matching_run_id" uuid,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_assignments_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "reservation_assignments_status_check" CHECK ("reservation_assignments"."status" in ('proposed', 'confirmed', 'declined', 'cancelled')),
	CONSTRAINT "reservation_assignments_period_check" CHECK (not isempty("reservation_assignments"."period") and not lower_inf("reservation_assignments"."period") and not upper_inf("reservation_assignments"."period")),
	CONSTRAINT "reservation_assignments_confirmed_at_check" CHECK ("reservation_assignments"."status" <> 'confirmed' or "reservation_assignments"."confirmed_at" is not null),
	CONSTRAINT "reservation_assignments_declined_at_check" CHECK ("reservation_assignments"."status" <> 'declined' or "reservation_assignments"."declined_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "reservation_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservation_recipients" (
	"tenant_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"care_recipient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_recipients_pkey" PRIMARY KEY("tenant_id","reservation_id","care_recipient_id")
);
--> statement-breakpoint
ALTER TABLE "reservation_recipients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reservations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"address_id" uuid,
	"service_item_id" uuid,
	"recurring_slot_id" uuid,
	"status" text DEFAULT 'requested' NOT NULL,
	"scheduled_period" "tstzrange" NOT NULL,
	"business_date" date NOT NULL,
	"required_staff_count" smallint DEFAULT 1 NOT NULL,
	"notes_enc" "bytea",
	"external_source" text,
	"external_id" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "reservations_tenant_id_external_source_external_id_key" UNIQUE("tenant_id","external_source","external_id"),
	CONSTRAINT "reservations_status_check" CHECK ("reservations"."status" in ('requested', 'tentative', 'confirmed', 'cancelled', 'done')),
	CONSTRAINT "reservations_required_staff_count_check" CHECK ("reservations"."required_staff_count" >= 1),
	CONSTRAINT "reservations_scheduled_period_check" CHECK (not isempty("reservations"."scheduled_period") and not lower_inf("reservations"."scheduled_period") and not upper_inf("reservations"."scheduled_period")),
	CONSTRAINT "reservations_external_check" CHECK (("reservations"."external_source" is null) = ("reservations"."external_id" is null))
);
--> statement-breakpoint
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_items" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"default_minutes" integer,
	"unit_price_yen" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_items_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "service_items_tenant_id_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "service_items_default_minutes_check" CHECK ("service_items"."default_minutes" > 0),
	CONSTRAINT "service_items_unit_price_yen_check" CHECK ("service_items"."unit_price_yen" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_reset_codes" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"sent_to_email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"mail_code_enc" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_codes_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "password_reset_codes_attempt_count_check" CHECK ("password_reset_codes"."attempt_count" between 0 and "password_reset_codes"."max_attempts")
);
--> statement-breakpoint
ALTER TABLE "password_reset_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "sessions_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "sessions_expiry_check" CHECK ("sessions"."idle_expires_at" <= "sessions"."absolute_expires_at")
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"family_name" text NOT NULL,
	"given_name" text DEFAULT '' NOT NULL,
	"family_name_kana" text,
	"given_name_kana" text,
	"phone" text,
	"role" text DEFAULT 'staff' NOT NULL,
	"retired_on" date,
	"gender" text,
	"birth_year" smallint,
	"home_area" text,
	"home_address" text,
	"home_geo_enc" "bytea",
	"home_geo_cell" text,
	"travel_mode" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "staff_role_check" CHECK ("staff"."role" in ('staff', 'coordinator', 'admin')),
	CONSTRAINT "staff_gender_check" CHECK ("staff"."gender" in ('female', 'male', 'other', 'unknown')),
	CONSTRAINT "staff_travel_mode_check" CHECK ("staff"."travel_mode" in ('car', 'bicycle', 'transit', 'walk')),
	CONSTRAINT "staff_birth_year_check" CHECK ("staff"."birth_year" between 1900 and 2100),
	CONSTRAINT "staff_home_geo_cell_check" CHECK ("staff"."home_geo_cell" ~ '^[0-9b-hjkmnp-z]{6}$')
);
--> statement-breakpoint
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_credentials" (
	"tenant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"password_hash" text,
	"legacy_password_hash" text,
	"password_changed_at" timestamp with time zone,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_credentials_pkey" PRIMARY KEY("tenant_id","staff_id"),
	CONSTRAINT "staff_credentials_failed_count_check" CHECK ("staff_credentials"."failed_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "staff_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_employment_terms" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"valid" daterange NOT NULL,
	"employment_type" text NOT NULL,
	"max_visits_per_day" smallint,
	"max_weekly_minutes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_employment_terms_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "staff_employment_terms_employment_type_check" CHECK ("staff_employment_terms"."employment_type" in ('full_time', 'part_time', 'contractor')),
	CONSTRAINT "staff_employment_terms_max_visits_per_day_check" CHECK ("staff_employment_terms"."max_visits_per_day" >= 0),
	CONSTRAINT "staff_employment_terms_max_weekly_minutes_check" CHECK ("staff_employment_terms"."max_weekly_minutes" >= 0),
	CONSTRAINT "staff_employment_terms_valid_check" CHECK (not isempty("staff_employment_terms"."valid"))
);
--> statement-breakpoint
ALTER TABLE "staff_employment_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_login_emails" (
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"staff_id" uuid NOT NULL,
	"is_primary" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_login_emails_pkey" PRIMARY KEY("tenant_id","email"),
	CONSTRAINT "staff_login_emails_email_check" CHECK ("staff_login_emails"."email" = lower("staff_login_emails"."email") and "staff_login_emails"."email" like '%@%')
);
--> statement-breakpoint
ALTER TABLE "staff_login_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"value_type" text DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "custom_field_definitions_tenant_id_entity_type_key_key" UNIQUE("tenant_id","entity_type","key"),
	CONSTRAINT "custom_field_definitions_entity_type_check" CHECK ("custom_field_definitions"."entity_type" in ('staff', 'customer')),
	CONSTRAINT "custom_field_definitions_value_type_check" CHECK ("custom_field_definitions"."value_type" in ('text', 'number', 'boolean', 'date', 'select'))
);
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_runs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"file_version" text,
	"status" text DEFAULT 'running' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"message" text,
	"triggered_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "import_runs_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "import_runs_source_check" CHECK ("import_runs"."source" in ('reserva_csv', 'staff_master_csv')),
	CONSTRAINT "import_runs_status_check" CHECK ("import_runs"."status" in ('running', 'applied', 'review_required', 'failed', 'skipped')),
	CONSTRAINT "import_runs_finished_at_check" CHECK (("import_runs"."status" = 'running') = ("import_runs"."finished_at" is null))
);
--> statement-breakpoint
ALTER TABLE "import_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_data_keys" (
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"wrapped_dek" "bytea",
	"kek_key_name" text NOT NULL,
	"state" text NOT NULL,
	"destroyed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_data_keys_pkey" PRIMARY KEY("tenant_id","version"),
	CONSTRAINT "tenant_data_keys_state_check" CHECK ("tenant_data_keys"."state" in ('active', 'decrypt_only', 'destroyed')),
	CONSTRAINT "tenant_data_keys_version_check" CHECK ("tenant_data_keys"."version" between 1 and 65535),
	CONSTRAINT "tenant_data_keys_wrapped_dek_check" CHECK (("tenant_data_keys"."state" = 'destroyed') = ("tenant_data_keys"."wrapped_dek" is null))
);
--> statement-breakpoint
ALTER TABLE "tenant_data_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_features" (
	"tenant_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_features_pkey" PRIMARY KEY("tenant_id","feature_key")
);
--> statement-breakpoint
ALTER TABLE "tenant_features" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_secrets" (
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value_enc" "bytea" NOT NULL,
	"updated_by" uuid,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_secrets_pkey" PRIMARY KEY("tenant_id","name"),
	CONSTRAINT "tenant_secrets_name_check" CHECK ("tenant_secrets"."name" in ('gemini_api_key', 'gchat_report_webhook', 'gchat_receipt_webhook'))
);
--> statement-breakpoint
ALTER TABLE "tenant_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid NOT NULL,
	"gemini_report_model" text,
	"gemini_ocr_model" text,
	"care_record_retention_days" integer DEFAULT 1825 NOT NULL,
	"customer_data_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_pkey" PRIMARY KEY("tenant_id"),
	CONSTRAINT "tenant_settings_care_record_retention_days_check" CHECK ("tenant_settings"."care_record_retention_days" >= 365)
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_periods" ADD CONSTRAINT "attendance_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_periods" ADD CONSTRAINT "attendance_periods_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_periods" ADD CONSTRAINT "attendance_periods_tenant_id_locked_by_fkey" FOREIGN KEY ("tenant_id","locked_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenant_id_assignment_id_fkey" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."reservation_assignments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_segments" ADD CONSTRAINT "work_segments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_segments" ADD CONSTRAINT "work_segments_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_recipients" ADD CONSTRAINT "care_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_recipients" ADD CONSTRAINT "care_recipients_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_preferences" ADD CONSTRAINT "customer_preferences_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_recurring_slots" ADD CONSTRAINT "customer_recurring_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_recurring_slots" ADD CONSTRAINT "customer_recurring_slots_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_recurring_slots" ADD CONSTRAINT "customer_recurring_slots_tenant_id_service_item_id_fkey" FOREIGN KEY ("tenant_id","service_item_id") REFERENCES "public"."service_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_source_records" ADD CONSTRAINT "customer_source_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_source_records" ADD CONSTRAINT "customer_source_records_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_source_records" ADD CONSTRAINT "customer_source_records_tenant_id_last_import_run_id_fkey" FOREIGN KEY ("tenant_id","last_import_run_id") REFERENCES "public"."import_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_tenant_id_requested_by_fkey" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."stored_files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_tenant_id_handled_by_fkey" FOREIGN KEY ("tenant_id","handled_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_required_attributes" ADD CONSTRAINT "customer_required_attributes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_required_attributes" ADD CONSTRAINT "customer_required_attributes_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_required_attributes" ADD CONSTRAINT "customer_required_attributes_tenant_id_attribute_id_fkey" FOREIGN KEY ("tenant_id","attribute_id") REFERENCES "public"."attribute_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ADD CONSTRAINT "customer_staff_affinities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ADD CONSTRAINT "customer_staff_affinities_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ADD CONSTRAINT "customer_staff_affinities_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" ADD CONSTRAINT "customer_staff_affinities_tenant_id_updated_by_fkey" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ADD CONSTRAINT "matching_run_candidates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ADD CONSTRAINT "matching_run_candidates_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."matching_runs"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ADD CONSTRAINT "matching_run_candidates_tenant_id_reservation_id_fkey" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" ADD CONSTRAINT "matching_run_candidates_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_runs" ADD CONSTRAINT "matching_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_runs" ADD CONSTRAINT "matching_runs_tenant_id_requested_by_fkey" FOREIGN KEY ("tenant_id","requested_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_areas" ADD CONSTRAINT "service_areas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attributes" ADD CONSTRAINT "staff_attributes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attributes" ADD CONSTRAINT "staff_attributes_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attributes" ADD CONSTRAINT "staff_attributes_tenant_id_attribute_id_fkey" FOREIGN KEY ("tenant_id","attribute_id") REFERENCES "public"."attribute_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attributes" ADD CONSTRAINT "staff_attributes_tenant_id_verified_by_fkey" FOREIGN KEY ("tenant_id","verified_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attributes" ADD CONSTRAINT "staff_attributes_tenant_id_evidence_file_id_fkey" FOREIGN KEY ("tenant_id","evidence_file_id") REFERENCES "public"."stored_files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability_exceptions" ADD CONSTRAINT "staff_availability_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability_exceptions" ADD CONSTRAINT "staff_availability_exceptions_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_busy_blocks" ADD CONSTRAINT "staff_busy_blocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_busy_blocks" ADD CONSTRAINT "staff_busy_blocks_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_calendars" ADD CONSTRAINT "staff_calendars_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_calendars" ADD CONSTRAINT "staff_calendars_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_areas" ADD CONSTRAINT "staff_service_areas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_areas" ADD CONSTRAINT "staff_service_areas_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_service_areas" ADD CONSTRAINT "staff_service_areas_tenant_id_service_area_id_fkey" FOREIGN KEY ("tenant_id","service_area_id") REFERENCES "public"."service_areas"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_weekly_availability" ADD CONSTRAINT "staff_weekly_availability_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_weekly_availability" ADD CONSTRAINT "staff_weekly_availability_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_time_cache" ADD CONSTRAINT "travel_time_cache_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_changes" ADD CONSTRAINT "entity_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."plan_features" ADD CONSTRAINT "plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "platform"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."tenants" ADD CONSTRAINT "tenants_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "platform"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompt_revisions" ADD CONSTRAINT "ai_prompt_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_tenant_id_updated_by_fkey" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_record_revisions" ADD CONSTRAINT "care_record_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_record_revisions" ADD CONSTRAINT "care_record_revisions_tenant_id_care_record_id_fkey" FOREIGN KEY ("tenant_id","care_record_id") REFERENCES "public"."care_records"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_tenant_id_visit_id_fkey" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_tenant_id_care_recipient_id_fkey" FOREIGN KEY ("tenant_id","care_recipient_id") REFERENCES "public"."care_recipients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_tenant_id_author_staff_id_fkey" FOREIGN KEY ("tenant_id","author_staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_uploads" ADD CONSTRAINT "receipt_uploads_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_upload_id_fkey" FOREIGN KEY ("tenant_id","upload_id") REFERENCES "public"."receipt_uploads"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."stored_files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id","created_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_id_reservation_id_fkey" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_id_matching_run_id_fkey" FOREIGN KEY ("tenant_id","matching_run_id") REFERENCES "public"."matching_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_id_assigned_by_fkey" FOREIGN KEY ("tenant_id","assigned_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_recipients" ADD CONSTRAINT "reservation_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_recipients" ADD CONSTRAINT "reservation_recipients_tenant_id_reservation_id_fkey" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."reservations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_recipients" ADD CONSTRAINT "reservation_recipients_tenant_id_care_recipient_id_fkey" FOREIGN KEY ("tenant_id","care_recipient_id") REFERENCES "public"."care_recipients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_address_id_fkey" FOREIGN KEY ("tenant_id","address_id") REFERENCES "public"."customer_addresses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_service_item_id_fkey" FOREIGN KEY ("tenant_id","service_item_id") REFERENCES "public"."service_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_recurring_slot_id_fkey" FOREIGN KEY ("tenant_id","recurring_slot_id") REFERENCES "public"."customer_recurring_slots"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_credentials" ADD CONSTRAINT "staff_credentials_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_employment_terms" ADD CONSTRAINT "staff_employment_terms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_employment_terms" ADD CONSTRAINT "staff_employment_terms_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_login_emails" ADD CONSTRAINT "staff_login_emails_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_login_emails" ADD CONSTRAINT "staff_login_emails_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id","staff_id") REFERENCES "public"."staff"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_tenant_id_triggered_by_fkey" FOREIGN KEY ("tenant_id","triggered_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_data_keys" ADD CONSTRAINT "tenant_data_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_features" ADD CONSTRAINT "tenant_features_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_secrets" ADD CONSTRAINT "tenant_secrets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_secrets" ADD CONSTRAINT "tenant_secrets_tenant_id_updated_by_fkey" FOREIGN KEY ("tenant_id","updated_by") REFERENCES "public"."staff"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visits_tenant_id_customer_id_business_date_idx" ON "visits" USING btree ("tenant_id","customer_id","business_date");--> statement-breakpoint
CREATE INDEX "care_recipients_tenant_id_customer_id_idx" ON "care_recipients" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_tenant_id_customer_id_idx" ON "customer_addresses" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_addresses_tenant_id_city_idx" ON "customer_addresses" USING btree ("tenant_id","city");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_tenant_id_customer_id_primary_key" ON "customer_addresses" USING btree ("tenant_id","customer_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "customer_contacts_tenant_id_customer_id_idx" ON "customer_contacts" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_recurring_slots_tenant_id_customer_id_idx" ON "customer_recurring_slots" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_source_records_tenant_id_customer_id_idx" ON "customer_source_records" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_id_family_name_idx" ON "customers" USING btree ("tenant_id","family_name");--> statement-breakpoint
CREATE INDEX "customers_tenant_id_family_name_kana_idx" ON "customers" USING btree ("tenant_id","family_name_kana" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "customer_staff_affinities_tenant_id_staff_id_idx" ON "customer_staff_affinities" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE INDEX "matching_run_candidates_created_at_idx" ON "matching_run_candidates" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "matching_runs_tenant_id_created_at_idx" ON "matching_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_attributes_tenant_id_attribute_id_idx" ON "staff_attributes" USING btree ("tenant_id","attribute_id");--> statement-breakpoint
CREATE INDEX "staff_availability_exceptions_tenant_id_staff_id_period_idx" ON "staff_availability_exceptions" USING gist ("tenant_id","staff_id","period");--> statement-breakpoint
CREATE INDEX "staff_busy_blocks_tenant_id_staff_id_period_idx" ON "staff_busy_blocks" USING gist ("tenant_id","staff_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_calendars_tenant_id_staff_id_schedule_key" ON "staff_calendars" USING btree ("tenant_id","staff_id") WHERE purpose = 'schedule';--> statement-breakpoint
CREATE INDEX "entity_changes_tenant_id_entity_type_entity_id_created_at_idx" ON "entity_changes" USING btree ("tenant_id","entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_messages_available_at_idx" ON "outbox_messages" USING btree ("available_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_messages_locked_until_idx" ON "outbox_messages" USING btree ("locked_until") WHERE status = 'processing';--> statement-breakpoint
CREATE INDEX "outbox_messages_tenant_id_aggregate_id_id_idx" ON "outbox_messages" USING btree ("tenant_id","aggregate_id","id");--> statement-breakpoint
CREATE INDEX "outbox_messages_completed_at_idx" ON "outbox_messages" USING btree ("completed_at") WHERE status in ('done', 'failed', 'dead');--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_updated_at_idx" ON "platform"."rate_limit_buckets" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "tenant_lifecycle_events_tenant_id_created_at_idx" ON "platform"."tenant_lifecycle_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "care_records_tenant_id_customer_id_occurred_at_id_idx" ON "care_records" USING btree ("tenant_id","customer_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "care_records_tenant_id_author_staff_id_occurred_at_idx" ON "care_records" USING btree ("tenant_id","author_staff_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "care_records_tenant_id_visit_id_idx" ON "care_records" USING btree ("tenant_id","visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_tenant_id_dedupe_bidx_key" ON "receipts" USING btree ("tenant_id","dedupe_bidx") WHERE dedupe_bidx is not null;--> statement-breakpoint
CREATE INDEX "receipts_tenant_id_staff_id_receipted_at_idx" ON "receipts" USING btree ("tenant_id","staff_id","receipted_at");--> statement-breakpoint
CREATE INDEX "receipts_tenant_id_upload_id_idx" ON "receipts" USING btree ("tenant_id","upload_id");--> statement-breakpoint
CREATE INDEX "receipts_tenant_id_file_id_idx" ON "receipts" USING btree ("tenant_id","file_id");--> statement-breakpoint
CREATE INDEX "reservation_assignments_tenant_id_reservation_id_idx" ON "reservation_assignments" USING btree ("tenant_id","reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_assignments_tenant_id_reservation_id_staff_id_key" ON "reservation_assignments" USING btree ("tenant_id","reservation_id","staff_id") WHERE status in ('proposed', 'confirmed');--> statement-breakpoint
CREATE INDEX "reservations_tenant_id_business_date_idx" ON "reservations" USING btree ("tenant_id","business_date");--> statement-breakpoint
CREATE INDEX "reservations_tenant_id_customer_id_idx" ON "reservations" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_codes_tenant_id_staff_id_active_key" ON "password_reset_codes" USING btree ("tenant_id","staff_id") WHERE used_at is null;--> statement-breakpoint
CREATE INDEX "password_reset_codes_expires_at_idx" ON "password_reset_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_tenant_id_staff_id_idx" ON "sessions" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE INDEX "sessions_absolute_expires_at_idx" ON "sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE INDEX "staff_tenant_id_family_name_idx" ON "staff" USING btree ("tenant_id","family_name");--> statement-breakpoint
CREATE INDEX "staff_tenant_id_family_name_kana_idx" ON "staff" USING btree ("tenant_id","family_name_kana" text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "staff_login_emails_tenant_id_staff_id_primary_key" ON "staff_login_emails" USING btree ("tenant_id","staff_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "staff_login_emails_tenant_id_staff_id_idx" ON "staff_login_emails" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE INDEX "import_runs_tenant_id_source_started_at_idx" ON "import_runs" USING btree ("tenant_id","source","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_data_keys_tenant_id_active_key" ON "tenant_data_keys" USING btree ("tenant_id") WHERE state = 'active';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attendance_days" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attendance_periods" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "travel_legs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "visits" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_segments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "care_recipients" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_addresses" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_contacts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_preferences" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_recurring_slots" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_source_records" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "data_export_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "data_subject_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "retention_policies" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attribute_definitions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_required_attributes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_staff_affinities" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "matching_run_candidates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "matching_runs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_areas" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_attributes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_availability_exceptions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_busy_blocks" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_calendars" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_service_areas" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_weekly_availability" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "travel_time_cache" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "entity_changes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "outbox_messages" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_prompt_revisions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_prompts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "care_record_revisions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "care_records" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "receipt_uploads" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "receipts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stored_files" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reservation_assignments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reservation_recipients" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reservations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "service_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "password_reset_codes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_credentials" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_employment_terms" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "staff_login_emails" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_field_definitions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "import_runs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_data_keys" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_features" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_secrets" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());