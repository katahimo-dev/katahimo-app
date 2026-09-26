# 更新履歴 (katahimo-app)

## [Ver. 1.0.0-baseline] - 2026-09-26

作り直したアプリ(GAS版 `gas-childcare-visit-app` と同じ画面・同じ結果の移植と、DB の新しいベースライン)を、今後の変更の
起点(ベースライン)にした。これより前の試作・作り直しの途中の履歴は git の履歴に残っている(この版より前の見出しは削除した)。
設計は `doc/`(索引 `doc/README.md`)。

### 機能(GAS版と同じ画面・同じ結果)

- ログイン・パスワード再設定/変更・設定(文字の大きさ・管理者の詳細設定: Gemini・Google Chat)。
- 今日/明日の予定とルート(Google Calendar + Maps Routes / Geocoding を直接呼ぶ。GAS Bridge も選べる)。
- お客様の一覧・お客様の情報・これまでの記録。
- 日報・事故報告・ヒヤリハット(AI の下書き)、訪問終わりました、領収書(読み取り・重複の確認・お客様の指定なし)。
- 出勤簿(週/日の表示・修正・月ロック・カレンダーとの見比べと取り込み・まとめて取り込む・今月のまとめ)。
- GAS版のコードを動かして出力の一致を確かめるテスト(出勤簿の計算・カレンダーの反映・予定の分類とルート)と、GAS版と並べて撮る
  見比べ(124場面、差分 0.05% 以下)・実際の API での通し確認。GAS版の穴(他人の日報の上書き・秘密値の平文の表示 等)は塞いだ
  (`doc/02_機能仕様.md` 11章)。

### 基盤

- PostgreSQL(Cloud SQL 17)を正データにし、マイグレーションは `0000_baseline.sql`(drizzle-kit)と `0001_baseline_custom.sql`(手書き)の2本。
  テナント分離は `tenant_id` + FORCE RLS + 複合外部キー、ロールは用途ごと(owner / migrator / app / worker / readonly)。
- 要配慮の列の暗号化(テナントごとの DEK を KMS の KEK で包む、形式 v3)と、領収書の重複判定のブラインドインデックス。
- 全ての DB の読み書きを Unit of Work 越しに、書き込みと outbox を同じトランザクションに。ワーカーが GAS Bridge(Ver. 1.1.38 以降)への
  ミラーと再設定メールを送る。夜間のカレンダー反映(22:00)・顧客CSV の取込(03:00)・保守(04:00)のジョブ。
- Cloud Run(API + Web 画面 / ワーカー / ジョブ)・Cloud SQL・Secret Manager・KMS・GCS の Terraform、Cloud Build、GitHub Actions の CI。

### この版での整理

- 資料を作り直した: `doc/01`〜`doc/10` と `doc/README.md`(コードに合わせた詳細設計)、`doc/03_付録_テーブル定義.md` は DB から作る
  (`pnpm db:doc`)。試作の頃の提案書・要約(SQLite・Firebase Auth・Neon/Supabase を前提にしたもの)、`doc/api/*`、旧 `doc/09`・`doc/11` は
  新しい資料にまとめて削除した。資料のリンクの確認 `pnpm docs:check` を足した。
- テナントと最初の管理者を作る運用スクリプト `pnpm tenant:create` を足した(以前の未対応の項目)。
- ルートの `package.json` から運用コマンド(`tenant:create`・`import:*`・`outbox:once`・`job:*`・`preview:*`・`db:doc`)を呼べるようにし、
  取込スクリプトの相対パスをコマンドを打ったフォルダから解決するようにした。
- 使われていない環境変数 `MIRROR_TO_GOOGLE_CALENDAR` と、使われていないカレンダーのポートを削除した。
- 全パッケージの版を `1.0.0-baseline` にした(設定の画面の「Ver.」に出る)。
