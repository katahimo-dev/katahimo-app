-- 0001_baseline_custom: drizzle-kit では書けない定義(手書き)。
-- トリガー・EXCLUDE 制約・ON DELETE SET NULL (列)・FORCE RLS・ロールごとの権限・パーティション表の app_logs・
-- テナントの作成・消去の関数。ロール(katahimo_owner / katahimo_app / katahimo_worker / katahimo_readonly)は
-- infra/initdb・infra/cloudsql の初期化SQLが先に作っておく(無ければここで失敗する)。
-- このマイグレーションは所有者ロール(katahimo_owner。katahimo_migrator が SET ROLE して実行)で流れる。

-- ─────────────────────────────────────────────────────────────
-- 1. updated_at はトリガーで保つ(アプリは書かない)
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER "plan_features_set_updated_at" BEFORE UPDATE ON "platform"."plan_features"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "plans_set_updated_at" BEFORE UPDATE ON "platform"."plans"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "platform_operators_set_updated_at" BEFORE UPDATE ON "platform"."platform_operators"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "rate_limit_buckets_set_updated_at" BEFORE UPDATE ON "platform"."rate_limit_buckets"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "tenants_set_updated_at" BEFORE UPDATE ON "platform"."tenants"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "ai_prompts_set_updated_at" BEFORE UPDATE ON "ai_prompts"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "attendance_days_set_updated_at" BEFORE UPDATE ON "attendance_days"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "attendance_periods_set_updated_at" BEFORE UPDATE ON "attendance_periods"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "attribute_definitions_set_updated_at" BEFORE UPDATE ON "attribute_definitions"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "care_recipients_set_updated_at" BEFORE UPDATE ON "care_recipients"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "care_records_set_updated_at" BEFORE UPDATE ON "care_records"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "custom_field_definitions_set_updated_at" BEFORE UPDATE ON "custom_field_definitions"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "customer_addresses_set_updated_at" BEFORE UPDATE ON "customer_addresses"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "customer_contacts_set_updated_at" BEFORE UPDATE ON "customer_contacts"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "customer_preferences_set_updated_at" BEFORE UPDATE ON "customer_preferences"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "customer_recurring_slots_set_updated_at" BEFORE UPDATE ON "customer_recurring_slots"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "customer_report_profiles_set_updated_at" BEFORE UPDATE ON "customer_report_profiles"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "customer_required_attributes_set_updated_at" BEFORE UPDATE ON "customer_required_attributes"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "customer_source_records_set_updated_at" BEFORE UPDATE ON "customer_source_records"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "customer_staff_affinities_set_updated_at" BEFORE UPDATE ON "customer_staff_affinities"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "customers_set_updated_at" BEFORE UPDATE ON "customers"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "data_export_requests_set_updated_at" BEFORE UPDATE ON "data_export_requests"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "data_subject_requests_set_updated_at" BEFORE UPDATE ON "data_subject_requests"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "legacy_imported_rows_set_updated_at" BEFORE UPDATE ON "legacy_imported_rows"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "matching_runs_set_updated_at" BEFORE UPDATE ON "matching_runs"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "push_subscriptions_set_updated_at" BEFORE UPDATE ON "push_subscriptions"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "report_age_bands_set_updated_at" BEFORE UPDATE ON "report_age_bands"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "report_education_levels_set_updated_at" BEFORE UPDATE ON "report_education_levels"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "report_keywords_set_updated_at" BEFORE UPDATE ON "report_keywords"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "report_phrases_set_updated_at" BEFORE UPDATE ON "report_phrases"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "report_psi_levels_set_updated_at" BEFORE UPDATE ON "report_psi_levels"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "report_stance_rules_set_updated_at" BEFORE UPDATE ON "report_stance_rules"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "reservation_assignments_set_updated_at" BEFORE UPDATE ON "reservation_assignments"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "reservations_set_updated_at" BEFORE UPDATE ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "retention_policies_set_updated_at" BEFORE UPDATE ON "retention_policies"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "service_areas_set_updated_at" BEFORE UPDATE ON "service_areas"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "service_items_set_updated_at" BEFORE UPDATE ON "service_items"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "staff_set_updated_at" BEFORE UPDATE ON "staff"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "staff_attributes_set_updated_at" BEFORE UPDATE ON "staff_attributes"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "staff_availability_exceptions_set_updated_at" BEFORE UPDATE ON "staff_availability_exceptions"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "staff_busy_blocks_set_updated_at" BEFORE UPDATE ON "staff_busy_blocks"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "staff_calendars_set_updated_at" BEFORE UPDATE ON "staff_calendars"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "staff_credentials_set_updated_at" BEFORE UPDATE ON "staff_credentials"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "staff_employment_terms_set_updated_at" BEFORE UPDATE ON "staff_employment_terms"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "staff_weekly_availability_set_updated_at" BEFORE UPDATE ON "staff_weekly_availability"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "tenant_features_set_updated_at" BEFORE UPDATE ON "tenant_features"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "tenant_secrets_set_updated_at" BEFORE UPDATE ON "tenant_secrets"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "tenant_settings_set_updated_at" BEFORE UPDATE ON "tenant_settings"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "travel_legs_set_updated_at" BEFORE UPDATE ON "travel_legs"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "visits_set_updated_at" BEFORE UPDATE ON "visits"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER "work_segments_set_updated_at" BEFORE UPDATE ON "work_segments"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- 2. EXCLUDE 制約(範囲の重なりの禁止。uuid・整数を = で GiST に載せるため btree_gist を使う)
-- ─────────────────────────────────────────────────────────────
-- 同じスタッフの雇用条件の期間は重ならない
ALTER TABLE "staff_employment_terms" ADD CONSTRAINT "staff_employment_terms_tenant_id_staff_id_valid_excl"
  EXCLUDE USING gist ("tenant_id" WITH =, "staff_id" WITH =, "valid" WITH &&);--> statement-breakpoint
-- 同じ顧客の自宅の期間は重ならない(期間限定の住所は secondary)
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenant_id_customer_id_valid_excl"
  EXCLUDE USING gist ("tenant_id" WITH =, "customer_id" WITH =, "valid" WITH &&) WHERE ("kind" = 'home');--> statement-breakpoint
-- スタッフの二重予約の禁止(有効な割当の時間帯は重ならない)
ALTER TABLE "reservation_assignments" ADD CONSTRAINT "reservation_assignments_tenant_id_staff_id_period_excl"
  EXCLUDE USING gist ("tenant_id" WITH =, "staff_id" WITH =, "period" WITH &&)
  WHERE ("status" IN ('proposed', 'confirmed'));--> statement-breakpoint
-- 訪問(visits)の実績の時間帯の重なりは制約にしない。予定の正はカレンダーで、GAS版もカレンダーの反映・手入力とも
-- 重なった時間帯をそのまま出勤簿に書いていた(重なりを拒否すると、その日の反映が丸ごと失敗する)。二重予約の防止は
-- 予約の割当(reservation_assignments の EXCLUDE)が受け持つ。
-- 週次の勤務可能枠: 同じ曜日で有効期間が重なる枠の時間帯は重ならない(時刻は基準日 2000-01-01 に載せて比べる)
ALTER TABLE "staff_weekly_availability" ADD CONSTRAINT "staff_weekly_availability_tenant_id_staff_id_weekday_excl"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "staff_id" WITH =,
    "weekday" WITH =,
    tsrange('2000-01-01'::date + "start_time", '2000-01-01'::date + "end_time") WITH &&,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );--> statement-breakpoint
-- 同じスタッフ・同じ属性の有効期間は重ならない
ALTER TABLE "staff_attributes" ADD CONSTRAINT "staff_attributes_tenant_id_staff_id_attribute_id_valid_excl"
  EXCLUDE USING gist ("tenant_id" WITH =, "staff_id" WITH =, "attribute_id" WITH =, "valid" WITH &&);--> statement-breakpoint
-- 日報AIの年齢帯: アーカイブしていない帯の月齢範囲 [from, to) は重ならない。取込は1つのトランザクションで帯を
-- 入れ替える(「0〜12ヶ月」を「0〜6」「6〜12」に分ける等)ため、確かめるのはコミットのとき
ALTER TABLE "report_age_bands" ADD CONSTRAINT "report_age_bands_tenant_id_age_range_excl"
  EXCLUDE USING gist ("tenant_id" WITH =, int4range("age_from_months", "age_to_months") WITH &&)
  WHERE ("archived_at" IS NULL) DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- 3. 移動 → 訪問の参照(訪問が消えたら列だけ null にする。PostgreSQL 15 以降の SET NULL (列))
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_tenant_id_from_visit_id_fkey"
  FOREIGN KEY ("tenant_id", "from_visit_id") REFERENCES "visits" ("tenant_id", "id") ON DELETE SET NULL ("from_visit_id");--> statement-breakpoint
ALTER TABLE "travel_legs" ADD CONSTRAINT "travel_legs_tenant_id_to_visit_id_fkey"
  FOREIGN KEY ("tenant_id", "to_visit_id") REFERENCES "visits" ("tenant_id", "id") ON DELETE SET NULL ("to_visit_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- 4. 勤怠の月の締め(attendance_periods.status = 'locked' の月は書き換えさせない)。アプリの判定に加えた二重の守り。
--    SQLSTATE KH001 はアプリが「締め済み」(400 locked)として扱う。
--    - 締めと書き込みが同時に走っても取りこぼさないよう、(テナント・スタッフ・月)ごとのアドバイザリロックで
--      順序を付ける: 勤怠の書き込みは共有ロック、締め(status を locked にする)は排他ロック。締めの行がまだ無い月
--      (INSERT で締める)でも効く。ロックはトランザクションの終わりまで持つ。
--    - 締めの解除(locked → open)・締めた月の行の削除は所有者(運用の関数・テナントの消去)だけができる。
--    - テナントの消去(platform.tenants の行の削除からの cascade)では確かめない(テナントの行が既に無い)。
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.attendance_period_lock_key(p_tenant_id uuid, p_staff_id uuid, p_year_month text)
  RETURNS bigint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT hashtextextended(p_tenant_id::text || '/' || p_staff_id::text || '/' || p_year_month, 0) $$;--> statement-breakpoint

-- 締めた月か(共有ロックを取ってから読む。締めの処理が終わるまで待つ)
CREATE FUNCTION public.attendance_period_is_locked(p_tenant_id uuid, p_staff_id uuid, p_business_date date)
  RETURNS boolean
  LANGUAGE plpgsql
  AS $$
DECLARE
  ym text := to_char(p_business_date, 'YYYY-MM');
BEGIN
  PERFORM pg_advisory_xact_lock_shared(public.attendance_period_lock_key(p_tenant_id, p_staff_id, ym));
  RETURN EXISTS (
    SELECT 1 FROM attendance_periods p
    WHERE p.tenant_id = p_tenant_id AND p.staff_id = p_staff_id AND p.year_month = ym AND p.status = 'locked'
  );
END
$$;--> statement-breakpoint

CREATE FUNCTION public.enforce_attendance_period_lock() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.tenants t WHERE t.id = r.tenant_id) THEN
    RETURN r;
  END IF;
  IF public.attendance_period_is_locked(r.tenant_id, r.staff_id, r.business_date)
     OR (TG_OP = 'UPDATE' AND public.attendance_period_is_locked(OLD.tenant_id, OLD.staff_id, OLD.business_date)) THEN
    RAISE EXCEPTION 'attendance period % is locked', to_char(r.business_date, 'YYYY-MM') USING ERRCODE = 'KH001';
  END IF;
  RETURN r;
END
$$;--> statement-breakpoint

CREATE TRIGGER "attendance_days_enforce_period_lock" BEFORE INSERT OR UPDATE OR DELETE ON "attendance_days"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_period_lock();--> statement-breakpoint
CREATE TRIGGER "visits_enforce_period_lock" BEFORE INSERT OR UPDATE OR DELETE ON "visits"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_period_lock();--> statement-breakpoint
CREATE TRIGGER "work_segments_enforce_period_lock" BEFORE INSERT OR UPDATE OR DELETE ON "work_segments"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_period_lock();--> statement-breakpoint
CREATE TRIGGER "travel_legs_enforce_period_lock" BEFORE INSERT OR UPDATE OR DELETE ON "travel_legs"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_period_lock();--> statement-breakpoint

-- 締めの行そのものの守り: 締めるときは排他ロックを取り(書き込み中の同じ月のトランザクションを待つ)、
-- 締めの解除・締めた月の行の削除は所有者だけに許す(アプリ・ワーカーは KH001)
CREATE FUNCTION public.guard_attendance_period() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'locked'
     AND (TG_OP = 'DELETE' OR NEW.status <> 'locked')
     AND current_user <> 'katahimo_owner' THEN
    RAISE EXCEPTION 'attendance period % is locked', OLD.year_month USING ERRCODE = 'KH001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status = 'locked' THEN
    PERFORM pg_advisory_xact_lock(public.attendance_period_lock_key(NEW.tenant_id, NEW.staff_id, NEW.year_month));
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "attendance_periods_guard" BEFORE INSERT OR UPDATE OR DELETE ON "attendance_periods"
  FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_period();--> statement-breakpoint

-- 締めの解除(運用。所有者のメンバー = katahimo_migrator だけが実行できる)。解除した行があれば true
CREATE FUNCTION platform.unlock_attendance_period(p_tenant_id uuid, p_staff_id uuid, p_year_month text)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  previous_tenant text := current_setting('app.tenant_id', true);
  updated integer;
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  UPDATE public.attendance_periods SET status = 'open', locked_at = NULL, locked_by = NULL
  WHERE tenant_id = p_tenant_id AND staff_id = p_staff_id AND year_month = p_year_month AND status = 'locked';
  GET DIAGNOSTICS updated = ROW_COUNT;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
  RETURN updated > 0;
END
$$;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- 5. 記録の守りと本文の変更履歴(全ての UPDATE・DELETE で動く。WHEN で絞らない)。
--    - locked(確定済み)の記録は、本文以外の列も含めて変更・削除できない(SQLSTATE KH002)。locked から他の状態へも戻せない。
--    - 下書き以外(submitted)の記録の本文(body・本文の形式の版)が変わったら、変更前を care_record_revisions に写す。
--      変更者はセッションの app.actor_id(UoW が設定)。
--    - テナントの消去(platform.tenants の行の削除からの cascade)では確かめない。
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.care_records_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform.tenants t WHERE t.id = OLD.tenant_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'care record % is locked', OLD.id USING ERRCODE = 'KH002';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF OLD.status <> 'draft' AND (OLD.body IS DISTINCT FROM NEW.body
                                OR OLD.body_schema_ver IS DISTINCT FROM NEW.body_schema_ver) THEN
    INSERT INTO care_record_revisions (tenant_id, id, care_record_id, revision_no, body, body_schema_ver, changed_by)
    VALUES (
      OLD.tenant_id,
      gen_random_uuid(),
      OLD.id,
      coalesce((SELECT max(revision_no) FROM care_record_revisions
                WHERE tenant_id = OLD.tenant_id AND care_record_id = OLD.id), 0) + 1,
      OLD.body,
      OLD.body_schema_ver,
      nullif(current_setting('app.actor_id', true), '')::uuid
    );
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "care_records_guard" BEFORE UPDATE OR DELETE ON "care_records"
  FOR EACH ROW EXECUTE FUNCTION public.care_records_guard();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- 6. 操作ログ(app_logs): 月ごとの RANGE パーティション。テナント特定前(ログイン失敗等)の行は tenant_id が null。
--    FK は持たない(記録の対象が消えても証跡を残す)。保存期間はパーティションごと DROP する(ワーカーのジョブ)。
-- ─────────────────────────────────────────────────────────────
CREATE TABLE "app_logs" (
	"id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" uuid,
	"level" text NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"target_type" text,
	"target_id" uuid,
	"request_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" inet,
	"user_agent" text,
	CONSTRAINT "app_logs_pkey" PRIMARY KEY ("created_at", "id"),
	CONSTRAINT "app_logs_level_check" CHECK ("level" IN ('INFO', 'WARN', 'ERROR', 'SECURITY')),
	CONSTRAINT "app_logs_actor_type_check" CHECK ("actor_type" IN ('staff', 'system', 'operator', 'anonymous')),
	CONSTRAINT "app_logs_actor_check" CHECK (("actor_type" IN ('staff', 'operator')) = ("actor_id" IS NOT NULL))
) PARTITION BY RANGE ("created_at");--> statement-breakpoint
CREATE INDEX "app_logs_tenant_id_created_at_idx" ON "app_logs" ("tenant_id", "created_at");--> statement-breakpoint
ALTER TABLE "app_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "app_logs_select" ON "app_logs" AS PERMISSIVE FOR SELECT TO public
  USING (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY "app_logs_insert" ON "app_logs" AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_current_tenant());--> statement-breakpoint

-- 既定のパーティション(該当する月のパーティションが無い行の受け皿)。月のパーティションを作り忘れても(保守ジョブの
-- 失敗等)操作ログの書き込みは失敗しない。受け皿に入った行は次の ensure_app_log_partitions が月のパーティションへ移す。
CREATE TABLE "app_logs_default" PARTITION OF "app_logs" DEFAULT;--> statement-breakpoint
ALTER TABLE "app_logs_default" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 月のパーティションを今月から months_ahead か月先まで作り、既定のパーティションに入っている行の月の分も作って
-- 行を移す(既定のパーティションに該当する行があると PARTITION OF では作れないため、別の表に移してから ATTACH する)。
-- 作った数を返す。既にあれば何もしない。
CREATE FUNCTION platform.ensure_app_log_partitions(months_ahead integer DEFAULT 12) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  this_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  month_start date;
  range_from timestamptz;
  range_to timestamptz;
  name text;
  created integer := 0;
BEGIN
  IF months_ahead < 0 THEN
    RAISE EXCEPTION 'months_ahead must be >= 0';
  END IF;
  FOR month_start IN
    SELECT m::date FROM generate_series(this_month, this_month + make_interval(months => months_ahead), interval '1 month') m
    UNION
    SELECT DISTINCT date_trunc('month', d.created_at AT TIME ZONE 'UTC')::date FROM public.app_logs_default d
    ORDER BY 1
  LOOP
    name := 'app_logs_y' || to_char(month_start, 'YYYY') || 'm' || to_char(month_start, 'MM');
    CONTINUE WHEN to_regclass('public.' || name) IS NOT NULL;
    range_from := month_start::timestamp AT TIME ZONE 'UTC';
    range_to := (month_start + interval '1 month')::timestamp AT TIME ZONE 'UTC';
    IF EXISTS (SELECT 1 FROM public.app_logs_default d WHERE d.created_at >= range_from AND d.created_at < range_to) THEN
      EXECUTE format('CREATE TABLE public.%I (LIKE public.app_logs INCLUDING DEFAULTS INCLUDING CONSTRAINTS)', name);
      EXECUTE format(
        'WITH moved AS (DELETE FROM public.app_logs_default WHERE created_at >= %L AND created_at < %L RETURNING *) '
        'INSERT INTO public.%I SELECT * FROM moved',
        range_from, range_to, name
      );
      EXECUTE format('ALTER TABLE public.app_logs ATTACH PARTITION public.%I FOR VALUES FROM (%L) TO (%L)',
        name, range_from, range_to);
    ELSE
      EXECUTE format('CREATE TABLE public.%I PARTITION OF public.app_logs FOR VALUES FROM (%L) TO (%L)',
        name, range_from, range_to);
    END IF;
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', name);
    created := created + 1;
  END LOOP;
  RETURN created;
END
$$;--> statement-breakpoint
-- 保存期間(retain_months か月)より前のパーティションを消す。消した数を返す。
CREATE FUNCTION platform.drop_app_log_partitions(retain_months integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  cutoff date := (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => retain_months))::date;
  part record;
  dropped integer := 0;
BEGIN
  IF retain_months < 1 THEN
    RAISE EXCEPTION 'retain_months must be >= 1';
  END IF;
  FOR part IN
    SELECT c.relname FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'public.app_logs'::regclass AND c.relname ~ '^app_logs_y[0-9]{4}m[0-9]{2}$'
  LOOP
    IF make_date(substr(part.relname, 11, 4)::int, substr(part.relname, 16, 2)::int, 1) < cutoff THEN
      EXECUTE format('DROP TABLE public.%I', part.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END
$$;--> statement-breakpoint
SELECT platform.ensure_app_log_partitions(12);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- 7. テナントの作成(運用の CLI・シードから)。所有者の権限で tenants・設定・ライフサイクルの記録をまとめて作る。
--    ID は呼び出し側が決める(アプリが生成する UUIDv7)。
-- ─────────────────────────────────────────────────────────────
CREATE FUNCTION platform.provision_tenant(
  p_id uuid,
  p_slug text,
  p_name text,
  p_timezone text DEFAULT 'Asia/Tokyo',
  p_business_type text DEFAULT 'babysitting'
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  previous_tenant text := current_setting('app.tenant_id', true);
BEGIN
  INSERT INTO platform.tenants (id, slug, name, status, timezone, business_type)
  VALUES (p_id, p_slug, p_name, 'active', p_timezone, p_business_type);
  -- テナントのテーブルは所有者にも RLS が掛かる(FORCE)ため、このトランザクションの中だけテナントを設定する
  PERFORM set_config('app.tenant_id', p_id::text, true);
  INSERT INTO public.tenant_settings (tenant_id) VALUES (p_id);
  INSERT INTO platform.tenant_lifecycle_events (id, tenant_id, event, actor)
  VALUES (gen_random_uuid(), p_id, 'provisioned', session_user);
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
  RETURN p_id;
END
$$;--> statement-breakpoint

-- テナントの消去(解約後。運用の CLI から、所有者のメンバー = katahimo_migrator だけが実行できる)。
-- 解約済み(status = 'terminated')のテナントだけを消す。platform.tenants の行を消すと、全てのテナントのテーブルの
-- tenant_id の外部キー(ON DELETE CASCADE)で1つの文の中で全データが消える(締めた月の勤怠・確定済みの記録・
-- 記録の履歴も。各トリガーはテナントの行が無いことで消去と判断して通す)。操作ログ(app_logs)は外部キーを
-- 持たないため残り、保存期間の経過でパーティションごと消える。消した場合 true、テナントが無ければ false。
CREATE FUNCTION platform.purge_tenant(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  current_status text;
BEGIN
  SELECT status INTO current_status FROM platform.tenants WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF current_status <> 'terminated' THEN
    RAISE EXCEPTION 'tenant % is not terminated (status=%)', p_id, current_status;
  END IF;
  DELETE FROM platform.tenants WHERE id = p_id;
  RETURN true;
END
$$;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- 8. RLS の強制(所有者にもポリシーを掛ける)と、ワーカーがテナントを横断して outbox を取るためのポリシー
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "ai_prompt_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_prompts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_days" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attribute_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "care_recipients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "care_record_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "care_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_addresses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_recurring_slots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_report_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_required_attributes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_source_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_export_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_subject_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entity_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_api_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "legacy_imported_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matching_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbox_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "password_reset_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipt_uploads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_age_bands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_ai_generations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_education_levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_keywords" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_phrases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_psi_levels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_stance_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reservation_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reservation_recipients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "retention_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_areas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_attributes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_availability_exceptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_busy_blocks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_calendars" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_employment_terms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_login_emails" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_service_areas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_weekly_availability" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stored_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_features" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_secrets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "travel_legs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "travel_time_cache" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_segments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "outbox_messages_worker" ON "outbox_messages" AS PERMISSIVE FOR ALL TO katahimo_worker
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- 9. 権限(既定権限 DEFAULT PRIVILEGES には頼らず、テーブルごとに明示する。新しいテーブルは追加の
--    マイグレーションで同じように GRANT を書く。packages/db/src/integration/catalog.integration.test.ts が
--    RLS・FORCE・ポリシー・追記専用テーブルの権限を確かめる)
--    katahimo_app: API / katahimo_worker: ワーカー / katahimo_readonly: 将来の分析・調査用(今は何も読めない)
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON SCHEMA platform FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public, platform TO katahimo_app, katahimo_worker, katahimo_readonly;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.provision_tenant(uuid, text, text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.purge_tenant(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.unlock_attendance_period(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.ensure_app_log_partitions(integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform.drop_app_log_partitions(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.ensure_app_log_partitions(integer) TO katahimo_worker;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform.drop_app_log_partitions(integer) TO katahimo_worker;--> statement-breakpoint

-- ── katahimo_app(API) ──
-- platform: 参照だけ(レート制限のカウンタは読み書き)。tenant_lifecycle_events・platform_operators は運用者のみ
GRANT SELECT ON "platform"."tenants", "platform"."plans", "platform"."plan_features" TO katahimo_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform"."rate_limit_buckets" TO katahimo_app;--> statement-breakpoint
-- 追記専用(UPDATE・DELETE なし。操作ログの保存期間の削除はパーティションごと)
GRANT SELECT, INSERT ON "app_logs", "ai_prompt_revisions", "care_record_revisions", "entity_changes" TO katahimo_app;--> statement-breakpoint
-- outbox は積むだけ(状態の更新はワーカー)。設定の行は provision_tenant が作る
GRANT SELECT, INSERT ON "outbox_messages" TO katahimo_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON "tenant_settings" TO katahimo_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "import_runs", "staff_credentials" TO katahimo_app;--> statement-breakpoint
-- GAS版のスプレッドシートからの移行の取込(運用担当者の CLI がアプリの DB ユーザーで動く)。取り込んだ行と記録の対応は消さない
GRANT SELECT, INSERT, UPDATE ON "legacy_imported_rows" TO katahimo_app;--> statement-breakpoint
-- 外部システム連携の API キーは確かめて最終利用の時刻を書くだけ(発行・失効は運用担当者の CLI が所有者の接続で行う)
GRANT SELECT, UPDATE ("last_used_at") ON "integration_api_keys" TO katahimo_app;--> statement-breakpoint
-- 月の締めは締めるだけ(解除・削除は所有者の platform.unlock_attendance_period / テナントの消去。トリガーでも守る)
GRANT SELECT, INSERT, UPDATE ON "attendance_periods" TO katahimo_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "ai_prompts", "attendance_days", "attribute_definitions", "care_recipients", "care_records",
  "custom_field_definitions", "customer_addresses", "customer_contacts", "customer_preferences",
  "customer_recurring_slots", "customer_required_attributes", "customer_source_records", "customer_staff_affinities",
  "customers", "data_export_requests", "data_subject_requests", "matching_run_candidates", "matching_runs",
  "password_reset_codes", "reservation_assignments", "reservation_recipients",
  "reservations", "retention_policies", "service_areas", "service_items", "sessions", "staff", "staff_attributes",
  "staff_availability_exceptions", "staff_busy_blocks", "staff_calendars", "staff_employment_terms",
  "staff_login_emails", "staff_service_areas", "staff_weekly_availability", "stored_files", "tenant_features",
  "tenant_secrets", "travel_legs", "travel_time_cache", "visits", "work_segments"
  TO katahimo_app;--> statement-breakpoint
-- 領収書は会計の記録なので登録するだけ(消さない)。登録の後に変えられるのは取消の列と版(論理削除の取消)と、
-- 重複の判定の代表(代表を取消したら同じ内容の残りの行へ移す)だけ
GRANT SELECT, INSERT ON "receipt_uploads", "receipts" TO katahimo_app;--> statement-breakpoint
GRANT UPDATE ("cancelled_at", "cancelled_by", "cancel_reason", "row_version", "dedupe_primary") ON "receipts" TO katahimo_app;--> statement-breakpoint
-- Web Push の購読(本人の端末の登録・付け替え・削除)
GRANT SELECT, INSERT, UPDATE, DELETE ON "push_subscriptions" TO katahimo_app;--> statement-breakpoint
-- 日報AIの調整のマスター(行は消さずにアーカイブする)・家庭ごとの教育思考★
GRANT SELECT, INSERT, UPDATE ON
  "report_keywords", "report_age_bands", "report_education_levels", "report_psi_levels", "report_phrases",
  "report_stance_rules", "customer_report_profiles"
  TO katahimo_app;--> statement-breakpoint
-- AI 生成の記録は追記のみ(後から書くのは日報への結び付けだけ)
GRANT SELECT, INSERT ON "report_ai_generations" TO katahimo_app;--> statement-breakpoint
GRANT UPDATE ("care_record_id") ON "report_ai_generations" TO katahimo_app;--> statement-breakpoint

-- ── katahimo_worker(ワーカー・ジョブ)。ジョブが使う表・操作だけ(認証情報・テナントの秘密値・AIプロンプト・
--    マッチングの表には権限を与えない)。ジョブを足すときはここと catalog.integration.test.ts の一覧を直す ──
-- outbox: 取り出し・状態の更新・保存期間の削除(テナント横断のポリシー outbox_messages_worker)、夜間の反映の積み込み
GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_messages" TO katahimo_worker;--> statement-breakpoint
GRANT SELECT ON "platform"."tenants" TO katahimo_worker;--> statement-breakpoint
GRANT INSERT ON "app_logs", "entity_changes" TO katahimo_worker;--> statement-breakpoint
-- 夜間のカレンダー反映(勤怠の書き込み。締めの判定のため attendance_periods を読む)・予定のマスタの読み込み
GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_days", "visits", "work_segments", "travel_legs" TO katahimo_worker;--> statement-breakpoint
GRANT SELECT ON "attendance_periods", "staff", "staff_login_emails" TO katahimo_worker;--> statement-breakpoint
GRANT SELECT, UPDATE ON "staff_calendars" TO katahimo_worker;--> statement-breakpoint
-- 顧客CSVの取込(顧客は消さずにアーカイブする)
GRANT SELECT, INSERT, UPDATE ON "customers", "customer_source_records", "care_recipients", "import_runs" TO katahimo_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_addresses", "customer_contacts" TO katahimo_worker;--> statement-breakpoint
GRANT SELECT, UPDATE ON "tenant_settings" TO katahimo_worker;--> statement-breakpoint
-- ミラーの送信(記録・領収書を読む)・再設定メールの送信
GRANT SELECT ON "care_records", "receipts", "receipt_uploads" TO katahimo_worker;--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON "password_reset_codes" TO katahimo_worker;--> statement-breakpoint
-- Web Push(翌日の予定のお知らせの対象の選び出し・送信の成功と失敗の記録・もう無い購読の削除)
GRANT SELECT, UPDATE, DELETE ON "push_subscriptions" TO katahimo_worker;--> statement-breakpoint
-- free/busy の同期
GRANT SELECT, INSERT, DELETE ON "staff_busy_blocks" TO katahimo_worker;--> statement-breakpoint
-- 保守(保存期間の削除。参照されないファイルの判定に staff_attributes・data_export_requests を読む)
GRANT SELECT, DELETE ON "sessions", "matching_run_candidates", "stored_files", "platform"."rate_limit_buckets" TO katahimo_worker;--> statement-breakpoint
GRANT SELECT ON "staff_attributes", "data_export_requests" TO katahimo_worker;--> statement-breakpoint
-- 保守(AI 生成の記録の保存期間の削除。結び付いた日報の保存期限は care_records を読む)
GRANT SELECT, DELETE ON "report_ai_generations" TO katahimo_worker;
