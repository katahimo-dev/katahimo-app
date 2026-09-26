# 更新履歴 (katahimo-app)

## [未リリース]

### 追加

- 管理者だけの「🛠 管理」タブ: スタッフ(一覧・登録・編集・退職日・削除・パスワード設定の案内メール)、AIプロンプト(編集・既定に戻す・
  他の管理者の保存との競合の検出)、操作ログ(期間・レベル・スタッフ・操作の種類で絞り込み、CSV で保存)。GAS版で管理者が
  スプレッドシートを直接編集していた作業と Drive の CSV ログの置き換え(`doc/02_機能仕様.md` 10章)。
- API: `DELETE /api/admin/staff/:id`、`POST /api/admin/staff/:id/password-guide`、`GET /api/admin/audit-logs`(`.csv`)。
  スタッフの登録・変更にカナ・自宅住所(ジオコーディングして保存)・移動手段・性別・予定のカレンダー・`rowVersion`、
  AIプロンプトに `revision` を追加(`doc/04_API仕様.md` 2.8・2.9)。
- スタッフ台帳の取込でカナ・電話・住所も読む(空欄は既存の値を消さない。住所が変わったら緯度経度を置き換える)。
- パスワード再設定の画面の「番号が届いている方はこちら」。

## [Ver. 1.0.0-baseline] - 2026-09-26

GAS版 `gas-childcare-visit-app` と同じ画面・同じ結果を持つ katahimo-app の最初の版(ベースライン)。今後の変更はこの版を起点に記録する。
設計は `doc/`(索引 `doc/README.md`)。

### 機能(GAS版と同じ画面・同じ結果)

- ログイン・パスワード再設定/変更・設定(文字の大きさ・管理者の詳細設定: Gemini・Google Chat)。
- 今日/明日の予定とルート(Google Calendar + Maps Routes / Geocoding を直接呼ぶ。GAS Bridge も選べる)。
- お客様の一覧・お客様の情報・これまでの記録。
- 日報・事故報告・ヒヤリハット(AI の下書き)、訪問終わりました、領収書(読み取り・重複の確認・お客様の指定なし)。
- 出勤簿(週/日の表示・修正・月ロック・カレンダーとの見比べと取り込み・まとめて取り込む・今月のまとめ)。
- 翌日の予定のお知らせ(PWA の Web Push。GAS版 gas-root-serach の夜間の LINE WORKS の DM の置き換え): 設定の「通知」で端末ごとに
  オンにすると、毎日 19:00 に明日の予定の時刻とお名前が届き、押すと予定タブで明日の予定を開く。テスト通知も送れる。
- GAS版のコードを動かして出力の一致を確かめるテスト(出勤簿の計算・カレンダーの反映・予定の分類とルート)と、GAS版と並べて撮る
  見比べ(124場面、差分 0.05% 以下)・実際の API での通し確認。GAS版と意図的に変えた点(他人の日報は上書きできない・秘密値は
  伏せ字だけを返す 等)は `doc/02_機能仕様.md` 11章。

### 基盤

- PostgreSQL(Cloud SQL 17)を正データにし、マイグレーションは `0000_baseline.sql`(drizzle-kit)と `0001_baseline_custom.sql`(手書き)の2本。
  テナント分離は `tenant_id` + FORCE RLS + 複合外部キー、ロールは用途ごと(owner / migrator / app / worker / readonly)。
- 保存データは CMEK(Cloud SQL のディスク・バックアップと領収書バケットを、このアプリ専用の Cloud KMS の鍵で暗号化)と、RLS・最小権限・
  監査ログ・回数制限で守る。テナントの秘密値(Gemini の API キー・Google Chat の Webhook URL)は Cloud KMS で封をして保存する(SecretBox)。
- 全ての DB の読み書きを Unit of Work 越しに、書き込みと outbox を同じトランザクションに。ワーカーが GAS Bridge(Ver. 1.1.38 以降)への
  ミラーと再設定メール・Web Push を送る。翌日の予定のお知らせ(19:00)・夜間のカレンダー反映(22:00)・顧客CSV の取込(03:00)・
  保守(04:00)のジョブ。
- Cloud Run(API + Web 画面 / ワーカー / ジョブ)・Cloud SQL・Secret Manager・Cloud KMS(CMEK・自動ローテーション)・GCS の Terraform、Cloud Build、GitHub Actions の CI。

### 資料・運用のコマンド

- 設計資料 `doc/01`〜`doc/10` と索引 `doc/README.md`(コードに合わせた詳細設計)。`doc/03_付録_テーブル定義.md` は DB から作る(`pnpm db:doc`)。資料のリンクの確認は `pnpm docs:check`。
- テナントと最初の管理者を作る運用スクリプト `pnpm tenant:create`。
- ルートの `package.json` から運用コマンド(`tenant:create`・`import:*`・`outbox:once`・`job:*`・`push:vapid-keys`・`preview:*`・`db:doc`)を呼べる。取込スクリプトの相対パスはコマンドを打ったフォルダから解決する。
- 全パッケージの版は `1.0.0-baseline`(設定の画面の「Ver.」に出る)。
