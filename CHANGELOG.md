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
- 翌日の予定のお知らせ(PWA の Web Push。GAS版 gas-root-serach の夜間の LINE WORKS の DM の置き換え): 設定の「通知」で端末ごとに
  オンにすると、毎日 19:00 に明日の予定の時刻とお名前が届き、押すと予定タブで明日の予定を開く。テスト通知も送れる。
  API `GET /api/push/config`・`POST`/`DELETE /api/push/subscriptions`・`POST /api/push/test`、outbox の `push.route_notice`・`push.test`、
  ジョブ `pnpm job:route-notice`(Cloud Scheduler 19:00)。VAPID の鍵(`VAPID_PUBLIC_KEY`・`VAPID_PRIVATE_KEY`・`VAPID_SUBJECT`)が
  無い環境では使わない。
- 運用のコマンド `pnpm push:vapid-keys`(Web Push の VAPID の鍵の組を作る)。
- テナントごとのカレンダーの設定(共有カレンダー・スタッフに設定できるカレンダーの許可)を `platform.tenants.calendar_settings` に置き、
  運用担当者のコマンド `pnpm tenant:calendars` で変える。管理者は許可に無いカレンダーをスタッフに設定できず、予定を読むときにも
  確かめ直す(`doc/05_バッチ・外部連携.md` 4.2)。
- 全員分の日報・事故報告・ヒヤリハットの「📋 報告一覧」(🛠 管理タブ。管理者とコーディネーター): 期間・種類・書いたスタッフ・お客様で
  絞り込んだ一覧、1件の中身(読むだけ。直した回数つき)、GAS版の「日報」「事故報告」シートと同じ列の CSV(BOM つき UTF-8)。
  スプレッドシートのミラーを止めても全員分を見られる。一覧・中身・CSV の書き出しは操作ログに残る(`doc/02_機能仕様.md` 10.2)。
  API `GET /api/reports`・`GET /api/reports/:id`・`GET /api/reports/export.csv`(`doc/04_API仕様.md` 2.6)。
- ワーカーの環境変数 `APP_PUBLIC_URL`: パスワード設定の案内のメールに法人IDつきのログイン画面の URL を書く(terraform の `app_public_url`)。

### 変更

- 「🛠 管理」タブをコーディネーターにも出す(中は「📋 報告一覧」だけ。スタッフ・AIプロンプト・操作ログは今までどおり管理者だけ)。
- 共有カレンダーの環境変数 `GOOGLE_CALENDAR_IDS` をやめ、テナントごとのカレンダーの設定(`pnpm tenant:calendars`)に置き換える。
  切替の前に、`GOOGLE_CALENDAR_IDS` に入れていたカレンダーを `pnpm tenant:calendars -- <slug> --add-shared …` で登録する。
- GAS版と並べて撮る画面の見比べ(`tools/gas-preview`、`pnpm preview:*`)をやめ、実際の API・DB での通し確認を `tools/e2e`(`pnpm e2e`)に
  切り出す。通し確認に管理タブ(スタッフ・AIプロンプト・操作ログ)と、VAPID が無いときに「通知」欄が出ないことの確認を足す。
  画面の文言・振る舞いはこのアプリのコードが正で、GAS版は業務ロジック・計算結果の基準(gasParity のテスト)。

### 資料

- `doc/11_GAS版との機能比較.md`: GAS版でできたこと全てと新アプリの判定(同等・改善・変更・GAS版のみと理由)、上位互換の状況、
  切替の日の運用に残っていること。
- キューテスト様向けのご説明資料(`doc/partner/`)を、スマホへの通知・管理者の画面・シートは見るだけの写しになることに合わせて
  更新(23枚)。画面の見比べの記述を外す。

## [Ver. 1.0.0-baseline] - 2026-09-26

GAS版 `gas-childcare-visit-app` と同じ画面・同じ結果を持つ katahimo-app の最初の版(ベースライン)。今後の変更はこの版を起点に記録する。
設計は `doc/`(索引 `doc/README.md`)。

### 機能(GAS版と同じ画面・同じ結果)

- ログイン・パスワード再設定/変更・設定(文字の大きさ・管理者の詳細設定: Gemini・Google Chat)。
- 今日/明日の予定とルート(Google Calendar + Maps Routes / Geocoding を直接呼ぶ。GAS Bridge も選べる)。
- お客様の一覧・お客様の情報・これまでの記録。
- 日報・事故報告・ヒヤリハット(AI の下書き)、訪問終わりました、領収書(読み取り・重複の確認・お客様の指定なし)。
- 出勤簿(週/日の表示・修正・月ロック・カレンダーとの見比べと取り込み・まとめて取り込む・今月のまとめ)。
- GAS版のコードを動かして出力の一致を確かめるテスト(出勤簿の計算・カレンダーの反映・予定の分類とルート)と、GAS版と並べて撮る
  見比べ(124場面、差分 0.05% 以下)・実際の API での通し確認。GAS版と意図的に変えた点(他人の日報は上書きできない・秘密値は
  伏せ字だけを返す 等)は `doc/02_機能仕様.md` 11章。

### 基盤

- PostgreSQL(Cloud SQL 17)を正データにし、マイグレーションは `0000_baseline.sql`(drizzle-kit)と `0001_baseline_custom.sql`(手書き)の2本。
  テナント分離は `tenant_id` + FORCE RLS + 複合外部キー、ロールは用途ごと(owner / migrator / app / worker / readonly)。
- 保存データは CMEK(Cloud SQL のディスク・バックアップと領収書バケットを、このアプリ専用の Cloud KMS の鍵で暗号化)と、RLS・最小権限・
  監査ログ・回数制限で守る。テナントの秘密値(Gemini の API キー・Google Chat の Webhook URL)は Cloud KMS で封をして保存する(SecretBox)。
- 全ての DB の読み書きを Unit of Work 越しに、書き込みと outbox を同じトランザクションに。ワーカーが GAS Bridge(Ver. 1.1.38 以降)への
  ミラーと再設定メールを送る。夜間のカレンダー反映(22:00)・顧客CSV の取込(03:00)・保守(04:00)のジョブ。
- Cloud Run(API + Web 画面 / ワーカー / ジョブ)・Cloud SQL・Secret Manager・Cloud KMS(CMEK・自動ローテーション)・GCS の Terraform、Cloud Build、GitHub Actions の CI。

### 資料・運用のコマンド

- 設計資料 `doc/01`〜`doc/10` と索引 `doc/README.md`(コードに合わせた詳細設計)。`doc/03_付録_テーブル定義.md` は DB から作る(`pnpm db:doc`)。資料のリンクの確認は `pnpm docs:check`。
- テナントと最初の管理者を作る運用スクリプト `pnpm tenant:create`。
- ルートの `package.json` から運用コマンド(`tenant:create`・`import:*`・`outbox:once`・`job:*`・`preview:*`・`db:doc`)を呼べる。取込スクリプトの相対パスはコマンドを打ったフォルダから解決する。
- 全パッケージの版は `1.0.0-baseline`(設定の画面の「Ver.」に出る)。
