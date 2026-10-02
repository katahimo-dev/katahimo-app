-- 0003_lock_attendance_period_keys: 締めた月の行を「締めたまま別の月・別のスタッフに付け替える」抜け道をふさぐ(手書き)。
-- これまでの guard_attendance_period() は締めの解除(locked → open)と締めた行の削除だけを断っていたため、
-- status を locked のまま year_month・staff_id を書き換える UPDATE が通り、締めた月が締めの無い月に戻せた
-- (勤怠の書き込みは attendance_period_is_locked で (テナント・スタッフ・月) の行を探すため)。
-- - 締めた行の tenant_id・staff_id・year_month・locked_at・locked_by の変更も、所有者(運用の関数・テナントの消去)
--   以外は KH001 で断る。締めの解除・削除の扱い、締めるときのアドバイザリロックはこれまでどおり。
-- - アプリ(katahimo_app)の UPDATE を、締めで書く列(status・locked_at・locked_by。lockPeriod の
--   ON CONFLICT DO UPDATE)だけに絞る。updated_at はトリガーが書く(列の権限は要らない)。
--   今のアプリが書く列は変わらないため、前の版のアプリもこのマイグレーションの後にそのまま動く。
--   ワーカーの権限(SELECT だけ)は変えない。
CREATE OR REPLACE FUNCTION public.guard_attendance_period() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'locked'
     AND current_user <> 'katahimo_owner'
     AND (
       TG_OP = 'DELETE'
       OR NEW.status <> 'locked'
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
       OR NEW.year_month IS DISTINCT FROM OLD.year_month
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
     ) THEN
    RAISE EXCEPTION 'attendance period % is locked', OLD.year_month USING ERRCODE = 'KH001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status = 'locked' THEN
    PERFORM pg_advisory_xact_lock(public.attendance_period_lock_key(NEW.tenant_id, NEW.staff_id, NEW.year_month));
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- 月の締めは締めるだけ: アプリが UPDATE できるのは締めの列だけ(行の付け替え・作成日時の書き換えはできない)
REVOKE UPDATE ON "attendance_periods" FROM katahimo_app;--> statement-breakpoint
GRANT UPDATE ("status", "locked_at", "locked_by") ON "attendance_periods" TO katahimo_app;
