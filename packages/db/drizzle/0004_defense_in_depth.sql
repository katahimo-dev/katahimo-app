-- 0004_defense_in_depth: アプリ・ワーカーの DB ユーザーが侵害されたときの被害を DB の側でも狭める(手書き)。
-- どれも今のアプリ(このマイグレーションの前の版を含む)がしない操作だけを断るため、前の版のアプリもこの後にそのまま動く。
--
-- 1. 操作ログのパーティション: drop_app_log_partitions は12か月より短い保存期間を断り(ワーカーの DB ユーザーで
--    監査の記録を消し切れないように)、ensure_app_log_partitions は24か月より先の作成を断る(パーティションの作りすぎ)。
--    保守ジョブは 12か月先まで作り、APP_LOG_RETENTION_MONTHS(既定13・最小12)で消す。
-- 2. 領収書の取消は戻せない: 取消した行(cancelled_at が入った行)の取消の列(cancelled_at・cancelled_by・cancel_reason)は
--    変えられない(KH003)。アプリは未取消の行だけを取消し(cancelled_at IS NULL の条件つき UPDATE)、重複の判定の
--    代表(dedupe_primary)の付け替えは取消の列に触れない。
-- 3. ワーカーのテナント横断の outbox のポリシーを、取り出し・状態の更新(SELECT・UPDATE)だけにする。
--    ワーカーの outbox の積み込み(夜間の反映・翌日のお知らせ)と保存期間の削除(保守ジョブ)はテナントの Unit of Work の中
--    (app.tenant_id を設定)で行うため、tenant_isolation で足りる。
-- 4. 日報の本文の変更履歴(care_record_revisions)はトリガーだけが書く: care_records_guard を所有者の権限で動かし
--    (SECURITY DEFINER・search_path 固定・名前は全て修飾)、アプリの INSERT の権限を外す(アプリが偽の履歴を書けない)。
--    アプリは履歴を直接書かない(保存・GAS版からの移行の取込とも care_records の UPDATE でトリガーが書く)。
--    あわせて下書き以外の記録を下書き(draft)に戻す UPDATE を断る(KH004。下書きの本文の変更は履歴に残らないため、
--    戻してから本文を変えると履歴を残さずに書き換えられる)。アプリは記録を submitted で作り、状態を下書きに戻さない。

-- ── 1. 操作ログのパーティション ──
CREATE OR REPLACE FUNCTION platform.ensure_app_log_partitions(months_ahead integer DEFAULT 12) RETURNS integer
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
  IF months_ahead IS NULL OR months_ahead < 0 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead must be between 0 and 24';
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

CREATE OR REPLACE FUNCTION platform.drop_app_log_partitions(retain_months integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  cutoff date;
  part record;
  dropped integer := 0;
BEGIN
  -- 監査の記録(操作ログ)は最低12か月残す(ワーカーの DB ユーザーが侵害されても、直近の記録を消し切れない)
  IF retain_months IS NULL OR retain_months < 12 THEN
    RAISE EXCEPTION 'retain_months must be >= 12';
  END IF;
  cutoff := (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => retain_months))::date;
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

-- ── 2. 領収書の取消は戻せない ──
CREATE FUNCTION public.guard_receipt_cancellation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF OLD.cancelled_at IS NOT NULL AND (
       NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
     ) THEN
    RAISE EXCEPTION 'receipt % is cancelled', OLD.id USING ERRCODE = 'KH003';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "receipts_guard_cancellation" BEFORE UPDATE ON "receipts"
  FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_cancellation();--> statement-breakpoint

-- ── 3. ワーカーのテナント横断の outbox は取り出し・状態の更新だけ ──
DROP POLICY "outbox_messages_worker" ON "outbox_messages";--> statement-breakpoint
CREATE POLICY "outbox_messages_worker_select" ON "outbox_messages" AS PERMISSIVE FOR SELECT TO katahimo_worker
  USING (true);--> statement-breakpoint
CREATE POLICY "outbox_messages_worker_update" ON "outbox_messages" AS PERMISSIVE FOR UPDATE TO katahimo_worker
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- ── 4. 日報の本文の変更履歴はトリガーだけが書く・提出した記録を下書きに戻さない ──
CREATE OR REPLACE FUNCTION public.care_records_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
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
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'care record % cannot return to draft', OLD.id USING ERRCODE = 'KH004';
  END IF;
  IF OLD.status <> 'draft' AND (OLD.body IS DISTINCT FROM NEW.body
                                OR OLD.body_schema_ver IS DISTINCT FROM NEW.body_schema_ver) THEN
    INSERT INTO public.care_record_revisions (tenant_id, id, care_record_id, revision_no, body, body_schema_ver, changed_by)
    VALUES (
      OLD.tenant_id,
      pg_catalog.gen_random_uuid(),
      OLD.id,
      coalesce((SELECT max(rv.revision_no) FROM public.care_record_revisions rv
                WHERE rv.tenant_id = OLD.tenant_id AND rv.care_record_id = OLD.id), 0) + 1,
      OLD.body,
      OLD.body_schema_ver,
      nullif(pg_catalog.current_setting('app.actor_id', true), '')::uuid
    );
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
-- トリガーからだけ呼ぶ(直接の呼び出しは要らない)
REVOKE ALL ON FUNCTION public.care_records_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE INSERT ON "care_record_revisions" FROM katahimo_app;
