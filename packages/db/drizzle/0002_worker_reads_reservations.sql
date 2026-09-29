-- ワーカー(夜間のカレンダー反映・翌日の予定のお知らせ)が、SCHEDULE_PROVIDER=database のときに予定として
-- スタッフの確定した予約を読む(DatabaseSchedulePort。公開デモ用)。読むだけで、予約・割当の変更はアプリ(API)だけ。
GRANT SELECT ON "reservations", "reservation_assignments" TO katahimo_worker;
