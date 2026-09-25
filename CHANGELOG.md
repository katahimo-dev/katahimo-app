# 更新履歴 (katahimo-app)

## [Ver. 0.1.1] - 2026-09-25

CI と運用の土台を整えた(アプリの動作は変わらない)。

- **CI(GitHub Actions)**: PR・main で lint・型検査・PostgreSQL 17 へのマイグレーション・スキーマとマイグレーションの
  差分チェック(`pnpm db:generate` で差分が出たら失敗)・テスト・ビルドを行う `ci.yml`。続けて GAS版との見比べと
  通し確認(当面は失敗しても全体を失敗にしない)。Terraform の fmt / validate の `infra.yml`。GAS版サブモジュールは
  `SUBMODULE_TOKEN` で取得し、無い場合は警告を出して一致テストをスキップする(サブモジュールが無いと出勤簿の
  一致テストがスキップではなく読み込みエラーになっていたのを直した)。
- **リポジトリの設定**: Dependabot(npm・Docker・GitHub Actions・Terraform)、CODEOWNERS、PR テンプレート、
  `.editorconfig`、推奨のブランチ保護(README「CI とブランチ保護」)。pnpm は `engineStrict`(Node 22 未満で
  install を失敗させる)、Biome は 2.5.10 に固定。
- **本番の構成**: Dockerfile のベースイメージをダイジェストで固定。Terraform に監視(API の 5xx・ジョブの失敗・
  Cloud SQL の CPU/ディスク/接続数・`/api/health` の外形監視、通知先はメール)と予算アラートを追加し、
  プロバイダーのロックファイルをコミットした(`doc/11` 5章)。ローカルの Docker の PostgreSQL を本番と同じ 17 にした
  (ボリューム名が `katahimo-pgdata-17` に変わるため、Docker で DB を使っていた場合はマイグレーション・seed をやり直す)。

## [Ver. 0.1.0] - 2026-09-25

GAS版 `gas-childcare-visit-app` の作り直しの一区切り。画面・サーバー処理ともGAS版の機能をひととおり移し終え、
並行して作った機能をつないだ状態で通し確認まで行った(本番環境への適用はまだ)。0.0.1〜0.0.3 の内容を含む。

- **DBの再設計**: 旧試作(Hono + Drizzle + PostgreSQL)を土台に取り込み、マイグレーションを
  `0000_initial_schema`(drizzle-kit 生成)と `0001_custom_constraints`(手書き: スタッフの二重予約を防ぐ EXCLUDE 制約・
  全テーブルの FORCE RLS・`app_logs` の UPDATE 禁止)の2本に作り直した。RLS 条件を
  `nullif(current_setting('app.tenant_id', true), '')` に直し(プール接続で uuid 変換エラーになる不具合)、
  複数法人(テナントの状態・タイムゾーン・業種・機能フラグ・独自項目)とマッチング拡張(スタッフ属性・勤務可能時間・
  カレンダーの busy・顧客の希望・相性・予約と割当・実行結果)のテーブル、GAS版の完全移植に要るテーブル(パスワード
  再設定コード・操作ログ・AIプロンプト・出勤簿の変更履歴・CSV取込の版数など)を足した(`doc/09`・`doc/10`)。
- **サーバー処理のGAS版との同等化**: 操作ログの共通ポート `AppLogPort`。認証(メール/サブメール・退職日・7日の
  ローリング延長・パスワード再設定/変更)、日報・事故報告(AIの下書き・他人の報告を上書きできたGAS版の穴を修正)、
  領収書(OCR・重複判定・お客様の指定なし・登録バッチ)、管理者設定・AIプロンプト・UI設定、スタッフ管理と台帳の
  一括取込、出勤簿(当月のみ編集・変わった列だけ保存・変更履歴・カレンダーからの反映・月次まとめ・週間予定)、
  顧客CSVの自動取込(差分適用・消失率の安全装置・データ版数)。APIの入出力は `@katahimo/shared` の zod 契約で揃え、
  エラーは `{code, message, fields}`(`doc/api/*.md`)。出勤簿の計算・カレンダー反映・予定の分類とルートは、GAS版の
  コードそのものを node:vm で動かして出力の一致を確かめるテストを付けた。
- **GASに頼らない予定・ルート計算**: Google Calendar API + Google Maps Platform(Geocoding / Routes)を直接呼ぶ
  `GoogleSchedulePort`(2時間の共有キャッシュ、正式な記録に使うときはキャッシュを使わない fresh 計算)。
  `SCHEDULE_PROVIDER`(google / gas_bridge / noop)で切り替える(`doc/api/schedule-route.md`)。
- **バッチ・ミラー**: ワーカーを常駐の outbox ポーラー(GAS版 Bridge.js へのミラー書き込み、指数バックオフの再試行・
  上限で failed・止まったジョブの取り直し)と単発ジョブ(夜間カレンダー反映 22:00・顧客CSV取込 03:00 JST・
  free/busy 同期・outbox 1回)に分けた(`doc/api/attendance-batch.md`)。
- **デプロイ**: Cloud Run(API + Web画面 / ワーカー / Jobs)+ Cloud SQL の構成一式(Dockerfile・Cloud Build・Terraform・
  Cloud SQL 初期化SQL)、GCS / Cloud KMS の実装、本番の起動時検証、GAS版からの切替チェックリスト(`doc/11`)。
- **画面のGAS版との同等化**: `packages/web` をGAS版 `index.html` を正として作り直した(骨格・ログイン・設定・お知らせ、
  今日の予定、お客様・お客様の情報・これまでの記録、日報・事故報告・領収書、出勤簿)。GAS版と新アプリを同じ場面・
  同じデータで撮って並べる見比べハーネス `tools/gas-preview`(124場面、差分はすべて 0.05% 以下)。
- **通し確認**: 実際のAPI・DBで、ログインから日報・領収書・出勤簿・設定・ログアウトまでと、一般スタッフでの管理者機能の
  拒否をスマホの大きさで操作する `tools/gas-preview/src/e2e.ts`(`pnpm --filter @katahimo/gas-preview e2e`)を追加し、
  開発サーバーと本番ビルドの配信(`WEB_DIST_DIR`)の両方で全手順が通ることを確かめた。
- 通し確認で見つけた不具合の修正: `pnpm db:seed` が中身の無いスクリプトを呼んでいた(api の seed を呼ぶようにした)、
  `import:reserva` と見比べハーネスが pnpm 11 の `--` を引数として読んでいた。
- README・CLAUDE.md を現状に合わせて書き直した。

## [Ver. 0.0.3] - 2026-09-25

- GCP 本番環境へのデプロイ一式を追加(`doc/11_GCPデプロイ手順.md`): `Dockerfile`(api / worker の2ターゲット、
  非rootユーザー)、`cloudbuild.yaml`(ビルド → マイグレーション → デプロイ)、Terraform(`infra/gcp/`: Cloud Run
  サービス・ジョブ、Cloud Scheduler(JST 22:00 / 03:00)、Cloud SQL、Secret Manager、Artifact Registry、GCS、
  Cloud KMS、サービスアカウント)、Cloud SQL 用のロール初期化SQL(`infra/cloudsql/`)。
- API が本番でビルド済みのWeb画面を同じオリジンから配信するようにした(`WEB_DIST_DIR`、SPA フォールバック、
  ハッシュ付きアセットは長期キャッシュ・`index.html` と Service Worker は `no-cache`)。
- Cloud SQL の Unix ソケット形式の `DATABASE_URL`(`?host=/cloudsql/...`)に対応し、接続プールを
  `DB_POOL_MAX` / `DB_IDLE_TIMEOUT_SEC` / `DB_MAX_LIFETIME_SEC` で調整できるようにした。
- 領収書画像の保存先に GCS(`STORAGE_PROVIDER=gcs`、`GcsStoragePort`)、テナントDEKの KEK に Cloud KMS
  (`KMS_PROVIDER=gcp`、`CloudKmsPort`)を追加。本番(`NODE_ENV=production`)ではどちらも必須とし、
  `SCHEDULE_PROVIDER` の明示・32文字以上の `SESSION_SECRET` とあわせて起動時に検証する。
- api / worker / db に tsup の本番ビルドを追加(ワークスペース内パッケージを取り込み、外部依存は node_modules から
  読む)。常駐ワーカーは `WORKER_HEALTH_PORT` でヘルスチェックに応答する(Cloud Run サービス用)。

## [Ver. 0.0.2] - 2026-09-25

- 出勤簿(過去の予定タブ)をGAS版と同じ挙動に揃えた: 当月のみ編集できる月ロック、変わった列だけの保存(`changed_fields`・変更履歴・強調表示つきミラー)、カレンダーからの反映(プレビュー/反映/冪等)、月次まとめ(全日・働いた時間・領収書集計)、勤怠集計の書き直し。
- outboxミラーの再試行(指数バックオフ・上限回数・異常終了したジョブの取り直し)と、勤怠集計(`attendance_aggregate`)のミラーを追加。
- ワーカーを常駐のoutboxポーラーと単発ジョブ(`job:nightly-calendar-sync` 22:00 / `job:csv-import` 03:00 JST)に分けた。顧客CSVの自動取込(Google Drive / ローカルディレクトリ)と `GET /api/data-version`、管理者の手動取込 `POST /api/admin/customers/import` を追加。仕様は `doc/api/attendance-batch.md`。

## [Ver. 0.0.1] - 2026-09-25

- 新規リポジトリとして作り直しを開始。GAS版を `legacy/gas-childcare-visit-app` に git submodule で取り込み、旧試作の設計資料を `doc/reference/` に置いた。
