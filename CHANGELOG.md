# 更新履歴 (katahimo-app)

## [Ver. 0.1.1] - 2026-09-25

### 画面(packages/web)・見比べハーネス(tools/gas-preview)

レビューで見つかった画面側の不具合の修正と、土台の更新。見た目・文言はGAS版と同じまま(見比べの全場面が 0.05% 以下)。

- **日報の保存の取り違えを修正**: 保存の返事を待つ間に別のお客様の日報を開き直すと、遅れて届いた結果で今の入力が
  「✅ 保存しました」になり、前のお客様の報告IDで次の保存が上書きされることがあった。開き直したあとに届いた結果は
  今の入力に反映しない(AI生成・「訪問終わりました」も同じ)。サーバーも、上書き対象の報告が送られたお客様のもので
  なければ 409 `conflict` で断る(`core/usecases/reports.ts`、`report.<種類>.save_denied` reason `customer_mismatch`)。
- **音声入力の止め忘れを修正**: 日報ダイアログを閉じても「🎤 話して入力」が聞き続け、次に開いたお客様のメモに入ることが
  あった。閉じたとき・開き直したときに止める。
- **端末に残る値を人ごとに分けた**: 書きかけの日報・最近のお客様・開始時刻/発生時刻の前回値を、ログインしている人ごとの
  キー(`<キー名>@<法人ID>/<スタッフID>`)に持つ。ログアウトでその人の値と表示用キャッシュ(ルート・週間予定・今月のまとめ)を
  消し、セッション切れ(401)でも表示用キャッシュと読み込み済みのデータを捨てる。お客様タブの探す欄の文字もログイン画面に
  戻ると空になる。人ごとに分ける前の値は、誰のものか分からないのでログイン時に消す。
- **起動時の通信の失敗をログイン切れと扱わない**: `/api/auth/me` が通信の失敗だったときは「もう一度読み込む」を出す
  (ログインしていないと決めるのは 401 のときだけ)。
- **ダイアログのキーボード・読み上げ対応**: ダイアログの外側を1つの部品 `Modal` にまとめ(出勤簿の `Dialog` を統合)、
  開いたときのフォーカス・Tab の閉じ込め・Escape・後ろの画面の `inert`・閉じたときのフォーカスの戻しを付けた(`useDialogA11y`)。
  ログイン・パスワード再設定・パスワード変更は `<form>` にして Enter で送れるようにし、メール欄を `type="email"` にした。
  ★の評価はラジオボタン、日報/事故の切り替えはタブとして読み上げる。placeholder だけの入力欄に名前を付けた。
  失敗のお知らせは `role="alert"` にし、同じ文言を続けて出しても読み上げる。
- **予定タブを TanStack Query に**: 取り消し(AbortSignal)・StrictMode でも地図APIを2回呼ばない・端末の2時間キャッシュは
  契約(zod)で確かめて読み、書くときに期限切れを消す。🔄 は useMutation。
- **エラーの受け止め**: 画面全体(「再読み込み」)とタブごと(「もう一度読み込む」、QueryErrorResetBoundary)。
- **PWA**: アイコン(192/512・maskable・apple-touch-icon・favicon)を追加。新しい版は勝手に切り替えず、お知らせの
  「更新する」で切り替える(1時間ごとに確認)。`/api/` は Service Worker の画面で代わりに返さない。
- **業務日は日本時間で数える**: 出勤簿・日報・領収書の「今日」「いまの時刻」を端末の時刻帯ではなく日本時間にした
  (`src/lib/date.ts`、Intl の timeZone)。
- そのほか: 4xx は読み直さない、版数の監視は画面が隠れている間は止める(useQuery の refetchInterval)、領収書の写真は
  6枚の数に縮めている途中の分も入れる・読めない写真を知らせる・送っている間は消せない・重複の返事をIDで対応づける・
  createImageBitmap / OffscreenCanvas で縮める(元の写真を base64 にしない)、出勤簿の「🔄 最新にする」はスタッフを
  切り替えたあとの結果も捨てる、まとめて取り込むダイアログは開くたびに作り直す、出勤簿タブとあまり使わないダイアログを
  別のJSに分けて手が空いたときに先に読む、お客様一覧の絞り込みを入力より後回しにする(useDeferredValue・memo)、
  使っていなかった reducer の操作・CSS(`.glass` / `.slide-in`)を消した。`@katahimo/shared` に `"sideEffects": false`。
- **更新**: React 18 → 19、Vite 6 → 7、@vitejs/plugin-react 4 → 5、vite-plugin-pwa 0.21 → 1.3。
- **テスト**: 画面のテストのまとまり(`packages/web/vitest.config.ts`、jsdom + @testing-library/react。ルートの
  `vitest.workspace.ts`)を追加し、`useReportController`(開き直しの取り違え)・`useReceipts`・`AuthGate`・`useDialogA11y` の
  テストを書いた。
- **見比べハーネス**: `shoot` / `e2e` が新アプリの Vite を自分で起動するようにした(`--web-url` で起動済みのサーバーを使う。
  e2e は API が動いていなければ起動する)。`shoot` は差分が `--max-diff`(既定 0.05%)を越えた場面・撮れなかった場面が
  あれば一覧を出して終了コード1で終わり、場面ごとの失敗で止まらず、`--concurrency` で並行して撮る。撮る前の待ちを
  固定の時間から「CSSの移り変わりが終わるまで」にし、読み込み中のくるくるは止めて撮る。「HH:MM 時点」の場面が
  撮る間に分が変わるとずれていた(0.07%)のを直した。

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
