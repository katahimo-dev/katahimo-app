-- アプリロール(katahimo_app)の権限を、アプリが実際に使う操作だけに絞る(セキュリティレビュー 2026-09)。
-- 既定権限(infra/initdb/01_bootstrap.sql・infra/cloudsql/01_bootstrap.sql の ALTER DEFAULT PRIVILEGES)で
-- 全テーブルに SELECT/INSERT/UPDATE/DELETE が付くため、使わないものをここで外す。
-- アプリロールが存在しない環境でも失敗しないよう条件付きで実行する(0001 と同じ)。
--
-- - tenants: アプリは参照と作成(pnpm db:seed)だけ。停止(status)の変更・削除は運用者が所有者ロールで行う。
-- - app_logs: 追記専用(UPDATE は 0001 で REVOKE 済み)。保存期間を過ぎた行の削除も運用者が所有者ロールで行う
--   (アプリが乗っ取られても監査ログを消せないようにする)。
-- - tenant_keys: アプリは参照と初回作成だけ。KEKの再ラップ(updateWrappedDek)・暗号学的削除(revoke)は
--   運用作業として所有者ロールで行う(アプリから鍵を書き換え・破棄できないようにする)。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_app') THEN
    REVOKE UPDATE, DELETE ON "tenants" FROM katahimo_app;
    REVOKE DELETE ON "app_logs" FROM katahimo_app;
    REVOKE UPDATE, DELETE ON "tenant_keys" FROM katahimo_app;
  END IF;
END
$$;
