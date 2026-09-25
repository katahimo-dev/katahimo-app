# 更新履歴 (katahimo-app)

## [Ver. 0.2.1] - 2026-09-25

新しいベースライン(Ver. 0.2.0)のレビューの指摘を直した。公開前のため `0000_baseline.sql` / `0001_baseline_custom.sql` を
直接直している。**開発DBは作り直しが必要**(`infra/initdb` の2本を流し直してから `pnpm db:migrate`・`pnpm db:seed`。
`01_bootstrap.sql` がアプリ・ワーカーのロールに接続ごとの上限を設定するようになった)。

### データベース・セキュリティ

- **接続プールの取り合いで止まる不具合**: テナントの鍵をトランザクションの中で初めて読むと、同じプールで別の
  トランザクションを開こうとし、プールの大きさ以上の処理が同時に来ると全員が空きを待ち合って止まっていた。Unit of Work が
  トランザクションを開く前に鍵を用意し(`CryptoPort.prepare`。KMS の呼び出しもトランザクションの外)、鍵の読み込みは
  API・ワーカーとも専用の1本のプールで行う。回帰テスト(プール2本に6つの処理を同時に)を足した。
- アプリ・ワーカーのロールに `statement_timeout` / `lock_timeout` / `idle_in_transaction_session_timeout` を設定する
  (アプリ 15s / 5s / 30s、ワーカー 60s / 10s / 60s。`infra/initdb`・`infra/cloudsql` の `01_bootstrap.sql`)。
- 破棄した鍵(DEK)の版が、プロセス内のキャッシュで使え続けていた。鍵の一覧を読み直したとき、使えなくなった版を捨てる。
- **テナントの消去**: 締めた月の勤怠があると消去(`platform.tenants` の削除)がトリガーで失敗していた。解約済みの
  テナントを消す `platform.purge_tenant()`(運用者だけ)を足し、各トリガーはテナントの行が無い(消去中)なら通す。
- **確定済みの記録**: 本文以外の列の変更・削除・locked からの戻しを見逃していた。記録のトリガーを全ての UPDATE・DELETE で
  動かし、locked なら全て拒否する(`KH002`)。下書き以外の本文(暗号文・形式の版)の変更は常に履歴に残す。履歴から記録への
  外部キーを `no action` にした(記録と一緒に履歴が消えない)。
- **月の締め**: アプリが締めを解除・削除できていた。トリガーで解除・締めた月の行の削除を拒否し(解除は運用者の
  `platform.unlock_attendance_period()`)、アプリの DELETE 権限を外した。締めと勤怠の書き込みが同時に走ったときに書き込みが
  締めた月に入り込めないよう、月ごとのアドバイザリロックで順序を付けた。
- **outbox**: リースが切れて別のワーカーが取り直した後、遅れて終わった古い処理が結果を上書きできた。結果は取り出したときの
  リース(`locked_by` と `attempts`)のままの行にだけ書く(書けなければ WARN `outbox.lease_lost`)。試行回数の上限に達した
  まま切れたリースは取り直さず `dead`(ERROR ログ)。
- 出勤簿の実体を消したときの変更履歴(`entity_changes`)に、変更前の値が残っていなかった。実体の全ての項目を残す。
- **操作ログ**: 既定のパーティション(`app_logs_default`)を足し、月のパーティションを作り忘れても書き込みが失敗しない
  ようにした。保守ジョブは12か月先まで作り、既定のパーティションの行を月のパーティションへ移す。保守の処理の失敗は ERROR
  ログに残し、ジョブを失敗にする。保守は停止中・解約済みのテナントも対象にする。
- AIプロンプトを同時に保存すると版がぶつかって 500 になっていた。キーごとにロックしてから版を数え、万一の一意制約の
  違反は 409 にする。
- **ログインの回数制限**: 失敗を照合の後に数えていたため、同時に大量の試行が来ると全てが照合まで進んでいた。照合の前に
  1回分の枠を取り、成功した回は返す(送信元IP)・数え直す(アカウント)。
- **ワーカーの権限を絞った**: ジョブが使う表・操作だけにした(テナントの秘密値・AIプロンプト・記録の履歴・予約と
  マッチングの表への権限を外し、記録・領収書・スタッフは読むだけ)。実際のジョブをワーカーのロールで動かす結合テストを足した。

### 動作(GAS版との一致)

- **時間の重なる予定**: カレンダーの予定の時間が重なっていると、その日の反映(夜間バッチを含む)が丸ごと失敗していた。
  GAS版と同じく重なりを許す(訪問の EXCLUDE 制約・重なりの 400 をやめた。手入力も同じ)。
- **顧客CSVの住所2**: 適用終了日が開始日より前(前日を含む)の行があると取込全体が失敗していた。期間なしで持ち
  (GAS版と同じく予定計算では使わない)、読めない日時は空に、顧客ID・氏名の無い行は飛ばして、数を `import_runs` に残す。
- **領収書の重複**: 同じ内容2枚の束(往復の運賃等)を送り直すと、1枚目だけが重複になり2枚目が登録されていた。既存と
  重複した内容は束の中の同じ内容を全て重複にする(GAS版と同じ)。
- **領収書日時**: 1桁の月・日・時や日付だけの表記を 400 にしていた・読めない表記を登録時刻にしていた。GAS版と同じく
  表記を問わずに受け、読めなければ報告の日付+開始時刻で記録する。
- **勤怠集計のミラー**: 予定が A → B → A と戻ると3回目を積んでいなかった。その日の送信の通し番号を重複排除キーにした。
  予定が無く出勤簿の行も無いスタッフには、夜間反映で空の行・ミラーを作らない(行があれば予定が消えても書き直す)。
- **出勤簿のミラー**: 25列全てを送り、シートにだけある値を空で上書きしていた。その書き込みで変わった列だけを送る。
  切替の前に当月の出勤簿を取り込むスクリプト `pnpm --filter @katahimo/api import:attendance` を足した(doc/11 §7)。
- **事故報告のミラー**(Bridge.js Ver. 1.1.38、GAS版リポジトリ): 列の並びが GAS版と2列ずれていた。**領収書のミラー**:
  再送で二重になり得た・同じ内容の2枚目が落ちていた(`KatahimoReceiptId` 列で冪等に)。書き込み action の配置は
  Bridge.js Ver. 1.1.38 以降にする。
- 停止の合図(SIGTERM)で途中で止めた夜間反映・保守が成功として終わっていた。終了コード1にする。
- 事故報告とヒヤリハットを上書きで切り替えられなかった(400)。GAS版と同じく切り替えられる。
- カレンダーの反映で枠が空になって実体が消えると、手で変えた強調表示が消えていた。枠に残し、次にその枠に入る値に
  引き継ぐ(GAS版のセルの背景色と同じ)。
- スタッフ台帳の取込が、本アプリで付けた管理者を一般スタッフに戻していた。取込では権限を上げるだけにする。
- 24:00 の表示は GAS版と同じく `00:00`(シートの時刻を `HH:mm` で読むため)のまま。テストで固定した。

## [Ver. 0.2.0] - 2026-09-25

### データベースの作り直し(新しいベースライン)

公開前のため互換性を持たずにスキーマを作り直し、マイグレーションを `0000_baseline.sql`(drizzle-kit)と
`0001_baseline_custom.sql`(手書き)の2本にした。**開発DBは作り直しが必要**(`infra/initdb` の SQL でロールから作り直し、
`pnpm db:migrate`・`pnpm db:seed`・CSV取込をやり直す。Docker はボリューム名が `katahimo-pgdata-17-v2` に変わる)。
構造は `doc/09`(ER図・ロール・暗号化・outbox・保存期間)。

- **テナント分離**: 主キー `(tenant_id, id)`、テナントの表への外部キーは全て `tenant_id` を含む複合キー、全テーブルの
  `tenant_id` は `platform.tenants` へ。`app_current_tenant()` が NULL のときは何も見えない。全テーブル FORCE RLS。
  テナント・プラン・レート制限等は `platform` スキーマ。テナントは `platform.provision_tenant()` だけが作る。
- **ロール**: `katahimo_owner`(所有者)/ `katahimo_migrator`(マイグレーション・テナント作成)/ `katahimo_app`(API)/
  `katahimo_worker`(ワーカー。専用の `WORKER_DATABASE_URL`)/ `katahimo_readonly`。権限はテーブルごとに明示し、
  追記専用の表(履歴・変更記録・操作ログ)は SELECT・INSERT だけ。
- **型**: 列挙は text + CHECK、期間は `tstzrange` / `daterange` の `[開始, 終了)`、`row_version`(楽観的排他)、
  `updated_at` はトリガー、`archived_at`・`retired_on`。ID はアプリが UUIDv7 で採番する。
- **出勤簿**: 1日1行の JSON をやめ、入れ物(`attendance_days`)と訪問・事務作業・移動の実体に分けた。GAS版の列記号の
  `rowData` との対応は `sheetLayout.ts` だけが持つ(画面・API の契約と GAS版との一致テストは変えていない)。変更は差分で書き、
  変更前の値を `entity_changes` に残す。訪問の時間帯の重なりは EXCLUDE 制約、締めた月はトリガーが拒否する。
  4件目以降の訪問は保存し、出勤簿には出さない(WARN ログ)。距離は常に小数2桁(`6` → `6.00`)。
- **顧客**: 住所・緊急連絡先・子ども・取込元の ID を別の表にし、取込は1トランザクションの差分適用(ID を保つ。
  消えた顧客・子どもはアーカイブ、戻れば戻す)。取込の記録は `import_runs`、データの版数は `tenant_settings`。
- **記録**: 日報・事故報告・ヒヤリハットを `care_records` にまとめ、本文の変更前はトリガーが `care_record_revisions` に残す。
- **領収書**: 登録の束(`receipt_uploads`、申し送りは束に1つ)・ファイル(`stored_files`)・領収書に分け、重複は
  `dedupe_bidx` の部分 UNIQUE + `ON CONFLICT DO NOTHING`(同時の登録でも1件)。拡張子・種類は画像の中身から決め、
  登録に失敗したら保存した画像を消す。
- **暗号化**: 暗号文は自己記述のバイト列(v3: 形式・DEK の版・nonce・暗号文・タグ)、AAD にテナント・列・行ID。
  DEK は版ごとに複数持て(`tenant_data_keys`)、`kek_key_name` で KEK を確かめる。ブラインドインデックスは
  `HKDF(マスター, テナント, 用途)` + 鍵の版。復号の監査は操作ごとに1件。
- **outbox**: `outbox_messages` に決定的な `dedupe_key` で同じトランザクションに積み、ワーカーが1件ずつリースを付けて取り出す
  (FOR UPDATE SKIP LOCKED)。試行回数の上限はメッセージごと。
- **操作ログ**: `app_logs` を月のパーティションにし、保守ジョブ(`job:maintenance`、毎日 04:00)が先のパーティションを作り、
  保存期間(既定13か月)を過ぎたものを消す。セッション・outbox・再設定コード等の保存期間も同じジョブが扱う。
- **マッチング・ライフサイクル**: 予約・割当・属性・勤務可能時間帯・相性・マッチングの記録、データの書き出し・開示請求・
  保存期間の表を用意した(表だけ。doc/10)。

### サーバー

- すべての DB の読み書きを Unit of Work(`uow.run(tenantId, repos => …)`)にし、リポジトリはテナントIDを受け取らない。
- 楽観的排他: 出勤簿・報告の応答に `rowVersion`、更新の要求に省略可能な `rowVersion`(食い違えば 409)。
  出勤簿の読み→書きはその日の行を押さえる。報告の上書きで顧客・担当スタッフは変えられない(409)。
- 活動記録のページングをキーセット(`nextCursor`)にした(同じ時刻の記録があっても重複・抜けが無い)。
- エラーの応答を `app.onError` の1か所にまとめ(`DomainError` → code、想定外は 500 internal でログにだけ詳細)、
  リクエストごとの構造化ログとリクエストID(`X-Request-Id`)を追加。成功の応答も契約のスキーマに通してから返す。
- 役割に `coordinator`(他のスタッフの予定・出勤簿・報告を扱えるが管理者設定はできない)を追加し、`isAdmin` を `role` にした。
- 予定の取得はスタッフIDで対象を決める(同姓同名でも取り違えない)。外部サービスの失敗は一般的な文言の 502。
- 夜間のカレンダー反映・在籍の判定はテナントのタイムゾーンの業務日。
- 顧客・スタッフのマスタのキャッシュは顧客データの版数ごと(取込で作り直す)。同時の読み込みは1回にまとめる。
- API とワーカーで同じでなければならない環境変数を1か所にまとめた(`sharedEnvShape`)。ワーカーも
  `MIRROR_TO_GOOGLE_SHEETS` に従う(無効なら残っているミラーを送らずに完了にする)。
- 停止処理: API は SIGTERM / SIGINT で受付を止めて接続プールを閉じ、8秒で強制終了。ワーカーは待ち時間をすぐに抜け、
  処理中の1件を終えてから止まり、ジョブには上限時間がある。
- 環境変数の名前の変更: `LOCAL_DEV_MASTER_KEY` → `BLIND_INDEX_MASTER_KEY`、ワーカーは `WORKER_DATABASE_URL`。

### 開発

- vitest 5 の projects(unit / integration / web)にし、DB の結合テスト(カタログの約束事・テナントの分離・複合外部キー・
  UoW のロールバック・row_version・EXCLUDE・締めのトリガー・本文の履歴・キーセット・領収書の同時登録・outbox の同時取り出し)
  と API のルートのテスト(エラーの形・admin-vs-self)を追加。CI でも動く。
- `exactOptionalPropertyTypes`・`noImplicitReturns`(サーバー側)、Biome の `noFloatingPromises` を有効にした。
- 使っていない依存を外した。

## [Ver. 0.1.1] - 2026-09-25

### CI・運用

CI と運用の土台を整えた(この節の項目はアプリの動作を変えない)。

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

### セキュリティ

セキュリティレビューの指摘への対応。**開発DBは作り直しが必要**(暗号文・ブラインドインデックスの形式を変えたため。
`pnpm db:migrate` の後 `pnpm db:seed`・CSV取込をやり直す)。

- **パスワード再設定の総当たり(重大)**: 並列に確認を送ると誤入力の上限を超えて試せ、正しいコードが通っていた
  (41件の並列送信で試行回数40)。試行回数の加算と上限判定を照合より前の1文の条件付きUPDATEにし、使用済みへの遷移も
  `used_at IS NULL` 条件のUPDATEにした(同じコードで2回再設定もできない)。実DBで並列性を確かめる結合テスト
  (`packages/db/src/integration`、`DATABASE_URL` がある時だけ動く)を追加。
- **レート制限(重大)**: Postgres の `rate_limit_buckets`(インスタンス間で共有、キーはHMAC)で、ログイン失敗
  (アカウント単位 15分10回・IP単位 15分50回で15分ロック、429)、パスワード再設定の発行・確認(アカウント・IP単位)、
  AI生成・領収書OCR(スタッフ単位の1日の上限)、予定のルート再計算(1時間の上限)を制限する(`RATE_LIMIT_*` で回数を
  変えられる)。再設定の要求を繰り返しても、上限を超えた要求は既存のコードを無効にしない。
- **CSRF・ヘッダー**: 状態を変えるAPIは `Sec-Fetch-Site` / `Origin` で別サイトからの要求を403にし、JSON以外の本体は415。
  本番のセッションCookieは `__Host-katahimo_session`。全応答に CSP・nosniff・Referrer-Policy・X-Frame-Options 等、
  本番は HSTS、`/api/*` は `Cache-Control: no-store`(ビルド済みの画面がCSPの下で動くことを Chromium で確認)。
- **要求の大きさ・領収書画像**: 本体の上限(既定256KB・領収書14MB・OCR 3MB)、画像は6枚まで・1枚1.5MBまで。
  種類は中身の先頭バイトで判定し JPEG・PNG・WebP だけを受け付け、保存する種類・拡張子もそれに合わせる。
- **Webhook のSSRF**: Google Chat の Webhook URL は `https://chat.googleapis.com/v1/spaces/...` だけを保存・送信し、
  送信はリダイレクトを追わず10秒で打ち切る。失敗の記録に応答本文を残さない。
- **送信元IP**: `X-Forwarded-For` の先頭(偽装できる)ではなく右から `TRUSTED_PROXY_HOPS` 番目(本番既定1)を使う。
- **アカウントの列挙**: 存在しないアカウントでもダミーのargon2照合で応答時間をそろえ、パスワード再設定メールは
  outbox 経由でワーカーが送るようにした(SMTP の設定はワーカーへ移動。`infra/gcp` も変更)。
- **テナントの停止**: `tenants.status='suspended'` のテナントはログイン・既存セッション・パスワード再設定を拒否する。
- **セッション**: ローリング延長しても、ログインから30日で無効にする。
- **秘密値**: 管理者設定のAPIキー・Webhook URLは伏せ字と設定済みフラグだけを返す(契約 `adminSettingsViewSchema` に
  `geminiApiKeySet` 等を追加。伏せ字のまま保存すると変更なし、Webhookは項目の省略も可)。再設定コードのHMAC鍵・
  レート制限のキーの鍵は `SESSION_SECRET` から HKDF で用途別に導出する。レガシーのパスワードハッシュは定数時間で比較する。
- **暗号化**: AES-GCM の AAD にテナントIDと用途(`テーブル.列`)を含め、暗号文に形式の版(`v2:`)を付けた。DEKのラップも
  テナントIDをAADに結び付け(Cloud KMS は additionalAuthenticatedData)、ブラインドインデックスの鍵は HKDF で導出する
  (旧形式とは互換なし)。
- **その他**: `/api/health/db` は失敗の詳細を返さない。アプリロールから `tenants` の UPDATE/DELETE・`app_logs` の DELETE・
  `tenant_keys` の UPDATE/DELETE を外した(マイグレーション `0003`)。Gemini の鍵はヘッダー(`x-goog-api-key`)で送り、
  モデル名をURLエンコードする。GAS Bridge にはシークレットをヘッダーでも送る(Bridge.js がクエリしか読めないため、クエリは
  残す。必要な変更は `doc/api/attendance-batch.md`)。顧客の詳細の閲覧を INFO `customer.detail.viewed` に残す。
- **依存パッケージの脆弱性**: nodemailer 9.1.1・drizzle-orm 0.45(drizzle-kit 0.31)・csv-parse 7 に更新し、qs・uuid は
  overrides で修正版に固定(`pnpm audit --prod` の指摘 17件 → 0件)。
- マイグレーション: `0002_security_hardening`(`rate_limit_buckets`、`password_reset_codes` の送信待ちのコード列)、
  `0003_app_role_privileges`(権限の縮小)。仕様は `doc/api/auth-reports-settings.md`・`doc/09`・`doc/11`(Cloud Armor・
  Cloud SQL のプライベートIPは検討事項として記載)。

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
- **回数の上限(429)**: サーバーの理由に、もう一度使えるまでの時間(Retry-After)を「（あと約15分）」のように添えて出す。
  領収書の読み取りが上限に達したときは知らせる(ほかの読み取りの失敗はGAS版と同じく知らせない)。
- 見比べハーネスの設定のモックを、サーバーが返す伏せ字の形(APIキー・Webhook URL)と設定済みフラグに合わせた。
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
- **見比べハーネス**: `shoot` / `e2e` が新アプリの Vite を自分で起動するようにした(CI の起動手順を外し、見比べ・通し確認の
  失敗でワークフローを失敗にするようにした)(`--web-url` で起動済みのサーバーを使う。
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
