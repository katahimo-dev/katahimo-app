-- drizzle-kit(スキーマ定義のTypeScript)では表現できない制約・権限を手書きで定義する。
-- スキーマの差分判定(drizzle-kit generate)の対象外なので、変更時はこのファイルの後ろに
-- 新しいカスタムマイグレーションを追加すること(このファイルを書き換えない)。

-- ① スタッフの二重予約防止(doc/07 第5章、doc/10)。
-- 同一テナント・同一スタッフで、取消(cancelled)以外の割当の時間帯(period、半開区間)が
-- 重なる行の挿入/更新を拒否する。uuid列を「=」でGiSTに載せるためbtree_gistが必要(0000の先頭で作成)。
ALTER TABLE "reservation_assignments"
  ADD CONSTRAINT "reservation_assignments_no_staff_double_booking"
  EXCLUDE USING gist ("tenant_id" WITH =, "staff_id" WITH =, "period" WITH &&)
  WHERE ("status" <> 'cancelled');--> statement-breakpoint

-- ② RLSの強制(FORCE)。テーブル所有者(katahimo)は既定ではRLSをバイパスするため、万一アプリが
-- 所有者ロールで接続する設定ミスがあってもテナント分離が効くよう、所有者にもポリシーを適用する
-- (doc/07 第4.1節)。マイグレーションはDDLのみでデータを読まないため影響しない。
-- 運用者が全テナント横断で調査する場合はスーパーユーザー(BYPASSRLS)で接続する。
ALTER TABLE "accident_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_prompts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_day_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_days" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attribute_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_sync_states" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_required_attributes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_staff_affinities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "family_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matching_run_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matching_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbox_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "password_reset_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reservation_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_attributes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_availability_exceptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_busy_blocks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_weekly_availability" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_features" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ③ 操作ログは追記専用。アプリロールからUPDATE権限を外す(DELETEは保存期間経過後の削除用に残す)。
-- アプリロールが存在しない環境(ロール名が異なる本番等)でも失敗しないよう条件付きで実行する。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_app') THEN
    REVOKE UPDATE ON "app_logs" FROM katahimo_app;
  END IF;
END
$$;
