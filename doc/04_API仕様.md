# 04. API 仕様

- 目的: HTTP API の全エンドポイントと、共通の約束(認証・エラー・CSRF・回数制限・本体の上限・ヘッダー)を決める。
- 対象読者: API・画面を直す開発者、API を使う連携を作る人、セキュリティレビュー。

正はコード: ルート `packages/api/src/routes/*.ts`(登録は `src/app.ts`)、契約 `packages/shared/src/contracts/*.ts`
(下の表の「契約」はそこにある zod スキーマの名前)、共通処理 `packages/api/src/http/`、セッション `src/session.ts`。
業務ルールの詳細は [02_機能仕様.md](02_機能仕様.md)、セキュリティの考え方は [06_セキュリティ設計.md](06_セキュリティ設計.md)。

## 1. 共通の約束

### 1.1 形式

- ベースは同じオリジンの `/api/*`(本番は API が Web 画面も配信する)。要求・応答は JSON(UTF-8)。
- 日付は業務日 `YYYY-MM-DD`(`businessDateSchema`)、年月 `YYYY-MM`、時刻 `HH:MM`、ID は UUID(`idSchema`)。日時は ISO 8601。
- 入力は `parseJsonBody` / `parseQuery` で契約に通す(失敗は 400)。成功の応答は `jsonOk(c, schema, body)` で**応答の契約にも
  通してから**返す(食い違いは 500 になりログに残る。契約に無い項目は落ちる)。画面(`web/src/api/client.ts`)も同じ契約で応答を検証する。
- 自由記述の欄(日報・事故報告の本文、領収書の店名・引き継ぎ、出勤簿のセル、AI のプロンプト、スタッフの氏名・電話 等)は、
  契約(`freeText`)でタブ・改行・復帰以外の制御文字(U+0000 等)を取り除いてから使う(PostgreSQL は U+0000 を保存できない)。
  顧客CSV・スタッフ台帳・出勤簿の CSV の取込も同じ規則で取り除く(`stripControlChars`)。
- `tenantId` は**セッション Cookie からだけ**決まる(外部システム連携の `/api/integrations/*` だけは API キーから。2.11)。
  要求の本体・クエリに入れても使わない。

### 1.2 認証とセッション Cookie

| 項目 | 内容 |
| --- | --- |
| Cookie 名 | 本番 `__Host-katahimo_session`(Secure・Path=/・Domain なし)、開発 `katahimo_session` |
| 属性 | `HttpOnly`・`SameSite=Lax`・`Path=/`・本番は `Secure`。期限は無操作の期限 |
| 値 | `<テナントID>.<生トークン>`。DB は生トークンの SHA-256 だけを持つ(`sessions.token_hash`) |
| 期限 | 無操作7日(`SESSION_IDLE_TTL_MS`)。残りが6日を切った要求で7日に延ばし Cookie も更新。ログインから30日(`SESSION_ABSOLUTE_TTL_MS`)を超えない |
| 毎回の確認 | セッション(失効・期限)→ テナントが `active` → スタッフの存在 → 退職日(テナントの時刻帯の業務日)。退職済みならそのスタッフの全セッションを失効 |
| ミドルウェア | `requireSession(container, deniedAction?)`(未ログイン 401。`deniedAction` があれば WARN `<action>.access_denied`。未ログインの拒否の WARN は送信元IPごとに10分に5件まで(06 10章))、`requireAdmin(container, action)`(未ログイン 401・管理者以外 403、どちらも WARN)、`requireCoordinator(container, action)`(同じくコーディネーター・管理者以外 403) |
| 「この端末」の印 | 本番 `__Host-katahimo_device`、開発 `katahimo_device`。`HttpOnly`・`SameSite=Lax`・`Path=/`・本番は `Secure`、期限180日。ログインの成功のたびに発行し直し(パスワードの変更・再設定の成功でもその端末の分を作り直す)、ログアウトでは消さない。値は `v1.<テナントID>.<スタッフID>.<発行時刻(秒)>.<乱数>.<HMAC>`(個人情報なし。[06](06_セキュリティ設計.md) 2.4)。アカウント単位のログインのロックを本人の端末から避けるためだけに使う(セッションではない) |
| 対象スタッフ | `targetStaffIdOf(c, staffId)`: 一般スタッフは常に本人、コーディネーター・管理者は指定があればそのスタッフ(usecase でも確かめる) |

### 1.3 エラー

全てのエラーは `{ code, message, fields? }`(`apiErrorSchema`)。`message` は画面にそのまま出せる日本語。

| code | HTTP | 主な場面 |
| --- | --- | --- |
| `unauthenticated` | 401 | 未ログイン・セッション切れ・ログイン失敗・外部連携の API キーが無い・誤り・失効(`WWW-Authenticate: Bearer`) |
| `forbidden` | 403 | 役割が足りない・他人の報告の上書き・CSRF |
| `not_found` | 404 | 無い ID・無いルート(「該当するAPIがありません」) |
| `validation_failed` | 400 / 413 / 415 | 入力の誤り(`fields` に項目ごとの最初の文言。キーは `rowData.D` のような経路)、本体が大きすぎる(413)、JSON 以外(415) |
| `locked` | 400 | 月ロック・締めた月・確定済みの記録 |
| `conflict` | 409 | 古い `rowVersion`・重複・顧客/担当の違う上書き・顧客CSV の `review_required`・同じテナントの他の顧客の取込が実行中(取込のロックを `lock_timeout` まで待てなかった。DB の 55P03 を `customer_import_in_progress` にする) |
| `rate_limited` | 429 | 回数制限(`Retry-After` ヘッダーに秒数) |
| `upstream_unavailable` | 502 | 外部サービス(カレンダー・地図・Gemini・Drive)の失敗。詳細はログにだけ |
| `internal` | 500 | 想定外の例外(「サーバーでエラーが発生しました。…」)。詳細とリクエストIDはプロセスログにだけ |

usecase は `DomainError(code, message, fields?, reason?)` を投げ、`app.onError(onApiError)` が1か所で `DOMAIN_ERROR_STATUS` に
従って応答にする(`http/responses.ts`)。

### 1.4 共通のミドルウェア(`app.ts` の順)

| 順 | 対象 | 処理 |
| --- | --- | --- |
| 1 | 全て | `requestLogger`: 1要求1行の構造化ログ。リクエストIDは `X-Cloud-Trace-Context` のトレースID、無ければ UUID。応答の `X-Request-Id` に返す。クエリ・本文は記録しない |
| 2 | 全て | `clientIpMiddleware`: 送信元IPは `X-Forwarded-For` の右から `TRUSTED_PROXY_HOPS` 番目(未指定は本番1・それ以外0 = 接続元) |
| 3 | 全て | `securityHeaders`: CSP・`X-Content-Type-Options: nosniff`・`X-Frame-Options: DENY`・`Referrer-Policy: strict-origin-when-cross-origin`・COOP/CORP same-origin・Permissions-Policy・本番だけ HSTS(1年)(06) |
| 4 | `/api/*` | `Cache-Control: no-store` |
| 5 | `/api/*` | CSRF: 状態を変える要求(POST/PUT/PATCH/DELETE)は `Sec-Fetch-Site` が `same-origin` / `none` 以外なら 403。`Sec-Fetch-Site` が無ければ `Origin` のホストが `Host` と違えば 403。どちらも無い要求(ブラウザ以外)は通す |
| 6 | `/api/*` | 本体のある状態変更の要求は `Content-Type: application/json` だけ(415) |
| 7 | `/api/*` | 本体の上限: 既定 256KB、`POST /api/receipts` 14MB、`POST /api/receipts/ocr` 3MB、`POST /api/integrations/customers` 2MB、`POST /api/admin/report-ai/import` 3MB、`POST /api/admin/staff/import` 3MB(xlsx のファイルは2MBまで。base64 で約4/3倍)(413) |
| 8 | `/api/*` | 公開デモ(`DEMO_TENANT_SLUG` を設定したときだけ): デモ用テナントの断る操作を 403(1.6。`GET /api/demo/config` は掛からない) |

xlsx の取込(`POST /api/admin/staff/import`・`/api/admin/report-ai/import`)は、本体の上限に加えて、exceljs(JSZip。全てのファイルを
展開してから読む)に渡す前に zip の目次を確かめる(`api/src/export/xlsxZipGuard.ts`。小さな本体が展開で何GBにも膨らむファイル対策):
ファイル200個・1つ5MB・合計8MB(展開後)まで、1MB を超えるファイルは圧縮率200倍まで。暗号化・ZIP64・deflate 以外の圧縮・目次の位置の
ずれたファイルは断る。目次の展開後の大きさは書き換えられるため、各ファイルを目次の大きさを上限に実際に展開し、合わなければ断る。
中のファイルが多すぎるファイルは 400 `xlsx_too_large`「Excel(.xlsx)のファイルの中のファイルが多すぎます(200個まで)」、展開すると大きすぎるファイルは
400 `xlsx_too_large`「Excel(.xlsx)のファイルの中身が大きすぎます(展開して合計8MB・中の1つのファイル5MBまで)」、それ以外は 400 `invalid_xlsx`。
上限は本当のファイルに合わせた値(書き出したスタッフ2000行は展開して1.6MB、全ての列を上限の長さにしても4.5MB。日報AIの調整のマスターは百行ほど。
exceljs は展開した XML の数十倍のメモリを使い、展開して30MB の XML では 230〜570MB になるため)。さらに exceljs で読むのは API の1インスタンスで
1つずつにし(`xlsxSheets.ts` の `withXlsxReadSlot`)、読んでいる間に来た取込(スタッフ・日報AIの調整のどちらでも)は回数制限を数えた後に
429「ほかの Excel の取込を読んでいます。少し待ってからもう一度お試しください。」(`Retry-After: 10`)にする。

### 1.5 回数制限

`platform.rate_limit_buckets` に固定窓で数える(Cloud Run の複数インスタンスで共有)。キーは `SESSION_SECRET` から HKDF で
導出した鍵つきハッシュ(IP・ログインIDを平文で残さない)。規則は `core/usecases/rateLimits.ts` の `DEFAULT_RATE_LIMIT_POLICY`、
回数だけ環境変数で変えられる。超えると WARN `rate_limit.exceeded`(規則名・回数)。

| 規則(name) | キー | 既定 | 超えたとき | 回数の環境変数 |
| --- | --- | --- | --- | --- |
| `login_failure_account` | テナントslug + 正規化したログインID(無いアカウントも数える) | 15分に10回 → 15分ロック | 429(正しいパスワードでも。ただし正しい「この端末」の印のある要求は数えず、断らない) | `RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT` |
| `login_failure_device` | テナント + スタッフ + 端末(「この端末」の印が正しい要求だけ。`login_failure_account` の代わりに数える) | 15分に10回 → 15分ロック | 429(その端末だけ) | — |
| `login_failure_ip` | 送信元IP | 15分に50回 → 15分ロック | 429 | `RATE_LIMIT_LOGIN_FAILURES_PER_IP` |
| `password_reset_request_account` | アカウント(分かればテナント + スタッフ = 主・サブのメールで同じ枠、分からなければテナントslug + ログインID) | 1時間に5回 | 何もせず同じ応答(既存のコードに触れない) | `RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_ACCOUNT` |
| `password_reset_request_account_ip_day` | `password_reset_request_account` のキー × 送信元IP(1つの送信元からのメールの送り続けを止める。別のネットワークの本人は止めない) | 1日10回 | 同上 | `RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_ACCOUNT_IP_DAY` |
| `password_reset_request_ip` | IP | 1時間に20回 | 429 | `RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_IP` |
| `password_reset_confirm_account` | アカウント(発行要求と同じ考え方) | 1時間に20回 | 誤ったコードと同じ 400「無効な認証コードです」(コードに触れない。429 にすると2つのメールが同じスタッフと分かるため) | — |
| `password_reset_confirm_ip` | IP | 1時間に50回 | 429 | — |
| `password_guide_staff` / `_day` | テナント + 送り先のスタッフ(管理者のパスワード設定の案内。本人の再設定の要求とは別の枠) | 1時間に5回 / 1日20回 | 429 | — |
| `password_change_failure_staff` | テナント + スタッフ(パスワード変更で現在のパスワードを誤った回。照合の前に枠を取り、一致した回は数え直す) | 15分に5回 → 15分ロック | 429「現在のパスワードの誤りが続いたため、一時的にパスワードを変更できません。…」(正しいパスワードでも) | — |
| `ai_generate_staff` | テナント + スタッフ | 1日200回 | 429 | `RATE_LIMIT_AI_GENERATE_PER_STAFF_DAY` |
| `receipt_ocr_staff` | テナント + スタッフ | 1日300回 | 429 | `RATE_LIMIT_RECEIPT_OCR_PER_STAFF_DAY` |
| `receipt_upload_staff` | テナント + スタッフ | 1時間60回(領収書の登録 `POST /api/receipts`。画像の枚数ではなく要求の回数。1回で最大6枚・14MB の本文を受け、画像を保存先に書くため。本文を読む前に数えるので、検証で断られた(400)要求も数える) | 429「領収書の登録の回数が上限に達しました。しばらく待ってから再度お試しください。」(`Retry-After` つき) | `RATE_LIMIT_RECEIPT_UPLOAD_PER_STAFF_HOUR` |
| `schedule_force_refresh_staff` | テナント + スタッフ | 1時間30回 | 429 | `RATE_LIMIT_SCHEDULE_REFRESH_PER_STAFF_HOUR` |
| `visit_complete_staff` | テナント + スタッフ | 1時間60回(「訪問終わりました」の通知 `POST /api/reports/visit-complete`。押すたびに Google Chat に送るため) | 429 | — |
| `push_test_staff` | テナント + スタッフ | 1時間10回 | 429 | — |
| `push_subscribe_staff` | テナント + スタッフ | 1時間30回 | 429 | — |
| `gemini_key_save_staff` | テナント + スタッフ | 1時間20回(Gemini API キーの保存。保存ごとに Gemini へ確かめるため) | 429 | — |
| `integration_customers_key` | テナント + 外部連携の API キー | 1時間120回 | 429 | — |
| `integration_auth_failure_ip` | 送信元IP(`/api/integrations/*` の認証の失敗) | 15分に30回 → 15分ロック(ロック中は認証もしない) | 429 | — |
| `attendance_export_staff` | テナント + スタッフ | 1時間30回(出勤簿の Excel の書き出し。1人分・全員分の合計) | 429 | — |
| `customer_csv_import_staff` | テナント + スタッフ | 1時間30回(顧客CSVの取込。`POST /api/admin/customers/import`) | 429 | — |
| `staff_import_apply_staff` | テナント + スタッフ(管理者) | 10分に5回(スタッフの xlsx の取込の反映。`dryRun` は数えない) | 429 | — |
| `staff_xlsx_import_staff` | テナント + スタッフ(管理者) | 1時間30回(スタッフの xlsx の取込。確かめる `dryRun`・反映の両方。xlsx を展開して読む前に数え、読めないファイル(400)も数える) | 429 | — |
| `report_ai_xlsx_import_staff` | テナント + スタッフ(管理者) | 1時間30回(日報AIの調整の xlsx の取込。確かめる `dryRun`・反映の両方。数え方は `staff_xlsx_import_staff` と同じ) | 429 | — |

パスワード再設定の規則は、まず送信元IPで数え(上限なら 429 でアカウントも探さない)、次にアカウントを探してからアカウント単位の
枠を数える(発行要求は1時間の枠、続いて送信元IPごとの1日の枠。1時間の上限を超えた回は1日の分に数えない)。アカウントが無い・退職者・
停止中のテナントでも入力のログインIDで同じ回数だけ数えるため、上限に達するまでの回数からアカウントの有無は分からない。認証の無い
要求で数える枠は、第三者が使い切っても本人を長く止められないようにする(確認に1日の枠は無く、発行要求の1日の枠は送信元IPごと。
管理者の案内は別の枠。[06](06_セキュリティ設計.md) 2.3)。

ログインの規則は照合(argon2)の**前に**1回分の枠を取る(同時の大量の試行でも照合まで進むのは上限の回数まで)。まず送信元IPで数え、
ロック中ならアカウントの枠には触れずに 429(1つのIPから送り続けてもアカウントの枠は減らない)。形の正しい「この端末」の印(Cookie)が
無ければ、テナント・アカウントを探す前に `login_failure_account` で数え、ロック中なら DB を読まずに 429(読み方の差からアカウントの有無が
分からないように)。印があればテナント・アカウントを探し(アカウントの有無にかかわらず同じ問い合わせ)、そのアカウントの正しい印なら
`login_failure_device`、それ以外は `login_failure_account` で数える。
一致した回は数えない(使った枠は数え直し、IP は先に取った1回分を返す)。印での成功ではアカウント単位の枠は戻さない。
`integration_auth_failure_ip` も同じく API キーを確かめる前に1回分を取り、成功した回は返す。ロック中の要求は `rate_limit.exceeded` も
`integration.auth_failed` も残さず(失敗の続く連携先で操作ログが溢れないように)、ロックの始まりに1回だけ WARN `integration.auth_locked` を残す。

送信元IPで数える規則(`login_failure_ip`・`password_reset_request_ip`・`password_reset_confirm_ip`・`integration_auth_failure_ip`、公開デモの AI の
`demo_ai_ip_day`)は、IP をそのままではなく `rateLimitIpSubject`(`core/domain/rateLimit/ipSubject.ts`)で決めた送信元で数える。IPv6 は利用者1人(1回線)に
/64 がまとめて割り当てられるのが普通で、アドレスを替えながら上限を避けられるため、先頭64ビットの範囲を RFC 5952 の書き方で(`2001:db8:1:2::/64`。省略形・大文字・
ゾーンID・角かっこの違いは同じ送信元)1つに数える。IPv4 射影の IPv6(`::ffff:192.0.2.1`)は IPv4 と同じ送信元、IPv4・読めない値はそのまま。
操作ログ・セッションの記録には元のアドレスを残す。

### 1.6 公開デモ用テナント(`DEMO_TENANT_SLUG`)

訪問者みんなで1つのテナントを使う公開デモのための制限(`api/src/http/demoRestrictions.ts`)。`DEMO_TENANT_SLUG` を設定したときだけ、
その slug のテナントにだけ掛かる(普通のテナントは変わらない)。データは毎晩 `pnpm demo:reset` で作り直し、前日のデモは日付付きの slug で停止して
一定期間残す(07 3.9)ため、入力・編集・閲覧・スタッフの追加・プロンプトの編集は普通に使える。断るのは、1人の操作で他の訪問者のデモを壊すものと、外への送信だけ:

| 断る操作 | 理由 |
| --- | --- |
| `POST /api/auth/change-password`、`POST /api/auth/password-reset/request`・`/confirm`(本文の `tenantSlug` がデモ用テナント) | 共有のアカウントでログインできなくなる・メールが外に出る |
| `PATCH`・`DELETE /api/admin/staff/:id`(デモ用アカウント `DEMO_ACCOUNTS` だけ。他のスタッフは編集できる)、`POST /api/admin/staff/:id/password-guide`、`POST /api/admin/staff/import` | 同上 |
| `POST /api/admin/report-ai/import`(日報AIの調整の xlsx の取込。1行ずつの保存・書き出しは使える) | マスターをまとめて書き換える。xlsx を読むのは API の1インスタンスで1つずつのため、送り続けると他の訪問者の取込を待たせ、メモリも使う |
| `POST /api/admin/customers/import` | 顧客を丸ごと入れ替える |
| `POST /api/settings/admin/gchat-webhooks` | 訪問者の入れた送り先へ外部送信が起きる |
| `GET /api/admin/audit-logs`・`/audit-logs.csv` | 操作ログに他の訪問者の送信元IP・ブラウザが残る(共有の管理者アカウントで見られる) |

- Gemini の API キー(`POST /api/settings/admin/gemini-key`)は断らない。運用担当者がデモ用の管理者で保存すれば、デモでも実際に AI で書ける
  (回数は下の上限。保存済みのキーは伏せ字でしか返さない。`demo:reset` が新しいテナントへ封をし直して引き継ぐ。AI プロンプトの上書き・日報AIの調整のマスターも引き継ぐ。07 3.9)。
  共有の管理者アカウントなので、訪問者も上書きできる(そのときは保存し直す)。
- 応答は 403 `{ code: 'forbidden', message: 'デモ環境ではこの操作はできません。' }`、WARN `demo.action_refused`(`details.rule` に規則名)。
- デモかどうかを画面に伝えるのは web のビルドの設定ではなく API(本番とデモで同じビルドを使う): ログイン前は `GET /api/demo/config`(2.12)、ログイン後は
  `POST /api/auth/login`・`GET /api/auth/me` の `staff.demoTenant`(そのテナントが `DEMO_TENANT_SLUG` の slug か。テナントの ID ごとの判定をプロセス内に10分覚える)。
  画面が隠すのは、ここで断る操作のうちパスワードの変更と顧客CSVの取込のボタン(06 4.3)。
- 前日のデモは `demo:reset` が slug を `<slug>-YYYYMMDD` に変えて停止(`suspended`)で残す。停止中のテナントはログイン(「ご利用の法人は現在利用を停止しています。…」)も
  既存のセッション Cookie も通らない(1.2 の「テナントが `active`」)。
- テナントはセッション Cookie の先頭(テナント ID)か本文の `tenantSlug` で決める(断るかどうかの判定だけ。認証は各ルートが行う)。
- ログイン: デモ用テナントはアカウント単位・端末単位のロック(`login_failure_account`・`login_failure_device`)をしない(わざと間違え続けて全員を締め出させない)。
  送信元IP単位(`login_failure_ip`)は残す。
- AI(`POST /api/reports/daily/generate`・`/accident/generate`・`POST /api/receipts/ocr`)は1回のログイン(セッション)につき合計
  `DEMO_AI_USES_PER_SESSION`(10)回まで(規則 `demo_ai_session`、キーはセッションID)。超えると 429「デモ環境では、AIを使えるのは
  1回のログインにつき10回までです。」。ログインし直す・スタッフを足すと増やせるため、天井として送信元IPごとに1日30回
  (`demo_ai_ip_day`)とデモ用テナント全体で1日300回(`demo_ai_tenant_day`)も数える(超えると 429「デモ環境の本日のAIの利用回数の上限に
  達しました。…」)。狭い枠から数え、超えた回は広い枠を使わない。スタッフ単位の1日の上限(`ai_generate_staff`・`receipt_ocr_staff`)も掛かる。
- パスの ID は大文字・小文字をそろえて比べる(UUID は DB では大文字・小文字を区別しないため、大文字で書いてデモ用アカウントの守りを
  すり抜けさせない。`routes/adminStaff.ts` の自分自身の降格・退職・削除の判定も同じ)。

## 2. エンドポイント一覧

権限: 「誰でも」= 未ログイン可、「ログイン」= `requireSession`、「管理者」= `requireAdmin`。
`staffId?` は管理者・コーディネーターだけが有効な対象スタッフの指定(一般スタッフは無視されて本人)。

### 2.1 ヘルスチェック

| メソッド・パス | 権限 | 応答 | 備考 |
| --- | --- | --- | --- |
| `GET /api/health` | 誰でも | `{ status: 'ok' }` | DB に触らない(Cloud Run の起動・生存確認) |
| `GET /api/health/db` | 誰でも | `{ status: 'ok' }` / 503 `{ status: 'error' }` | 失敗の詳細はプロセスログにだけ |

### 2.2 認証 `/api/auth`(`routes/auth.ts`)

| メソッド・パス | 権限 | 契約(要求 / 応答) | 応答・エラー | 主なログ |
| --- | --- | --- | --- | --- |
| `POST /login` | 誰でも | `loginRequestSchema`(`tenantSlug`・`email`(サブメールも可)・`password`)/ `sessionUserResponseSchema` | `{ staff: { staffId, tenantId, name, email, role, demoTenant } }` + セッションの Cookie と「この端末」の印の Cookie(1.2。要求に正しい印があれば、アカウント単位のロック中でも通す)(`demoTenant` = 公開デモ用テナントへのログインか。1.6)。401「メールアドレスまたはパスワードが違います」/「ログイン権限のないユーザーです」(退職)/「ご利用の法人は現在利用を停止しています。…」、429(ロック中) | INFO `auth.login.succeeded`、SECURITY `auth.login.failed`・`.lockout_started`・`.locked`(`scope` = `ip` / `account` / `device`。印を送った要求は `details.device` = `trusted` / `invalid`) |
| `GET /me` | 誰でも(Cookie) | — / `sessionUserResponseSchema` | `{ staff: { …, demoTenant } }`(`/login` と同じ形)。401「未ログインです」 | INFO `auth.session.auto_login` / WARN `.auto_login_failed` |
| `POST /logout` | 誰でも | — / `okResponseSchema` | `{ ok: true }`。セッションを失効しセッションの Cookie を消す(「この端末」の印の Cookie は残す) | INFO `auth.logout` |
| `POST /change-password` | ログイン | `changePasswordRequestSchema`(`currentPassword`・`newPassword` 8〜128文字)/ `changePasswordResponseSchema` | 400「現在のパスワードが正しくありません」・長さの規則、429(現在のパスワードの誤りが15分に5回を超えた。1.5 `password_change_failure_staff`)。操作中以外のセッションを失効し、「この端末」の印の Cookie を作り直す(1.2) | SECURITY `auth.password_change.succeeded` / `.failed`、WARN `.locked` / `.lockout_started` |
| `POST /password-reset/request` | 誰でも | `passwordResetRequestSchema`(`tenantSlug`・`email`)/ `passwordResetRequestResponseSchema` | 常に `{ ok: true, message }`。IP の上限だけ 429 | SECURITY `auth.password_reset.requested`、WARN `.request_rejected` |
| `POST /password-reset/confirm` | 誰でも | `passwordResetConfirmSchema`(`tenantSlug`・`email`・`code` 8桁の数字(移行のあいだだけ6桁も受け付ける。`PASSWORD_RESET_CODE_PATTERN`)・`newPassword`)/ `passwordResetConfirmResponseSchema` | `{ ok: true, message }` + この端末の「この端末」の印の Cookie(新しいパスワードで作り直す。1.2)。400「無効な認証コードです」(アカウント単位の確認の上限も同じ)/「認証コードの有効期限が切れています」/入力回数の上限、429(送信元IPの上限だけ) | SECURITY `auth.password_reset.completed`、WARN `.failed` |

### 2.3 お客様 `/api/customers`(`routes/customers.ts`、全てログイン)

| メソッド・パス | 契約 | 応答 | 備考 |
| --- | --- | --- | --- |
| `GET /?familyName=` | `customerListQuerySchema` / `customerListResponseSchema` | `{ customers: [{ id, name, phone, city }], cities }` | `familyName` 省略でアーカイブされていない全件(絞り込みは画面)。指定すると苗字の完全一致 |
| `GET /:id` | — / `customerDetailResponseSchema` | 住所・連絡先・子ども(アレルギー等)の全項目 | 形の違う ID は 404。INFO `customer.detail.viewed`(`details.customerId`) |
| `GET /:id/report-profile` | — / `customerReportProfileResponseSchema` | `{ profile: { customerId, educationLevel, rowVersion, updatedAt, updatedByName } }`(家庭の教育思考★。一度も設定していない家庭は `educationLevel`・`rowVersion` が null、未設定に戻した家庭は `educationLevel` だけ null) | 無い・別テナントのお客様は 404 |
| `PUT /:id/report-profile` | `saveCustomerReportProfileRequestSchema`(`educationLevel` 1〜5 または null(未設定に戻す)・`rowVersion?`(行の無い家庭は省略))/ 同上 | 同上 | ログインしているスタッフなら誰でも。null は行を消さずに `education_level` を null にする(`rowVersion` は上がり続け、行の無い家庭を null にすると null の行を作る)。未設定の家庭の日報AIは行の無い家庭と同じく★2(`DEFAULT_EDUCATION_LEVEL`)。版が違う(未設定のつもりで送ったが他の人が先に設定した場合を含む)と 409(WARN `customer.report_profile.update_rejected`)。INFO `customer.report_profile.updated`(`customerId`・前後の★。未設定は null) |

### 2.4 予定 `/api/schedule`(`routes/schedule.ts`、全てログイン)

| メソッド・パス | 契約 | 応答 | 備考 |
| --- | --- | --- | --- |
| `GET /?date=&staffId?` | `scheduleQuerySchema` / `scheduleLightResponseSchema` | 予定の一覧(ルートなし)。読めないカレンダーがあれば `partial: true`(読めた分だけ) | 地図 API を呼ばない。カレンダーのイベント一覧は60秒の短期キャッシュ(05 4.4)。成功はログに残さない |
| `GET /route?date=&staffId?&forceRefresh?` | `scheduleRouteQuerySchema` / `scheduleWithRouteResponseSchema` | 予定 + 区間ごとの所要時間・距離・経路URL。読めないカレンダーがあれば `partial: true` | 予定はカレンダーから読む(イベント一覧は60秒、地図の結果は区間・住所ごとに6時間の共有キャッシュ。05 4.4)。`forceRefresh=1` はどちらのキャッシュも読まずに調べ直して書き直す(回数制限あり)。INFO `schedule.route.succeeded`(`forceRefresh`・`geocodeCalls`・`routeCalls`・`cacheHits`・部分的なら `partial`)、502(外部の失敗) |
| `GET /api/staff` | — / `activeStaffListResponseSchema` | `{ staff: [{ id, name }] }`(退職者を除く) | 一般スタッフには空の一覧(`routes/staff.ts`) |

### 2.5 出勤簿 `/api/attendance`(`routes/attendance.ts`、全てログイン)

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー |
| --- | --- | --- |
| `GET /day?date=&staffId?` | `attendanceDayQuerySchema` / `attendanceDayResponseSchema` | `{ attendance: { businessDate, staffId, staffName, found, rowData, derived, changedFields, rowVersion, editable, editableFrom, editableTo, optionsI, optionsR } }` |
| `PUT /day` | `updateAttendanceDayRequestSchema`(`date`・`staffId?`・`rowData`・`rowVersion?`)/ `updateAttendanceDayResponseSchema` | `{ attendance, changedCount, changedColumns, message }`。400 `locked`(月ロック・締めた月)・`validation_failed`(`rowData.<列>`)、409(古い `rowVersion`、WARN `attendance.day.update_conflict`) |
| `GET /day/calendar-sync/preview?date=&staffId?` | `calendarSyncQuerySchema` / `calendarSyncPreviewResponseSchema` | `{ staffId, staffName, date, appointmentCount, hasChanges, changes: [{ column, label, oldValue, newValue }] }`。書き込みなし。502 |
| `POST /day/calendar-sync` | `calendarSyncApplyRequestSchema`(`date`・`staffId?`)/ `calendarSyncApplyResponseSchema` | `{ staffId, staffName, date, appointmentCount, changedCount, changes }`。冪等。月ロックは掛からない。502 |
| `POST /day/aggregate/refresh` | `refreshAttendanceAggregateRequestSchema`(`date`・`staffId`)/ `refreshAttendanceAggregateResponseSchema` | **管理者だけ**(usecase が確かめる。403)。勤怠集計のミラーを積み、参考の `rowData` を返す |
| `GET /month?month=&staffId?` | `attendanceMonthQuerySchema` / `attendanceMonthResponseSchema` | `{ month: { yearMonth, staffId, staffName, days, totals, receipts: { byDay, total, companyPaidByDay, companyPaid, customerBillable } } }`(月の全日。領収書は取消していないものだけ。`byDay`・`total` は会社負担を含み、`companyPaid(ByDay)` はうち会社負担、`customerBillable` はお客様に請求する額) |
| `GET /week?start=&end=&staffId?` | `attendanceWeekQuerySchema` / `attendanceWeekResponseSchema` | `{ events: [{ date, slotKey, title, eventType, start, end }] }`(最大31日) |
| `GET /export?month=\|fiscalYear=&staffId?` | `attendanceExportQuerySchema`(`month` か `fiscalYear` のどちらか一方)/ .xlsx | 出勤簿の Excel(`XLSX_CONTENT_TYPE`)。1か月は1シート、年度(4月〜翌3月)は12シート。対象スタッフの決め方は `/month` と同じ。`Content-Disposition: attachment; filename="attendance_<月>.xlsx"; filename*=UTF-8''<日本語の名前>`(RFC 5987)、`Cache-Control: no-store`。中身は 02 8.6。INFO `attendance.export.downloaded`(自分の分も)。回数制限 `attendance_export_staff`(429) |
| `GET /export/all?month=` | `attendanceBulkExportQuerySchema` / .xlsx | **管理者だけ**(`requireAdmin`、他は 403 + WARN `attendance.export_all.access_denied`)。その月に在籍している全員を1人1シート(100人まで(`MAX_ATTENDANCE_EXPORT_STAFF`)。在籍している管理者・コーディネーターも数える。超えると 400 で何も作らない)。SECURITY `attendance.export_all.downloaded`(`staffCount`。全スタッフの記録を持ち出すため、操作ログの CSV と同じ扱い)。回数制限は上と共通。1つのサーバーで同時に1つだけ(重なれば 429) |

`rowData` のキーは出勤簿の列記号(`C`・`D`・`E` … `AO`。意味は `sheetLayout.ts` の `ATTENDANCE_COLUMNS`)、値は文字列。
書き込みは全て INFO、失敗・拒否は WARN/ERROR、閲覧は管理者・コーディネーターが他のスタッフを見たときだけ INFO(`targetStaffId`)。

### 2.6 日報・事故報告 `/api/reports`(`routes/reports.ts`・`routes/reportCsv.ts`、全てログイン)

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー |
| --- | --- | --- |
| `POST /daily/generate` | `generateDailyReportRequestSchema`(`text` 1〜20,000字・`start?`・`end?`・`customerId`・`careRecipientId?`(日報のお子様。`null` = 選ばない、省略 = 世帯にアーカイブされていない子がちょうど1人ならその子)・`riskRating?`(1〜5。PSI)・`reportDate?`(月齢を数える訪問日。省略はテナントの今日)・`model?`(試すモデル。`GET /generate/models` の1つ。省略はその先頭。Gemini Flash / Flash-Lite 系の名前以外は 400 `model_not_allowed`))/ `generateDailyReportResponseSchema` | `{ draft: { warnings, internal, customer }, ai: { generationId, usedKeywords: [{ code, keyword, status }], candidateCount, escalationRequired, childAgeMonths, educationLevel, effectiveEducationLevel, model, retryable } }`。`model` は使ったモデル、`retryable` は API エラーで次のモデルで試す意味があるか(05 6章)。失敗もエラーにせず `warnings` に `API Error` / `API Key Missing`(GAS版と同じ)。日報AIの3軸で絞り込んだプロンプトで生成し(02 6.1)、生成を `report_ai_generations` に記録する(記録できなければ `generationId` は null・ERROR `ai.daily_report.generation_log_failed`)。PSI 1 は `warnings` に「管理者へ連絡…」を必ず入れる。無いお客様は 404、お客様の世帯に無いお子様は 400 `care_recipient_mismatch`(AI を呼ばない)。`usedKeywords[].status` は `used`(候補に見せた語。`report_ai_generations.used_keyword_ids` に入る)/ `not_offered`(表にはあるが候補に見せていない語)/ `unknown`(表に無い答え)で、`not_offered`・`unknown` は使った語に数えず `unresolved_used_codes` に答えのまま残す。回数制限 |
| `GET /generate/models` | — / `reportModelsResponseSchema` | `{ models: string[] }`。保育日報・事故報告の生成で試すモデルの順番(Gemini Flash 系 → Flash-Lite 系を系統ごとに4件まで、系統の中は `-latest` が先頭、次に新しい版から。最大8件。05 6章)。API キーが無ければ空(画面はモデルを指定せずに1回だけ呼ぶ)。回数制限の対象外 |
| `POST /accident/generate` | `generateReportRequestSchema`(`text`・`start?`・`end?`・`model?`(日報と同じ。`GET /generate/models` の1つ、省略はその先頭、Flash / Flash-Lite 系以外は 400 `model_not_allowed`))/ `generateAccidentReportResponseSchema` | `{ draft: {…8項目} | { error }, model, retryable }`。`model` は使ったモデル(API キーが無ければ null)、`retryable` は失敗で次のモデルで試す意味があるか(日報の `ai.model` / `ai.retryable` と同じ。05 6章)。失敗は ERROR `ai.accident_report.generate_failed`、先頭でないモデルで書けたら WARN `ai.accident_report.model_fallback_succeeded`。回数制限は日報と共通(試し直しも1回に数える) |
| `POST /daily` | `saveDailyReportRequestSchema`(`reportId?`・`rowVersion?`・`staffId?`・`customerId`・`reportDate?`(実在する 2000〜2100年の日付。外は 400)・`startTime`・`endTime`・`inputText`・`internalText`・`customerText`・`riskRating?`・`esRating?`・`careRecipientId?`(日報のお子様。`null` = 選ばない、省略 = 世帯にアーカイブされていない子がちょうど1人ならその子)・`aiGenerationId?`(generate の `ai.generationId`))/ `saveDailyReportResponseSchema` | `{ success, message: '保存しました', report }`(`report.rowVersion`・`careRecipientId`・`psiAlert` を含む)。`aiGenerationId` は同じテナント・同じお客様で、保存する人が作った成功した生成だけ(違えば 400 `ai_generation_mismatch`、別の日報に結び付いていれば 409 `ai_generation_linked`)で、その生成の `care_record_id` に日報を結び付ける(上書きしても前の生成は結び付いたまま。結び付けはまだ結び付いていないか同じ日報のときだけ書くため、同じ生成を並んだ2つの保存で別々の日報に結び付けようとすると後の方が 409 `ai_generation_linked`)。お客様の世帯に無いお子様は 400 `care_recipient_mismatch`。PSI 2 以下で、新しい日報か前の保存から PSI が変わったとき(同じ PSI のままの保存し直しでは知らせない)は、在籍している管理者の全ての購読に `push.psi_alert` を積み(dedupe `push.psi_alert:<購読ID>:<記録ID>:<PSI>:<版>`)、日報の Google Chat に【PSI緊急】/【PSI注意】を送り、WARN `report.psi_alert`(`reportId`・`riskRating`・`rowVersion`・`pushQueued`)。`report.psiAlert` はこの保存で知らせたか(画面の「管理者に知らせました」)。404 `report_not_found`、403(他人の報告。SECURITY `report.daily.save_denied`)、409 `customer_mismatch` / `author_mismatch` / 古い版、400 `locked` |
| `POST /accident` | `saveAccidentReportRequestSchema`(`reportType: '事故報告'｜'ヒヤリハット'`・`targetName`・`targetDob`・`occurrenceTime`・`location`・`accidentContent`・`situation`・`immediateResponse`・`parentCorrespondence`・`diagnosisTreatment`・`prevention`・`inputText` と上の共通項目)/ `saveAccidentReportResponseSchema` | `{ success, report }`。事故報告とヒヤリハットは上書きで切り替えられる。日報との切り替えは 404。エラーは日報と同じ |
| `POST /visit-complete` | `visitCompleteRequestSchema`(`staffId?`・`customerId`・`visitDate`・`startTime`・`endTime`(どちらも `HH:mm` か空。それ以外は 400。前の版の画面(端末にキャッシュされた PWA)が時刻を選んでいないときに送る `":"` は、1リリースの間だけ空として受け付ける。次のリリースで外す))/ `visitCompleteResponseSchema` | `{ success: true }`。DB に書かず Google Chat に知らせるだけ(名前は DB の値。Chat の書式の文字は文字参照にする)。回数制限 `visit_complete_staff`(429)。INFO `report.visit_complete.notified`(`customerId`・`visitDate`、他人名義なら `targetStaffId`) |
| `GET /history?customerId=&before?` | `customerHistoryQuerySchema` / `customerHistoryResponseSchema` | `{ items, nextCursor }`(5件ずつ、`(occurred_at DESC, id DESC)` のキーセット。続きが無ければ `null`)。読めない `before` は 400。**一般スタッフにも、そのお客様の全員の記録(他のスタッフの社内向けの記録・PSI を含む)を返す**: 訪問の引き継ぎ(次に訪問するスタッフが前の訪問を読む。GAS版 `getCustomerReports` と同じ)のための意図した例外で、本人の分だけを返す `GET /`・`GET /:id` とは違う(06 4章)。返すページに他のスタッフの記録が入っていれば、続きのページも1ページごとに INFO `report.history.viewed`(`customerId`・`count`・`othersCount`・ページの先頭と末尾の記録ID `firstRecordId`・`lastRecordId`・続きのページか `continued`・続きがあるか `hasMore`。本文は残さない、`targetStaffId` は null) |
| `GET /?from&to&staffId&customerId&kind&sort&cursor&limit` | `reportListQuerySchema`(`from?`・`to?`(記録の日時の業務日、両端を含む。既定は今日までの31日間、366日まで。`sort` によらず記録の日時で絞る)・`staffId?`(書いたスタッフ。一般スタッフは無視して本人)・`customerId?`・`kind?`(`daily_report` / `accident` / `near_miss`)・`sort?`(`occurred` = 訪問日時の新しい順(既定)/ `saved` = 保存した順。ほかの値は 400)・`cursor?`(同じ `sort` の前のページの `nextCursor`)・`limit`(1〜100、既定30))/ `reportListResponseSchema` | `{ reports: [{ id, kind, occurredAt, date, time, staffId, staffName, customerId, customerName, excerpt, riskRating, esRating, updatedAt, createdAt }], nextCursor, range: { from, to }, timeZone }`。`sort=occurred` は `(occurred_at DESC, id DESC)`、`sort=saved` は `(created_at DESC, id DESC)`(最初に保存した日時。上書き保存は同じ行を直すため順は変わらない = GAS版の「日報」シートで行が足された順)のキーセット。`saved` の続きの位置は `s.` を頭に付け、`created_at` をマイクロ秒まで保つ。`createdAt` は最初に保存した日時。`time` は日報なら「開始〜終了」、事故報告は記録の時刻 `HH:mm`。`excerpt` は60文字まで。期間の誤りは 400(`fields.from`)、読めない `cursor`(壊れた形・UUID でない ID・0001〜9999年の外や存在しない日時・別の `sort` の続きの位置)は 400 `invalid_cursor`。他のスタッフの記録を含むページは続きのページも1ページごとに INFO `report.list.viewed`(条件・件数・続きのページか `continued`・`saved` なら `sort`。スタッフを絞れば `targetStaffId`) |
| `GET /export.csv?sheet&from&to&staffId&customerId&kind&sort` | `reportCsvQuerySchema`(`sheet`: `daily` / `accident` 必須、`kind` は `sheet` に合うものだけ、`sort` は一覧と同じで行の順になる)。コーディネーター・管理者だけ(`requireCoordinator`、それ以外は 403・WARN `report.list.export.access_denied`) | `text/csv; charset=utf-8`(BOM つき、CRLF、`attachment; filename="reports-<sheet>_<from>_<to>.csv"`)。`daily` は GAS版の「日報」シートと同じ12列(日時・開始時刻・終了時刻・スタッフ・顧客ID・お客様・書いたメモ・事務局に送る文・保護者に送る文・PSI・ES・記録ID)、`accident` は「事故報告」シートと同じ17列(日時・報告者・顧客ID・お客様・対象児童名・生年月日・発生日時・発生場所・事故内容・発生状況・発生時の対応・保護者への対応・診断名・処置・今後の対応・元のメモ・種別(事故報告/ヒヤリハット)・記録ID)に、どちらも「最終更新」を足す。日時はテナントのタイムゾーンの `yyyy/MM/dd HH:mm:ss`、顧客IDは取込元(RESERVA)のID(無ければ本アプリのID。ミラーと同じ)。500件ずつ別のトランザクションで読んで流す。式として動く値・切断・途中の失敗の扱いは操作ログの CSV と同じ(`http/csv.ts` `writeCsvStream`)。読み始める前に SECURITY `report.list.exported`(条件と `sheet`。`saved` なら `sort`) |
| `GET /:id` | — / `reportDetailResponseSchema` | `{ report: { id, kind, occurredAt, date, time, updatedAt, createdAt, staffId, staffName, customerId, customerName, rowVersion, revisionCount, content, (日報は riskRating・esRating) }, timeZone }`。`content` は日報なら `startTime`〜`customerText`、事故報告・ヒヤリハットなら `targetName`〜`inputText`。`revisionCount` は `care_record_revisions` の件数。一般スタッフは本人の記録だけ(他人は 403・SECURITY `report.detail.view_denied`)。無い・別テナント・UUID でない ID は 404。他のスタッフの記録を読んだら INFO `report.detail.viewed`(`targetStaffId`) |

担当スタッフ: 一般スタッフは常に本人。管理者・コーディネーターは `staffId` → 上書きなら元の担当 → 本人の順。保存成功で
INFO `report.<daily|accident>.saved`(他人名義なら `targetStaffId`)。Google Chat の未設定は WARN
`notification.gchat.not_configured`、送信失敗は ERROR `notification.gchat.failed`(保存は成功のまま)。

### 2.7 領収書 `/api/receipts`(`routes/receipts.ts`、全てログイン)

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー |
| --- | --- | --- |
| `POST /ocr` | `receiptOcrRequestSchema`(`image` data URL)/ `receiptOcrResponseSchema` | `{ result: { amount, storeName, receiptDate, error? } }`。モデルは Flash-Lite 系をサーバーの中で最大3つ順に試す(1回30秒。05 6章)。画像の形式・大きさの誤りは 400「領収書画像の形式が正しくないか、大きすぎます(JPEG・PNG・WebP、1枚1.5MBまで)。」。回数制限 |
| `POST /` | `uploadReceiptsRequestSchema`(`staffId?`・`customerId?｜null`・`customerNameText?`(200字)・`images: [{ data, amount?, storeName?, receiptDate?, companyPaid? }]`(1〜6枚。`amount` は1,000万円まで・文字なら20文字まで(超えたら 400「金額は10,000,000円以下で入力してください。」。読めない文字は金額なしで登録)、`storeName` は200文字まで。`companyPaid` は会社負担=お客様に請求しない、既定 `false`、登録の後は変えられない)・`receiptTimestamp?`・`reportDate?`・`startTime?`・`handoffText?`(2000文字まで))/ `uploadReceiptsResponseSchema` | `{ success, message, uploadedCount, duplicateCount, duplicates, uploadBatchId }`。1枚でも画像が不正なら何も保存せず 400(`fields` に `images.<番号>.data`)。重複の判定は取消していない領収書とだけ行い、`companyPaid` は判定に入れない。どれか1枚の領収書日時(フォールバックの後。テナントのタイムゾーンの月)の、名義のスタッフ(`staffId` で他のスタッフを指定したときはそのスタッフ)の出勤簿が締め済み(`attendance_periods`)なら、何も登録せず 400 `locked`「YYYY年M月の出勤簿は締め済みのため、この月の日付の領収書は登録できません。」に続けて、一般スタッフには「領収書の日付を確かめるか、管理者に連絡してください。」、コーディネーターには「領収書の日付を確かめてください。この月に登録する必要があるときは、管理者から運用担当者に締めの解除を依頼してください。」、管理者には「領収書の日付を確かめてください。この月に登録する必要があるときは、運用担当者に締めの解除を依頼してください。」+ WARN `receipt.upload_refused`(`customerId`・`imageCount`・`yearMonth`・`reason: period_locked`)。締めは画像を保存する前に確かめ(断る登録では画像を書かない)、登録のトランザクションの中でも確かめ直す(締めと同じアドバイザリロックを共有で取るため、確かめてから登録するまでに締められない。その間に締められていれば保存した画像を消して同じ 400)。INFO `receipt.uploaded`(`companyPaidCount` つき) |
| `POST /:id/cancel` | `cancelReceiptRequestSchema`(`reason?`: 1行・100文字まで。改行・制御文字は空白にして前後の空白を除き、空なら理由なし。`rowVersion`: 一覧の行の版)/ `cancelReceiptResponseSchema` | `{ receipt }`(取消した後の一覧の行。`cancellation` つき・`cancellable: false`・版が1上がる)。取消は論理削除(行は残し、合計・CSV・今月のまとめ・Excel・重複の判定から外す。スプレッドシートのミラーには送らない)。本人の分、管理者・コーディネーターは他のスタッフの分も(一般スタッフの他人の分は 403 + WARN `receipt.cancel_denied`)。取消せる期間(02 7.1。テナントのタイムゾーンの今日と領収書日時の日付 D で決める: スタッフ・コーディネーターは D+2日まで・同じ月・今日が月の最終日でない、管理者は今月と前の月以前なら常に、D が来月以降なら誰も不可)の外、D の月のそのスタッフの出勤簿が締め済み(締めと同じアドバイザリロックを共有で取って読む。取消の間に締められない)なら 400 `locked` + WARN `receipt.cancel_refused`(`reason`: `deadline_passed`・`month_end`・`other_month`・`future_month`・`period_locked`)。取消した行が同じ内容の重複の判定の代表なら、同じ内容の取消していない行の1つが代表を引き継ぐ(同じトランザクション。その行の版は変わらない)。取消済みは 409(`already_cancelled`)、`rowVersion` が違えば 409。無い・他テナント・ID でない値は 404、要求の形の誤りは 400。取消すと Google Chat(領収書の通知先)に「【領収書取消】」、INFO `receipt.cancelled`(`receiptId`・`uploadBatchId`・`withReason`) |

画像の種類は data URL の申告ではなく中身の先頭バイトで判定する(JPEG・PNG・WebP)。保存の Content-Type・拡張子は判定した種類。
日時のフォールバック: 画像ごとの `receiptDate`(表記を問わない)→ `receiptTimestamp` → `reportDate` + `startTime` → 登録時刻。`receiptTimestamp`・`reportDate` は実在する 2000〜2100年の日付だけ(外は 400)、`receiptDate` の年がこの範囲の外なら読めない表記と同じく次の候補にする。

一覧・画像・CSV(GAS版では管理者が「領収書一覧」シートと Drive で見ていたもの):

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー |
| --- | --- | --- |
| `GET /?month=YYYY-MM&staffId?&allStaff?&customerId?&cursor?&limit?` | `receiptListQuerySchema` / `receiptListResponseSchema` | `{ receipts, nextCursor, yearMonth, staff, summary: { count, totalYen, companyPaidYen, customerBillableYen, noAmountCount, cancelledCount }, timeZone }`。領収書日時(テナントのタイムゾーンの月)の新しい順に `limit`(既定50・最大200)件ずつ、`(receipted_at DESC, id DESC)` のキーセット。`summary` はページではなく月全体の取消していない領収書(金額の無いものは0円。`totalYen` は会社負担を含むスタッフへの支払いの額、`companyPaidYen` はうち会社負担、`customerBillableYen` はお客様に請求する額)と、取消済みの件数 `cancelledCount`。一覧の行には取消済みの領収書も入る。各行は日時・スタッフ・お客様(登録済みは表示名、未登録は入力された氏名、指定なしは `null`)・金額・店名・会社負担(`companyPaid`)・束の申し送り(`handoffText`)・束のID(`uploadBatchId`)・画像の種類と大きさ・版(`rowVersion`)・取消の情報(`cancellation`: `{ cancelledAt, cancelledByName, reason }`、取消していなければ `null`)・見ている人が今取消せるか(`cancellable`。本人か・役割・期間・締めでサーバーが決める)。一般スタッフは本人の分だけ(`staffId` は無視して本人、`allStaff=true` は 403 + WARN `receipt.list.view_denied`)。管理者・コーディネーターは `staffId` で他のスタッフ、`allStaff=true` で全スタッフ分(`staff: null`)。存在しない・他テナントのスタッフ・お客様は 404、読めない `cursor`(壊れた形・UUID でない ID・0001〜9999年の外や存在しない日時)は 400 `invalid_cursor`。他のスタッフ・全スタッフ分は続きのページも1ページごとに INFO `receipt.list.viewed`(月・月全体の件数・続きのページか `continued`・そのページの件数 `pageCount`) |
| `GET /csv?month=&staffId?&allStaff?&customerId?` | `receiptListQuerySchema`(`cursor`・`limit` は使わない)/ CSV | 管理者・コーディネーターだけ(一般スタッフは 403 + WARN `receipt.list.export_denied`)。条件に合う取消していない全件(新しい順、500件ずつ読む)。BOM つき UTF-8・見出し「領収書日時,スタッフ,お客様,金額(円),区分,店名,申し送り,登録の束ID,領収書ID」(区分は「お客様請求」か「会社負担」)、ファイル名 `receipts_<YYYY-MM>_<staff|all>.csv`。式として動く値は先頭に `'`。途中で失敗したら最後の行に失敗の印。INFO `receipt.list.exported` |
| `GET /:id/image` | — / 画像 | 本人の領収書、管理者・コーディネーターは全員の領収書。API が中身をそのまま返す(`Content-Type` は中身の先頭バイトで判定し直した JPEG / PNG / WebP、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`、`Content-Disposition: inline`)。一般スタッフの他人の領収書は 403 + WARN `receipt.image.view_denied`。無い・他テナント・ID でない値は 404。ファイル置き場に無い・画像でない中身は 404 + WARN `receipt.image.unavailable`(`reason: missing｜unsupported_type`)。1枚ごとの閲覧は記録しない(一覧の閲覧を記録する。06 5章) |

### 2.8 設定

| メソッド・パス | 権限 | 契約(要求 / 応答) | 応答・ログ |
| --- | --- | --- | --- |
| `GET /api/ui-config` | ログイン | — / `uiConfigResponseSchema` | `{ dailyPlaceholder, accidentPlaceholder, accidentHint, hiyariPlaceholder, assessments, educationLevels }`(テナントの上書き → `defaults/aiPrompts.ts`)。PSI の定義・判定基準は日報AIの調整の PSI(段階ごと)があればその文言。`educationLevels` = `{ title, levels: [{ score, label, customerProfile, usage }] }`(★1〜5 の説明): 日報AIの調整の教育思考★(段階ごと)があればその呼称・想定顧客像・教育語の使い方、空の項目と行の無い段階は `EDUCATION_LEVEL_DEFINITIONS`(`defaults/assessments.ts`) |
| `GET /api/data-version` | ログイン | — / `dataVersionResponseSchema` | `{ dataVersion: '12' }`(`tenant_settings.customer_data_version`) |
| `GET /api/settings/admin` | 管理者 | — / `adminSettingsResponseSchema` | `{ settings: { geminiApiKey, geminiApiKeySet, gchatReportWebhookUrl, gchatReportWebhookUrlSet, gchatReceiptWebhookUrl, gchatReceiptWebhookUrlSet } }`。秘密値は伏せ字 モデルは自動で選ぶので返さない(モデルの設定の `POST /api/settings/admin/gemini-models`・`/gemini-models/available` は廃止。05 6章) |
| `POST /api/settings/admin/gemini-key` | 管理者 | `saveGeminiApiKeyRequestSchema`(`apiKey` 500字まで)/ `saveSettingsResponseSchema` | `{ ok, changed, message }`。空・伏せ字の一部だけ書き換えは 400。新しいキーは保存の前に Gemini の ListModels(1ページ、8秒まで)で確かめ、確かめられなければ何も保存しない: キーを断られた(Gemini が 400・401・403)・日報のモデル(Flash / Flash-Lite 系)が一覧に無い → 400 `validation_failed` + `fields.apiKey`、つながらない・5xx・429・時間切れ → 502 `upstream_unavailable`(どちらも WARN `settings.gemini_key.verify_failed`、details は理由コードと HTTP ステータスだけ)。変更なし・空・伏せ字の一部の書き換えは確かめない。SECURITY `settings.gemini_api_key.changed` |
| `POST /api/settings/admin/gchat-webhooks` | 管理者 | `saveGchatWebhooksRequestSchema`(`reportWebhookUrl?`・`receiptWebhookUrl?`)/ 同上 | 新しい値は `https://chat.googleapis.com/v1/spaces/<space>/messages?…` だけ。SECURITY `settings.gchat_webhooks.changed`、WARN `.save_rejected` |
| `GET /api/settings/admin/prompts` | 管理者 | — / `aiPromptListResponseSchema` | `{ prompts: [{ key, kind, label, body, defaultBody, customized, updatedAt, revision }] }`。`revision` はキーの最新の版(履歴 `ai_prompt_revisions` の最大値。保存したことが無ければ 0) |
| `PUT /api/settings/admin/prompts` | 管理者 | `updateAiPromptsRequestSchema`(`prompts: [{ key, body｜null, revision? }]`、本文は2万字まで)/ 同上 | null・空・既定値と同じなら上書きを消す。未知の key が含まれると 400 で何も変えない。`revision` が最新の版と違えば(他の管理者が先に保存した)409 で何も変えない(WARN `settings.ai_prompts.update_rejected`)。INFO `settings.ai_prompts.updated` |

同じ値の保存は `changed: false`「変更ありません」でログも残さない。秘密値の伏せ字: APIキーは `••••••••` + 末尾4文字(8文字以下は
全て伏せる)、Webhook URL は `…/messages?••••••••`(文字は `SECRET_MASK_CHAR`)。プロンプトの key(`AI_PROMPT_KEYS`):
`daily_report.generate`・`daily_report.company_policy`(保育日報の `{companyPolicy}`。既定は空)・`accident_report.generate`(kind=prompt)、`daily_report.memo_placeholder`・`accident_report.memo_placeholder`・
`accident_report.writing_hint`・`hiyari.writing_hint`(kind=placeholder)。

### 2.9 管理者 `/api/admin`

(`/api/admin` の下でも、顧客CSVの取込だけはコーディネーターも使える。下の表の行を見る)

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー・ログ |
| --- | --- | --- |
| `GET /api/admin/staff` | — / `adminStaffListResponseSchema` | `{ staff: [{ id, name, kana, email, altEmail, phone, role, retiredOn, isRetired, passwordStatus, homeAddress, hasHomeGeo, travelMode, gender, scheduleCalendarId, rowVersion }] }`(退職者を含む、氏名順)。`kana` は「セイ メイ」、`scheduleCalendarId` は `staff_calendars`(purpose=schedule) |
| `POST /api/admin/staff` | `createStaffRequestSchema`(`name`・`email`・`kana?`・`altEmail?`・`phone?`・`role`(既定 staff)・`homeAddress?`・`travelMode?`(car / bicycle / transit / walk)・`gender?`(female / male / other / unknown)・`scheduleCalendarId?`・`initialPassword?`)/ `adminStaffResponseSchema` | 201 `{ staff, homeGeocode }`。初期パスワードを省くと未設定。メール・サブメールはテナント内で両方を跨いで一意(409、`fields` つき)。自宅住所はジオコーディングして緯度経度・区画を保存し、`homeGeocode` に結果(`ok` / `not_found` / `failed` / `unavailable`。住所を送らなければ null)。ok 以外でも住所は保存する。`scheduleCalendarId` はテナントの許可の一覧(運用担当者の `pnpm tenant:calendars`。05 4.2)に合うものだけで、合わなければ 400(`fields.scheduleCalendarId`「このカレンダーは使えません。運用担当者に登録を依頼してください」、WARN `staff.admin.create_rejected` `calendar_not_allowed`)。カレンダーIDは小文字にして保存する。SECURITY `staff.admin.created` |
| `PATCH /api/admin/staff/:id` | `updateStaffRequestSchema`(登録の項目 + `retiredOn`、全て省略可。null・空欄は値を消す。`rowVersion?`)/ `adminStaffResponseSchema` | `rowVersion` が今の版と違えば 409(`stale_row_version`)。`rowVersion` は地図APIを呼ぶ前に確かめる。住所を変えたとき(または住所は同じでも緯度経度が無いとき)だけジオコーディングし `homeGeocode` を返す(それ以外は null)。カレンダーを変えるときは登録と同じ許可の確かめ(400)。今日以前の退職日を入れると全セッションを失効(先の日付ならその日からログイン不可)。自分の役割の変更・退職日は 400。ほかの管理者を外す・退職させる変更は、在籍中の管理者の行をロックして確かめ、操作する人がもう管理者でなければ 403(`actor_not_admin`)、退職日の決まっていない管理者が残らなければ 409(`last_admin`)。更新する項目が無ければ 400。SECURITY `staff.admin.updated`(`changedFields` と役割・退職日・`homeGeocode`。値そのものは残さない) |
| `DELETE /api/admin/staff/:id` | — / `okResponseSchema` | 業務の記録(出勤簿・訪問・移動・勤務・日報・領収書・取込・設定の更新者 等、`ON DELETE` の無い外部キー)にも、外部キーの無い変更の履歴(`entity_changes.changed_by`・`care_record_revisions.changed_by`・`ai_prompt_revisions.created_by`)にも無ければ削除し、認証情報・ログイン用メール・セッション・再設定コード・カレンダー設定も消える。参照されていれば 409「…記録があるため削除できません。辞めた方は退職日を設定してください。」(`staff_has_records`)。自分自身は 400、無ければ 404、管理者で退職日の決まっていない管理者が残らなくなるなら 409(`last_admin`)。SECURITY `staff.admin.deleted` |
| `POST /api/admin/staff/:id/password-guide` | — / `okResponseSchema` | パスワード未設定・GAS版のパスワードのままの在籍者に、パスワード設定の案内(再設定コード。`mail.password_reset` を outbox に積み、payload は `{ purpose: 'setup_guide' }` だけ)をメールアドレス宛に送る(本文に法人ID と、ワーカーの `APP_PUBLIC_URL` があれば `?t=<法人ID>` つきのログイン画面の URL)。設定済み・退職者は 400。回数は送り先のスタッフ単位の `password_guide_staff`(1時間5回)・`_day`(1日20回)で数え、上限なら 429(Retry-After)。本人の再設定の要求(認証の無い要求)とは枠を共有しない(第三者が要求を送り続けても案内は止まらない)。SECURITY `staff.admin.password_guide_sent` |
| `GET /api/admin/staff/export.xlsx` | — | 退職者を含む全員の xlsx(`スタッフ一覧.xlsx`、シート「スタッフ」)。列は shared の `STAFF_SHEET_COLUMNS` の順(ID・氏名・カナ・メールアドレス・サブメール・電話・役割・退職日・自宅住所・移動手段・性別・予定カレンダーID)、役割・移動手段・性別は画面と同じ日本語(`STAFF_ROLE_LABELS` / `TRAVEL_MODE_LABELS` / `GENDER_LABELS`)、退職日は「YYYY-MM-DD」の文字、ID・電話・退職日の列は文字の書式。パスワードは出さない。そのまま取り込める。SECURITY `staff.export.downloaded`(件数だけ) |
| `POST /api/admin/staff/import` | `staffImportRequestSchema`(`fileBase64`(xlsx。2MB まで)・`fileName?`・`dryRun`(既定 true)・`planDigest?`(反映するときは必須))/ `staffImportResponseSchema` | `{ dryRun, applied, counts: { rows, created, updated, unchanged }, changes: [{ row, kind: create/update, name, email, fields: [見出し] }], errors: [{ row, message }], warnings, planDigest }`(`row` は Excel の行番号、ファイル全体の問題は null)。シート「スタッフ」(無ければ先頭のシート)の上から10行までで「氏名」「メールアドレス」の見出しの行を探し、見出しで列を見分ける(並び順は問わない。知らない見出しは知らせ、同じ見出しが2つ・氏名かメールアドレスの見出しが無ければ誤り)。空の行は読まず、500行を超えれば誤り。突き合わせは ID(空欄でなければ。知らない ID は誤り)、無ければメールアドレス(主)、どちらでも見つからなければ新しいスタッフ(パスワード未設定、役割の空欄はスタッフ)。見出しのある列はセルの値で上書きし、空欄は値の削除(氏名・メールアドレス・既存のスタッフの役割は必須)、見出しの無い列は今の値のまま、ファイルに無いスタッフは変えない。セルは登録・更新と同じ規則(`staffFieldSchemas`)で確かめ、役割・移動手段・性別は日本語の名前か値のコード、退職日は日付のセル・Excel の日付のシリアル値(整数)・「YYYY-MM-DD」「YYYY/MM/DD」「YYYY.MM.DD」(月・日は1桁も可、全角も可。2000〜2100年)。式は残っている計算結果を、リンク・書式つきの文字は文字だけを読む。値を読めないセル(エラーの値・計算結果の残っていない式)と、退職日以外の列の日付のセルは空欄(値の削除)にせず、その行の誤り(「「電話」の列のセルを読めません(式・エラーの値)…」「…の列が日付のセルです…」)にする。業務の規則は `PATCH` と同じ: ファイル内・他のスタッフとのメール・サブメールの重なり(取込の後の状態で確かめる。ファイルの中で2人のメールを入れ替えるのは良い)、自分自身の降格・退職日、取込の後に退職日の決まっていない管理者が残らない(`last_admin`)、許可の一覧に無い予定のカレンダー(変えるときだけ)は誤り。`dryRun` は確かめるだけで何も書かない(`import_runs`・操作ログも無し、地図APIも呼ばない)。`planDigest` は反映する内容の指紋(行ごとの行番号・作成/更新/変更なし・対象のスタッフとその `row_version`・変わる項目と新しい値の SHA-256。16進64文字。操作ログには残さない)で、反映(`dryRun: false`)は確かめたときの `planDigest` を付けて送る(無ければ 400 `plan_digest_required`)。反映は誤りが1件も無いときだけ: 指紋が今の内容と違えば地図APIを呼ぶ前に 409 `import_stale`「確かめた後に他の人がスタッフの情報を変えました。もう一度ファイルを選んで確かめてから取り込んでください」(確かめた後に他の管理者が対象のスタッフを変えた(ファイルに無い列でも)・ファイルが違う)、自宅住所が変わる行をトランザクションの前にジオコーディング(同じ住所は1回。見つからない・失敗は住所だけ保存して warnings)、1つのトランザクションで在籍中の管理者の行をロックして読み直して確かめ直し(誤りになる・指紋が変われば 409 `import_stale`、操作する人がもう管理者でなければ 403)、変わる行だけを書き(メール・サブメールが変わるスタッフは先に全員のログイン用メールを外してから書く)、今日以前の退職日を入れたスタッフはセッションを失効し通知の購読を消し、`import_runs`(`staff_xlsx`)に件数を残す。コミットの後に SECURITY `staff.xlsx_import.applied`(`importRunId`・件数・`retired`・`warnings`・`geocode: { geocoded, notFound, failed }`(地図APIを呼んだ住所の数))と、書いたスタッフごとに SECURITY `staff.admin.created` / `staff.admin.updated`(画面の登録・更新と同じ形: `targetStaffId`・`changedFields`(項目の名前だけ)・変わったときの `role` / `retiredOn`・`homeGeocode`、作成は `initialPasswordSet: false`。加えて `via: 'staff_xlsx'`・`importRunId`。値そのものは残さない)。誤り・`import_stale` で反映しないときは WARN `staff.xlsx_import.rejected`(`reason`)。回数制限は確かめる・反映の両方を `staff_xlsx_import_staff` で、反映はさらに `staff_import_apply_staff` でも数える(429)。展開すると大きすぎるファイルは exceljs で読む前に 400 `xlsx_too_large`(展開の上限は 1.4)。読めないファイルは 400 `invalid_xlsx`、シートが20枚を超えれば 400 `too_many_sheets`、シートの行が2000行を超えれば 400 `too_many_rows`。41列目より右の列は読まない |
| `GET /api/admin/audit-logs` | `auditLogQuerySchema`(`from?`・`to?`(業務日、両端を含む。既定は今日までの7日間、93日まで)・`level?`・`staffId?`(操作者か対象)・`action?`(操作コードの前方一致)・`cursor?`・`limit`(1〜200、既定50))/ `auditLogListResponseSchema` | `{ entries: [{ id, createdAt, level, action, actorType, actorStaffId, actorName, targetStaffId, targetName, details, ip, userAgent, requestId }], nextCursor, range: { from, to }, timeZone }`。新しい順(`created_at`, `id` の keyset。`nextCursor` を次の `cursor` に)。テナントの行だけ(tenant_id が null のログイン前の記録は出さない)。期間の誤り・読めない `cursor` は 400(`fields.from` / `invalid_cursor`)。最初のページだけ INFO `audit_log.viewed`(条件。スタッフを絞れば `targetStaffId`) |
| `GET /api/admin/audit-logs.csv` | 同上(`cursor`・`limit` は使わない) | `text/csv; charset=utf-8`(BOM つき、CRLF、`attachment; filename="audit-logs_<from>_<to>.csv"`)。見出し: 日時(テナントのタイムゾーン)・レベル・操作・操作コード・操作者の種類・操作者・対象スタッフ・詳細・IPアドレス・ユーザーエージェント・リクエストID。条件に合う全件を500件ずつ別のトランザクションで読んで流す。`=`・`+`・`-`・`@` で始まる値は先頭に `'` を付ける。受け取る側が切ったら読むのをやめる。途中で失敗したら(状態コードは送った後なので 200 のまま)最後の行に「※ 書き出しが途中で失敗しました(request id <X-Request-Id>)…」を書き、ERROR を残す。読み始める前に SECURITY `audit_log.exported` |
| `POST /api/admin/customers/import` | `customerCsvImportRequestSchema`(`force` 既定 true。**権限はコーディネーター・管理者**(`requireCoordinator`。一般スタッフは 403 + WARN `customer_csv.import.access_denied`)で、`force: true` は管理者だけ(コーディネーターは 403・同じ WARN の理由 `force_not_admin`)。お客様タブのボタンは `force: false`)/ `customerCsvImportResponseSchema` | `{ status, message, fileName, version, stats, dataVersion }`(失敗の応答は同じ本文に `code` が付き、`{ code, message }` のエラーの形も満たす)。回数の上限 `customer_csv_import_staff`(テナント + スタッフ、1時間30回、429)。`imported` / `up_to_date` / `no_files` / `not_configured` は 200、`review_required` 409(`code: 'conflict'`。`force` なしで、同じ版の CSV を前回のジョブが既に止めているときは、ファイルを読まず `import_runs`・操作ログも残さずに同じ応答を返す。新しい CSV か管理者の `force` で再試行。`message`「この顧客CSV(<ファイル名>)は、消えた顧客が多すぎるため取り込みを止めています。CSVの内容を確認し、正しいCSVをファイル名の日時が新しいものとして置いてください(同じ日時のファイル名で置き直しても読み直しません。急ぐときは管理者に取り込み直しを頼んでください)。」。止めたかは版(ファイル名の日時)で見る)、`busy` 409(`code: 'conflict'`。他の顧客の取込(定期の取込・外部連携の API)が5秒より長くロックを持っていた。`message`「別の顧客の取込が実行中です。しばらくしてから送り直してください。」、何も書かない)、`failed` 502(`code: 'upstream_unavailable'`。`message` は「顧客CSVの取込に失敗しました。しばらくしてからもう一度お試しください(続くときは管理者へ連絡してください)。」で、原因は操作ログ ERROR `customer_csv.import_failed` だけに残す) |

| `GET /api/admin/report-ai` | — / `reportAiMastersResponseSchema` | `{ keywords, ageBands, educationLevels, psiLevels, phrases, stanceRules }`(アーカイブしていない行。各行に `id`・`rowVersion`・`updatedAt`)。日報AIの調整(02 10.4) |
| `POST /api/admin/report-ai/:kind` | `kind` = `keywords` / `age-bands` / `phrases` / `stance-rules`、`save*RequestSchema`(`row`)/ `reportAiRowSavedResponseSchema` | 201 `{ id, rowVersion, updatedAt }`。自然キー(ID・年齢帯・区分+表現・項目)が他の行と重なれば 409 `duplicate_key`(アーカイブした行と同じキーならその行を戻して書き換える)。年齢帯の月齢範囲が重なれば 400 `age_band_overlap`。INFO `settings.report_ai.row_saved` |
| `PUT /api/admin/report-ai/:kind/:id` | 同上 + `rowVersion?` | 版が違えば 409(`stale_row_version`)、無ければ 404。自然キーが他の行(アーカイブした行も含む。キーの UNIQUE はアーカイブした行にもかかる)と重なれば 409 `duplicate_key`。同上 |
| `DELETE /api/admin/report-ai/:kind/:id` | `archiveReportAiRowRequestSchema`(`rowVersion?`)/ `okResponseSchema` | アーカイブ(プロンプトに使わなくなる)。INFO `settings.report_ai.row_archived` |
| `PUT /api/admin/report-ai/education-levels/:level`・`/psi-levels/:level` | `saveReportEducationLevelRequestSchema` / `saveReportPsiLevelRequestSchema`(`row`・`rowVersion?`)/ 同上 | 段階(1〜5)の行を書く(無ければ作る)。1〜5 の外は 404 |
| `POST /api/admin/report-ai/import` | `reportAiImportRequestSchema`(`fileBase64`(xlsx。2MB まで)・`fileName?`・`dryRun`(既定 true))/ `reportAiImportResponseSchema` | `{ dryRun, applied, counts: { <表>: { rows, created, updated, unchanged } }, errors: [{ sheet, row, message }], warnings }`。`dryRun` は数えるだけ。誤りが無ければ全ての表を1つのトランザクションで反映し `import_runs`(`report_ai_xlsx`)に件数を残す(INFO `settings.report_ai.imported`)。誤りがあれば何も書かない(WARN `settings.report_ai.import_rejected`)。読めないファイルは 400 `invalid_xlsx`(シート30枚・2000行・40列まで)。展開すると大きすぎるファイルは exceljs で読む前に 400 `xlsx_too_large`(展開の上限は 1.4)。回数制限 `report_ai_xlsx_import_staff`(確かめる・反映の両方。429) |
| `GET /api/admin/report-ai/export.xlsx` | — | 取込と同じシート名・見出しの xlsx(`日報キーワード表現マスター.xlsx`)。INFO `settings.report_ai.exported` |
| `GET /api/admin/report-ai/usage.csv?from&to` | `reportAiUsageQuerySchema`(業務日、両端を含む。366日まで) | `text/csv; charset=utf-8`(BOM つき)。ID・キーワード・カテゴリ・候補に出した回数・AIが使った回数(候補に出した語だけ)・候補外でAIが使ったと答えた回数(期間の生成の記録から。候補に出なかった語も並べる。候補外の答えは生成と同じ突き合わせで今の表の語に直し、直せない答えは最後の「(表に無い答え)」の行にまとめる)。INFO `settings.report_ai.usage_exported` |

拒否は WARN `<action>.access_denied`(`staff.admin.list` / `staff.admin.delete` / `staff.admin.password_guide` / `audit_log.view` / `audit_log.export` / `settings.report_ai.view` / `settings.report_ai.import` 等)・`staff.admin.create_rejected` / `update_rejected` / `delete_rejected` / `password_guide_rejected`(`details.reason` に理由コード)・`customer_csv.import.access_denied`。
操作コードの日本語の表示名は `@katahimo/shared` の `AUDIT_ACTION_LABELS`(画面と CSV で共有)。

### 2.10 通知 `/api/push`(`routes/push.ts`、全てログイン)

Web Push(翌日の予定のお知らせ・テスト通知。02 9.1、05 10章)。購読はログイン中の**本人の端末だけ**を扱う(要求にスタッフの
指定は無い)。`endpoint` は既知のプッシュサービス(`fcm.googleapis.com`・`android.googleapis.com`・`push.services.mozilla.com`・
`push.apple.com`・`notify.windows.com` とそのサブドメイン)の `https` の URL だけ(`isAllowedPushEndpoint`。ワーカーが任意の
URL へ送らないように)。操作ログに `endpoint`・鍵は残さない。

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー・ログ |
| --- | --- | --- |
| `GET /config` | — / `pushConfigResponseSchema` | `{ enabled, publicKey }`。VAPID の設定(`VAPID_PUBLIC_KEY`)が無ければ `{ enabled: false, publicKey: null }` |
| `POST /subscriptions` | `pushSubscribeRequestSchema`(`PushSubscription.toJSON()` の形: `endpoint`・`expirationTime?`・`keys: { p256dh, auth }`)/ `okResponseSchema` | 同じ `endpoint` が本人のものなら鍵を書き直す。別のスタッフのものは、送られた鍵(`p256dh`・`auth`)が登録済みの鍵と同じときだけ本人に付け替え(同じ端末のブラウザの購読。WARN `push.subscription.moved`、`previousStaffId`・`targetStaffId`)、鍵が違えば何も書かずに 409 `conflict`「この端末の通知は別のスタッフの登録として残っています。…」+ WARN `push.subscription.takeover_refused`(`reason: keys_mismatch`。endpoint を知った人が自分の鍵で他人の購読を奪い、その人の通知を受け取るのを防ぐ。画面は端末の購読を作り直して1回だけ登録し直す)。User-Agent(300字まで)を残す。1人10件まで(超えたら `updated_at` の古いものから消す)。通知を使えない環境は 400。回数制限 `push_subscribe_staff`。INFO `push.subscription.saved`(`subscriptionId`・`created`・消した数 `trimmed`) |
| `DELETE /subscriptions` | `pushUnsubscribeRequestSchema`(`endpoint`)/ `okResponseSchema` | 本人の購読だけを消す(無ければ何もしない)。INFO `push.subscription.deleted`(`subscriptionId`・`deleted`) |
| `POST /test` | — / `pushTestResponseSchema` | `{ ok, subscriptionCount }`。本人の全ての購読に送るテスト通知を購読ごとに outbox に積む。購読が無ければ 400。回数制限 `push_test_staff`。INFO `push.test.queued` |

### 2.11 外部システム連携 `/api/integrations`(`routes/integrations.ts`、API キー)

RESERVA 等の外部システムからの受け口(05 11章)。認証は `Authorization: Bearer kth_<テナントID>_<乱数>`(運用担当者が
`pnpm tenant:api-keys` で発行するテナントごとの API キー。07 3.6)だけで、**Cookie のセッションは使わない**(ログイン中の画面からは
呼べない。Cookie を自動で送られないため CSRF の前提に当たらない。1.4 の CSRF・JSON の検査はそのまま掛かる)。テナントと書ける取込元は
キーで決まり、本体では指定しない。トークンの `<テナントID>` の部分で RLS のテナントを決め、トークン全体の SHA-256 で
`integration_api_keys` を引く(平文を比べない)。キーが無い・形が違う・無い(別のテナントのIDに差し替えた場合を含む)・失効は 401、
テナントが利用停止中は 403(どちらも WARN `integration.auth_failed`、理由コードだけ)。同じ送信元IPからの失敗が続けば一時的に 429
(`integration_auth_failure_ip`。ロック中は正しいキーでも確かめず、操作ログも残さない。ロックの始まりに1回 WARN `integration.auth_locked`)。

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー・ログ |
| --- | --- | --- |
| `POST /customers` | `integrationCustomersRequestSchema`(`mode`(`upsert` だけ。既定)・`customers`(1〜500件): `externalId`・`familyName`・`givenName?`・`displayName?`(null・空は「姓 名」)・`familyNameKana?`・`givenNameKana?`・`email?`・`phone?`・`memo?`・`benefitMemberId?`・`evacuationSite?`・`home?`(`addressLine`・`prefecture?`・`city?`(省けば住所から取り出す)・`parkingArea?`・`parkingDetail?`・`lat?`・`lng?`(両方か無し))・`secondary?`(`home` と同じ + `validFrom?`・`validTo?`(両端を含む `YYYY-MM-DD`))・`emergencyContact?`(`relation?`・`phone?`)・`recipients?`(20人まで: `name`・`birthDate?`・`needs?`・`allergy?`)・`attributes?`(英小文字のキー → 値、30項目まで)・`externalRegisteredAt?`・`externalUpdatedAt?`(ISO 8601、時差つき))/ `integrationCustomersResponseSchema` | 200 `{ importRunId, counts: { created, updated, unchanged, skipped }, results: [{ externalId, outcome, issues }], dataVersion }`(`results` は送った順)。**省いた項目は今の値のまま、null は空にする**(部分的な送信でよい。新しい顧客では省いた項目は空、表示名は「姓 名」。`displayName` を省いて姓・名を変えたときは、今の表示名が今の姓名から作った「姓 名」の形なら新しい姓名で作り直し、取込元が別に付けた表示名は今のまま)。`home`・`secondary`・`emergencyContact` はまとまりごと、`attributes` はオブジェクトごと、`recipients` は配列ごと(渡せば全員を置き換え、配列に無い子どもはアーカイブ。`[]` で全員を外す)に置き換える(顧客CSVの1行は今の全ての値で、空の列は空にする。05 11章)。キーの取込元 × `externalId` で突き合わせ、作成・更新だけを行う(**削除・アーカイブはしない**)。全件を1トランザクションで適用し `import_runs`(`source = external_api`)を残す。同じテナントの取込(この API の同時の送信・顧客CSVの取込)とはテナントごとのロックで1つずつ適用する(待ってから適用する。同じ新しい顧客IDを同時に送っても顧客は1人)。他の取込が5秒(アプリのロールの `lock_timeout`)より長くロックを持っていれば 409 `conflict`「別の顧客の取込が実行中です。しばらくしてから送り直してください。」(何も書かない。WARN `integration.customers.ingest_failed`、`error: conflict:customer_import_in_progress`)。同じ `externalId` が2回・存在しない日付・住所2の期間の逆転・緯度だけ等は 400(何も書かない)。回数制限 `integration_customers_key`。INFO `integration.customers.ingested`(`skipped`・`issues` があれば WARN)。それ以外の理由で適用に失敗したら何も残さず 500 と ERROR `integration.customers.ingest_failed` |

### 2.12 公開デモの設定 `/api/demo`(`routes/demo.ts`)

| メソッド・パス | 権限 | 応答 | 備考 |
| --- | --- | --- | --- |
| `GET /api/demo/config` | 誰でも(ログイン不要) | `demoConfigResponseSchema` | 環境変数 `DEMO_*` の表示設定だけを返す(DB を読まない・操作ログに残さない・`Cache-Control: no-store`)。`DEMO_TENANT_SLUG` が無ければ `{ enabled: false }`。あれば `{ enabled: true, tenantSlug, publicLogin, accounts: [], password: null, dataRetentionDays, logRetentionMonths, aiUsesPerSession }`。認証情報は環境にかかわらず返さない(`accounts` と `password` は旧クライアントとの互換用)。`publicLogin` はデモ専用環境の既定法人IDを決める。`dataRetentionDays`(`DEMO_DATA_RETENTION_DAYS`)・`logRetentionMonths`(`DEMO_LOG_RETENTION_MONTHS`)・`aiUsesPerSession`(10)は画面の案内に入れる値。日数・月数は null になりうる(null = 期間を約束しない): `publicLogin` が true なら未設定でも 30・12、false なら明示したときだけ返す。画面は日数が null なら「毎晩作り直します」も期間も書かない(02 3.1) |

web はログイン画面で、デモ用テナントの法人IDが入っているなら注意書きを出し、`publicLogin` なら会社IDの既定をデモ用テナントにする(02 3章)。認証情報の表示・自動入力はしない。読めなかったときはデモではない扱い。

## 3. 本番での Web 画面の配信

`WEB_DIST_DIR` を設定すると、`/api/*` の後に静的ファイルを配信する(`http/webStatic.ts`)。拡張子の無いパスは `index.html`
(SPA)。キャッシュ: `assets/*`・`workbox-<hash>.js` は1年 immutable、`index.html`・`sw.js`・`push-sw.js`(通知の処理)・
`registerSW.js`・`manifest.webmanifest` は `no-cache`、その他は1時間。

## 4. 新しいエンドポイントを足すとき

1. `packages/shared/src/contracts/` に要求(クエリも)と応答の zod スキーマを足す(ルートの中で要求の形を定義しない)。
2. usecase(`core/usecases`)を書き、失敗は `DomainError` で投げる。権限は `requireSession` / `requireAdmin` と
   `targetStaffIdOf` で決め、usecase でも確かめる。
3. ルートは `parseJsonBody` / `parseQuery` → usecase → `jsonOk(c, 応答の契約, …)`。
4. `packages/api/src/routes.integration.test.ts` にエラーの形・権限のテストを足し、この資料の2章に行を足す。
5. 画面は `packages/web/src/api/<機能>.ts` から同じ契約で呼ぶ。
